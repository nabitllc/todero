#!/bin/bash
# pipeline-watchdog.sh — single unified watchdog, every 30 min
# Replaces: aggressive-kicker-5min + pipeline-orchestrator
#
# Philosophy: check, don't spam. If an agent is actively running and
# making progress, leave it alone. Only intervene when something is
# idle, stuck, or structurally wrong.
#
# Per run:
#   1. For each lane: check if agent is active (has a live claude process
#      or was updated recently). If active → skip. If idle with eligible
#      work → kick. If stuck (claimed >30m, no progress) → clear + kick.
#   2. Strategic: feature pipeline depth, empty-queue Telegram alert,
#      escalation detection, worktree GC.
#   3. Discord summary only when something happened.

set -u
LOG=/tmp/pipeline-watchdog.log
API="http://localhost:3000/api/issues"
RUN_API="http://localhost:3000/api/run-agent"
NOTIFY_API="http://localhost:3000/api/notify"
AGENTS_API="http://localhost:3000/api/agents"
TODERO_DIR="/Users/kemuniagent/todero"
STATE=/tmp/pipeline-watchdog.state.json

# Thresholds (seconds)
BUILDER_STALE=2700    # 45 min
REVIEWER_STALE=900    # 15 min
DEFAULT_STALE=1800    # 30 min
RECENT_WINDOW=900     # 15 min — "recently active" window

exec >> "$LOG" 2>&1
echo
echo "=== $(date '+%F %T %Z') ==="

# ── Helpers ─────────────────────────────────────────────────────────────
kick() {
  local AGENT="$1"
  local R
  R=$(curl -s -X POST "$RUN_API?agent=$AGENT" 2>/dev/null)
  if echo "$R" | grep -q '"ok":true'; then
    local KEY
    KEY=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin).get('task',{}).get('taskKey','?'))" 2>/dev/null || echo '?')
    echo "  ✓ $AGENT → $KEY"
    ACTIONS="${ACTIONS}${AGENT}:${KEY} "
    return 0
  else
    # Log WHY the kick failed (WIP limit, no eligible, etc.)
    local MSG
    MSG=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin).get('message','unknown')[:80])" 2>/dev/null || echo "parse-error")
    echo "  ✗ $AGENT: $MSG"
    return 1
  fi
}

notify_telegram() {
  python3 -c "
import json, sys, urllib.request
msg = sys.argv[1]
data = json.dumps({'channels':['telegram-dm'],'text':msg}).encode()
req = urllib.request.Request('http://localhost:3000/api/notify', data=data,
    headers={'Content-Type':'application/json'}, method='POST')
try: urllib.request.urlopen(req, timeout=10)
except: pass
" "$1" 2>/dev/null
}

# ── Fetch state ─────────────────────────────────────────────────────────
ISSUES=$(curl -s "$API" 2>/dev/null)
if [ -z "$ISSUES" ] || echo "$ISSUES" | grep -q '"error"'; then
  echo "[FATAL] API unreachable"
  NOTABLE="${NOTABLE}SERVER_DOWN "
  exit 1
fi

ACTIONS=""
NOTABLE=""

# ═══════════════════════════════════════════════════════════════════════
# PART 1: Per-lane health check
# ═══════════════════════════════════════════════════════════════════════

# Get all lanes' state in one python call
LANE_STATE=$(echo "$ISSUES" | python3 -c "
import json, sys, datetime
issues = json.load(sys.stdin)
now = datetime.datetime.now(datetime.timezone.utc)

def age_sec(ts):
    if not ts: return 999999
    try: return (now - datetime.datetime.fromisoformat(ts.replace('Z','+00:00'))).total_seconds()
    except: return 999999

lanes = {
    'builder':    {'pickup':'open',         'working':'in_progress',  'stale':$BUILDER_STALE,  'assignee_match':True},
    'ops':        {'pickup':'open',         'working':'in_progress',  'stale':$DEFAULT_STALE,  'assignee_match':True},
    'scout':      {'pickup':'open',         'working':'in_progress',  'stale':$DEFAULT_STALE,  'assignee_match':True},
    'tester':     {'pickup':'code_review',  'working':'code_review',  'stale':$REVIEWER_STALE, 'assignee_match':False},
    'designer':   {'pickup':'code_review',  'working':'code_review',  'stale':$REVIEWER_STALE, 'assignee_match':False},
    'po':         {'pickup':'backlog',      'working':'defined',      'stale':$DEFAULT_STALE,  'assignee_match':True},
    'auditor':    {'pickup':'released',     'working':'released',     'stale':$DEFAULT_STALE,  'assignee_match':True},
    'deployer':   {'pickup':'approved',     'working':'approved',     'stale':$DEFAULT_STALE,  'assignee_match':True},
    'todero-sme': {'pickup':'backlog',      'working':'draft',        'stale':$DEFAULT_STALE,  'assignee_match':True},
}

for agent, cfg in lanes.items():
    # Count eligible
    if agent in ('tester','designer'):
        field = 'tester_status' if agent == 'tester' else 'designer_status'
        eligible = sum(1 for i in issues
            if i.get('status') == cfg['pickup']
            and i.get(field) == 'pending'
            and i.get('acceptance_criteria')
            and not i.get('is_blocked'))
    elif agent == 'todero-sme':
        eligible = sum(1 for i in issues
            if i.get('assignee') == agent
            and i.get('status') == cfg['pickup']
            and i.get('type') == 'epic'
            and not i.get('is_blocked'))
    else:
        eligible = sum(1 for i in issues
            if i.get('assignee') == agent
            and i.get('status') == cfg['pickup']
            and not i.get('is_blocked'))

    # Count in-flight (has started_at in working status)
    inflight = [i for i in issues
        if i.get('status') == cfg['working']
        and i.get('started_at')
        and (not cfg['assignee_match'] or i.get('assignee') == agent)]

    # Check for stuck claims
    stale_keys = []
    for i in inflight:
        if age_sec(i.get('started_at')) > cfg['stale']:
            stale_keys.append(i.get('task_key','?'))

    # Recently updated = active
    recent = sum(1 for i in issues
        if i.get('assignee') == agent
        and age_sec(i.get('updated_at')) < $RECENT_WINDOW)

    # Classify
    if inflight and not stale_keys:
        state = 'ACTIVE'
    elif stale_keys:
        state = 'STUCK'
    elif eligible > 0:
        state = 'IDLE_WITH_WORK'
    elif recent > 0:
        state = 'ACTIVE'
    else:
        state = 'IDLE'

    print(f'{agent}|{state}|{eligible}|{len(inflight)}|{\" \".join(stale_keys)}')
")

echo "[lanes]"
while IFS='|' read -r AGENT STATE ELIGIBLE INFLIGHT STALE_KEYS; do
  [ -z "$AGENT" ] && continue

  case "$STATE" in
    ACTIVE)
      # Agent is working, not stuck. Leave it alone.
      ;;
    STUCK)
      # Clear stale claims, then kick
      echo "  ⚠ $AGENT STUCK on: $STALE_KEYS"
      for KEY in $STALE_KEYS; do
        curl -s -X PATCH "$API" -H "Content-Type: application/json" \
          -d "{\"task_key\":\"$KEY\",\"started_at\":null,\"transitioned_by\":\"main\"}" \
          -o /dev/null
      done
      kick "$AGENT"
      NOTABLE="${NOTABLE}${AGENT}:stuck "
      ;;
    IDLE_WITH_WORK)
      # Has eligible work but no active spawn. Kick.
      echo "  → $AGENT idle with $ELIGIBLE eligible"
      kick "$AGENT"
      ;;
    IDLE)
      # Nothing to do. Fine.
      ;;
  esac
done <<< "$LANE_STATE"

# ═══════════════════════════════════════════════════════════════════════
# PART 2: Strategic checks
# ═══════════════════════════════════════════════════════════════════════

read OPEN_WORK DEF_FEAT BKLOG_FEAT <<< $(echo "$ISSUES" | python3 -c "
import json, sys
issues = json.load(sys.stdin)
ow = sum(1 for i in issues if i.get('status')=='open' and i.get('type') in ('task','bug','ops','research') and not i.get('is_blocked'))
df = sum(1 for i in issues if i.get('status')=='defined' and i.get('type')=='feature' and not i.get('is_blocked'))
bf = sum(1 for i in issues if i.get('status')=='backlog' and i.get('type')=='feature' and not i.get('is_blocked'))
print(ow, df, bf)
")

# §1 Empty open queue → Discord #alerts (was Telegram — changed 2026-04-13)
if [ "$OPEN_WORK" -eq 0 ]; then
  echo "[strategic] ⚠ Open queue EMPTY"
  NOTABLE="${NOTABLE}open=EMPTY "
fi

# §2 Feature pipeline depth
if [ "$DEF_FEAT" -lt 5 ]; then
  echo "[strategic] ⚠ Feature pipeline thin: $DEF_FEAT defined, $BKLOG_FEAT backlog"
  NOTABLE="${NOTABLE}feat_thin "
  if [ "$BKLOG_FEAT" -gt 0 ]; then
    kick po
  else
    kick todero-sme; kick kemuni-sme; kick vespera-sme; kick infra-sme
    NOTABLE="${NOTABLE}feat_pipeline_dry "
  fi
fi

# §3 Escalation tracking (Builder+PO both stuck for 2+ consecutive runs)
PREV_STREAK=0
STATE_FILE=/tmp/pipeline-watchdog.state.json
[ -f "$STATE_FILE" ] && PREV_STREAK=$(python3 -c "import json; print(json.load(open('${STATE_FILE}')).get('stuck_streak',0))" 2>/dev/null || echo 0)

B_STUCK=$(echo "$LANE_STATE" | grep "^builder|STUCK\|^builder|IDLE_WITH_WORK" | wc -l | tr -d ' ')
P_STUCK=$(echo "$LANE_STATE" | grep "^po|STUCK\|^po|IDLE_WITH_WORK" | wc -l | tr -d ' ')

STREAK=$PREV_STREAK
if [ "$B_STUCK" -gt 0 ] && [ "$P_STUCK" -gt 0 ]; then
  STREAK=$((STREAK+1))
else
  STREAK=0
fi

STATE_FILE=/tmp/pipeline-watchdog.state.json
python3 -c "import json; json.dump({'stuck_streak':$STREAK,'last':'$(date -u +%FT%TZ)'},open('${STATE_FILE}','w'))"

if [ "$STREAK" -ge 2 ]; then
  echo "[strategic] 🚨 ESCALATION: Builder+PO stuck $STREAK consecutive runs"
  # Send to Discord #alerts, NOT Telegram DM. Telegram DM is reserved for
  # direct conversation with KAOS, not automated pipeline alerts.
  NOTABLE="${NOTABLE}ESCALATION(${STREAK}h) "
fi

# §4 Worktree GC
PRUNED=0
cd "$TODERO_DIR" 2>/dev/null
for wt in $(git worktree list --porcelain 2>/dev/null | awk '/^worktree/ {print $2}' | grep "agent-worktrees"); do
  if [ -d "$wt" ]; then
    AGE_MIN=$(python3 -c "import os,time; print(int((time.time()-os.path.getmtime('$wt'))/60))" 2>/dev/null || echo 0)
    if [ "$AGE_MIN" -gt 120 ]; then
      git worktree remove --force "$wt" 2>/dev/null && PRUNED=$((PRUNED+1))
    fi
  fi
done
git worktree prune 2>/dev/null
[ "$PRUNED" -gt 0 ] && NOTABLE="${NOTABLE}gc=$PRUNED "

# ═══════════════════════════════════════════════════════════════════════
# PART 3: Summary (Discord only if something happened)
# ═══════════════════════════════════════════════════════════════════════
if [ -n "$NOTABLE" ] || [ -n "$ACTIONS" ]; then
  python3 -c "
import json, sys, urllib.request
msg = sys.argv[1]
data = json.dumps({'channels':['discord-alerts'],'text':msg}).encode()
req = urllib.request.Request('http://localhost:3000/api/notify', data=data,
    headers={'Content-Type':'application/json'}, method='POST')
try: urllib.request.urlopen(req, timeout=10)
except: pass
" "Watchdog $(date '+%H:%M %Z') | ${NOTABLE}${ACTIONS:+spawned: $ACTIONS}" 2>/dev/null
  echo "[discord] $NOTABLE$ACTIONS"
fi

echo "[$(date '+%T')] done"

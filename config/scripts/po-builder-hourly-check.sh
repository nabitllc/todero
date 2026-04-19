#!/bin/bash
# po-builder-hourly-check.sh — runs every hour at :00 via LaunchAgent
# work.nabit.po-builder-check. Checks PO and Builder specifically.
#
# Per-run logic:
#  1. Find stuck Builder claims: assignee=builder, status=in_progress, started_at > 45m ago.
#     → clear started_at so the slot reopens.
#  2. Find stuck PO claims: assignee=po, status=defined, started_at > 15m ago.
#     → clear started_at.
#  3. Classify the CURRENT health for each of {po, builder}:
#     - 🟢 RUNNING (has an active spawn OR updated in last 15 min)
#     - 🟡 IDLE_NO_WORK (no eligible issues to pick up)
#     - 🔴 STUCK (has eligible work but no running spawn, or just recovered stale claims)
#  4. Re-kick both lanes unconditionally. WIP enforcement + "no eligible" messages
#     are safe — over-spawn is impossible.
#  5. Persist classification to STATE. Escalate to Telegram DM if BOTH lanes are 🔴
#     for TWO consecutive checks (i.e., an hour of dead pipeline).
#  6. Report every run to Discord #alerts via /api/notify.
#
# This LaunchAgent does NOT self-unload — it runs indefinitely. To stop it:
#   launchctl unload ~/Library/LaunchAgents/work.nabit.po-builder-check.plist

set -u
LOG=/tmp/po-builder-hourly-check.log
API="http://localhost:3000/api/issues"
RUN_API="http://localhost:3000/api/run-agent"
NOTIFY_API="http://localhost:3000/api/notify"
AGENTS_API="http://localhost:3000/api/agents"
STATE=/tmp/po-builder-hourly-check.state.json

# Stuck thresholds (in seconds)
BUILDER_STUCK_SEC=$((45*60))   # 45 minutes
PO_STUCK_SEC=$((15*60))        # 15 minutes
RECENT_ACTIVITY_SEC=$((15*60)) # 15-min "running" window

exec >> "$LOG" 2>&1
echo
echo "=== $(date '+%F %T %Z') ==="

# ── 1 & 2. Clear stuck started_at on Builder + PO ──────────────────────────
STUCK_KEYS=$(curl -s "$API" | BUILDER_STUCK_SEC=$BUILDER_STUCK_SEC PO_STUCK_SEC=$PO_STUCK_SEC python3 -c "
import json, sys, datetime, os
issues = json.load(sys.stdin)
now = datetime.datetime.now(datetime.timezone.utc)
b_cut = now - datetime.timedelta(seconds=int(os.environ['BUILDER_STUCK_SEC']))
p_cut = now - datetime.timedelta(seconds=int(os.environ['PO_STUCK_SEC']))
out = []
for i in issues:
  st = i.get('started_at')
  if not st: continue
  try:
    t = datetime.datetime.fromisoformat(st.replace('Z','+00:00'))
  except: continue
  a = i.get('assignee'); s = i.get('status'); k = i.get('task_key','')
  if a == 'builder' and s == 'in_progress' and t < b_cut:
    out.append(('builder', k))
  elif a == 'po' and s == 'defined' and t < p_cut:
    out.append(('po', k))
for who,k in out: print(who, k)
")
BUILDER_RECOVERED=0
PO_RECOVERED=0
if [ -n "$STUCK_KEYS" ]; then
  while read -r WHO KEY; do
    [ -z "$KEY" ] && continue
    CODE=$(curl -s -X PATCH "$API" -H "Content-Type: application/json" \
      -d "{\"task_key\":\"$KEY\",\"started_at\":null,\"transitioned_by\":\"main\"}" \
      -o /dev/null -w "%{http_code}")
    echo "[stuck] $WHO $KEY → cleared started_at (http=$CODE)"
    if [ "$WHO" = "builder" ]; then BUILDER_RECOVERED=$((BUILDER_RECOVERED+1)); fi
    if [ "$WHO" = "po" ]; then PO_RECOVERED=$((PO_RECOVERED+1)); fi
  done <<< "$STUCK_KEYS"
else
  echo "[stuck] none"
fi

# ── 3. Classify each lane ──────────────────────────────────────────────────
#   Need two things per lane:
#    a. Is there a running spawn / recent activity?
#    b. Is there eligible work sitting in the pickup queue?
CLASS=$(curl -s "$API" | RECENT_ACTIVITY_SEC=$RECENT_ACTIVITY_SEC python3 -c "
import json, sys, datetime, os
issues = json.load(sys.stdin)
now = datetime.datetime.now(datetime.timezone.utc)
window = datetime.timedelta(seconds=int(os.environ['RECENT_ACTIVITY_SEC']))

def recent(ts):
  if not ts: return False
  try: return (now - datetime.datetime.fromisoformat(ts.replace('Z','+00:00'))) < window
  except: return False

# Builder: eligible = assignee=builder, status=open, description + AC present, not blocked
builder_eligible = [i for i in issues
  if i.get('assignee') == 'builder' and i.get('status') == 'open'
  and i.get('description') and i.get('acceptance_criteria')
  and not i.get('is_blocked')]
builder_inflight = [i for i in issues if i.get('assignee') == 'builder' and i.get('status') == 'in_progress' and i.get('started_at')]
builder_recent = [i for i in issues if i.get('assignee') == 'builder' and recent(i.get('updated_at'))]

# PO: eligible = assignee=po, status=backlog, type in (feature,task,bug)
po_eligible = [i for i in issues
  if i.get('assignee') == 'po' and i.get('status') == 'backlog'
  and i.get('type') in ('feature','task','bug')]
po_inflight = [i for i in issues if i.get('assignee') == 'po' and i.get('status') == 'defined' and i.get('started_at')]
po_recent = [i for i in issues if i.get('assignee') == 'po' and recent(i.get('updated_at'))]

def classify(inflight, eligible, recent_touches):
  if inflight or recent_touches: return 'RUNNING'
  if not eligible: return 'IDLE_NO_WORK'
  return 'STUCK'

b_state = classify(builder_inflight, builder_eligible, builder_recent)
p_state = classify(po_inflight, po_eligible, po_recent)

out = {
  'builder': {
    'state': b_state,
    'inflight': len(builder_inflight),
    'eligible': len(builder_eligible),
    'recent': len(builder_recent),
    'top_key': builder_inflight[0].get('task_key') if builder_inflight else (builder_eligible[0].get('task_key') if builder_eligible else None),
  },
  'po': {
    'state': p_state,
    'inflight': len(po_inflight),
    'eligible': len(po_eligible),
    'recent': len(po_recent),
    'top_key': po_inflight[0].get('task_key') if po_inflight else (po_eligible[0].get('task_key') if po_eligible else None),
  },
}
print(json.dumps(out))
")
echo "[class] $CLASS"

B_STATE=$(echo "$CLASS" | python3 -c "import json,sys; print(json.load(sys.stdin)['builder']['state'])")
P_STATE=$(echo "$CLASS" | python3 -c "import json,sys; print(json.load(sys.stdin)['po']['state'])")
B_ELIGIBLE=$(echo "$CLASS" | python3 -c "import json,sys; print(json.load(sys.stdin)['builder']['eligible'])")
P_ELIGIBLE=$(echo "$CLASS" | python3 -c "import json,sys; print(json.load(sys.stdin)['po']['eligible'])")
B_INFLIGHT=$(echo "$CLASS" | python3 -c "import json,sys; print(json.load(sys.stdin)['builder']['inflight'])")
P_INFLIGHT=$(echo "$CLASS" | python3 -c "import json,sys; print(json.load(sys.stdin)['po']['inflight'])")
B_TOP=$(echo "$CLASS" | python3 -c "import json,sys; print(json.load(sys.stdin)['builder'].get('top_key') or '-')")
P_TOP=$(echo "$CLASS" | python3 -c "import json,sys; print(json.load(sys.stdin)['po'].get('top_key') or '-')")

# ── 4. Re-kick both lanes ──────────────────────────────────────────────────
BUILDER_SPAWN=""
PO_SPAWN=""
R=$(curl -s -X POST "$RUN_API?agent=builder")
if echo "$R" | grep -q '"ok":true'; then
  BUILDER_SPAWN=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin).get('task',{}).get('taskKey','?'))" 2>/dev/null)
  echo "[kick] builder spawned on $BUILDER_SPAWN"
fi
R=$(curl -s -X POST "$RUN_API?agent=po")
if echo "$R" | grep -q '"ok":true'; then
  PO_SPAWN=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin).get('task',{}).get('taskKey','?'))" 2>/dev/null)
  echo "[kick] po spawned on $PO_SPAWN"
fi

# ── 5. Escalation state tracking ───────────────────────────────────────────
# State file stores { "prev_builder_state": "...", "prev_po_state": "...", "stuck_streak": N }
PREV_B="none"; PREV_P="none"; STREAK=0
if [ -f "$STATE" ]; then
  PREV_B=$(python3 -c "import json; d=json.load(open('$STATE')); print(d.get('prev_builder_state','none'))" 2>/dev/null || echo "none")
  PREV_P=$(python3 -c "import json; d=json.load(open('$STATE')); print(d.get('prev_po_state','none'))" 2>/dev/null || echo "none")
  STREAK=$(python3 -c "import json; d=json.load(open('$STATE')); print(d.get('stuck_streak',0))" 2>/dev/null || echo "0")
fi

# Is this run "both stuck"?
BOTH_STUCK="no"
if [ "$B_STATE" = "STUCK" ] && [ "$P_STATE" = "STUCK" ]; then
  BOTH_STUCK="yes"
  STREAK=$((STREAK+1))
else
  STREAK=0
fi

# Write new state
python3 -c "
import json
json.dump({
  'prev_builder_state': '$B_STATE',
  'prev_po_state': '$P_STATE',
  'stuck_streak': $STREAK,
  'last_check': '$(date -u +%Y-%m-%dT%H:%M:%SZ)',
}, open('$STATE','w'), indent=2)
"

ESCALATE="no"
if [ "$STREAK" -ge 2 ]; then
  ESCALATE="yes"
  echo "[escalate] streak=$STREAK — both PO+Builder stuck for 2+ consecutive hours"
fi

# ── 6. Compose + post Discord (+ Telegram if escalating) ──────────────────
emoji_for() {
  case "$1" in
    RUNNING) echo "🟢" ;;
    IDLE_NO_WORK) echo "🟡" ;;
    STUCK) echo "🔴" ;;
    *) echo "❔" ;;
  esac
}

B_EMOJI=$(emoji_for "$B_STATE")
P_EMOJI=$(emoji_for "$P_STATE")
TIMESTAMP=$(date '+%H:%M %Z')

BODY_LINE1="🕐 Hourly check $TIMESTAMP"
BODY_LINE2="${B_EMOJI} Builder ${B_STATE} · eligible=${B_ELIGIBLE} inflight=${B_INFLIGHT} top=${B_TOP}"
BODY_LINE3="${P_EMOJI} PO ${P_STATE} · eligible=${P_ELIGIBLE} inflight=${P_INFLIGHT} top=${P_TOP}"
BODY_LINE4="recovered: builder=${BUILDER_RECOVERED} po=${PO_RECOVERED} · spawned: builder=${BUILDER_SPAWN:--} po=${PO_SPAWN:--}"
BODY="$BODY_LINE1
$BODY_LINE2
$BODY_LINE3
$BODY_LINE4"

if [ "$ESCALATE" = "yes" ]; then
  BODY="🚨 ESCALATION: PO+Builder both stuck $STREAK runs in a row
$BODY"
  CHANNELS='["discord-alerts","telegram-dm"]'
else
  CHANNELS='["discord-alerts"]'
fi

export BODY CHANNELS
PAYLOAD=$(python3 -c "
import json, os
print(json.dumps({'channels': json.loads(os.environ['CHANNELS']), 'text': os.environ['BODY']}))
")
CODE=$(curl -s -X POST "$NOTIFY_API" -H "Content-Type: application/json" -d "$PAYLOAD" -o /dev/null -w "%{http_code}")
echo "[discord] http=$CODE channels=$CHANNELS"
echo "[$(date '+%T')] done"

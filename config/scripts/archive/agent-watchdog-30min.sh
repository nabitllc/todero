#!/bin/bash
# agent-watchdog-30min.sh — runs every 30 min.
# 1. Find stale in_progress claims (>2h old) and clear their started_at so
#    the WIP slot opens up. We do NOT transition status — that requires a
#    per-type validator path and we want this to be uniform.
# 2. For every agent lane, POST /api/run-agent. WIP enforcement guards against
#    over-spawn; if a lane has nothing eligible, run-agent returns a "no eligible"
#    message and that's fine.
# 3. Post a status summary to Discord #alerts via /api/notify.
# 4. Self-unload after MAX_RUNS.

set -u
LOG=/tmp/agent-watchdog-30min.log
API="http://localhost:3000/api/issues"
RUN_API="http://localhost:3000/api/run-agent"
NOTIFY_API="http://localhost:3000/api/notify"
STATE=/tmp/agent-watchdog-30min.state
MAX_RUNS=7

exec >> "$LOG" 2>&1
echo
echo "=== $(date '+%F %T %Z') ==="

# Increment run counter
RUNS=0
if [ -f "$STATE" ]; then RUNS=$(cat "$STATE" 2>/dev/null || echo 0); fi
RUNS=$((RUNS+1))
echo "[runs] $RUNS of $MAX_RUNS"
echo "$RUNS" > "$STATE"

# ── 1. Stale started_at clearing ────────────────────────────────────────────
STALE_KEYS=$(curl -s "$API" | python3 -c "
import json, sys, datetime
issues = json.load(sys.stdin)
cut = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=2)
out = []
for i in issues:
  if i.get('status') not in ('in_progress','defined','released'): continue
  st = i.get('started_at')
  if not st: continue
  try:
    t = datetime.datetime.fromisoformat(st.replace('Z','+00:00'))
    if t < cut:
      out.append(i.get('task_key',''))
  except: pass
print(' '.join(out))
")
if [ -n "$STALE_KEYS" ]; then
  echo "[stale] clearing started_at on: $STALE_KEYS"
  for KEY in $STALE_KEYS; do
    CODE=$(curl -s -X PATCH "$API" -H "Content-Type: application/json" \
      -d "{\"task_key\":\"$KEY\",\"started_at\":null,\"transitioned_by\":\"main\"}" \
      -o /dev/null -w "%{http_code}")
    echo "  $KEY → http=$CODE"
  done
else
  echo "[stale] none"
fi

# ── 2. Kick every lane ──────────────────────────────────────────────────────
SPAWNED=""
for AGENT in builder tester designer ops po auditor deployer todero-sme kemuni-sme vespera-sme infra-sme; do
  R=$(curl -s -X POST "$RUN_API?agent=$AGENT")
  if echo "$R" | grep -q '"ok":true'; then
    KEY=$(echo "$R" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('task',{}).get('taskKey','?'))" 2>/dev/null || echo '?')
    echo "[kick] $AGENT spawned on $KEY"
    SPAWNED="$SPAWNED $AGENT:$KEY"
  elif echo "$R" | grep -q "WIP limit reached"; then
    : # busy, that's fine
  fi
done
if [ -z "$SPAWNED" ]; then
  echo "[kick] no new spawns (all lanes busy or idle with no eligible work)"
fi

# ── 3. Status summary ───────────────────────────────────────────────────────
SUMMARY=$(curl -s "$API" | python3 -c "
import json, sys
issues = json.load(sys.stdin)
by = {}
for i in issues:
  s = i.get('status','?')
  by[s] = by.get(s,0)+1
blocked = sum(1 for i in issues if i.get('is_blocked'))
inflight = (by.get('in_progress',0) + by.get('code_review',0) + by.get('product_review',0)
            + by.get('approved',0) + by.get('released',0))
queue = by.get('open',0) + by.get('defined',0)
print(f'in_flight={inflight} queue={queue} blocked={blocked} | ip={by.get(\"in_progress\",0)} cr={by.get(\"code_review\",0)} appr={by.get(\"approved\",0)} rel={by.get(\"released\",0)}')
")
echo "[summary] $SUMMARY"

AGENTS=$(curl -s http://localhost:3000/api/agents | python3 -c "
import json, sys, time
a = json.load(sys.stdin)
now = int(time.time()*1000)
running = [x for x in a if x.get('isRunning')]
recent = [x for x in a if not x.get('isRunning') and x.get('lastUpdatedAt') and (now - x['lastUpdatedAt']) < 30*60*1000]
parts = []
for x in running: parts.append('🟢'+x.get('name','?'))
for x in recent:
  m = round((now-x['lastUpdatedAt'])/60000)
  parts.append(f'🟡{x.get(\"name\",\"?\")} {m}m')
print(' | '.join(parts) if parts else 'none')
")
echo "[agents] $AGENTS"

# ── 4. Discord post via /api/notify ─────────────────────────────────────────
export RUNS MAX_RUNS SUMMARY AGENTS SPAWNED
export TIMESTAMP=$(date '+%H:%M %Z')
BODY=$(python3 -c "
import json, os
msg = f'''⏱️ Watchdog #{os.environ[\"RUNS\"]}/{os.environ[\"MAX_RUNS\"]} — {os.environ[\"TIMESTAMP\"]}
{os.environ[\"SUMMARY\"]}
agents: {os.environ[\"AGENTS\"]}
spawned:{os.environ[\"SPAWNED\"]}'''
# /api/notify expects 'text' (the notification route's required field)
print(json.dumps({'channels':['discord-alerts'],'text':msg}))
")
CODE=$(curl -s -X POST "$NOTIFY_API" -H "Content-Type: application/json" -d "$BODY" -o /dev/null -w "%{http_code}")
echo "[discord] http=$CODE"

# ── 5. Self-unload after MAX_RUNS ───────────────────────────────────────────
if [ "$RUNS" -ge "$MAX_RUNS" ]; then
  echo "[done] reached MAX_RUNS, unloading LaunchAgent"
  rm -f "$STATE"
  launchctl unload /Users/kemuniagent/Library/LaunchAgents/work.nabit.agent-watchdog-30min.plist 2>&1 || true
  rm -f /Users/kemuniagent/Library/LaunchAgents/work.nabit.agent-watchdog-30min.plist
fi

echo "[$(date '+%T')] done"

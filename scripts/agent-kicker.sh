#!/bin/bash
# Lightweight agent kicker — runs every 15 min via LaunchAgent
# Only hits localhost MC API (no direct Supabase = no egress)
# Checks each agent: if WIP < limit and eligible > 0, kicks via POST

set -euo pipefail
API="http://localhost:3000/api/run-agent"
log() { echo "[$(date '+%H:%M:%S')] $1"; }

# Check if server is up
if ! curl -sf "$API?agent=builder" -o /dev/null 2>/dev/null; then
  log "Server down — skipping"
  exit 0
fi

# Agents to kick (in priority order)
AGENTS="builder po tester designer deployer"

for AGENT in $AGENTS; do
  STATUS=$(curl -sf "$API?agent=$AGENT" 2>/dev/null || echo '{}')
  WIP=$(echo "$STATUS" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); lanes=d.get('lanes',[]); print(lanes[0].get('wip',0) if lanes else 0)" 2>/dev/null || echo 0)
  LIMIT=$(echo "$STATUS" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); lanes=d.get('lanes',[]); print(lanes[0].get('wipLimit',1) if lanes else 1)" 2>/dev/null || echo 1)
  ELIGIBLE=$(echo "$STATUS" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); lanes=d.get('lanes',[]); print(lanes[0].get('eligible',0) if lanes else 0)" 2>/dev/null || echo 0)

  if [ "$WIP" -lt "$LIMIT" ] && [ "$ELIGIBLE" -gt 0 ]; then
    log "$AGENT: WIP $WIP/$LIMIT, $ELIGIBLE eligible — kicking"
    RESULT=$(curl -sf -X POST "$API?agent=$AGENT" 2>/dev/null || echo '{"error":"failed"}')
    SPAWNED=$(echo "$RESULT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('task',{}).get('taskKey','none'))" 2>/dev/null || echo "?")
    log "$AGENT: picked up $SPAWNED"
  else
    log "$AGENT: WIP $WIP/$LIMIT, $ELIGIBLE eligible — idle"
  fi
done

# Clear stale claims: in_progress > 2h with no live claude process
STALE=$(curl -sf "http://localhost:3000/api/issues?fields=id,task_key,status,started_at&status=in_progress" 2>/dev/null || echo '[]')
echo "$STALE" | python3 -c "
import json, sys, urllib.request
from datetime import datetime, timezone
rows = json.loads(sys.stdin.read())
if not isinstance(rows, list): sys.exit(0)
now = datetime.now(timezone.utc)
for r in rows:
    sa = r.get('started_at')
    if not sa: continue
    started = datetime.fromisoformat(sa.replace('+00:00','+00:00'))
    hours = (now - started).total_seconds() / 3600
    if hours > 2:
        print(f'Stale: {r[\"task_key\"]} in_progress for {hours:.1f}h — resetting to open')
        data = json.dumps({'id': r['id'], 'status': 'open', 'started_at': None, 'worked_by': None, 'transitioned_by': 'main'}).encode()
        try:
            req = urllib.request.Request('http://localhost:3000/api/issues', data=data,
                headers={'Content-Type': 'application/json'}, method='PATCH')
            urllib.request.urlopen(req)
        except: pass
" 2>/dev/null

log "Done."

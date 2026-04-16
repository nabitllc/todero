#!/bin/bash
# Lightweight agent kicker — runs at :00 and :30 each hour via LaunchAgent
# Mirrors what Vercel cron does for /api/cron/watchdog and /api/cron/queue-refill
# No direct Supabase — only hits localhost MC API

set -euo pipefail
API="http://localhost:3000/api/run-agent"
BASE="http://localhost:3000"
log() { echo "[$(date '+%H:%M:%S')] $1"; }

# Check if server is up
if ! curl -sf "$API?agent=builder" -o /dev/null 2>/dev/null; then
  log "Server down — skipping"
  exit 0
fi

# ── Queue refill: promote refined → open to maintain minimum depth ────────────
log "Running queue-refill..."
REFILL=$(curl -sf "$BASE/api/cron/queue-refill" 2>/dev/null || echo '{}')
PROMOTED=$(echo "$REFILL" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('promotedCount',0))" 2>/dev/null || echo 0)
log "Queue-refill: $PROMOTED issues promoted to open"

# ── Watchdog: clear stale/ghost claims ───────────────────────────────────────
log "Running watchdog..."
WATCH=$(curl -sf "$BASE/api/cron/watchdog" 2>/dev/null || echo '{}')
CLEARED=$(echo "$WATCH" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(len(d.get('cleared',[])))" 2>/dev/null || echo 0)
log "Watchdog: $CLEARED stale claims cleared"

# ── Agent kicker: wake idle lanes ────────────────────────────────────────────
# Agents to kick (in priority order). Skip if WIP full (already handled by run-agent).
AGENTS="builder po tester designer deployer ops scout"

for AGENT in $AGENTS; do
  STATUS=$(curl -sf "$API?agent=$AGENT" 2>/dev/null || echo '{}')
  # Check if paused
  PAUSED=$(echo "$STATUS" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print('yes' if d.get('paused') else 'no')" 2>/dev/null || echo no)
  if [ "$PAUSED" = "yes" ]; then
    log "$AGENT: paused — skipping"
    continue
  fi

  WIP=$(echo "$STATUS" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); lanes=d.get('lanes',[]); print(lanes[0].get('wip',0) if lanes else 0)" 2>/dev/null || echo 0)
  LIMIT=$(echo "$STATUS" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); lanes=d.get('lanes',[]); print(lanes[0].get('wipLimit',1) if lanes else 1)" 2>/dev/null || echo 1)
  ELIGIBLE=$(echo "$STATUS" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); lanes=d.get('lanes',[]); print(lanes[0].get('eligible',0) if lanes else 0)" 2>/dev/null || echo 0)

  if [ "$WIP" -lt "$LIMIT" ] && [ "$ELIGIBLE" -gt 0 ]; then
    log "$AGENT: WIP $WIP/$LIMIT, $ELIGIBLE eligible — kicking"
    RESULT=$(curl -sf -X POST "$API?agent=$AGENT" 2>/dev/null || echo '{"error":"failed"}')
    SPAWNED=$(echo "$RESULT" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('task',{}).get('taskKey','none'))" 2>/dev/null || echo "?")
    log "$AGENT: picked up $SPAWNED"
  else
    log "$AGENT: WIP $WIP/$LIMIT, $ELIGIBLE eligible — at capacity or idle"
  fi
done

# Queue refill: promote refined → open so agents always have work.
# The endpoint checks each lane; if open count < QUEUE_MIN (5), promotes refined issues.
REFILL=$(curl -sf -X POST "http://localhost:3000/api/queue-refill" 2>/dev/null || echo '{"ok":false,"promoted":[]}')
PROMOTED=$(echo "$REFILL" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); p=d.get('promoted',[]); print(', '.join(p) if p else 'none')" 2>/dev/null || echo "?")
log "queue-refill: promoted [$PROMOTED]"

log "Done."

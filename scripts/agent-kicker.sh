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

log "Done."

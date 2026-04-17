#!/bin/bash
# agent-kicker.sh — runs at :00 and :30 each hour via work.nabit.agent-kicker LaunchAgent
#
# Three jobs per tick:
#   1. queue-refill  — promotes refined→open for all agents/types to maintain depth ≥5
#   2. watchdog      — clears stale in_progress claims so issues don't get stuck
#   3. agent-trigger — calls POST /api/run-agent for each active agent whose open queue
#                      has tasks. Each endpoint enforces its own WIP limit, so calling
#                      when an agent is already at capacity is a safe no-op.
#
# Agents triggered: builder, ops, scout, po, tester, auditor, deployer
# NOT triggered: designer (manual only — needs human-quality UX judgment)

set -uo pipefail
BASE="http://localhost:3000"
SECRET="${INTERNAL_SECRET:-kaos-internal-2026}"
log() { echo "[$(date '+%H:%M:%S')] $1"; }

# ── Health check ──────────────────────────────────────────────────────────────
if ! curl -sf "$BASE/api/health" -o /dev/null 2>/dev/null; then
  log "Server down — skipping"
  exit 0
fi

# ── 1. Queue refill ───────────────────────────────────────────────────────────
log "Running queue-refill..."
REFILL=$(curl -sf "$BASE/api/cron/queue-refill" 2>/dev/null || echo '{}')
PROMOTED=$(echo "$REFILL" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('promotedCount',0))" 2>/dev/null || echo 0)
log "Queue-refill: $PROMOTED issues promoted to open"

# ── 2. Watchdog ───────────────────────────────────────────────────────────────
log "Running watchdog..."
WATCH=$(curl -sf "$BASE/api/cron/watchdog" 2>/dev/null || echo '{}')
CLEARED=$(echo "$WATCH" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(len(d.get('cleared',[])))" 2>/dev/null || echo 0)
log "Watchdog: $CLEARED stale claims cleared"

# ── 3. Agent triggers ─────────────────────────────────────────────────────────
# Call POST /api/run-agent for each agent. The endpoint:
#   - Returns immediately if WIP limit reached (agent already active at capacity)
#   - Returns immediately if no eligible issues in queue
#   - Spawns a new claude session only when there is work and capacity available
#
# This is idempotent — safe to call every 30 min even if agents are already running.

kick_agent() {
  local AGENT="$1"
  local RESULT
  RESULT=$(curl -sf -X POST "$BASE/api/run-agent?agent=$AGENT" \
    -H "Content-Type: application/json" \
    -H "x-internal-secret: $SECRET" \
    -d '{}' 2>/dev/null || echo '{"error":"curl failed"}')

  local MSG
  MSG=$(echo "$RESULT" | python3 -c "
import json, sys
d = json.loads(sys.stdin.read())
if d.get('ok'):
    print(f\"spawned: {d.get('task', d.get('taskKey','?'))}\")
elif d.get('wip') is not None:
    print(f\"at WIP limit ({d['wip']}) — skipping\")
elif 'No eligible' in str(d.get('message','')):
    print('no eligible issues — idle')
elif d.get('paused'):
    print('paused (loop breaker or hub pause)')
elif d.get('error'):
    print(f\"error: {d['error']}\")
else:
    print(d.get('message', str(d))[:80])
" 2>/dev/null || echo "$RESULT" | head -c 80)

  log "  $AGENT: $MSG"
}

log "Triggering agents..."
kick_agent "builder"
kick_agent "ops"
kick_agent "po"
kick_agent "scout"
kick_agent "tester"
kick_agent "auditor"
kick_agent "deployer"

log "Done."

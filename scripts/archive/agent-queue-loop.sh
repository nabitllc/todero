#!/bin/bash
# TOD-576: Generic agent queue loop — parameterized by agent ID
# Usage: bash scripts/agent-queue-loop.sh <agent_id> [interval_seconds]
# Example: bash scripts/agent-queue-loop.sh scout 600
#
# One-at-a-time lane enforcement:
# 1. Check if agent session already running (skip if so)
# 2. Call POST /api/run-agent?agent=<id> to pick next issue
# 3. Dispatch agent via openclaw message (TOD-487) or Claude --print
# 4. Wait for completion, then loop
# 5. Heartbeat logged to /tmp/<agent>-queue.log

set -euo pipefail

AGENT_ID="${1:?Usage: agent-queue-loop.sh <agent_id> [interval_seconds]}"
INTERVAL="${2:-600}"

LOG="/tmp/${AGENT_ID}-queue.log"
LOCK="/tmp/${AGENT_ID}-queue-instance.lock"
MC_API="${MC_API_URL:-http://localhost:3000/api}"
INTERNAL_SECRET="${INTERNAL_SECRET:-kaos-internal-2026}"

SUPA_URL="${NEXT_PUBLIC_SUPABASE_URL:?NEXT_PUBLIC_SUPABASE_URL is not set - see .env.local.template}"
SUPA_KEY="${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY is not set - see .env.local.template}"

MC_DIR="${TODERO_DIR:-$HOME/mission-control}"
VES_DIR="/var/folders/r0/hww7pxv12txb9sfmlmmw76xw0000gn/T/tmp.8qWeSvST6Z"

log() { echo "[$(date '+%H:%M:%S')] [$AGENT_ID] $1" | tee -a "$LOG"; }

# Single instance guard
if [ -f "$LOCK" ] && kill -0 "$(cat "$LOCK")" 2>/dev/null; then
  log "Queue loop already running (PID $(cat "$LOCK")) — exiting"
  exit 0
fi
echo $$ > "$LOCK"
trap "rm -f $LOCK" EXIT

log "=== Queue loop started (interval=${INTERVAL}s) ==="

while true; do
  log "--- tick ---"

  # Check if agent session is already active
  if pgrep -f "claude.*${AGENT_ID}" > /dev/null 2>&1; then
    log "Agent session active — skipping tick"
    sleep "$INTERVAL"
    continue
  fi

  # Call unified queue endpoint to pick next issue
  RESPONSE=$(curl -sf -X POST "${MC_API}/run-agent?agent=${AGENT_ID}" \
    -H "x-internal-secret: ${INTERNAL_SECRET}" \
    -H "Content-Type: application/json" 2>/dev/null || echo '{"error":"API unreachable"}')

  OK=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('ok',''))" 2>/dev/null || echo "")

  if [ "$OK" != "True" ]; then
    MSG=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('message',d.get('error','no issues')))" 2>/dev/null || echo "no issues")
    log "Skip: $MSG"
    sleep "$INTERVAL"
    continue
  fi

  # Extract task details
  TASK_ID=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['task']['id'])" 2>/dev/null)
  TASK_KEY=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['task'].get('taskKey',''))" 2>/dev/null)
  TASK_TITLE=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['task']['title'])" 2>/dev/null)
  PROJECT=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['task'].get('project',''))" 2>/dev/null)
  PROMPT=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('prompt',''))" 2>/dev/null)

  log "Picked: $TASK_KEY — $TASK_TITLE (project=$PROJECT)"

  # Determine repo directory
  if [ "$PROJECT" = "Vespera" ]; then
    REPO_DIR="$VES_DIR"
  else
    REPO_DIR="$MC_DIR"
  fi

  # Load workspace context (TOD-490)
  CONTEXT=""
  if [ -f "$MC_DIR/scripts/spawn-context.sh" ]; then
    CONTEXT=$(bash "$MC_DIR/scripts/spawn-context.sh" "$REPO_DIR" 2>/dev/null || echo "")
  fi

  # Dispatch via openclaw message if available, otherwise Claude --print
  if command -v /opt/homebrew/bin/openclaw &>/dev/null; then
    FULL_PROMPT="${CONTEXT}

${PROMPT}

When done, report completion:
curl -sf -X PATCH '${MC_API}/issues' -H 'Content-Type: application/json' -d '{\"id\":\"${TASK_ID}\",\"status\":\"in_review\",\"implementation_notes\":\"Completed by ${AGENT_ID} agent\"}'
/opt/homebrew/bin/openclaw system event --text '${AGENT_ID}: completed ${TASK_KEY} — ${TASK_TITLE}' --mode now"

    log "Dispatching via openclaw message --agent ${AGENT_ID}"
    /opt/homebrew/bin/openclaw message --agent "$AGENT_ID" --text "$FULL_PROMPT" 2>>"$LOG" || {
      # Fallback to Claude --print if openclaw message fails
      log "openclaw message failed — falling back to Claude --print"
      cd "$REPO_DIR" && timeout 300 /opt/homebrew/bin/claude --permission-mode bypassPermissions --print "$FULL_PROMPT" >> "$LOG" 2>&1 || true
    }
  else
    log "Dispatching via Claude --print"
    cd "$REPO_DIR" && timeout 300 /opt/homebrew/bin/claude --permission-mode bypassPermissions --print "${CONTEXT}

${PROMPT}" >> "$LOG" 2>&1 || true
  fi

  log "Agent finished: $TASK_KEY"

  # Post-task memory accumulation (TOD-489)
  if [ -f "$MC_DIR/scripts/post-task-memory.sh" ]; then
    log "Running post-task memory for $TASK_KEY"
    bash "$MC_DIR/scripts/post-task-memory.sh" "$AGENT_ID" "$TASK_KEY" "$TASK_TITLE" "0" 2>>"$LOG" || {
      log "post-task-memory failed (non-fatal)"
    }
  fi

  # Log heartbeat
  curl -sf -X POST "$SUPA_URL/rest/v1/agent_runs" \
    -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" -H "Content-Type: application/json" \
    -d "{\"agent_id\":\"${AGENT_ID}\",\"task_id\":\"${TASK_ID}\",\"task_title\":\"${TASK_TITLE}\",\"status\":\"done\"}" >/dev/null 2>&1 || true

  sleep "$INTERVAL"
done

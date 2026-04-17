#!/usr/bin/env bash
# scripts/builder-with-cost.sh
# Runs a builder Claude session and writes cost/token stats back to agent_runs.
#
# Usage: builder-with-cost.sh <runId> <repoDir> <promptFile>
#   runId      — agent_runs.id (UUID); "none" to skip cost write-back
#   repoDir    — absolute path to the cloned repo directory
#   promptFile — path to file containing the full prompt (deleted after run)
#
# Writes to /tmp/builder-cost-<runId>.log for debugging.

set -uo pipefail

RUN_ID="${1:?runId required}"
REPO_DIR="${2:?repoDir required}"
PROMPT_FILE="${3:?promptFile required}"
API="${INTERNAL_API:-http://localhost:3000}"
SECRET="${INTERNAL_SECRET:-kaos-internal-2026}"
LOG="/tmp/builder-cost-${RUN_ID}.log"

log() { echo "[$(date '+%H:%M:%S')] $1" | tee -a "$LOG"; }

log "builder-with-cost starting: run=$RUN_ID dir=$REPO_DIR"

if [ ! -f "$PROMPT_FILE" ]; then
  log "ERROR: promptFile not found: $PROMPT_FILE"
  exit 1
fi

if [ ! -d "$REPO_DIR" ]; then
  log "ERROR: repoDir not found: $REPO_DIR"
  exit 1
fi

# ── Run claude with JSON output, capturing result ──────────────────────────
# --output-format=json emits a single JSON object when done with total_cost_usd + usage
CLAUDE_OUTPUT=$(cd "$REPO_DIR" && claude \
  --permission-mode bypassPermissions \
  --print \
  --output-format=json \
  "$(cat "$PROMPT_FILE")" 2>>"$LOG") || true

log "Claude session finished. Parsing cost/tokens..."

# ── Parse total_cost_usd ───────────────────────────────────────────────────
COST=$(printf '%s' "$CLAUDE_OUTPUT" | python3 -c "
import json, sys
try:
    d = json.loads(sys.stdin.read())
    print(round(float(d.get('total_cost_usd', 0)), 6))
except Exception as e:
    import sys; print(0, file=sys.stderr)
    print(0)
" 2>>"$LOG" || echo "0")

# ── Parse tokens (all categories) ─────────────────────────────────────────
TOKENS=$(printf '%s' "$CLAUDE_OUTPUT" | python3 -c "
import json, sys
try:
    d = json.loads(sys.stdin.read())
    u = d.get('usage', {})
    total = (u.get('input_tokens', 0)
           + u.get('output_tokens', 0)
           + u.get('cache_creation_input_tokens', 0)
           + u.get('cache_read_input_tokens', 0))
    print(int(total))
except Exception as e:
    import sys; print(0, file=sys.stderr)
    print(0)
" 2>>"$LOG" || echo "0")

# ── Determine success vs error ─────────────────────────────────────────────
IS_ERROR=$(printf '%s' "$CLAUDE_OUTPUT" | python3 -c "
import json, sys
try:
    d = json.loads(sys.stdin.read())
    print('true' if d.get('is_error', False) else 'false')
except:
    print('true')
" 2>/dev/null || echo "true")

STATUS="done"
[ "$IS_ERROR" = "true" ] && STATUS="error"

log "Parsed: status=$STATUS cost=\$$COST tokens=$TOKENS"

# ── Write-back cost/tokens to agent_runs (skip if runId is "none") ─────────
if [ "$RUN_ID" != "none" ]; then
  PATCH_RESULT=$(curl -sf -X PATCH "$API/api/agent-runs/$RUN_ID" \
    -H "Content-Type: application/json" \
    -H "x-internal-secret: $SECRET" \
    -d "{\"tokens_used\":$TOKENS,\"cost_usd\":$COST,\"status\":\"$STATUS\"}" \
    2>>"$LOG") || true
  log "PATCH agent_runs: $PATCH_RESULT"
else
  log "Skipping cost write-back (runId=none)"
fi

# ── Cleanup ────────────────────────────────────────────────────────────────
rm -f "$PROMPT_FILE"
log "Done. Log: $LOG"

#!/usr/bin/env bash
# post-task-memory.sh — Appends lessons/corrections after each agent session (TOD-489)
#
# Usage:
#   bash scripts/post-task-memory.sh <agent_id> <task_key> <task_title> [exit_status]
#
# Reads the completed task's reviewer_notes, rejection_count, and implementation_notes
# from Supabase, then appends a timestamped entry to the agent's self-improving files:
#   workspace-<agent>/self-improving/corrections.md  (if rejected or had errors)
#   workspace-<agent>/self-improving/memory.md       (always — patterns learned)
#
# Called by agent-queue-loop.sh after each task completes.

set -euo pipefail

AGENT_ID="${1:?Usage: post-task-memory.sh <agent_id> <task_key> <task_title> [exit_status]}"
TASK_KEY="${2:?Missing task_key}"
TASK_TITLE="${3:?Missing task_title}"
EXIT_STATUS="${4:-0}"

MC_API="${MC_API_URL:-http://localhost:3000/api}"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Fetch task details via MC API
TASK_DATA=$(curl -sf "${MC_API}/issues?task_key=${TASK_KEY}" 2>/dev/null || echo "[]")

REVIEWER_NOTES=$(echo "$TASK_DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0].get('reviewer_notes','') or '')" 2>/dev/null || echo "")
REJECTION_COUNT=$(echo "$TASK_DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0].get('rejection_count',0) or 0)" 2>/dev/null || echo "0")
IMPL_NOTES=$(echo "$TASK_DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0].get('implementation_notes','') or '')" 2>/dev/null || echo "")
REJECTION_REASON=$(echo "$TASK_DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0].get('last_rejection_reason','') or '')" 2>/dev/null || echo "")
TESTER_NOTES=$(echo "$TASK_DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0].get('tester_notes','') or '')" 2>/dev/null || echo "")
DESIGNER_NOTES=$(echo "$TASK_DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0].get('designer_notes','') or '')" 2>/dev/null || echo "")
TASK_STATUS=$(echo "$TASK_DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0].get('status','') or '')" 2>/dev/null || echo "")

# --- Corrections: append via MC API if task was rejected or had build errors ---
if [ "$REJECTION_COUNT" -gt 0 ] || [ "$EXIT_STATUS" != "0" ]; then
  CORRECTION_ENTRY="### ${TIMESTAMP} — ${TASK_KEY}: ${TASK_TITLE}
- **Rejection count:** ${REJECTION_COUNT}"
  if [ "$EXIT_STATUS" != "0" ]; then
    CORRECTION_ENTRY="${CORRECTION_ENTRY}
- **Build/runtime error:** exit code ${EXIT_STATUS}"
  fi
  if [ -n "$REJECTION_REASON" ]; then
    CORRECTION_ENTRY="${CORRECTION_ENTRY}
- **Rejection reason:** ${REJECTION_REASON}"
  fi
  if [ -n "$REVIEWER_NOTES" ]; then
    CORRECTION_ENTRY="${CORRECTION_ENTRY}
- **Reviewer feedback:** ${REVIEWER_NOTES}"
  fi

  python3 /Users/kemuniagent/todero/config/scripts/append-agent-memory.py \
    "$AGENT_ID" \
    --task-key "$TASK_KEY" \
    --context "$TASK_TITLE" \
    --correction "$CORRECTION_ENTRY" \
    --type global \
    --status tentative 2>/dev/null || true

  echo "[post-task-memory] Correction appended for ${TASK_KEY} (rejections=${REJECTION_COUNT}, exit=${EXIT_STATUS})"
fi

# --- Memory: always append a session entry via MC API ---
MEMORY_ENTRY="### ${TIMESTAMP} — ${TASK_KEY}: ${TASK_TITLE}
- **Status:** ${TASK_STATUS}"
if [ -n "$IMPL_NOTES" ]; then
  MEMORY_ENTRY="${MEMORY_ENTRY}
- **What was done:** ${IMPL_NOTES}"
fi
if [ "$REJECTION_COUNT" -gt 0 ]; then
  MEMORY_ENTRY="${MEMORY_ENTRY}
- **Corrections applied:** ${REJECTION_COUNT} rejection(s)"
fi

python3 /Users/kemuniagent/todero/config/scripts/append-agent-memory.py \
  "$AGENT_ID" \
  --task-key "$TASK_KEY" \
  --context "$TASK_TITLE" \
  --reflection "$MEMORY_ENTRY" 2>/dev/null || true

echo "[post-task-memory] Memory appended for ${TASK_KEY}"
echo "[post-task-memory] Done for ${AGENT_ID}/${TASK_KEY}"

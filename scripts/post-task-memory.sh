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

MC_DIR="/Users/kemuniagent/mission-control"
SUPA_URL="https://twthgapiouiqhavrcnry.supabase.co"
SUPA_KEY="${SUPABASE_SERVICE_ROLE_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q}"

WORKSPACE_DIR="${MC_DIR}/workspace-${AGENT_ID}/self-improving"
MEMORY_FILE="${WORKSPACE_DIR}/memory.md"
CORRECTIONS_FILE="${WORKSPACE_DIR}/corrections.md"
TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

# Ensure workspace exists
mkdir -p "$WORKSPACE_DIR"

# Fetch task details from Supabase
TASK_DATA=$(curl -sf "${SUPA_URL}/rest/v1/issues?task_key=eq.${TASK_KEY}&select=reviewer_notes,rejection_count,implementation_notes,last_rejection_reason,tester_notes,designer_notes,status" \
  -H "apikey: ${SUPA_KEY}" -H "Authorization: Bearer ${SUPA_KEY}" 2>/dev/null || echo "[]")

REVIEWER_NOTES=$(echo "$TASK_DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0].get('reviewer_notes','') or '')" 2>/dev/null || echo "")
REJECTION_COUNT=$(echo "$TASK_DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0].get('rejection_count',0) or 0)" 2>/dev/null || echo "0")
IMPL_NOTES=$(echo "$TASK_DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0].get('implementation_notes','') or '')" 2>/dev/null || echo "")
REJECTION_REASON=$(echo "$TASK_DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0].get('last_rejection_reason','') or '')" 2>/dev/null || echo "")
TESTER_NOTES=$(echo "$TASK_DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0].get('tester_notes','') or '')" 2>/dev/null || echo "")
DESIGNER_NOTES=$(echo "$TASK_DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0].get('designer_notes','') or '')" 2>/dev/null || echo "")
TASK_STATUS=$(echo "$TASK_DATA" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d[0].get('status','') or '')" 2>/dev/null || echo "")

# --- Corrections: append if task was rejected or had build errors ---
if [ "$REJECTION_COUNT" -gt 0 ] || [ "$EXIT_STATUS" != "0" ]; then
  {
    echo ""
    echo "### ${TIMESTAMP} — ${TASK_KEY}: ${TASK_TITLE}"
    echo "- **Rejection count:** ${REJECTION_COUNT}"
    if [ "$EXIT_STATUS" != "0" ]; then
      echo "- **Build/runtime error:** exit code ${EXIT_STATUS}"
    fi
    if [ -n "$REJECTION_REASON" ]; then
      echo "- **Rejection reason:** ${REJECTION_REASON}"
    fi
    if [ -n "$REVIEWER_NOTES" ]; then
      echo "- **Reviewer feedback:** ${REVIEWER_NOTES}"
    fi
    if [ -n "$TESTER_NOTES" ]; then
      echo "- **Tester feedback:** ${TESTER_NOTES}"
    fi
    if [ -n "$DESIGNER_NOTES" ]; then
      echo "- **Designer feedback:** ${DESIGNER_NOTES}"
    fi
    echo ""
  } >> "$CORRECTIONS_FILE"
  echo "[post-task-memory] Correction appended for ${TASK_KEY} (rejections=${REJECTION_COUNT}, exit=${EXIT_STATUS})"
fi

# --- Memory: always append a session entry ---
{
  echo ""
  echo "### ${TIMESTAMP} — ${TASK_KEY}: ${TASK_TITLE}"
  echo "- **Status:** ${TASK_STATUS}"
  if [ -n "$IMPL_NOTES" ]; then
    echo "- **What was done:** ${IMPL_NOTES}"
  fi
  if [ "$REJECTION_COUNT" -gt 0 ]; then
    echo "- **Corrections applied:** ${REJECTION_COUNT} rejection(s) — see corrections.md"
  fi
  if [ -n "$REVIEWER_NOTES" ]; then
    echo "- **Reviewer insight:** ${REVIEWER_NOTES}"
  fi
  echo ""
} >> "$MEMORY_FILE"
echo "[post-task-memory] Memory appended for ${TASK_KEY}"

# --- Store to Supabase agent_memory for cross-session access ---
SESSION_ENTRY=$(python3 -c "
import json, sys
entry = {
    'task_key': '${TASK_KEY}',
    'title': '${TASK_TITLE}',
    'timestamp': '${TIMESTAMP}',
    'status': '${TASK_STATUS}',
    'rejection_count': int('${REJECTION_COUNT}' or 0),
    'had_build_error': '${EXIT_STATUS}' != '0',
}
print(json.dumps(entry))
" 2>/dev/null)

curl -sf -X POST "${SUPA_URL}/rest/v1/agent_memory" \
  -H "apikey: ${SUPA_KEY}" -H "Authorization: Bearer ${SUPA_KEY}" \
  -H "Content-Type: application/json" \
  -H "Prefer: resolution=merge-duplicates" \
  -d "{\"agent_id\":\"${AGENT_ID}\",\"key\":\"last_session_${TASK_KEY}\",\"value\":${SESSION_ENTRY},\"updated_at\":\"${TIMESTAMP}\"}" \
  >/dev/null 2>&1 || true

echo "[post-task-memory] Done for ${AGENT_ID}/${TASK_KEY}"

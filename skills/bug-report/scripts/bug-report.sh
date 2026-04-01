#!/usr/bin/env bash
# bug-report.sh — Create a bug issue on the MC board
# Usage: bug-report.sh --title "..." --project "..." --priority "medium" --description "..." --ac "..."
# Optionally: --assignee builder --sprint 2026-03-30

set -euo pipefail

MC_URL="${MC_URL:-http://localhost:3000}"
SPRINT="$(date +%Y-%m-%d)"

TITLE=""
PROJECT=""
PRIORITY="medium"
ASSIGNEE="builder"
DESCRIPTION=""
AC=""
PARENT_ID=""

# Parse args
while [[ $# -gt 0 ]]; do
  case "$1" in
    --title)       TITLE="$2";       shift 2 ;;
    --project)     PROJECT="$2";     shift 2 ;;
    --priority)    PRIORITY="$2";    shift 2 ;;
    --assignee)    ASSIGNEE="$2";    shift 2 ;;
    --description) DESCRIPTION="$2"; shift 2 ;;
    --ac)          AC="$2";          shift 2 ;;
    --sprint)      SPRINT="$2";      shift 2 ;;
    --parent-id)   PARENT_ID="$2";   shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

# Validate required
if [[ -z "$TITLE" ]]; then   echo "Error: --title required" >&2;   exit 1; fi
if [[ -z "$PROJECT" ]]; then echo "Error: --project required" >&2; exit 1; fi
if [[ -z "$AC" ]]; then      AC="Bug is fixed and no longer reproducible."; fi
if [[ -z "$DESCRIPTION" ]]; then DESCRIPTION="$TITLE"; fi

# Build JSON payload
PAYLOAD=$(python3 -c "
import json, sys
d = {
    'title':                sys.argv[1],
    'project':              sys.argv[2],
    'type':                 'bug',
    'priority':             sys.argv[3],
    'assignee':             sys.argv[4],
    'sprint':               sys.argv[5],
    'description':          sys.argv[6],
    'acceptance_criteria':  sys.argv[7],
}
if sys.argv[8]: d['parent_id'] = sys.argv[8]
print(json.dumps(d))
" "$TITLE" "$PROJECT" "$PRIORITY" "$ASSIGNEE" "$SPRINT" "$DESCRIPTION" "$AC" "$PARENT_ID")

# POST to MC API
RESPONSE=$(curl -s -X POST "$MC_URL/api/issues" \
  -H "Content-Type: application/json" \
  -d "$PAYLOAD")

TASK_KEY=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('task_key','?'))" 2>/dev/null || echo "?")
STATUS=$(echo "$RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print('ok' if 'task_key' in d else d.get('error','unknown error'))" 2>/dev/null || echo "unknown")

if [[ "$STATUS" == "ok" ]]; then
  echo "Bug $TASK_KEY created — $TITLE"
  exit 0
else
  echo "Error creating bug: $STATUS" >&2
  echo "Response: $RESPONSE" >&2
  exit 1
fi

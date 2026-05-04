#!/bin/bash
# INF-192: DoR enforcement nightly — find DoR-incomplete issues, set to backlog, alert Discord
# Runs nightly via n8n cron
# DoR-incomplete = assignee=builder AND (description IS NULL OR test_tier IS NULL OR acceptance_criteria IS NULL) AND status NOT IN (completed, closed, backlog)
set -euo pipefail

SUPA_URL="https://twthgapiouiqhavrcnry.supabase.co"
SUPA_KEY="${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY is required}"
MC_API="${MC_API_URL:-http://localhost:3000/api}"
DISCORD_CHANNEL="${DISCORD_ALERTS_CHANNEL:-1487584901678104698}"

echo "[dor-nightly] Starting DoR enforcement check..."

# Find builder-assigned non-terminal/non-backlog issues missing DoR fields
MISSING_DESC=$(curl -sf "$SUPA_URL/rest/v1/issues?assignee=eq.builder&status=not.in.(completed,closed,backlog)&description=is.null&select=id,task_key,title,project&limit=200" \
  -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" 2>/dev/null || echo "[]")

MISSING_TIER=$(curl -sf "$SUPA_URL/rest/v1/issues?assignee=eq.builder&status=not.in.(completed,closed,backlog)&test_tier=is.null&select=id,task_key,title,project&limit=200" \
  -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" 2>/dev/null || echo "[]")

MISSING_AC=$(curl -sf "$SUPA_URL/rest/v1/issues?assignee=eq.builder&status=not.in.(completed,closed,backlog)&acceptance_criteria=is.null&select=id,task_key,title,project&limit=200" \
  -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" 2>/dev/null || echo "[]")

# Combine and deduplicate by id
ALL_INCOMPLETE=$(echo "$MISSING_DESC $MISSING_TIER $MISSING_AC" | jq -s 'add | unique_by(.id)')
COUNT=$(echo "$ALL_INCOMPLETE" | jq 'length')

if [ "$COUNT" -eq 0 ]; then
  echo "[dor-nightly] All builder issues are DoR-complete"
  exit 0
fi

echo "[dor-nightly] Found $COUNT DoR-incomplete issues. Moving to backlog..."

# Move each to backlog
echo "$ALL_INCOMPLETE" | jq -c '.[]' | while read -r ISSUE; do
  ID=$(echo "$ISSUE" | jq -r '.id')
  KEY=$(echo "$ISSUE" | jq -r '.task_key // "?"')

  curl -sf -X PATCH "$MC_API/issues" \
    -H "Content-Type: application/json" \
    -d "{\"task_key\":\"$KEY\",\"status\":\"backlog\",\"transitioned_by\":\"dor-nightly\"}" >/dev/null 2>&1 || true

  echo "[dor-nightly] $KEY → backlog (DoR incomplete)"
done

# Alert Discord
ITEMS=$(echo "$ALL_INCOMPLETE" | jq -r '.[] | "- **\(.task_key // "?")** (\(.project // "?")) \(.title // "")"' | head -20)
MSG="🚫 **DoR Nightly: $COUNT builder issues moved to backlog**\n$ITEMS\n\nMissing: description, test_tier, or acceptance_criteria.\nKAOS: complete DoR before re-adding to sprint."

curl -s -X POST "http://localhost:3000/api/notify" \
  -H "Content-Type: application/json" \
  -d "{\"text\": \"$MSG\", \"channels\": [\"discord-alerts\"]}" 2>/dev/null || true

echo "[dor-nightly] Enforcement complete: $COUNT issues moved to backlog"

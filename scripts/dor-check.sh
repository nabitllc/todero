#!/bin/bash
# INF-179: DoR gate checker — runs every 30 min via n8n
# Finds builder-assigned issues missing required DoR fields and alerts Discord
set -euo pipefail

SUPA_URL="https://twthgapiouiqhavrcnry.supabase.co"
SUPA_KEY="${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY is required}"
DISCORD_CHANNEL="${DISCORD_ALERTS_CHANNEL:-1487584901678104698}"

# Fetch builder-assigned open issues missing DoR fields
# Missing description OR test_tier
MISSING_DESC=$(curl -sf "$SUPA_URL/rest/v1/issues?assignee=eq.builder&status=eq.open&description=is.null&select=task_key,title" \
  -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" 2>/dev/null || echo "[]")

MISSING_TIER=$(curl -sf "$SUPA_URL/rest/v1/issues?assignee=eq.builder&status=eq.open&test_tier=is.null&select=task_key,title" \
  -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" 2>/dev/null || echo "[]")

MISSING_AC=$(curl -sf "$SUPA_URL/rest/v1/issues?assignee=eq.builder&status=eq.open&acceptance_criteria=is.null&select=task_key,title" \
  -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" 2>/dev/null || echo "[]")

# Combine and deduplicate
ALL_MISSING=$(echo "$MISSING_DESC $MISSING_TIER $MISSING_AC" | jq -s 'add | unique_by(.task_key)')
COUNT=$(echo "$ALL_MISSING" | jq 'length')

if [ "$COUNT" -gt 0 ]; then
  ITEMS=$(echo "$ALL_MISSING" | jq -r '.[] | "- **\(.task_key)** \(.title)"' | head -20)
  MSG="⚠️ **DoR Gate: $COUNT builder issues missing required fields**\n$ITEMS\n\nMissing: description, test_tier, or acceptance_criteria. Builder will skip these until complete."
  curl -s -X POST "http://localhost:3000/api/notify" \
    -H "Content-Type: application/json" \
    -d "{\"text\": \"$MSG\", \"channels\": [\"discord-alerts\"]}" 2>/dev/null || true
  echo "[dor-check] Alerted: $COUNT incomplete issues"
else
  echo "[dor-check] All builder issues are DoR-complete"
fi

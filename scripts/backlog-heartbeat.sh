#!/bin/bash
# INF-194: Heartbeat check — maintain ≥10 backlog features + ≥3 DoF-ready per project
# Runs every 4h via n8n cron
set -euo pipefail

SUPA_URL="${NEXT_PUBLIC_SUPABASE_URL:?NEXT_PUBLIC_SUPABASE_URL is not set - see .env.local.template}"
SUPA_KEY="${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY is required}"
DISCORD_CHANNEL="${DISCORD_ALERTS_CHANNEL:-1487584901678104698}"

PROJECTS=("Vespera" "Todero" "Kemuni" "KAOS")
MIN_BACKLOG=10
MIN_DOF_READY=3
ALERTS=""

for PROJECT in "${PROJECTS[@]}"; do
  echo "[backlog-heartbeat] Checking $PROJECT..."

  # Count backlog features
  BACKLOG=$(curl -sf "$SUPA_URL/rest/v1/issues?project=eq.$PROJECT&type=eq.feature&status=eq.backlog&select=id" \
    -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" -H "Prefer: count=exact" 2>/dev/null || echo "[]")
  BACKLOG_COUNT=$(echo "$BACKLOG" | jq 'length')

  # Count DoF-ready features (have description + AC + at least one child task)
  # Batch: single query for candidate features, then one query for all their children
  DOF_FEATURES=$(curl -sf "$SUPA_URL/rest/v1/issues?project=eq.$PROJECT&type=eq.feature&status=eq.open&description=not.is.null&acceptance_criteria=not.is.null&select=id" \
    -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" 2>/dev/null || echo "[]")
  DOF_COUNT=0

  FEATURE_IDS=$(echo "$DOF_FEATURES" | jq -r '[.[].id] | join(",")' 2>/dev/null || echo "")
  if [ -n "$FEATURE_IDS" ]; then
    DOF_COUNT=$(python3 - "$SUPA_URL" "$SUPA_KEY" "$FEATURE_IDS" "$DOF_FEATURES" <<'INNERPY'
import json, sys, urllib.request
supa_url, supa_key, ids, cands_json = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
cands = json.loads(cands_json)
req = urllib.request.Request(
    f"{supa_url}/rest/v1/issues?parent_id=in.({ids})&select=parent_id&limit=500",
    headers={"apikey": supa_key, "Authorization": f"Bearer {supa_key}"})
with urllib.request.urlopen(req, timeout=15) as r:
    children = json.loads(r.read())
parents_with_children = {c["parent_id"] for c in children}
print(sum(1 for i in cands if i["id"] in parents_with_children))
INNERPY
    )
  fi

  echo "[backlog-heartbeat] $PROJECT: backlog=$BACKLOG_COUNT (min $MIN_BACKLOG), DoF-ready=$DOF_COUNT (min $MIN_DOF_READY)"

  if [ "$BACKLOG_COUNT" -lt "$MIN_BACKLOG" ]; then
    DEFICIT=$((MIN_BACKLOG - BACKLOG_COUNT))
    ALERTS="$ALERTS\n⚠️ **$PROJECT**: only $BACKLOG_COUNT backlog features (need $DEFICIT more)"
  fi

  if [ "$DOF_COUNT" -lt "$MIN_DOF_READY" ]; then
    DEFICIT=$((MIN_DOF_READY - DOF_COUNT))
    ALERTS="$ALERTS\n⚠️ **$PROJECT**: only $DOF_COUNT DoF-ready features (need $DEFICIT more)"
  fi
done

if [ -n "$ALERTS" ]; then
  MSG="📊 **Backlog Heartbeat — $(date '+%Y-%m-%d %H:%M') ET**$ALERTS\n\nKAOS: generate features and prep DoF for any project below threshold."
  curl -s -X POST "http://localhost:3000/api/notify" \
    -H "Content-Type: application/json" \
    -d "{\"text\": \"$MSG\", \"channels\": [\"discord-alerts\"]}" 2>/dev/null || true
  echo "[backlog-heartbeat] Alerts sent to Discord"
else
  echo "[backlog-heartbeat] All projects meet minimums"
fi

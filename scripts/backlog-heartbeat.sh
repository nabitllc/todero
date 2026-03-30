#!/bin/bash
# INF-194: Heartbeat check — maintain ≥10 backlog features + ≥3 DoF-ready per project
# Runs every 4h via n8n cron
set -euo pipefail

SUPA_URL="https://twthgapiouiqhavrcnry.supabase.co"
SUPA_KEY="${SUPABASE_SERVICE_ROLE_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q}"
DISCORD_CHANNEL="${DISCORD_ALERTS_CHANNEL:-1487584901678104698}"

PROJECTS=("Vespera" "Mission Control" "Kemuni" "Infrastructure" "KAOS")
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
  # First get features with description + AC that are open (DoF-ready = status=open with children)
  DOF_FEATURES=$(curl -sf "$SUPA_URL/rest/v1/issues?project=eq.$PROJECT&type=eq.feature&status=eq.open&description=not.is.null&acceptance_criteria=not.is.null&select=id" \
    -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" 2>/dev/null || echo "[]")
  DOF_COUNT=0

  # Check each feature has child tasks
  for FID in $(echo "$DOF_FEATURES" | jq -r '.[].id'); do
    CHILDREN=$(curl -sf "$SUPA_URL/rest/v1/issues?parent_id=eq.$FID&select=id&limit=1" \
      -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" 2>/dev/null || echo "[]")
    CHILD_COUNT=$(echo "$CHILDREN" | jq 'length')
    if [ "$CHILD_COUNT" -gt 0 ]; then
      DOF_COUNT=$((DOF_COUNT + 1))
    fi
  done

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
  /opt/homebrew/bin/openclaw message send --channel discord --target "channel:$DISCORD_CHANNEL" --message "$MSG" 2>/dev/null || true
  echo "[backlog-heartbeat] Alerts sent to Discord"
else
  echo "[backlog-heartbeat] All projects meet minimums"
fi

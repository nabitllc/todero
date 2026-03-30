#!/bin/bash
# INF-187: Automated smoke test — runs build + lint before Tester review
# Called by n8n before triggering Tester. If build fails, auto-fails the issue.
set -euo pipefail

SUPA_URL="https://twthgapiouiqhavrcnry.supabase.co"
SUPA_KEY="${SUPABASE_SERVICE_ROLE_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q}"
MC_API="${MC_API_URL:-http://localhost:3000/api}"
DISCORD_CHANNEL="${DISCORD_ALERTS_CHANNEL:-1487584901678104698}"

echo "[smoke-test] Starting pre-tester smoke tests..."

# Fetch in_review issues that haven't been smoke-tested yet (test_status=none)
ISSUES=$(curl -sf "$SUPA_URL/rest/v1/issues?status=eq.in_review&test_status=eq.none&select=id,title,task_key,project,feature_branch" \
  -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY")

COUNT=$(echo "$ISSUES" | jq 'length')
if [ "$COUNT" -eq 0 ]; then
  echo "[smoke-test] No issues pending smoke test"
  exit 0
fi

echo "[smoke-test] $COUNT issues to smoke test"

PASS_COUNT=0
FAIL_COUNT=0

echo "$ISSUES" | jq -c '.[]' | while read -r ISSUE; do
  ID=$(echo "$ISSUE" | jq -r '.id')
  KEY=$(echo "$ISSUE" | jq -r '.task_key // "?"')
  PROJECT=$(echo "$ISSUE" | jq -r '.project // ""')
  BRANCH=$(echo "$ISSUE" | jq -r '.feature_branch // ""')

  echo "[smoke-test] Testing $KEY (project=$PROJECT, branch=$BRANCH)..."

  # Determine repo directory
  if [ "$PROJECT" = "Vespera" ]; then
    REPO_DIR="/var/folders/r0/hww7pxv12txb9sfmlmmw76xw0000gn/T/tmp.8qWeSvST6Z"
  else
    REPO_DIR="/Users/kemuniagent/mission-control"
  fi

  cd "$REPO_DIR"

  # Checkout branch if specified
  if [ -n "$BRANCH" ]; then
    git checkout "$BRANCH" 2>/dev/null || true
  fi

  # Run build
  BUILD_OUTPUT=""
  BUILD_OK=true
  if ! BUILD_OUTPUT=$(npm run build 2>&1); then
    BUILD_OK=false
  fi

  # Run lint if available
  LINT_OK=true
  if npm run lint --if-present 2>/dev/null; then
    LINT_OK=true
  else
    LINT_OK=false
  fi

  NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  if [ "$BUILD_OK" = true ]; then
    echo "[smoke-test] $KEY: Build PASSED"
    # Mark as smoke-test passed (test_status stays none — Tester will set it)
    # We just mark it ready for tester by setting test_status=smoke_passed
    # Actually, we leave test_status=none and let Tester process it
    # The Tester script already filters for in_review issues
    PASS_COUNT=$((PASS_COUNT + 1))
  else
    echo "[smoke-test] $KEY: Build FAILED"
    FAIL_SNIPPET=$(echo "$BUILD_OUTPUT" | tail -20 | head -10)
    # Auto-fail back to Builder
    curl -sf -X PATCH "$MC_API/issues" \
      -H "Content-Type: application/json" \
      -d "{\"id\":\"$ID\",\"test_status\":\"failed\",\"status\":\"open\"}" >/dev/null 2>&1 || true

    # Alert Discord
    MSG="🔴 **Smoke Test Failed: $KEY**\nBuild failed — returned to Builder.\n\`\`\`\n$FAIL_SNIPPET\n\`\`\`"
    /opt/homebrew/bin/openclaw message send --channel discord --target "channel:$DISCORD_CHANNEL" --message "$MSG" 2>/dev/null || true
    FAIL_COUNT=$((FAIL_COUNT + 1))
  fi
done

echo "[smoke-test] Complete: passed=$PASS_COUNT failed=$FAIL_COUNT"

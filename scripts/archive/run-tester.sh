#!/bin/bash
# INF-171: Tester agent — reviews code_review issues against acceptance criteria
# Called by n8n or manually. Reviews P0/P1 first, then P2.
# Sets test_status=passed → status=completed (or Designer gate for MC/Vespera), or test_status=failed → status=open with notes.
set -euo pipefail

SUPA_URL="https://twthgapiouiqhavrcnry.supabase.co"
SUPA_KEY="${SUPABASE_SERVICE_ROLE_KEY:-eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q}"
MC_API="${MC_API_URL:-http://localhost:3000/api}"
INTERNAL_SECRET="${INTERNAL_SECRET:-kaos-internal-2026}"

# WIP check: max 5 code_review at once for tester processing
IN_REVIEW_COUNT=$(curl -sf "$SUPA_URL/rest/v1/issues?status=eq.code_review&select=id" \
  -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" | jq 'length')

echo "[tester] $IN_REVIEW_COUNT issues in code_review"

# Fetch code_review issues, ordered by priority (P0/P1 first)
ISSUES=$(curl -sf "$SUPA_URL/rest/v1/issues?status=eq.code_review&select=id,title,description,acceptance_criteria,task_key,project,test_tier,feature_branch,type&order=priority.asc&limit=5" \
  -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY")

COUNT=$(echo "$ISSUES" | jq 'length')
if [ "$COUNT" -eq 0 ]; then
  echo "[tester] No issues in code_review to test"
  exit 0
fi

echo "[tester] Processing $COUNT issues..."

echo "$ISSUES" | jq -c '.[]' | while read -r ISSUE; do
  ID=$(echo "$ISSUE" | jq -r '.id')
  TITLE=$(echo "$ISSUE" | jq -r '.title')
  KEY=$(echo "$ISSUE" | jq -r '.task_key // "?"')
  AC=$(echo "$ISSUE" | jq -r '.acceptance_criteria // "none"')
  DESC=$(echo "$ISSUE" | jq -r '.description // ""')
  PROJECT=$(echo "$ISSUE" | jq -r '.project // ""')
  BRANCH=$(echo "$ISSUE" | jq -r '.feature_branch // ""')
  TIER=$(echo "$ISSUE" | jq -r '.test_tier // "P2"')

  echo "[tester] Reviewing $KEY: $TITLE (tier=$TIER)"

  # Determine repo directory
  if [ "$PROJECT" = "Vespera" ]; then
    REPO_DIR="/var/folders/r0/hww7pxv12txb9sfmlmmw76xw0000gn/T/tmp.8qWeSvST6Z"
  else
    REPO_DIR="/Users/kemuniagent/mission-control"
  fi

  # INF-183: For P0/P1, include git diff in tester prompt for code review
  GIT_DIFF_SECTION=""
  if [ "$TIER" = "P0" ] || [ "$TIER" = "P1" ]; then
    cd "$REPO_DIR"
    if [ -n "$BRANCH" ] && [ "$BRANCH" != "null" ]; then
      DIFF_OUTPUT=$(git diff "main...$BRANCH" --stat 2>/dev/null || git diff HEAD~5 --stat 2>/dev/null || echo "Could not generate diff")
      DIFF_DETAIL=$(git diff "main...$BRANCH" 2>/dev/null | head -500 || git diff HEAD~5 2>/dev/null | head -500 || echo "Could not generate diff")
    else
      DIFF_OUTPUT=$(git diff HEAD~3 --stat 2>/dev/null || echo "No branch specified")
      DIFF_DETAIL=$(git diff HEAD~3 2>/dev/null | head -500 || echo "No branch specified")
    fi
    GIT_DIFF_SECTION="
--- GIT DIFF (P0/P1 code review required) ---
Files changed:
$DIFF_OUTPUT

Diff detail (first 500 lines):
$DIFF_DETAIL
--- END DIFF ---

IMPORTANT: As this is a $TIER issue, you MUST review the actual code changes above.
Verify the diff implements what the acceptance criteria require.
If the diff does not match the AC, set passed=false."
  fi

  # Build test prompt for Claude
  PROMPT="You are Tester. Review this issue against its acceptance criteria.

Task: $KEY — $TITLE
Project: $PROJECT
Branch: $BRANCH
Test Tier: $TIER

Acceptance Criteria:
$AC

Builder Notes (from description):
$DESC
$GIT_DIFF_SECTION

Instructions:
1. Check the git log on branch '$BRANCH' (or current branch) for recent commits related to this task
2. Read the changed files and verify each acceptance criterion is met
3. Run 'npm run build' to verify the build passes$([ "$TIER" = "P0" ] || [ "$TIER" = "P1" ] && echo "
4. Review the git diff above — explicitly reference code changes in your notes
5. If the diff does not implement the AC, fail the review")
$([ "$TIER" != "P0" ] && [ "$TIER" != "P1" ] && echo "4. ")Output your verdict as JSON on the LAST line:
   {\"passed\": true, \"notes\": \"All AC met. Build passes.\"}
   or
   {\"passed\": false, \"notes\": \"AC #2 not met: <reason>\"}"

  # Run tester via Claude
  cd "$REPO_DIR"
  RESULT=$(timeout 120 /opt/homebrew/bin/claude --permission-mode bypassPermissions --print "$PROMPT" 2>/dev/null || echo '{"passed": false, "notes": "Tester timed out or errored"}')

  # Extract JSON verdict from last line
  VERDICT=$(echo "$RESULT" | grep -o '{.*"passed".*}' | tail -1 || echo '{"passed": false, "notes": "Could not parse tester output"}')
  PASSED=$(echo "$VERDICT" | jq -r '.passed // false')
  NOTES=$(echo "$VERDICT" | jq -r '.notes // "No notes"')

  NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  if [ "$PASSED" = "true" ]; then
    echo "[tester] $KEY: PASSED — $NOTES"

    # ── INF-258 + INF-259: Designer pipeline gate for UI issues ──
    # MC and Vespera issues get Designer review after Tester passes
    DESIGNER_GATE=false
    if [ "$PROJECT" = "Mission Control" ] || [ "$PROJECT" = "Vespera" ]; then
      DESIGNER_GATE=true
    fi

    if [ "$DESIGNER_GATE" = "true" ]; then
      echo "[tester] $KEY: Designer gate triggered — creating Designer review issue"
      # Mark test_status=passed but keep in_review (awaiting Designer)
      curl -sf -X PATCH "$MC_API/issues" \
        -H "Content-Type: application/json" \
        -d "{\"id\":\"$ID\",\"test_status\":\"passed\",\"description\":\"$DESC\n\n---\n**Tester notes ($NOW):** $NOTES\n**Status:** Awaiting Designer review before completion.\"}" >/dev/null

      # Create Designer review child issue
      DESIGNER_AC="Review $KEY against design-system.md. Check: color tokens, spacing scale, typography, component consistency, responsive behavior, accessibility basics. Approve (close original → completed) or reject (create fix task for builder)."
      curl -sf -X POST "$MC_API/issues" \
        -H "Content-Type: application/json" \
        -d "{\"title\":\"Designer Review: $KEY — $TITLE\",\"description\":\"Designer review gate for $KEY. Review the UI changes on branch $BRANCH against design-system.md standards. If approved, close parent issue. If rejected, create a fix task assigned to builder.\",\"project\":\"$PROJECT\",\"type\":\"task\",\"priority\":\"high\",\"assignee\":\"designer\",\"acceptance_criteria\":\"$DESIGNER_AC\",\"sprint\":\"$(date -u +%Y-%m-%d)\",\"parent_id\":\"$ID\",\"test_tier\":\"P2\"}" >/dev/null
      echo "[tester] $KEY: Designer review issue created, assigned to designer agent"
    else
      # No Designer gate — mark completed directly
      curl -sf -X PATCH "$MC_API/issues" \
        -H "Content-Type: application/json" \
        -d "{\"id\":\"$ID\",\"test_status\":\"passed\",\"status\":\"done\",\"description\":\"$DESC\n\n---\n**Tester notes ($NOW):** $NOTES\"}" >/dev/null
    fi
  else
    echo "[tester] $KEY: FAILED — $NOTES"
    # Set test_status=failed, status=open for Builder to fix
    curl -sf -X PATCH "$MC_API/issues" \
      -H "Content-Type: application/json" \
      -d "{\"id\":\"$ID\",\"test_status\":\"failed\",\"status\":\"open\",\"description\":\"$DESC\n\n---\n**Tester FAILED ($NOW):** $NOTES\"}" >/dev/null
  fi

  # Log agent run
  curl -sf -X POST "$SUPA_URL/rest/v1/agent_runs" \
    -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" -H "Content-Type: application/json" \
    -d "{\"agent_id\":\"tester\",\"task_id\":\"$ID\",\"task_title\":\"Review: $TITLE\",\"status\":\"$([ \"$PASSED\" = 'true' ] && echo 'passed' || echo 'failed')\"}" >/dev/null 2>&1 || true
done

echo "[tester] Review cycle complete"

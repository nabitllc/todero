#!/bin/bash
# INF-258: UX review agent — reviews UI changes against design-system.md
# Called by n8n or manually. Processes open UX review issues (assignee=ux).
# Approves (status=done) or fails (test_status=failed, status=open) with feedback.
set -euo pipefail

SUPA_URL="${NEXT_PUBLIC_SUPABASE_URL:?NEXT_PUBLIC_SUPABASE_URL is not set - see .env.local.template}"
SUPA_KEY="${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY is not set - see .env.local.template}"
MC_API="${MC_API_URL:-http://localhost:3000/api}"

REPO_DIR="${TODERO_DIR:-$HOME/mission-control}"
DESIGN_SYSTEM="$REPO_DIR/docs/design-system.md"

# Fetch open UX review issues
ISSUES=$(curl -sf "$SUPA_URL/rest/v1/issues?assignee=eq.ux&status=eq.open&select=id,title,description,acceptance_criteria,task_key,parent_id,feature_branch&order=priority.asc&limit=5" \
  -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY")

COUNT=$(echo "$ISSUES" | jq 'length')
if [ "$COUNT" -eq 0 ]; then
  echo "[ux-review] No UX review issues to process"
  exit 0
fi

echo "[ux-review] Processing $COUNT UX review issues..."

# Read design system doc
DESIGN_DOC=""
if [ -f "$DESIGN_SYSTEM" ]; then
  DESIGN_DOC=$(cat "$DESIGN_SYSTEM")
else
  echo "[ux-review] WARNING: design-system.md not found at $DESIGN_SYSTEM"
  DESIGN_DOC="No design system document found. Use general UX best practices."
fi

echo "$ISSUES" | jq -c '.[]' | while read -r ISSUE; do
  ID=$(echo "$ISSUE" | jq -r '.id')
  TITLE=$(echo "$ISSUE" | jq -r '.title')
  KEY=$(echo "$ISSUE" | jq -r '.task_key // "?"')
  AC=$(echo "$ISSUE" | jq -r '.acceptance_criteria // "none"')
  DESC=$(echo "$ISSUE" | jq -r '.description // ""')
  PARENT_ID=$(echo "$ISSUE" | jq -r '.parent_id // ""')
  BRANCH=$(echo "$ISSUE" | jq -r '.feature_branch // ""')

  echo "[ux-review] Reviewing $KEY: $TITLE"

  # Get parent issue info for context
  PARENT_INFO=""
  if [ -n "$PARENT_ID" ] && [ "$PARENT_ID" != "null" ]; then
    PARENT_DATA=$(curl -sf "$SUPA_URL/rest/v1/issues?id=eq.$PARENT_ID&select=title,task_key,feature_branch,description" \
      -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" | jq -r '.[0] // empty')
    if [ -n "$PARENT_DATA" ]; then
      PARENT_TITLE=$(echo "$PARENT_DATA" | jq -r '.title // ""')
      PARENT_KEY=$(echo "$PARENT_DATA" | jq -r '.task_key // ""')
      PARENT_BRANCH=$(echo "$PARENT_DATA" | jq -r '.feature_branch // ""')
      PARENT_INFO="Parent Issue: $PARENT_KEY — $PARENT_TITLE (branch: $PARENT_BRANCH)"
      # Use parent branch if UX review issue has no branch
      if [ -z "$BRANCH" ] || [ "$BRANCH" = "null" ]; then
        BRANCH="$PARENT_BRANCH"
      fi
    fi
  fi

  # Get git diff for review
  GIT_DIFF=""
  cd "$REPO_DIR"
  if [ -n "$BRANCH" ] && [ "$BRANCH" != "null" ]; then
    GIT_DIFF=$(git diff "main...$BRANCH" -- '*.tsx' '*.css' '*.scss' 2>/dev/null | head -800 || echo "Could not generate diff")
  else
    GIT_DIFF=$(git diff HEAD~5 -- '*.tsx' '*.css' '*.scss' 2>/dev/null | head -800 || echo "No branch specified")
  fi

  PROMPT="You are UX Reviewer. Review UI changes against the design system.

$PARENT_INFO

Task: $KEY — $TITLE
Description: $DESC

Acceptance Criteria:
$AC

--- DESIGN SYSTEM ---
$DESIGN_DOC
--- END DESIGN SYSTEM ---

--- UI CODE CHANGES ---
$GIT_DIFF
--- END CHANGES ---

Instructions:
1. Review the code changes above against the design system standards
2. Check these specific areas:
   - Color tokens: Are hardcoded colors used instead of design tokens?
   - Spacing: Does spacing follow the defined scale?
   - Typography: Are font sizes/weights consistent with the system?
   - Component patterns: Are components consistent with existing patterns?
   - Responsive: Are responsive breakpoints handled?
   - Accessibility: Are aria labels, focus states, contrast ratios adequate?
3. Be pragmatic — minor deviations are OK if they serve the UX

Output your verdict as JSON on the LAST line:
  {\"passed\": true, \"notes\": \"UX approved. All standards met.\"}
  or
  {\"passed\": false, \"notes\": \"Issues found: <list specific problems>\"}"

  # Run UX review via Claude
  cd "$REPO_DIR"
  RESULT=$(timeout 120 /opt/homebrew/bin/claude --permission-mode bypassPermissions --print "$PROMPT" 2>/dev/null || echo '{"passed": false, "notes": "UX reviewer timed out or errored"}')

  # Extract JSON verdict
  VERDICT=$(echo "$RESULT" | grep -o '{.*"passed".*}' | tail -1 || echo '{"passed": false, "notes": "Could not parse UX review output"}')
  PASSED=$(echo "$VERDICT" | jq -r '.passed // false')
  NOTES=$(echo "$VERDICT" | jq -r '.notes // "No notes"')

  NOW=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  if [ "$PASSED" = "true" ]; then
    echo "[ux-review] $KEY: UX APPROVED — $NOTES"
    # Mark UX review issue as done → PATCH handler will auto-complete parent
    curl -sf -X PATCH "$MC_API/issues" \
      -H "Content-Type: application/json" \
      -d "{\"id\":\"$ID\",\"test_status\":\"passed\",\"status\":\"done\",\"description\":\"$DESC\n\n---\n**UX Review ($NOW):** APPROVED — $NOTES\"}" >/dev/null
  else
    echo "[ux-review] $KEY: UX FAILED — $NOTES"
    # Mark UX review as failed → PATCH handler will create fix task
    curl -sf -X PATCH "$MC_API/issues" \
      -H "Content-Type: application/json" \
      -d "{\"id\":\"$ID\",\"test_status\":\"failed\",\"status\":\"open\",\"description\":\"$DESC\n\n---\n**UX Review FAILED ($NOW):** $NOTES\"}" >/dev/null
  fi

  # Log agent run
  curl -sf -X POST "$SUPA_URL/rest/v1/agent_runs" \
    -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" -H "Content-Type: application/json" \
    -d "{\"agent_id\":\"ux\",\"task_id\":\"$ID\",\"task_title\":\"UX Review: $TITLE\",\"status\":\"$([ \"$PASSED\" = 'true' ] && echo 'passed' || echo 'failed')\"}" >/dev/null 2>&1 || true
done

echo "[ux-review] UX review cycle complete"

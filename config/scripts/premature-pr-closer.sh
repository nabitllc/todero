#!/usr/bin/env bash
# premature-pr-closer.sh
# Detects premature per-issue PRs opened by Builder on feat/TOD-XXX branches
# and auto-closes them if the issue is not yet released.
#
# PRs should only be created by KAOS at 7am/7pm ET PR windows — never by Builder.
# Run manually: bash scripts/premature-pr-closer.sh
#
# Exit codes: 0 = success (including "nothing to do"), 1 = fatal error
#
# Note: rescued from orphan commit ca14604b (feat/pipeline-watchdog-rescue).
# Fixed bugs: (1) MC API uses ?task_key=KEY not PostgREST ?task_key=eq.KEY,
# (2) MC API returns single object for task_key lookup, not a list.

set -euo pipefail

MC_API="${MC_API_URL:-http://localhost:3000/api/issues}"
CLOSE_COMMENT="This PR was created prematurely by a pipeline agent. Todero uses a batched PR model — all approved branches are merged in a single PR at the 7am or 7pm ET window by KAOS. Per-issue PRs cause merge conflicts and review fatigue. Auto-closing this PR. The branch is safe and will be picked up at the next PR window."

log() { echo "[pr-closer] $(date -u +%H:%M:%SZ) $*"; }

# Require gh CLI
if ! command -v gh &>/dev/null; then
  log "ERROR: gh CLI not found — cannot run"
  exit 1
fi

# Fetch all open PRs whose head branch matches feat/TOD-* (or feat/tod-*)
log "Scanning for open PRs on feat/TOD-* branches..."
PREMATURE_PRS=$(gh pr list \
  --state open \
  --json number,headRefName,url \
  --jq '.[] | select(.headRefName | test("^feat/(TOD|tod)-[0-9]+"; "i")) | [.number, .headRefName, .url] | @tsv' \
  2>/dev/null || true)

if [[ -z "$PREMATURE_PRS" ]]; then
  log "No open PRs on feat/TOD-* branches — nothing to do."
  exit 0
fi

CLOSED_COUNT=0
SKIPPED_COUNT=0

while IFS=$'\t' read -r PR_NUMBER BRANCH_NAME PR_URL; do
  # Extract issue key from branch name (feat/tod-1234 → TOD-1234)
  ISSUE_KEY=$(echo "$BRANCH_NAME" | sed -E 's|feat/(tod-[0-9]+).*|\1|i' | tr '[:lower:]' '[:upper:]')
  log "Found PR #${PR_NUMBER} on branch ${BRANCH_NAME} (issue key: ${ISSUE_KEY})"

  # Look up issue by task_key in MC API (returns single object, not a list)
  ISSUE_JSON=$(curl -s "${MC_API}?task_key=${ISSUE_KEY}" 2>/dev/null || echo "{}")
  ISSUE_STATUS=$(echo "$ISSUE_JSON" | python3 -c "
import json,sys
d=json.load(sys.stdin)
# MC API returns a single object for task_key lookups
if isinstance(d, dict) and 'status' in d:
    print(d['status'])
elif isinstance(d, list) and len(d) > 0:
    print(d[0].get('status','unknown'))
else:
    print('not_found')
" 2>/dev/null || echo "unknown")

  log "  Issue ${ISSUE_KEY} status: ${ISSUE_STATUS}"

  if [[ "$ISSUE_STATUS" == "released" || "$ISSUE_STATUS" == "closed" ]]; then
    log "  Skipping — issue is ${ISSUE_STATUS} (PR may be legitimate release)"
    ((SKIPPED_COUNT++)) || true
    continue
  fi

  if [[ "$ISSUE_STATUS" == "not_found" || "$ISSUE_STATUS" == "unknown" ]]; then
    log "  WARNING: could not determine status for ${ISSUE_KEY} — skipping to avoid false close"
    ((SKIPPED_COUNT++)) || true
    continue
  fi

  # Issue is NOT released — this is a premature PR, close it
  log "  Closing premature PR #${PR_NUMBER} (issue status: ${ISSUE_STATUS})..."
  if gh pr close "$PR_NUMBER" --comment "$CLOSE_COMMENT" 2>&1 | tee /tmp/pr-closer-output.txt; then
    log "  Closed PR #${PR_NUMBER}"
    ((CLOSED_COUNT++)) || true
  else
    log "  ERROR closing PR #${PR_NUMBER}: $(cat /tmp/pr-closer-output.txt)"
  fi

done <<< "$PREMATURE_PRS"

log "Done. Closed: ${CLOSED_COUNT}, Skipped (released/closed/unknown): ${SKIPPED_COUNT}"
exit 0

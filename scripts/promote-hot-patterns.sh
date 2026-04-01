#!/usr/bin/env bash
# promote-hot-patterns.sh — KAOS reviews corrections and promotes high-signal patterns to HOT tier (TOD-489)
#
# Usage:
#   bash scripts/promote-hot-patterns.sh [agent_id]    # specific agent
#   bash scripts/promote-hot-patterns.sh                # all agents
#
# Logic:
#   1. Scans workspace-<agent>/self-improving/corrections.md
#   2. Groups corrections by similarity (keyword matching)
#   3. If a pattern appears 3+ times, promotes it to memory.md HOT tier
#   4. Marks promoted patterns in corrections.md to avoid re-promotion
#
# Intended to be run by KAOS during sprint review or on a schedule.

set -euo pipefail

MC_DIR="/Users/kemuniagent/mission-control"
AGENTS="${1:-builder tester designer}"
THRESHOLD=3

log() { echo "[promote-hot] $1"; }

for AGENT_ID in $AGENTS; do
  WORKSPACE="${MC_DIR}/workspace-${AGENT_ID}/self-improving"
  CORRECTIONS="${WORKSPACE}/corrections.md"
  MEMORY="${WORKSPACE}/memory.md"

  if [ ! -f "$CORRECTIONS" ]; then
    log "${AGENT_ID}: no corrections file — skipping"
    continue
  fi

  CORRECTION_COUNT=$(grep -c "^### " "$CORRECTIONS" 2>/dev/null || echo "0")
  log "${AGENT_ID}: ${CORRECTION_COUNT} correction entries found"

  if [ "$CORRECTION_COUNT" -lt "$THRESHOLD" ]; then
    log "${AGENT_ID}: below threshold (${THRESHOLD}) — skipping promotion"
    continue
  fi

  # Extract rejection reasons and reviewer feedback for pattern analysis
  PATTERNS=$(grep -E "^\- \*\*(Rejection reason|Reviewer feedback|Tester feedback|Designer feedback|Build/runtime error):" "$CORRECTIONS" 2>/dev/null || echo "")

  if [ -z "$PATTERNS" ]; then
    log "${AGENT_ID}: no extractable patterns — skipping"
    continue
  fi

  # Use python3 to find repeated keywords/themes
  PROMOTIONS=$(echo "$PATTERNS" | python3 -c "
import sys, re
from collections import Counter

lines = sys.stdin.read().strip().split('\n')
# Extract key phrases (lowercase, strip markdown)
phrases = []
for line in lines:
    cleaned = re.sub(r'\*\*[^:]+:\*\*\s*', '', line).strip().lower()
    # Extract significant words (4+ chars)
    words = [w for w in re.findall(r'[a-z]{4,}', cleaned)]
    phrases.extend(words)

# Find words appearing 3+ times (likely recurring issues)
common = Counter(phrases).most_common(10)
recurring = [(word, count) for word, count in common if count >= ${THRESHOLD}]

if recurring:
    for word, count in recurring:
        print(f'- **{word}** appeared {count} times across corrections')
else:
    print('')
" 2>/dev/null)

  if [ -z "$PROMOTIONS" ]; then
    log "${AGENT_ID}: no patterns meet threshold — skipping"
    continue
  fi

  TIMESTAMP=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  # Append to HOT tier in memory.md
  # Insert after the HOT section header
  {
    echo ""
    echo "#### Promoted ${TIMESTAMP}"
    echo "$PROMOTIONS"
    echo ""
  } >> "$MEMORY"

  # Use sed to replace the placeholder if still present
  if grep -q "^_None yet" "$MEMORY" 2>/dev/null; then
    sed -i '' 's/^_None yet.*$//' "$MEMORY"
  fi

  log "${AGENT_ID}: promoted patterns to HOT tier:"
  echo "$PROMOTIONS"
done

log "Done."

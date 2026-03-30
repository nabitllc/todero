#!/bin/bash
# MC-207: Clean up partial/untracked .tsx files left by Builder timeouts
# Run after Builder sessions to remove any broken partial files.

cd /Users/kemuniagent/mission-control

echo "[cleanup] Checking for untracked .tsx/.ts files..."
UNTRACKED=$(git ls-files --others --exclude-standard '*.tsx' '*.ts')

if [ -z "$UNTRACKED" ]; then
  echo "[cleanup] No untracked TypeScript files found."
  exit 0
fi

echo "[cleanup] Found untracked files:"
echo "$UNTRACKED"

# Check each for syntax errors
BROKEN=""
for f in $UNTRACKED; do
  # Quick syntax check: try to parse with node
  /opt/homebrew/opt/node@22/bin/node -e "require('fs').readFileSync('$f','utf8')" 2>/dev/null
  if [ $? -ne 0 ]; then
    BROKEN="$BROKEN $f"
  fi
done

# Also check if any untracked file causes build failure
echo "[cleanup] Running build check..."
/opt/homebrew/opt/node@22/bin/node node_modules/.bin/next build 2>&1 | tail -5
if [ ${PIPESTATUS[0]} -ne 0 ]; then
  echo "[cleanup] Build broken. Removing all untracked .tsx/.ts files..."
  echo "$UNTRACKED" | xargs rm -f
  echo "[cleanup] Removed. Re-checking build..."
  /opt/homebrew/opt/node@22/bin/node node_modules/.bin/next build 2>&1 | tail -5
else
  echo "[cleanup] Build is clean."
fi

echo "[cleanup] Done."

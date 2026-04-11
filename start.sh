#!/bin/bash
# Todero production server startup — reliable boot
set -e

TODERO_DIR="/Users/kemuniagent/todero"

# Kill anything on port 3000
PID=$(/usr/sbin/lsof -ti :3000 2>/dev/null || true)
if [ -n "$PID" ]; then
  echo "[start.sh] Killing stale process on port 3000: $PID"
  kill -9 $PID 2>/dev/null || true
  sleep 1
fi

cd "$TODERO_DIR"

# Ensure we're always on main (agents may leave us on feature branches)
git checkout main 2>/dev/null || true

# TOD-XXX (2026-04-10): typescript must be installed in node_modules for
# Next.js to read tsconfig.json path mappings. Without it, every @/* import
# silently fails to resolve at build time, causing a 500 on every page
# while the server starts fine. This bit us on 2026-04-10 — the Builder
# itself spotted the issue (TOD-838) but couldn't fix it because the build
# was broken WHILE it was running. Checking here guarantees the server
# never starts with a broken node_modules.
if [ ! -d node_modules/typescript ]; then
  echo "[start.sh] typescript missing from node_modules — reinstalling dev deps"
  /opt/homebrew/opt/node@22/bin/npm install typescript --save-dev 2>&1 | tail -3
fi

# Also check the handful of other critical packages that break the build
# when missing. If package.json lists them but they aren't on disk, reinstall.
for pkg in next react @supabase/supabase-js; do
  if [ ! -d "node_modules/$pkg" ]; then
    echo "[start.sh] $pkg missing from node_modules — running npm install"
    /opt/homebrew/opt/node@22/bin/npm install 2>&1 | tail -3
    break
  fi
done

# If BUILD_ID is missing or .next is broken, rebuild
if [ ! -f .next/BUILD_ID ]; then
  echo "[start.sh] BUILD_ID missing, rebuilding..."
  rm -rf .next
  /opt/homebrew/opt/node@22/bin/node node_modules/.bin/next build 2>&1 | tail -10
  if [ ! -f .next/BUILD_ID ]; then
    echo "[start.sh] CRITICAL: build failed even after reinstall. Retrying ONCE more with clean cache."
    rm -rf .next node_modules/.cache
    /opt/homebrew/opt/node@22/bin/node node_modules/.bin/next build 2>&1 | tail -15
  fi
fi

echo "[start.sh] Starting Next.js on port 3000..."
exec /opt/homebrew/opt/node@22/bin/node node_modules/.bin/next start --port 3000

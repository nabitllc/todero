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

# If BUILD_ID is missing or .next is broken, rebuild
if [ ! -f .next/BUILD_ID ]; then
  echo "[start.sh] BUILD_ID missing, rebuilding..."
  rm -rf .next
  /opt/homebrew/opt/node@22/bin/node node_modules/.bin/next build 2>&1 | tail -5
fi

echo "[start.sh] Starting Next.js on port 3000..."
exec /opt/homebrew/opt/node@22/bin/node node_modules/.bin/next start --port 3000

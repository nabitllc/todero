#!/bin/bash
# Dev server for Claude Code preview panel (port 3001).
# Uses absolute paths so it works regardless of CWD when the preview tool spawns it.
export NODE_PATH=/Users/kemuniagent/todero/node_modules
cd /Users/kemuniagent/todero

# Clear any stale process on 3001 before starting
STALE=$(lsof -ti :3001 2>/dev/null || true)
if [ -n "$STALE" ]; then
  kill -9 $STALE 2>/dev/null || true
  sleep 1
fi

exec /opt/homebrew/opt/node@22/bin/node \
  /Users/kemuniagent/todero/node_modules/next/dist/bin/next \
  dev --port 3001

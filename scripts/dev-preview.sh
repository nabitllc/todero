#!/bin/bash
# Dev server for Claude Code preview panel (port 3001).
# Uses absolute paths so it works regardless of CWD when the preview tool spawns it.
export NODE_PATH="${TODERO_DIR:-$HOME/todero}/node_modules"
cd "${TODERO_DIR:-$HOME/todero}"

# Clear any stale process on 3001 before starting
STALE=$(lsof -ti :3001 2>/dev/null || true)
if [ -n "$STALE" ]; then
  kill -9 $STALE 2>/dev/null || true
  sleep 1
fi

# NODE_BIN lets a host without Homebrew (or on a non-Homebrew path) point at
# its own node; bare `node` falls back to whatever PATH resolves.
exec "${NODE_BIN:-node}" \
  "${TODERO_DIR:-$HOME/todero}/node_modules/next/dist/bin/next" \
  dev --port 3001

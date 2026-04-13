#!/bin/bash
# Worktree janitor — removes stale ~/agent-worktrees/ dirs older than 24h.
# Runs every 6 hours via work.nabit.worktree-janitor LaunchAgent.
# Calls POST /api/run-agent/worktrees?maxAgeHours=24 which invokes gcStaleWorktrees.
set -euo pipefail
LOG="/tmp/worktree-janitor.log"
ts="[$(date '+%Y-%m-%d %H:%M:%S')]"

{
  echo "$ts starting"
  if ! curl -s -f -X POST "http://localhost:3000/api/run-agent/worktrees?maxAgeHours=24" > /tmp/worktree-janitor-result.json; then
    echo "$ts Todero /api unreachable - skipping"
    exit 0
  fi
  REMOVED=$(python3 -c "import json; print(json.load(open('/tmp/worktree-janitor-result.json'))['removed'])" 2>/dev/null || echo "?")
  ERRORS=$(python3 -c "import json; d=json.load(open('/tmp/worktree-janitor-result.json')); print(len(d.get('errors',[])))" 2>/dev/null || echo "?")
  echo "$ts removed=$REMOVED errors=$ERRORS"
  if [ "$ERRORS" != "0" ] && [ "$ERRORS" != "?" ]; then
    python3 -c "import json; [print(e) for e in json.load(open('/tmp/worktree-janitor-result.json'))['errors']]"
  fi
  echo "$ts done"
} >> "$LOG" 2>&1

#!/bin/bash
# Kill anything on port 3000 before starting MC
PID=$(/usr/sbin/lsof -ti :3000 2>/dev/null)
if [ -n "$PID" ]; then
  echo "Killing existing process on port 3000: $PID"
  kill -9 $PID 2>/dev/null
  sleep 1
fi

cd /Users/kemuniagent/mission-control
exec /opt/homebrew/opt/node@22/bin/node node_modules/.bin/next start --port 3000

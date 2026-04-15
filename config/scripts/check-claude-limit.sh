#!/bin/bash
RESULT=$(echo "ping" | /opt/homebrew/bin/claude --print --max-tokens 1 2>&1)
if echo "$RESULT" | grep -qi "limit\|rate\|quota\|usage\|exceeded"; then
  echo "limited"
else
  echo "ok"
fi

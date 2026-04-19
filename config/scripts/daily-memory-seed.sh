#!/usr/bin/env bash
# daily-memory-seed.sh — Phase 3.4 (TOD-1514)
# Ensures today's daily memory row exists in Supabase agent_memory_files.
# Run at midnight via LaunchAgent work.nabit.daily-memory-seed.
# If row already exists (from agents writing today), it's a no-op (upsert by date_key).
# If local file exists (~/todero/config/memory/YYYY-MM-DD.md), seeds content from it.
# Otherwise creates an empty placeholder row so agents loading context don't miss today.

set -euo pipefail

MC_API="${MC_API_URL:-http://localhost:3000/api}"
TODAY=$(date +%Y-%m-%d)
LOCAL_FILE="/Users/kemuniagent/todero/config/memory/${TODAY}.md"

if [ -f "$LOCAL_FILE" ]; then
  CONTENT=$(cat "$LOCAL_FILE")
else
  CONTENT="# Daily Memory — ${TODAY}

## Session log
(No entries yet — agents will append as they complete tasks today)"
fi

python3 - <<EOF
import urllib.request, json, sys
content = open("$LOCAL_FILE").read() if __import__("os").path.exists("$LOCAL_FILE") else """$CONTENT"""
payload = json.dumps({
  "agent_id": "global",
  "memory_type": "daily",
  "date_key": "$TODAY",
  "content": content
})
req = urllib.request.Request(
  "$MC_API/agent-memory",
  data=payload.encode(),
  headers={"Content-Type": "application/json"},
  method="POST"
)
try:
  with urllib.request.urlopen(req, timeout=10) as r:
    d = json.loads(r.read())
    if d.get("error"):
      print(f"[daily-memory-seed] ERROR: {d['error']}", file=sys.stderr)
      sys.exit(1)
    print(f"[daily-memory-seed] Row upserted for $TODAY (id={d.get('id','?')[:8]})")
except Exception as e:
  print(f"[daily-memory-seed] FAILED: {e}", file=sys.stderr)
  sys.exit(1)
EOF

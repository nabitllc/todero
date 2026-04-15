#!/bin/bash
# TOD-XXX (gap 8): Detect drift between plist StartCalendarInterval times and
# their in-file comments. This bug burned us on 2026-04-10 — sprint-cycle had
# a comment saying "= 10:55 UTC" but launchd uses local time.
set -euo pipefail
LAUNCHAGENTS="$HOME/Library/LaunchAgents"
LOG="/tmp/plist-drift-check.log"
issues=()

for plist in "$LAUNCHAGENTS"/work.nabit.*.plist; do
  [ -f "$plist" ] || continue
  name=$(basename "$plist" .plist)
  # Skip this script's own plist — its comment legitimately mentions UTC as explanation
  [ "$name" = "work.nabit.plist-drift-check" ] && continue

  # Only flag if a comment line has a digit:digit time followed by UTC/GMT.
  # This catches "= 10:55 UTC" (the actual bug) without matching general prose.
  drift_hint=$(grep -E '[0-9]{1,2}:[0-9]{2}\s*(UTC|GMT)' "$plist" | head -1 | sed 's/^\s*//' || true)

  if [ -n "$drift_hint" ]; then
    issues+=("$name: $drift_hint")
  fi
done

if [ "${#issues[@]}" -eq 0 ]; then
  echo "[$(date '+%F %T')] plist-drift-check: clean (0 issues)" >> "$LOG"
  exit 0
fi

echo "[$(date '+%F %T')] plist-drift-check: ${#issues[@]} issues" >> "$LOG"
for i in "${issues[@]}"; do
  echo "  $i" >> "$LOG"
done

msg="⚠️ plist drift detected on ${#issues[@]} LaunchAgent(s):"
for i in "${issues[@]}"; do
  msg="$msg\\n• $i"
done
curl -s -X POST "http://localhost:3000/api/notify" \
  -H "Content-Type: application/json" \
  -d "{\"text\":\"$msg\",\"channels\":[\"telegram-dm\"]}" >> "$LOG" 2>&1 || true

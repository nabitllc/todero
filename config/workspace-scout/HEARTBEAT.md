# HEARTBEAT.md — Scout

Heartbeat: every 4h

## Checks

1. **Research queue** — research tasks in `open` assigned to scout
   - If found: log count

2. **Stale research** — scout tasks in_progress >48h
   - Alert: "Long-running research: [key] — may be stuck"

3. Nothing found → HEARTBEAT_OK

## Alert Format
Short paragraph: what's being researched, blockers, ETA estimate.

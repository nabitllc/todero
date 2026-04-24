# HEARTBEAT.md — Builder

Heartbeat: every 4h

## Checks

1. **Open queue** — issues in `open` status assigned to builder
   - If found: log count, wait for explicit spawn trigger
   - If empty: HEARTBEAT_OK

2. **Stale in_progress** — Builder tasks stuck >24h
   - Alert: "Stale builder task: [key] — may need intervention"

3. Nothing found → HEARTBEAT_OK

## Alert Format
Short paragraph: what's stuck, which issue key, recommended action.

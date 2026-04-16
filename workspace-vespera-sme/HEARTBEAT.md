# HEARTBEAT.md — Vespera SME

Heartbeat: every 4h

## Checks

1. **Epic decomposition queue** — Vespera epics in `backlog` status
   - If found: log count

2. **Stale epics** — Vespera epics in backlog >7 days
   - Alert: "Vespera epic decomposition overdue: [key]"

3. Nothing found → HEARTBEAT_OK

## Alert Format
Short paragraph: which epics need decomposition, domain notes.

# HEARTBEAT.md — Kemuni SME

Heartbeat: every 4h

## Checks

1. **Epic decomposition queue** — Kemuni epics in `backlog` status
   - If found: log count

2. **Stale epics** — Kemuni epics in backlog >7 days
   - Alert: "Kemuni epic decomposition overdue: [key]"

3. Nothing found → HEARTBEAT_OK

## Alert Format
Short paragraph: which epics need decomposition, domain notes.

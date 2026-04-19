# HEARTBEAT.md — Auditor

Heartbeat: every 12h

## Checks

1. **DoR compliance** — open issues missing required fields (AC, reviewer, owner, parent_id)
   - If found: count and list issue keys

2. **Stale open issues** — open status >3 days without progress
   - Alert: "Stale open issues: [count] — may need reassignment"

3. **Pipeline health** — in_progress issues >48h
   - Alert: "Long-running tasks: [keys]"

4. Nothing found → HEARTBEAT_OK

## Alert Format
Bullet list of findings, issue keys, recommended actions.

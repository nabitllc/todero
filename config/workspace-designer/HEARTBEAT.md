# HEARTBEAT.md — Designer

Heartbeat: every 4h

## Checks

1. **Design review queue** — issues in `code_review` where reviewer=designer
   - If found: log count
   - Auto-spawn only if explicitly configured

2. **Stale design reviews** — stuck >12h
   - Alert: "Design review backlog: [count] issues"

3. Nothing found → HEARTBEAT_OK

## Alert Format
Short paragraph: what needs review, component types, priority.

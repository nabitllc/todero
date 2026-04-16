# HEARTBEAT.md — PO

Heartbeat: every 4h

## Checks

1. **Grooming queue** — features/tasks in `backlog` assigned to po
   - If >5: alert "Grooming backlog building up: [count]"

2. **Missing DoR** — issues in open without required fields
   - Alert: "DoR gaps: [count] issues"

3. Nothing found → HEARTBEAT_OK

## Alert Format
Short paragraph: what needs grooming, how many, priority guidance.

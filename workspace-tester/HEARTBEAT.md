# HEARTBEAT.md — Tester

Heartbeat: every 4h

## Checks

1. **Review queue** — issues in `code_review` assigned to tester
   - If found: log count to #agent-logs
   - Auto-spawn only if explicitly configured

2. **Stale reviews** — code_review issues stuck >12h
   - Alert: "Review queue backed up: [count] issues waiting"

3. Nothing found → HEARTBEAT_OK

## Alert Format
Short paragraph: what's waiting, priority levels, recommended action.

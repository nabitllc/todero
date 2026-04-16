# HEARTBEAT.md — Ops

Heartbeat: every 1h

## Checks

1. **Service health** — verify todero (port 3000) is responding
   - curl -s http://localhost:3000/api/issues > /dev/null || alert

2. **Disk space** — df -h / check
   - Alert if >85% used

3. **LaunchAgent status** — verify agent-kicker and pr-window are loaded
   - launchctl list | grep work.nabit

4. Nothing found → HEARTBEAT_OK

## Alert Format
Short paragraph: which service failed, error details, recovery steps.

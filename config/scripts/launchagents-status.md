# LaunchAgents Status — Post Migration
# Updated: 2026-04-08

## ✅ Active (running)
- com.nabit.mission-control.plist        — Mission Control Next.js (port 3000)
- com.nabit.builder-loop.plist           — Builder loop (Claude Code, every 10min)
- com.nabit.pr-window-server.plist       — PR window enforcement (7am/7pm)
- com.nabit.cloudflared.plist            — Cloudflare tunnel
- com.nabit.monitor-completed.plist      — Task completed → Discord (2min)
- com.nabit.monitor-prs.plist            — PR notifications → Discord (5min)
- com.nabit.monitor-pr-merge.plist       — PR merged → issue released (5min)
- com.nabit.monitor-stale.plist          — Stale issue watchdog → Telegram (2h)
- com.nabit.monitor-review-transition.plist — in_review → code_review (2min)
- com.nabit.monitor-claude-limit.plist   — Claude rate limit → Telegram (15min)
- com.nabit.standup-report.plist         — Daily standup → Discord (8am)

## ⚠️ Needs action
- com.kemuni.missioncontrol.plist        — DUPLICATE of mission-control, unload + disable
- com.nabit.pr-window-server.plist       — Points to missing pr_window_server.py, unload
- ai.openclaw.gateway.plist             — OpenClaw, already stopped, delete plist
- com.n8n.agent.plist                   — n8n, already stopped, delete plist
- n8n.plist                             — n8n duplicate, already stopped, delete plist

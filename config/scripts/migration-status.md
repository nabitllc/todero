# Migration Status — 2026-04-08

## ✅ Complete
- Claude Code installed and working
- kaos-config and kaos-mission-control on GitHub
- All monitors running as launchd agents
- n8n shut down
- OpenClaw gateway shut down
- All OpenClaw references removed from docs and skills

## LaunchAgents — Active
- com.nabit.mission-control        — MC Next.js app (port 3000)
- com.nabit.builder-loop           — Builder queue (10min)
- com.nabit.pr-window              — Push branches + open PRs (7am/7pm EDT)
- com.nabit.cloudflared            — Cloudflare tunnel
- com.nabit.monitor-completed      — Task done → Discord (2min)
- com.nabit.monitor-prs            — New PRs → Discord (5min)
- com.nabit.monitor-pr-merge       — PR merged → release (5min)
- com.nabit.monitor-stale          — Stale issues → Telegram (2h)
- com.nabit.monitor-review-transition — in_review → code_review (2min)
- com.nabit.monitor-claude-limit   — Rate limit → Telegram (15min)
- com.nabit.standup-report         — Daily standup → Discord (8am)

## Pending (your action)
- git push --set-upstream origin main  (both repos)
- Load com.nabit.pr-window.plist
- Run safe-export.py before deleting OpenClaw dirs
- Delete ~/.openclaw platform dirs
- Delete ~/.n8n
- Vespera: decide Firebase vs Supabase rebuild

# Todero Platform — Asset Safety Manifest
# Generated: 2026-04-08
# Purpose: Reference before deleting ANYTHING so nothing important is lost.

---

## ✅ SAFE TO DELETE (nothing valuable)

### ~/.openclaw/ platform directories
These are OpenClaw runtime files. Your actual work is in kaos-config (workspace/) and GitHub.
```bash
~/.openclaw/agents/
~/.openclaw/workspace-auditor/
~/.openclaw/workspace-builder/
~/.openclaw/workspace-community/
~/.openclaw/workspace-content/
~/.openclaw/workspace-deployer/
~/.openclaw/workspace-designer/
~/.openclaw/workspace-growth/
~/.openclaw/workspace-kemuni/
~/.openclaw/workspace-ops/
~/.openclaw/workspace-po/
~/.openclaw/workspace-scout/
~/.openclaw/workspace-security/
~/.openclaw/workspace-tester/
~/.openclaw/workspace-tools/
~/.openclaw/workspace-ux/
~/.openclaw/openclaw.json + backups
~/.openclaw/cron/
~/.openclaw/flows/
~/.openclaw/delivery-queue/
~/.openclaw/canvas/
~/.openclaw/completions/
~/.openclaw/subagents/
~/.openclaw/tasks/
~/.openclaw/qqbot/
~/.openclaw/telegram/
~/.openclaw/audit/
~/.openclaw/media/
~/.openclaw/identity/
~/.openclaw/devices/
~/.openclaw/exec-approvals.json
~/.openclaw/update-check.json
```

### ~/.n8n/
619MB of execution history. All 54 workflow definitions exported to kaos-config/scripts/n8n-exports/.
Safe to delete entirely.

---

## ⚠️ DO NOT DELETE WITHOUT READING — workspace-vespera

**~/.openclaw/workspace-vespera/** is NOT an OpenClaw platform directory.
It is the Vespera SME agent workspace containing active Vespera project context.

The NEW Vespera (Next.js + Supabase) codebase is at:
- Local: ~/.openclaw/workspace-vespera/app/
- GitHub: github.com/nabitllc/vespera
- Vercel: https://app-nabit.vercel.app

### Status as of last session (2026-03-28)
- PRs #20, #21, #22 were open and ready to merge
- MVP was feature-complete waiting on Michael to:
  1. Rotate Supabase service role key
  2. Set SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SITE_URL in Vercel env vars
  3. Run DB migrations 002–004 (SQL in DEPLOY.md inside PR #20)
  4. Create avatar storage bucket
  5. Seed events + promote admin account
- North star: WAU/MAU ratio — community-first, no monetization until sticky

### Vespera Supabase
- URL: https://pxuyvmijevxnlxyobajh.supabase.co
- .env.local: ~/.openclaw/workspace-vespera/app/.env.local

### Action needed
Move workspace-vespera into kaos-config or a standalone location:
```bash
mv ~/.openclaw/workspace-vespera ~/.openclaw/workspace/projects/vespera
```
Then commit it to kaos-config so Vespera context is preserved.

---

## 🔒 DO NOT DELETE — Your actual work

### GitHub repos (source of truth)
| Repo | URL | What |
|---|---|---|
| kaos-mission-control | github.com/nabitllc/kaos-mission-control | Mission Control Next.js app |
| kaos-config | github.com/nabitllc/kaos-config | Agent config, scripts, memory |
| vespera (new) | github.com/nabitllc/vespera | New Vespera Next.js app |
| vespera (firebase) | github.com/michsaenz/vespera | Old Firebase version (reference) |

### Local paths that matter
| Path | What | Backed up? |
|---|---|---|
| ~/mission-control/ | MC Next.js app | ✅ GitHub |
| ~/.openclaw/workspace/ | kaos-config working copy | ✅ GitHub |
| ~/.openclaw/workspace-vespera/app/ | Vespera Next.js app | ✅ GitHub (nabitllc/vespera) |
| ~/.openclaw/workspace-vespera/*.md | Vespera project memory | ⚠️ NOT on GitHub yet |

### Supabase (cloud, not local — never at risk)
| Project | URL |
|---|---|
| Todero/Mission Control | https://twthgapiouiqhavrcnry.supabase.co |
| Vespera | https://pxuyvmijevxnlxyobajh.supabase.co |

### Credentials (already in scripts — keep a copy in password manager)
- Supabase service role key (Todero) — in builder-loop.sh
- Supabase key (Vespera) — in workspace-vespera/app/.env.local
- GitHub token — in pr-window.py, monitor-prs.py
- Discord bot token — in all monitor scripts
- Telegram bot token — in monitor-stale.py, telegram-kaos-v2.py
- Cloudflare tunnel — in com.nabit.cloudflared.plist

---

## Pre-deletion checklist

Before running any delete commands, confirm:
1. [ ] kaos-config pushed to GitHub (`git status` in ~/.openclaw/workspace)
2. [ ] kaos-mission-control pushed to GitHub (`git status` in ~/mission-control)
3. [ ] workspace-vespera/*.md files saved (move to kaos-config first)
4. [ ] nabitllc/vespera on GitHub has latest code (check open PRs #20-22)
5. [ ] Both Supabase projects accessible
6. [ ] Credentials saved in password manager

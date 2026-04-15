# Todero Preservation Manifest
# Everything that matters — where it lives, what backs it up
# Generated: 2026-04-08

## Rule: If it's in a GitHub repo, it's safe to delete locally.
## Rule: If it's only local, back it up before deleting.

---

## ✅ SAFE TO DELETE — backed up on GitHub

| Local path | GitHub repo | Notes |
|---|---|---|
| `~/.openclaw/workspace/` | `github.com/nabitllc/kaos-config` | Agent config, scripts, memory, skills |
| `~/mission-control/` | `github.com/nabitllc/kaos-mission-control` | MC app, CLAUDE.md, migrations |

---

## ✅ SAFE TO DELETE — dead platform files, no value

| Path | What | Why safe |
|---|---|---|
| `~/.openclaw/agents/` | OpenClaw agent runner sessions | Replaced by Claude Code |
| `~/.openclaw/workspace-*/` | Per-agent workspaces (17 dirs) | Superseded by unified workspace |
| `~/.openclaw/openclaw.json*` | OpenClaw platform config + backups | No longer used |
| `~/.openclaw/cron/` | OpenClaw cron definitions | Replaced by launchd plists |
| `~/.openclaw/flows/` | OpenClaw flow definitions | Not used |
| `~/.openclaw/delivery-queue/` | OpenClaw task queue | Replaced by queue-runner.py |
| `~/.openclaw/canvas/` | OpenClaw canvas data | Not used |
| `~/.openclaw/completions/` | OpenClaw LLM completion logs | Not needed |
| `~/.openclaw/subagents/` | OpenClaw subagent sessions | Replaced by Claude Code |
| `~/.openclaw/tasks/` | OpenClaw task cache | Replaced by Supabase |
| `~/.openclaw/qqbot/` | OpenClaw QQ bot | Not used |
| `~/.openclaw/telegram/` | OpenClaw telegram config | Telegram handled via bot token |
| `~/.openclaw/audit/` | OpenClaw audit logs | Not needed |
| `~/.n8n/` | n8n database + logs (619MB) | Workflows ported to Python scripts |
| `~/Library/LaunchAgents/ai.openclaw.gateway.plist` | OpenClaw gateway launchd | Already removed |
| `~/Library/LaunchAgents/com.n8n.agent.plist` | n8n launchd | Already removed |
| `~/Library/LaunchAgents/n8n.plist` | n8n launchd duplicate | Already removed |

---

## ⚠️ REVIEW BEFORE DELETING — legacy projects

| Path | What | Action |
|---|---|---|
| `~/.openclaw/workspace/vespera-old/` | Old Vespera (Firebase/Vite) — its own git repo pointing to `github.com/michsaenz/vespera` | **Already on GitHub** — safe to remove from here, but confirm with Michael if Vespera is still active |
| `~/.openclaw/workspace/vespera-old.zip` | Corrupt/invalid zip | Safe to delete |
| `~/.openclaw/credentials/` | May contain API keys or tokens | **Review contents before deleting** |
| `~/.openclaw/identity/` | Agent identity config | Check if anything unique here |
| `~/.openclaw/memory/` | OpenClaw platform memory | May overlap with workspace/memory/ — review |
| `~/.openclaw/devices/` | Device registrations | Low value, but check |
| `~/.openclaw/media/` | Any media files | Check for anything unique |
| `~/.openclaw/logs/` | OpenClaw log files | Low value, safe after review |

---

## 🔒 NEVER DELETE — active system

| Path | What | Backed up? |
|---|---|---|
| `~/.openclaw/workspace/` | kaos-config — your entire agent brain | ✅ GitHub |
| `~/mission-control/` | Todero app | ✅ GitHub |
| `~/Library/LaunchAgents/com.nabit.*.plist` | All your service plists | ✅ Should commit to kaos-config |
| `~/.local/bin/claude` | Claude Code binary | Reinstall with `npm install -g @anthropic-ai/claude-code` |
| Supabase DB | All issues, sprints, agent data | ✅ Cloud (supabase.com) |
| Discord bot token | In scripts as env var | ✅ In kaos-config scripts |
| GitHub token | In scripts | ✅ In kaos-config scripts |

---

## 🚨 IMPORTANT: Commit LaunchAgents to kaos-config

The `.plist` files in `~/Library/LaunchAgents/com.nabit.*` are NOT currently in git.
If you wipe the Mac Mini, you'd need to recreate them.

Run this to back them up:
```bash
cp ~/Library/LaunchAgents/com.nabit.*.plist ~/.openclaw/workspace/launchagents/
cd ~/.openclaw/workspace
git add launchagents/
git commit -m "chore: backup launchagents to repo"
git push
```

---

## Vespera Status

**Old Vespera (Firebase/Vite):**
- Local: `~/.openclaw/workspace/vespera-old/Vespera App/Vespera/Vespera App/`
- GitHub: `github.com/michsaenz/vespera` (and `github.com/mich-hq/vespera`)
- Stack: Vite + Firebase + Firestore
- Last branch: `main`, also has `feature/fix-bucaramanga-filter`, `review-26-Nov`, `cleanup-backup-dec4-2025`
- Status: Legacy — code is safe on GitHub, OpenClaw was building a new version on top of it

**New Vespera (OpenClaw-era work):**
- Was being built in `~/.openclaw/workspace-vespera/` — this dir will be deleted
- Check `~/.openclaw/workspace/memory/` for context on what was built
- Recommendation: before deleting workspace-vespera, check if there's any code there

---

## Uninstalling OpenClaw Safely

Once you've verified the above:

```bash
# 1. Remove OpenClaw platform directories
rm -rf ~/.openclaw/agents ~/.openclaw/workspace-* \
       ~/.openclaw/openclaw.json* ~/.openclaw/cron \
       ~/.openclaw/flows ~/.openclaw/delivery-queue \
       ~/.openclaw/canvas ~/.openclaw/completions \
       ~/.openclaw/subagents ~/.openclaw/tasks \
       ~/.openclaw/qqbot ~/.openclaw/telegram \
       ~/.openclaw/audit ~/.openclaw/logs

# 2. Remove n8n (619MB)
rm -rf ~/.n8n

# 3. Uninstall OpenClaw binary
npm uninstall -g openclaw

# 4. Your workspace stays: ~/.openclaw/workspace/ is kaos-config and stays forever
```

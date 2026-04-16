# LaunchAgents Backup — Active Services
# Install on new Mac: copy *.plist to ~/Library/LaunchAgents/ then launchctl load each
# Updated: 2026-04-08

| Label | Script | Schedule |
|---|---|---|
| com.nabit.mission-control | mission-control/start.sh | Always on |
| com.nabit.builder-loop | scripts/builder-loop.sh | Always on (polls 10min) |
| com.nabit.pr-window | scripts/pr-window.py | 7am + 7pm EDT |
| com.nabit.standup-report | scripts/standup-report.py | 8am daily |
| com.nabit.monitor-completed | scripts/monitor-completed.py | Every 2min |
| com.nabit.monitor-prs | scripts/monitor-prs.py | Every 5min |
| com.nabit.monitor-pr-merge | scripts/monitor-pr-merge.py | Every 5min |
| com.nabit.monitor-stale | scripts/monitor-stale.py | Every 2h |
| com.nabit.monitor-review-transition | scripts/monitor-review-transition.py | Every 2min |
| ~~com.nabit.monitor-claude-limit~~ | ~~scripts/monitor-claude-limit.py~~ | Removed — Claude subscription has no API rate limit |
| com.nabit.cloudflared | cloudflared tunnel | Always on |

## Quick install on new Mac
```bash
# 1. Clone repos
git clone https://github.com/nabitllc/kaos-config ~/.openclaw/workspace
git clone https://github.com/nabitllc/kaos-mission-control ~/mission-control

# 2. Install Claude Code
npm install -g @anthropic-ai/claude-code

# 3. Install Node 22
brew install node@22

# 4. Install cloudflared
brew install cloudflared

# 5. Copy and load LaunchAgents
# (plist files are in ~/Library/LaunchAgents/ — copy from backup or recreate from this doc)
for f in ~/Library/LaunchAgents/com.nabit.*.plist; do launchctl load "$f"; done

# 6. Build and start Mission Control
cd ~/mission-control && npm install && npm run build
launchctl load ~/Library/LaunchAgents/com.nabit.mission-control.plist
```

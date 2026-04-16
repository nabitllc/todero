# n8n Workflow Triage — 2026-04-08

## Root cause of 79% failure rate
Two workflows called `http://127.0.0.1:8787/trigger-agent` (OpenClaw gateway) on every tick:
- **Auto-Activate on active/signoff queue** — every 5 min → ~2,600+ calls/month to dead endpoint
- **Auto-Activate on open queue** — every 1 hour → ~820 calls/month to dead endpoint
- **Stale Task Watchdog** — also called trigger-agent on stale issues
- **PR Window** — called `http://127.0.0.1:8787/pr-window-create` (OpenClaw)

These 4 workflows alone account for nearly all 40,825 failures.
With n8n stopped, the bleeding is done.

---

## Decision: All 54 workflows — DROP n8n entirely

### Why not keep n8n running with some workflows?
The valuable workflows (PR notifications, task completed → Discord, stale watchdog,
rate limit monitor, deployer trigger) are all 2-node scripts that poll Supabase/GitHub
and post to Discord/Telegram. They are **trivially portable** to standalone Python scripts
managed by launchd — no n8n needed.

n8n adds: 575MB SQLite DB, constant CPU, 54 workflows to maintain, port 5678 to manage.
Python scripts add: ~5KB each, zero overhead, already in your scripts/ folder pattern.

### Verdict: Port the 8 valuable workflows, drop the other 46, shut down n8n permanently.

---

## The 8 workflows worth porting (all others: DROP)

| ID | Name | Port as |
|---|---|---|
| `hnLagyYLNItdFX0z` | Task Completed → Discord #completed-tasks | `scripts/monitor-completed.py` |
| `dDcSY7ZWV04AgHmW` | PR Notifications → #pr-reviews | `scripts/monitor-prs.py` |
| `huC16MvkjX5FiI3f` | PR Merge → Issue Released | `scripts/monitor-pr-merge.py` |
| `uQKbhz8eQOJwqB9p` | Stale Task Watchdog — 2h | `scripts/monitor-stale.py` (no agent trigger) |
| `LtI70OKEg5lmztlf` | Claude Rate Limit Monitor | ~~`scripts/monitor-claude-limit.py`~~ (deleted — Claude subscription has no API rate limit) |
| `ao4Y4wryLRGpa6F5` | Auto-Trigger Deployer on Approved Tasks | `scripts/monitor-deployer.py` |
| `9Frgx5Odj57qrVnk` | Tester Auto-Trigger in_review → code_review | `scripts/monitor-review-transition.py` |
| `fB1x5k7m4YyARPSi` | INF-163: All feature tasks passed → in_review | `scripts/monitor-feature-advance.py` |

## The 46 workflows being dropped

### OpenClaw-dependent (dead endpoints — primary failure source)
- `tgwln7Ra04hKhbeC` Auto-Activate on active/signoff — every 5 min (calls trigger-agent)
- `ypkSfCq0LZ6eXDvM` Auto-Activate on open queue — every 1h (calls trigger-agent)
- `3Itb30Ykb2QKiRVU` PR Window (calls pr-window-create on OpenClaw)
- `slQ0YtOPzYQ2oNmY` OpenClaw Gateway Watchdog
- `QzQxOq7R1q7VOFZH` KAOS Proactive Loop (calls trigger-agent)
- `zCXzxUFLe2NqJh5U` Auto-Trigger Scout on Research Tasks (calls trigger-agent)
- `g6K0NP0myGS1fERt` Nightly Builder Queue (calls trigger-agent)
- `W3vaygqY8IpjfBix` Designer Loop (calls trigger-agent)
- `0EwpBAD0npXKhUrW` Tester Loop (calls trigger-agent)

### Duplicates / never ran / zero executions
- `mDgs8S1uUBHPkQzP` Model Switch Discord Logger (0 runs)
- `oJrwUiX3Cm78dAo4` Model Switch Discord Logger (0 runs)
- `M2kkLh7We63fYrM9` Model Switch Discord Logger (0 runs)
- `63Bp3Z6bHlvf4b2B` Model Switch Discord Logger (0 runs)
- `xPEMF81dDUkNyV7F` Model Switch Discord Logger (0 runs)
- `Jk0fxRHa5pbUPs56` KAOS Daily Model Canary (irrelevant — no more model switching)
- `3cRnePo3Ykzdv6WB` Monitor: Ping Michael When Issues Cleared (0 runs, duplicate)
- `X5D3gsXQ4Q5hzPOn` Monitor: Ping Michael When Issues Cleared (0 runs, duplicate)
- `YL3MdZ6z1cjKZlBE` Monitor: Ping Michael When Issues Cleared (keep one → ported above)
- `9D8iRQnfghBgqwiM` MC Health Check + Auto-Restart (0 runs, duplicate)
- `GIol64CWPhALAvR3` MC Health Check + Auto-Restart (0 runs, duplicate)
- `H43uFCGNOjeck4SR` MC Health Check + Auto-Restart every 5min (0 runs)
- `hsXxSRK8FmzYRREg` MC Health Check + Auto-Restart (76 runs — superseded)

### Replaced by Claude Code / queue-runner
- `TYNZOhpgz5FHaog5` KAOS Reroute — reassign issues wrongly assigned to main
- `dmRPP7il0ebJ3r2O` INF-39: Agent Timeout Alerts (queue-runner handles stuck detection)
- `oQljohzSBtYlyHG4` INF-165: Blocked issue alert (queue-runner handles skip alerts)
- `UTpkDWCf0DQD6WU2` INF-161: DoF-ready → auto-generate child tasks

### Reporting workflows (low value, superseded by KAOS daily brief)
- `F4gj5yY98iDhpsxe` KAOS Daily Brief — 8am (migrate to cron script)
- `wzv99yEK35IwfKHw` Weekly Executive Brief — Sunday 8am
- `o8Z6TE2lVn1jkWv4` Weekly Summary — Sunday 9am
- `SjnHDDryrCTmJMay` Weekly Audit — Sundays 8pm
- `AgtO95uGpAIkVXjN` Sprint Close — retro + rollover + Discord
- `IgQZ6JHpXj1XyWO8` Sprint Start — create sprint + kickoff Discord
- `OIxtmsd0l4WWtKr5` Sprint: Mid-Sprint Progress
- `X3uOzl6V0t5mM5IM` Sprint: 7am Scope
- `yQlXmvNJydO0KX8G` INF-24: Weekly Self-Improvement Loop

### Market research (can re-enable later as needed, not urgent)
- `g4W4AIDJVEkGQVm2` Infrastructure Market Research
- `UX9ARpHC5wwnLS6z` MC Market Research — Daily Digest
- `af0Fwq0uYBYHVZJ1` Kemuni Daily Market Research
- `wnerjtiClEAweOG4` Vespera Daily Market Research
- `UVmsMrAje96ccGQa` Vespera Health Check
- `9QXwpe8vDwFuvfCA` INF-17: Stale PR Alert >24h

### Misc / superseded
- `imidBGxYeGhvlyCK` Global Error Handler — Telegram Alert
- `qF068qEaXSYtwRg0` Global Error Handler — Discord
- `9QZ5DW0nmL0gGjlA` Telegram Command Interface (OpenClaw-era)
- `5n5tiKYqDy9cKNK1` Low Watermark Alert
- `PUq7ZngakPTq5Tre` Auditor: System Health Check every 30 min

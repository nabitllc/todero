---
name: agent-setup
description: Set up a new agent for the Todero platform. Claude Code version — creates workspace context files and registers agent in queue config. Use when: creating a new agent role, activating an agent that has no queue config, or adding a new agent identity. NOT for: modifying existing agent behavior (edit AGENTS.md directly), restarting services.
---

# Agent Setup Skill — Claude Code

## Critical Rules
- **No openclaw.json** — agents are registered in `AGENTS.md` roster + `queue-agent-config.json`
- **NEVER git push** — commit locally only, KAOS pushes at sprint windows
- No gateway to restart

## Workflow

### Step 1 — Define the agent in AGENTS.md
Add a row to the Agent Roster table in `AGENTS.md` with:
- ID, model, role description

### Step 2 — Add to queue-agent-config.json
File: `/Users/kemuniagent/.openclaw/workspace/scripts/queue-agent-config.json`

```json
"<agent-id>": {
  "eligible_statuses": ["open"],
  "discord_channel": "1485333334077735084"
}
```

### Step 3 — Verify with dry run
```bash
curl -s "http://localhost:3000/api/issues?assignee=<id>&status=open" | python3 -c "import json,sys; d=json.load(sys.stdin); print(f'{len(d)} issues ready for <id>')"
```

### Step 4 — Commit
```bash
cd /Users/kemuniagent/todero/config
git add -A && git commit -m "feat(agent): add <id> agent — AGENTS.md + queue config"
```

## Eligible Statuses by Role

| Role | eligible_statuses |
|---|---|
| builder | `["open"]` |
| tester | `["code_review"]` |
| designer | `["code_review"]` |
| po | `["defined"]` |
| deployer | `["approved"]` |
| auditor | `["released"]` |
| scout | `["open"]` |
| ops | `["open"]` |

## Current Agents

| ID | Model | Emoji | Role |
|---|---|---|---|
| main | sonnet | 🧠 | KAOS — orchestrator |
| builder | sonnet | 🔨 | Coding, implementation |
| tester | haiku | 🧪 | QA, test review |
| designer | haiku | 🎨 | UI/UX review |
| po | sonnet | 📋 | Issue structure, backlog |
| scout | sonnet | 🔍 | Research |
| ops | haiku | ⚙️ | Infrastructure |
| deployer | haiku | 🚀 | Release coordination |
| auditor | sonnet | 🔎 | Drift detection |
| kemuni-sme | sonnet | 🚀 | Kemuni product |
| vespera-sme | sonnet | 🖤 | Vespera product |

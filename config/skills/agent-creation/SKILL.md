---
name: agent-creation
description: Create a new agent for the Todero platform. Claude Code version — no OpenClaw dependency. Use when adding a new agent role (builder, tester, scout, etc.). Creates the agent's workspace files and registers it in AGENTS.md.
---

# Agent Creation Skill — Claude Code

## When to Use
Creating a new persistent agent role: "create a new agent", "add an agent", "set up [role] agent".

## What an Agent Is Now

An agent is a named Claude Code session that:
- Has a defined role (builder, tester, scout, etc.)
- Loads workspace context (SOUL.md, AGENTS.md, self-improving/memory.md) at startup
- Picks up issues via `queue-runner-<id>.sh` or `builder-loop.sh`
- Reports results via MC API + Discord

There is no `openclaw.json` registration. The agent exists when it's in the AGENTS.md roster and the queue-runner config.

## Checklist

- [ ] 1. Choose agent ID (lowercase, no spaces: `builder`, `tester`, `ux-researcher`)
- [ ] 2. Define role, mandate, model tier in `AGENTS.md` roster table
- [ ] 3. Add to `scripts/queue-agent-config.json` with eligible_statuses and discord_channel
- [ ] 4. Create agent-specific SOUL section if needed (or it inherits the shared SOUL.md)
- [ ] 5. Test: `curl -s "http://localhost:3000/api/issues?assignee=<id>&status=open"` returns expected issues

## queue-agent-config.json Entry

```json
"<agent-id>": {
  "eligible_statuses": ["open"],
  "discord_channel": "1485333334077735084"
}
```

Adjust `eligible_statuses` per role:
- builder → `["open"]`
- tester → `["code_review"]`
- designer → `["code_review"]`
- deployer → `["approved"]`
- auditor → `["released"]`

## Model Guidelines

| Complexity | Model |
|---|---|
| Complex reasoning, design, orchestration | claude-sonnet-4-6 |
| Monitoring, triage, review, heartbeat | claude-haiku-4-5 |

## Spawning the Agent Manually

```bash
/Users/kemuniagent/.local/bin/claude \
  --permission-mode bypassPermissions \
  --print "$(python3 /Users/kemuniagent/.openclaw/workspace/scripts/render-agent-context.py <agent-id>)

You are <AgentName>. [task here]"
```

## Current Agent Roster

| ID | Model | Role |
|---|---|---|
| main (KAOS) | sonnet | Orchestrator |
| builder | sonnet | Code implementation |
| tester | haiku | QA review |
| designer | haiku | UI/UX review |
| po | sonnet | Issue structuring, backlog |
| scout | sonnet | Research |
| ops | haiku | Infrastructure |
| deployer | haiku | Release coordination |
| auditor | sonnet | Drift detection |
| kemuni-sme | sonnet | Kemuni product specialist |
| vespera-sme | sonnet | Vespera product specialist |

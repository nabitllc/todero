---
name: agent-creation
description: Create a new agent for the Todero platform. Creates workspace files, seeds identity docs into DB, registers in agent-queue.ts and AGENTS.md.
---

# Agent Creation Skill

## When to Use
Adding a new persistent agent role: "create a new agent", "add agent", "set up [role] agent".

## What an Agent Is

An agent is a named Claude Code session that:
- Has a defined role and identity (stored in `agent_documents` table, `agent_id=<name>`)
- Picks up issues via `POST /api/run-agent?agent=<name>`
- Reports results via MC API + Discord

## Checklist

- [ ] 1. Choose agent ID (lowercase, no spaces: `builder`, `tester`, `ux-researcher`)
- [ ] 2. Add to `lib/agent-queue.ts` → `AGENT_QUEUE_CONFIGS` with correct pickup/working/completion statuses, WIP limit, model, promptPrefix
- [ ] 3. Add to `AGENTS.md` roster table
- [ ] 4. Create `workspace-<id>/SOUL.md` with agent identity, then seed into DB:
  ```bash
  # After creating the file, upsert into agent_documents via API:
  curl -s -X POST http://localhost:3000/api/agent-docs \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $CRON_SECRET" \
    -d '{"agent_id":"<id>","doc_type":"soul","slug":"SOUL","content":"<content>"}'
  ```
  Or run `npx ts-node config/migrations/seed-agent-db.ts` to re-seed all files.
- [ ] 5. Add `workspace-<id>/HEARTBEAT.md` with heartbeat schedule and pickup logic
- [ ] 6. Add agent skill routing in `app/api/run-agent/route.ts` → `agentSkillFiles` map
- [ ] 7. Test: `curl -s "http://localhost:3000/api/run-agent?agent=<id>"` returns eligible issues or "no eligible issues"

## Spawning Manually

```bash
curl -s -X POST http://localhost:3000/api/run-agent?agent=<id>
```

The `run-agent` endpoint assembles full context automatically from DB (when `AGENT_CONTEXT_SOURCE=db`) or filesystem (default).

## Current Agent Roster

| ID | Model | Role |
|---|---|---|
| main (KAOS) | sonnet | Orchestrator |
| builder | sonnet | Code implementation |
| tester | haiku | QA review |
| designer | haiku | UI/UX review |
| po | sonnet | Product owner |
| scout | sonnet | Research |
| ops | haiku | Infrastructure |
| deployer | haiku | Release coordination |
| auditor | sonnet | Drift detection |
| kemuni-sme | sonnet | Kemuni product specialist |
| vespera-sme | sonnet | Vespera product specialist |
| todero-sme | sonnet | Todero platform specialist |
| infra-sme | sonnet | Infrastructure specialist |

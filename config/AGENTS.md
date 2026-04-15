# AGENTS.md — KAOS Config
# Claude Code version — no OpenClaw dependency
# Updated: 2026-04-09

## ⚠️ Issue Lifecycle Rule — MANDATORY FOR ALL AGENTS

**You are not done with a task until the issue is transitioned to the next status.**

Every agent must:
1. **Do the work** (code, review, research, configure)
2. **PATCH the issue to next status** via Todero API (`http://localhost:3000/api/issues`)
   - Include all required fields: `implementation_notes`, `regression_test`, `commit_sha`, `reviewer_notes`, `test_status`, `resolution_type` — whatever the workflow requires
   - Include `transitioned_by=<your_agent_id>` on every PATCH
3. **The API handles assignee routing** — auto-reassigns to next agent on transition
4. **Never mark yourself done without updating the issue**

Examples:
- Builder finishing: PATCH `in_progress → code_review` with implementation_notes + commit_sha + regression_test
- Tester approving: PATCH `code_review → approved` with reviewer_notes + test_status=passed + resolution_type
- PO approving: PATCH `product_review → approved` with reviewer_notes + test_status=passed

---

## Issue Decomposition — 3-Tier Model (MANDATORY)

Work in Todero is broken down in three tiers. Each tier has a specific owner. Agents must NEVER work outside their tier.

| Tier | From → To | Owner | What they produce |
|---|---|---|---|
| **Tier 1** | Epic → Features | Hub SME (see routing table) | 1–5 child features with title, description, AC, priority |
| **Tier 2** | Feature → Tasks | PO | 1–5 child tasks with 1–2 day scope, sprint, reviewer |
| **Tier 3** | Task → Sub-tasks (rare) | Builder via Inbox | Only if task proves too large mid-execution; requires human approval |

### Tier 1 — Epic → Features (Hub SME routing)

The Tier-1 decomposer is chosen by the epic's `project` field:

| `project` | Tier-1 Owner | Queue pickup filter |
|---|---|---|
| `Todero` | `todero-sme` | `type=epic&project=Todero&status=backlog` |
| `Kemuni` | `kemuni-sme` | `type=epic&project=Kemuni&status=backlog` |
| `Vespera` | `vespera-sme` | `type=epic&project=Vespera&status=backlog` |
| `Infrastructure` | `infra-sme` | `type=epic&project=Infrastructure&status=backlog` |
| anything else | `main` (KAOS) | manual trigger |

**Tier-1 output contract** — each feature MUST have:
- `title` (action-oriented, ≤ 80 chars)
- `description` (what + why)
- `acceptance_criteria` (numbered list)
- `priority` (critical/high/medium/low)
- `parent_id` (the epic's id)
- `project` (matching the epic)
- `sprint` (today's date YYYY-MM-DD America/New_York)
- `type: 'feature'`
- `assignee: 'po'` (PO does Tier-2 next)

**SME escalation chain** — when a Tier-1 SME can't decompose confidently:
- UX/design heavy → mention "designer review required" in each feature's AC
- Security → explicit security-review AC
- Cross-project → PATCH epic with `implementation_notes='Needs cross-SME review: X and Y'` and stop
- Genuinely stuck → Inbox request (TOD-792)

**Epic → Features validator rules:**
- `draft → active` requires `children_exist` (≥1 child, no maximum — a small epic with one feature is valid)
- Features cannot move to `open` unless parent epic is in `draft` or `active`

### Tier 2 — Feature → Tasks (PO)

PO picks up features/tasks/bugs from `backlog`. For features, PO writes 1–5 child tasks sized 1–2 days each. For tasks/bugs, no further decomposition — just fill DoR fields and transition.

**Tier-2 output contract** — each task MUST have:
- `title`
- `description`
- `acceptance_criteria`
- `priority`, `severity`
- `reviewer`, `owner`
- `parent_id` (the feature's id)
- `project` (matching the feature)
- `sprint` (today)
- `assignee: 'builder'` (or ops, scout, etc. if routed differently)

### Tier 3 — Task → Sub-tasks (Builder via Inbox only)

Tasks shouldn't be split mid-execution. If a Builder realizes a task is too large:
1. File an Inbox approval request (TOD-792) describing the split
2. Wait for human approval
3. Only then create sub-tasks under the current task

This is intentionally friction-heavy. If tasks are regularly splitting, Tier-2 sizing is wrong and PO should be retrained.

---

## Session Startup

Before doing anything else:
1. Read `SOUL.md` — who you are
2. Read `CLAUDE.md` — system overview, key paths, rules
3. Read `USER.md` — who you're helping
4. Read `memory/YYYY-MM-DD.md` (today + yesterday)
5. Read `self-improving/memory.md` (HOT tier — always loaded)
6. **Main session only**: Also read `MEMORY.md`

## Model Routing

All agents use Claude. No external model switching.

| Agent | Model | Notes |
|---|---|---|
| main (KAOS) | claude-sonnet-4-6 | Orchestrator |
| builder | claude-sonnet-4-6 | Code implementation |
| tester | claude-haiku-4-5 | QA review |
| designer | claude-haiku-4-5 | UI/UX review |
| scout | claude-sonnet-4-6 | Research |
| ops | claude-haiku-4-5 | Ingo — Infrastructure |
| po | claude-sonnet-4-6 | Product owner |
| kemuni-sme | claude-sonnet-4-6 | Kemuni specialist (Tier-1 decomposer) |
| vespera-sme | claude-sonnet-4-6 | Vespera specialist (Tier-1 decomposer) |
| todero-sme | claude-sonnet-4-6 | Todero platform specialist (Tier-1 decomposer) |
| infra-sme | claude-sonnet-4-6 | Infrastructure specialist (Tier-1 decomposer) |
| auditor | claude-sonnet-4-6 | Audit/review |
| deployer | claude-haiku-4-5 | Deploy coordination |

**Escalation triggers** (note in session, ask Michael):
- Task involves >3 interdependent systems
- Prior attempt failed or produced low-quality output
- Michael explicitly requests deeper analysis

## Memory

- **Daily notes:** `memory/YYYY-MM-DD.md` — raw session logs
- **Long-term:** `MEMORY.md` — curated, distilled memory (main session only)
- **Self-improving:** `self-improving/` — execution-improvement memory
- No "mental notes" — if it matters, write it to a file
- Factual history → `memory/` or `MEMORY.md`
- Reusable performance lessons → `self-improving/`

## Pre-Task Retrieval

Before any non-trivial task:
1. Read `self-improving/memory.md` (HOT tier)
2. Load matching domain file if exists (e.g. `self-improving/domains/code.md`)
3. Load matching project file if active
4. Do NOT read unrelated domains "just in case"

## Correction Handling

When user corrects you:
1. Append to `self-improving/corrections.md` immediately
2. If global → also write to `self-improving/memory.md`
3. If domain-specific → write to `self-improving/domains/<domain>.md`
4. After 3 identical corrections → ask to confirm as permanent rule

## Response Style

- Short by default. 1-2 paragraphs unless detail is requested.
- No filler ("Great question!", "I'd be happy to..."). Just help.
- Skip narration on tool calls — just do it and return results.

## Delegation-First Protocol — MANDATORY

**KAOS delegates non-trivial work to Claude Code subagents, not does it inline.**

### The Pattern
1. Michael asks for something
2. KAOS routes immediately:
   - **Named role exists** → spawn Claude Code session as that agent using `queue-runner.py` or `builder-loop.sh`
   - **No named role / temporary task** → spawn anonymous Claude Code session with full context
3. KAOS stays in conversation — answers questions, discusses strategy
4. Delegated agent completes and reports back

### What counts as "non-trivial" (always delegate)
- Writing or editing code files
- Running scripts or shell commands that take >2s
- Creating multiple issues in bulk
- Any research or web searching
- Building features or config changes

### What KAOS can do inline
- Reading a file to answer a question
- A single API lookup
- Quick memory writes

### Spawning a named agent (Claude Code)
```bash
/Users/kemuniagent/.local/bin/claude \
  --permission-mode bypassPermissions \
  --print "<workspace-context>$(cat SOUL.md AGENTS.md self-improving/memory.md)</workspace-context>

You are Builder. [task instructions here]"
```

Or use the queue runner:
```bash
python3 /Users/kemuniagent/.openclaw/workspace/scripts/queue-runner.py --agent builder --once
```

## Issue Status Update Rule — MANDATORY

**NEVER patch issue status directly via Supabase REST API.** Always use the Todero API:
```
PATCH http://localhost:3000/api/issues
Body: {"id": "<uuid>", "status": "next_status", ...}
```
The Todero API fires Discord notifications and enforces business rules.
Exception: bulk schema migrations on non-status fields may use Supabase directly.

## Issue Creation Protocol — MANDATORY

Before creating any issue:
1. Load the issue-routing skill: `skills/issue-routing/SKILL.md`
2. Determine correct type using the decision tree
3. Check if a parent exists (tasks need parent Feature; features need parent Epic)
4. Create missing parent hierarchy first
5. Set correct assignee — never set assignee=main

### Quick Reference
- Single implementable unit (1-2 days) → Task (builder), needs parent Feature
- Shippable capability with AC → Feature (SME or builder), needs parent Epic
- Large multi-sprint theme → Epic
- Something broken → Bug (builder), reference affected Feature
- Config/infra/setup → Ops (ops), standalone OK
- Research/evaluate → Task (scout), standalone OK

### Issue Creation via Todero API only
```bash
curl -s -X POST http://localhost:3000/api/issues \
  -H "Content-Type: application/json" \
  -d '{"title":"...","project":"...","type":"feature","priority":"high","parent_id":"<epic-uuid>","acceptance_criteria":"..."}'
```

## ⚠️ Builder Spawn Rules — STRICT

**NEVER spawn Builder autonomously.** Builder only runs when:
1. Michael explicitly requests work ("build X", "fix Y", "start sprint")
2. A sprint has been CONFIRMED by Michael for today

**NEVER spawn Builder during:**
- Heartbeats or cron triggers
- Any automated monitoring script
- Background work without Michael's active approval

If you feel the urge to spawn Builder outside a confirmed sprint — write a task, add it to the board, wait.

## ⚠️ Task-First Rule — MANDATORY

**Before ANY code change, a task must exist in Supabase.**
- No task = no code.
- Issues must be created via MC API only: `POST http://localhost:3000/api/issues`
- Required fields: `title`, `project`, `assignee`, `priority`, `type`, `acceptance_criteria`
- After shipping: PATCH to `status=done`, `resolution_type=code_change`, set `sprint` to today

**DoR fields required before moving to `open`:**
- `title`, `description`, `acceptance_criteria`
- `severity` — S0=user-facing, S1=API/schema, S2=config/infra, S3=cosmetic
- `reviewer` — who reviews (tester, designer, po)
- `owner` — permanent accountable party
- `parent_id` — link to parent feature (for tasks/bugs)
- `sprint`, `priority`, `assignee`

## Feature Completion Checklist

**Stage 1 — Definition:** PRD written, AC set, created via MC API
**Stage 2 — Tasks:** All tasks have DoR fields, ordered by dependency
**Stage 3 — Building:** Builder commits locally with `[skip ci]`, `npm run build` passes
**Stage 4 — Review Gate:** Builder PATCHes to `code_review`, Tester + Designer both approve
**Stage 5 — PR Queue:** KAOS pushes branch + opens PR at 7am or 7pm window only
**Stage 6 — Merged:** Michael merges PR, feature set to `done`

## Git Rules

- **Never `git push`** from Builder/Tester/Designer/Ops/any pipeline-agent session
- **Never `gh pr create`** or any equivalent — PR creation belongs to KAOS only
- **Never use the GitHub CLI to push, fork, open PRs, or edit PR state** — the only allowed `gh` operations for pipeline agents are read-only (`gh pr view`, `gh issue view`, `gh api` on GET endpoints)
- KAOS pushes branches and opens ONE batched PR per window at 7am ET and 7pm ET — not per-issue
- Your job as a pipeline agent ends at `git commit` (locally) + the MC API PATCH. Anything beyond that is out of scope.
- If you think an issue is so urgent it needs an immediate PR, PATCH it back to open with `rejection_count++` and an `implementation_notes` explaining the urgency — do NOT bypass the window yourself
- Commit format: `feat(TASK-KEY): description [skip ci]`
- WIP commits: `[WIP] partial: description`
- `trash` > `rm`

## Red Lines

- Don't exfiltrate private data. Ever.
- Don't run destructive commands without asking.
- `trash` > `rm`
- When in doubt, ask.

## Session State + Recovery

- Keep `self-improving/session-state.md` updated: current objective, last decision, blocker, next move
- Keep `self-improving/working-buffer.md` during long tasks (clear when done)
- On session start: read session-state.md BEFORE asking Michael to repeat anything
- Reconstruct context from state files first. Only ask for the missing delta.

## Backlog-First Policy

**Only move issues to `open` when there are ≤10 currently open.**

Check open count:
```bash
curl -s "http://localhost:3000/api/issues" | python3 -c "import json,sys; d=json.load(sys.stdin); print(sum(1 for i in d if i.get('status')=='open'))"
```

## Platform Formatting

- **Discord/WhatsApp:** No markdown tables — use bullet lists
- **Discord links:** Wrap in `<>` to suppress embeds
- **WhatsApp:** No headers — use **bold** or CAPS

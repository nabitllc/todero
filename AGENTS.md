# Todero — Agent System (Runtime-Neutral)

> **This file is read by Claude Code, Codex, Cursor, and any other LLM CLI that
> looks at `AGENTS.md` at the repo root. It is intentionally runtime-neutral.**
>
> For the full agent protocols, behavioral rules, and skill library, read
> [`~/kaos-config/AGENTS.md`](/Users/kemuniagent/kaos-config/AGENTS.md) and
> [`~/kaos-config/SOUL.md`](/Users/kaos-config/SOUL.md).
>
> For Todero-specific build and test rules, read [`./CLAUDE.md`](./CLAUDE.md)
> (named that way for historical reasons — it's read by all LLM CLIs, not just Claude).

## Portability

Todero's agent pipeline is driven by `/api/run-agent`, which dispatches through
`lib/runtimes/` — a pluggable runtime registry. You can switch the underlying
LLM CLI by setting `TODERO_RUNTIME`:

```bash
TODERO_RUNTIME=claude-code  npm start   # default — Claude Code CLI (Anthropic)
TODERO_RUNTIME=codex        npm start   # OpenAI Codex CLI
TODERO_RUNTIME=cursor       npm start   # Cursor CLI
```

Per-spawn override: `POST /api/run-agent?agent=builder&runtime=codex`.
List available runtimes: `GET /api/run-agent/runtimes`.

Every spawn runs in an isolated git worktree under `~/agent-worktrees/`
(see `lib/runtimes/worktree.ts`), so parallel agents never collide on branch
state and the interactive editor session in `~/todero` is never affected.

## Production

- Live URL: **https://kaos.nabit.work** (Cloudflare tunnel → `localhost:3000`)
- Database: Supabase (`twthgapiouiqhavrcnry.supabase.co`)
- LaunchAgent: `work.nabit.todero` (macOS launchd)

## Interactive Agent Rules (MUST follow regardless of runtime)

When acting as a pipeline agent (Builder, Tester, Designer, PO, etc.):

1. **Work in your assigned git worktree**, not `~/todero`. The spawn command
   places you there.
2. **Never `git push`, never `gh pr create`**, never edit PR state. KAOS batches
   all PRs at 7am/7pm ET via `pr-window.py`. Your scope ends at `git commit`
   plus the MC API PATCH.
3. **Always PATCH the issue to its completion status** via
   `http://localhost:3000/api/issues` before ending your session. If you skip
   this, your work is lost because the next agent cannot claim the issue.
4. **Commit format**: `feat(TASK-KEY): description [skip ci]` or
   `fix(TASK-KEY): description [skip ci]`.
5. **Run `npm run build`** to verify TypeScript errors = 0 before committing.
6. **Consult skills on demand**: your spawn prompt includes core behavioral
   rules from `~/kaos-config/skills/proactivity/` and
   `~/kaos-config/skills/self-improving/`. For deeper protocols (memory
   templates, heartbeat rules, operations playbooks), `Read` the additional
   files in `~/kaos-config/skills/<pack>/` as needed.

## Agents

| Agent | Role | Model | Status |
|-------|------|-------|--------|
| KAOS (main) | Chief of Staff / Orchestrator | Claude Sonnet 4.6 | Active |
| Builder | Coding Agent | Claude Sonnet 4.6 | Active |
| Tester | QA Reviewer | Claude Haiku 4.5 | Active |
| Designer | Design Review Agent | Claude Haiku 4.5 | Active |
| Scout | Research Agent | Gemma 3 4B (Ollama) | Scheduled |
| Ingo | Infrastructure | — | Planned |
| Kemuni SME | Kemuni Product Specialist | Claude Sonnet 4.6 | Active |
| Vespera SME | Vespera Product Specialist | Claude Sonnet 4.6 | Active |

## Issue Creation Protocol

**MANDATORY**: Before KAOS creates any issue, it MUST follow this protocol:

### Step 1: Load Issue-Routing Skill

Before creating any issue, KAOS must either:

1. **Read the issue-routing skill** to verify the correct `type` and hierarchy for the new issue, OR
2. **Describe the request to PO agent** and let PO structure it into the correct issue type and hierarchy.

### Step 2: Check Hierarchy

No issue should be created without first checking:

- Does a **parent epic** exist for this work area?
- Does a **parent feature** exist under that epic?
- Is the new issue a **task** that belongs under an existing feature?

If no parent exists, KAOS must create the hierarchy top-down:
1. Create the epic (if missing)
2. Create the feature under the epic (if missing)
3. Create the task under the feature

### Step 3: Validate Before Creating

Before calling the issues API, verify:

- `type` is correct: `epic`, `feature`, `task`, `bug`, or `ops`
- `parent_id` is set to the correct parent (feature for tasks, epic for features)
- `project` matches the correct business unit (Vespera, Kemuni, Mission Control, Infrastructure)
- `priority` is set appropriately
- `acceptance_criteria` is defined (required for sprint issues)
- `assignee` is a valid agent ID

### Rules

- **KAOS must NEVER create tasks directly** without checking if a parent feature/epic exists first.
- If unsure about hierarchy, delegate to PO agent.
- Orphan tasks (tasks without a parent feature) are a sign of protocol violation.
- All sprint issues MUST have `acceptance_criteria` set.

## Agent Communication

- Agents communicate via Supabase `agent_runs` table and issue status transitions.
- KAOS delegates work by creating issues assigned to the appropriate agent.
- Builder picks up `open` issues assigned to `builder` with `acceptance_criteria` set.
- Builder submits code-change work to `code_review`; assignee flips to `tester` and both Tester + Designer are activated in parallel.
- Tester reviews the functional/regression lane and records `tester_status` + `tester_notes`.
- Designer reviews the UX/product-impact lane (including backend-only fallout checks) and records `designer_status` + `designer_notes`.
- A code-change issue cannot move from `code_review` to `approved` until both reviewer lanes pass; if either fails it returns to `open` for the issue owner/working agent with both note sets preserved.
Approved work routes to `deployer`; released work routes to `auditor`; closing always clears assignee.

## Sprint Workflow

1. KAOS creates sprint issues following the Issue Creation Protocol above.
2. Builder implements code changes and moves issues to `in_review`.
3. Tester reviews and either passes or fails (→ `open` with notes).
4. For MC/Vespera passed issues: Designer reviews UI against design-system.md.
   - Designer approves → parent issue marked `done`.
   - Designer rejects → creates fix task for builder, parent reopened.
5. KAOS monitors progress and adjusts priorities as needed.

## Delegation-First Spawn Protocol

**MANDATORY**: Every named-agent spawn MUST prepend workspace context to the task prompt.

### Spawn Template

When KAOS spawns any named agent, the prompt MUST follow this structure:

```
<workspace-context>
{output of: bash scripts/spawn-context.sh /path/to/workspace}
</workspace-context>

You are {AgentName}. {Task description here.}
```

### How to Use

1. **Generate context** before spawning:
   ```bash
   CONTEXT=$(bash scripts/spawn-context.sh /Users/kemuniagent/mission-control)
   ```

2. **Prepend to prompt**:
   ```
   <workspace-context>
   ${CONTEXT}
   </workspace-context>

   You are Builder. Work on MC-491: replace inline styles with Tailwind tokens...
   ```

3. **Multi-workspace spawns** (e.g., Vespera):
   ```bash
   CONTEXT=$(bash scripts/spawn-context.sh /path/to/vespera)
   ```

### What Gets Loaded

| File | Purpose | Loaded As |
|------|---------|-----------|
| `SOUL.md` | Agent-specific guidelines, constraints | Full content |
| `AGENTS.md` | Agent table, communication protocol, workflow | Key sections (agent table, comms, workflow) |
| `self-improving/memory.md` | Learned patterns, past decisions | Full content (if exists) |

### Rules

- KAOS must NEVER spawn an agent without running `spawn-context.sh` first.
- The context block must appear before any task-specific instructions.
- If a workspace directory does not exist, skip context for that workspace (do not fail).
- The script is idempotent and read-only — safe to run at any time.

## Tester SOUL

**Code review gate:**

1. Tester updates the shared issue with `tester_status=passed|failed` plus `tester_notes`.
2. Designer updates the same issue with `designer_status=passed|failed` plus `designer_notes`.
3. The issue stays in `code_review` until both lanes pass.
4. If either lane fails, the issue returns to `open` and the owner/working agent addresses both note sets on the same task.
5. `approved` assigns Deployer, `released` assigns Auditor, and `closed` always clears assignee.

**Designer review scope:**
- Designer reviews: color tokens, spacing scale, typography, component consistency, responsive behavior, accessibility
- Backend-only work still gets a lighter Designer check for user-flow or UX fallout

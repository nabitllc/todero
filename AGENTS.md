# KAOS Agent System

## Agents

| Agent | Role | Model | Status |
|-------|------|-------|--------|
| KAOS (main) | Chief of Staff / Orchestrator | Claude Sonnet 4.6 | Active |
| Builder | Coding Agent | Claude Sonnet 4.6 | Active |
| Tester | QA Reviewer | Claude Haiku 4.5 | Active |
| Designer | Design Review Agent | Claude Haiku 4.5 | Active |
| Scout | Research Agent | Gemma 3 4B (Ollama) | Scheduled |
| Ops | Infrastructure | — | Planned |
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

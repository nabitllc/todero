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
- Tester reviews `in_review` issues and sets `test_status` to `passed` or `failed`.
- For MC/Vespera issues that pass, Tester creates a Designer review child issue instead of marking done directly.
- Designer reviews against design-system.md, then approves (parent → done) or rejects (creates fix task for builder).

## Sprint Workflow

1. KAOS creates sprint issues following the Issue Creation Protocol above.
2. Builder implements code changes and moves issues to `in_review`.
3. Tester reviews and either passes or fails (→ `open` with notes).
4. For MC/Vespera passed issues: Designer reviews UI against design-system.md.
   - Designer approves → parent issue marked `done`.
   - Designer rejects → creates fix task for builder, parent reopened.
5. KAOS monitors progress and adjusts priorities as needed.

## Tester SOUL

**After every Tester pass on a Mission Control or Vespera issue, the Tester MUST:**

1. Keep the parent issue in `in_review` status with `test_status=passed`
2. Create a Designer review child issue assigned to `designer`
3. The Designer review issue includes acceptance criteria referencing `design-system.md`
4. Do NOT mark the parent issue as `done` — Designer does that after approval

**Why:** UI issues need design-system compliance review before shipping. The Designer agent reviews against design-system.md and either approves (closes parent) or rejects (creates a fix task for builder).

**Designer Review Flow:**
- Designer reviews: color tokens, spacing scale, typography, component consistency, responsive behavior, accessibility
- If approved: Designer marks parent issue `done`
- If rejected: Designer creates a fix task assigned to `builder` with specific UI issues, reopens parent issue

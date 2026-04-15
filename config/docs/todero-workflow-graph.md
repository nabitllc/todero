# Todero Workflow — Full Graph Spec

**Audience:** People who need to understand how an issue moves from "new idea" to "shipped."
**Purpose:** Visual reference suitable for Google Nano Banana, Canvas, draw.io, or any diagram tool.
**Last updated:** 2026-04-10

---

## Legend

- **Circle (⬤)** = a state/status an issue can be in
- **Arrow (→)** = a transition the system allows
- **[role]** = who is authorized to perform a transition
- **🔒** = validator (hard system rule, cannot be bypassed)
- **⚙️** = post-function (side effect that fires automatically)
- **📝** = required field before entering state

---

## Actors / Agents

| Symbol | Name | What they do |
|---|---|---|
| 👤 | Michael (human) | Owner, can do anything, final arbiter |
| 🧠 | KAOS (main) | Orchestrator, assigns work, breaks down epics |
| 📋 | PO (Product Owner) | Grooms features, writes acceptance criteria, creates child tasks |
| 🔨 | Builder | Implements code tasks + ops tasks, runs `npm run build` |
| 🧪 | Tester | Reviews code against acceptance criteria, runs regression tests |
| 🎨 | Designer | Reviews UX/accessibility/responsive layout |
| 🔍 | Scout | Research agent (new product decisions, competitor analysis) |
| ⚙️ | Ingo | Infrastructure + configuration tasks |
| 🚀 | Deployer | Pushes to production, merges PRs during the 7am/7pm window |
| 🕵️ | Auditor | Final sign-off after release, verifies deployment outcome |

---

## Issue Types and Hierarchy

```
Epic (big goal)
  └── Feature (user-facing capability)
        └── Task / Bug / Ops / Research (unit of work)
```

- **Epic** → lives at the top, has multiple Features as children
- **Feature** → must have a parent Epic, has multiple Tasks as children
- **Task / Bug / Ops / Research** → must have a parent Feature (hard rule)

---

## The Status Lifecycle

```
                            ┌─────────────┐
                            │   backlog   │  (idea, not yet scheduled)
                            └──────┬──────┘
                                   │ [PO: add AC, sprint, estimate]
                                   ▼
                            ┌─────────────┐
                            │   defined   │  (groomed, has AC, ready for a sprint)
                            └──────┬──────┘
                                   │ [PO: last check — all DoR fields ok]
                                   ▼
                            ┌─────────────┐
                            │    open     │  (ready for work, in Builder queue)
                            └──────┬──────┘
                                   │ [Builder: claim the issue]
                                   ▼
                            ┌─────────────┐
                            │ in_progress │  (Builder actively coding)
                            └──────┬──────┘
                                   │ [Builder: commit + PATCH to code_review]
                                   ▼
                            ┌─────────────┐
                            │ code_review │  (waiting for Tester + Designer)
                            └──────┬──────┘
                                   │ [Tester: passes] AND [Designer: ux_approved]
                                   ▼
                            ┌─────────────┐
                            │  approved   │  (ready for deploy)
                            └──────┬──────┘
                                   │ [Deployer: ship to production]
                                   ▼
                            ┌─────────────┐
                            │  released   │  (live in production)
                            └──────┬──────┘
                                   │ [Auditor: verify deployment + AC met]
                                   ▼
                            ┌─────────────┐
                            │  completed  │  (signed off)
                            └──────┬──────┘
                                   │ [KAOS/Auditor: archive]
                                   ▼
                            ┌─────────────┐
                            │   closed    │  (terminal)
                            └─────────────┘

Alternative exits:
    any state  ──[PO: deprecate]──→  closed (resolution=deprecated)
    code_review ──[Tester/Designer: fail]──→ open (rejection_count++)
    in_progress ──[Builder: blocked]──→ open (implementation_notes explain blocker)
```

---

## Transition Details

### 1. `backlog → defined`

**Who:** PO
**Required fields before transition (📝):**
- `title` (always required)
- `description` (must be non-empty)
- `acceptance_criteria` (must be non-empty, can't be the placeholder "Acceptance criteria pending…")
- `priority` (critical | high | medium | low)
- `severity` (S0 | S1 | S2 | S3)
- `type` (epic | feature | task | bug | ops | research)

**Validators (🔒):**
- If `type=task|bug|ops`, must have `parent_id` pointing to a feature
- If `type=feature`, must have `parent_id` pointing to an epic
- `sprint` auto-filled to today's ET date if missing (added 2026-04-10)

**Post-functions (⚙️):**
- None

---

### 2. `defined → open`

**Who:** PO
**Required fields before transition (📝):**
- All fields from `backlog → defined`, plus:
- `assignee` set (must be a real agent, default is the one matching the type)
- `reviewer` set
- `owner` set
- `sprint` set to active sprint date

**Validators (🔒):**
- `assignee` must be a valid queue agent
- `sprint` must be today's ET date OR a future date (past dates auto-corrected)
- For `type=feature` in `backlog|defined`, assignee is **forced to `po`** — if someone sends `builder`, it's auto-rewritten (hard guard added 2026-04-10)

**Post-functions (⚙️):**
- `set_active_sprint` — looks up the active sprint for the project and stamps `sprint` with its `start_date`

---

### 3. `open → in_progress`

**Who:** Builder (or Ops, Scout — depends on type)
**Required fields before transition (📝):**
- Issue assignee must match the claiming agent
- WIP limit for the agent must not be at cap (Builder has `wipLimit=1`)

**Validators (🔒):**
- `dorFields` for the agent must all be set (Builder needs `description` + `acceptance_criteria`)
- `blocked_by` must be null or point to a closed/completed issue
- Agent must not already be over its WIP limit (enforced in `/api/run-agent`)

**Post-functions (⚙️):**
- `started_at` field auto-set to current timestamp
- `worked_by` set to the agent
- Sets `feature_branch = feat/<taskKey>` if unset (for Builder/Ops)
- Spawns the agent's Claude Code process in an isolated git worktree at `~/agent-worktrees/<agent>-<task>-<ts>/`

---

### 4. `in_progress → code_review`

**Who:** Builder (the agent that claimed it)
**Required fields before transition (📝):**
- `implementation_notes` (what the agent did, 1-2 sentences)
- `commit_sha` (the git commit hash)
- `regression_test` (how to verify)

**Validators (🔒):**
- `transitioned_by` must equal the current assignee (only the worker can advance)
- The three fields above are checked by the API and return 422 if missing (hardened 2026-04-10)

**Post-functions (⚙️):**
- `assignee` updated to the reviewer (tester by default for tasks/bugs, both tester + designer for features)
- `tester_status` and `designer_status` set to `pending`
- `test_status` set to `none`
- `/api/run-agent?agent=tester` fired in the background (spawns Tester)
- `/api/run-agent?agent=designer` fired in the background (spawns Designer)

---

### 5. `code_review → approved`

**Who:** System post-function, triggered when **BOTH** `tester_status='passed'` AND `designer_status='ux_approved'`
**Required fields before transition (📝):**
- `reviewer_notes` (auto-aggregated from tester + designer notes)

**Validators (🔒):**
- Both review states must pass
- If either fails, issue goes back to `open` and `rejection_count` increments by 1
- If `rejection_count >= 3`, `is_blocked` is auto-set to `true` (loop breaker, 2026-04-10)

**Post-functions (⚙️):**
- `test_status` updated to aggregate result (`passed` / `failed` / `mixed`)
- `resolution_type` auto-set based on type (code_change, config_change, research_completed)
- `assignee` switched to `deployer` for code-producing work
- Discord notification to `#3-ready-for-deploy`

---

### 6. `approved → released`

**Who:** Deployer (during the 7am/7pm ET PR window)
**Required fields before transition (📝):**
- `feature_branch` (must exist on origin — Deployer pushes it as part of the release PR)
- `pr_url` set after PR is created

**Validators (🔒):**
- Only `deployer` role can execute this
- PR window enforcement (soft — via `pr-window.py` cron, not API)

**Post-functions (⚙️):**
- `assignee` switched to `auditor`
- Discord notification to `#3-signoff`
- Release notes generator picks up the issue for the next release

---

### 7. `released → completed`

**Who:** Auditor
**Required fields before transition (📝):**
- `reviewer_notes` (final audit notes)

**Validators (🔒):**
- Only `auditor` role can execute this (hardened in 007 migration)
- PR must actually be merged (check `pr_url` status)

**Post-functions (⚙️):**
- Parent Feature's % done recalculated
- If all siblings are `completed`, parent Feature auto-transitions to `completed`
- Discord notification to `#4-done`

---

### 8. `completed → closed`

**Who:** System post-function (or KAOS manually)
**Required fields before transition (📝):**
- None

**Validators (🔒):**
- Only `auditor` or `main` can close

**Post-functions (⚙️):**
- `assignee` cleared
- `completed_at` timestamp set
- Parent Epic's % done recalculated; if all features are closed, Epic closes too

---

## Error Paths (Rejection, Block, Recovery)

### Rejection (code_review fails)
```
code_review ──[Tester or Designer fails]──→ open
    ⚙️ rejection_count += 1
    ⚙️ last_rejected_at = now
    ⚙️ last_rejection_reason = aggregated reviewer_notes
    🔒 if rejection_count >= 3: is_blocked = true (loop breaker)
```

### Auto-recovery (stale in_progress)
```
in_progress for >15 min with no updates
    ⚙️ monitor-stale.py cron detects
    ⚙️ PATCH status → open, rejection_count++
    ⚙️ kill the dead agent process
    ⚙️ Discord alert to #alerts
```

### Manual block (agent can't proceed)
```
in_progress ──[agent: blocked]──→ open
    📝 implementation_notes explains the blocker
    📝 blocked_by (optional) points at the blocking issue
```

---

## Required Fields Per Status (Summary Table)

| Status | Required |
|---|---|
| backlog | title, project, type |
| defined | + description, acceptance_criteria, priority, severity, sprint, assignee, owner, reviewer |
| open | same as defined |
| in_progress | same as open + `started_at` auto-set |
| code_review | + `implementation_notes`, `commit_sha`, `regression_test` |
| approved | + `reviewer_notes`, `test_status=passed`, `resolution_type` |
| released | + `pr_url`, `feature_branch` pushed |
| completed | + final `reviewer_notes` from auditor |
| closed | + `completed_at`, assignee cleared |

---

## Visual Layout Suggestion (for Nano Banana / Canvas)

Render as a horizontal swim-lane diagram:

- **Top row**: statuses as rounded rectangles, left to right (backlog → closed)
- **Arrow labels**: the actor + trigger, e.g. "PO: promote"
- **Below each status**: a stack of required fields as small cards
- **Below that**: validators as red "🔒" badges
- **Below that**: post-functions as green "⚙️" badges
- **Color code statuses** by `status_category`:
  - `Planned` (grey): backlog, defined
  - `Ongoing` (blue): open, in_progress, code_review, product_review
  - `SignOff` (orange): approved, released
  - `Done` (green): completed, closed
- **Error paths** as red dashed arrows pointing backward (code_review → open on rejection)

---

## Source Files (where the rules live)

| Layer | File |
|---|---|
| Workflow validators | `todero/app/api/issues/route.ts` (POST + PATCH handlers) |
| Agent queue config | `todero/lib/agent-queue.ts` |
| DB workflow transitions table | `todero/supabase/migrations/20260331*` + `007_*` + `009_*` |
| Spawn / runtime adapter | `todero/lib/runtimes/claude-code.ts` + `runtimes/index.ts` |
| Status category mapping | `todero/lib/issues.ts` |
| Post-functions (Discord, set_active_sprint) | `todero/app/api/issues/route.ts` top |
| Auto-recovery (stale) | `kaos-config/scripts/monitor-stale.py` |
| Sprint cycle (daily) | `kaos-config/scripts/sprint-cycle.sh` |
| PR window (7am/7pm) | `kaos-config/scripts/pr-window.py` |

---

## For the 100-person audience (1-page summary)

Todero is an **AI-run company OS**. When you create an issue, it starts in `backlog`. A **PO agent** picks it up, asks clarifying questions, writes acceptance criteria, then moves it to `open`. A **Builder agent** claims it, writes code in its own isolated git worktree, and submits for review. A **Tester** checks the code, a **Designer** checks the UX; both must approve. Once approved, a **Deployer** batches it into a release PR at the next 7am/7pm window. After deploy, an **Auditor** verifies production works as expected and closes the issue.

Every step is recorded in a Supabase database. Every agent runs its own Claude Code process (or Codex/Cursor — Todero is portable). If an agent gets stuck, a **monitor-stale** cron picks it up within 15 minutes and retries. If an issue gets rejected 3 times, a **loop breaker** marks it blocked and asks a human.

The human (Michael, or an admin) oversees through the Board UI at `https://kaos.nabit.work` — a 3-column kanban (Queue / Ongoing / Achieved) with swimlane views by Business, Feature, or Sprint.

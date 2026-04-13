# Todero Workflow Reference
**Last updated: 2026-04-13**

---

# Part 1: Workflows

## 1.1 Issue Types Using Each Workflow

Todero has **3 distinct workflows** based on issue type:

| Workflow | Issue Types | Purpose |
|---|---|---|
| **Standard** | `task`, `bug`, `feature`, `ops` | The full development pipeline: backlog → code → review → deploy → close |
| **Epic** | `epic` | Strategic container workflow: backlog → draft → active → completed → closed |
| **Research** | `research` | Lightweight: backlog → research → completed → closed (no code review) |

---

## 1.2 Statuses

### Standard Workflow Statuses (task, bug, feature, ops)

| Status | Meaning | Who owns it |
|---|---|---|
| `backlog` | Unrefined idea. Has title but may lack AC, sprint, severity. | Nobody (queue) |
| `defined` | PO refined it — has description, AC, parent. Not yet ready for work. | PO (refining) |
| `open` | Fully groomed: sprint, priority, severity, assignee, reviewer, owner all set. Ready for Builder. | Queue (waiting for Builder) |
| `in_progress` | An agent has claimed it and is actively working. `started_at` is set. | Builder / Ingo |
| `code_review` | Code written, committed. Dual review: Tester + Designer must both pass. | Tester + Designer |
| `product_review` | Code passes technical review, needs product/business validation. | PO / Reviewer |
| `approved` | All reviews passed. Ready for deployment at next PR window. | Deployer (queue) |
| `released` | Deployed to production. Awaiting final audit. | Auditor |
| `completed` | Audit passed. Work is done. | Auditor |
| `closed` | Final state. Immutable. Issue cannot be modified. | Archive |

### Epic Workflow Statuses

| Status | Meaning | Who owns it |
|---|---|---|
| `backlog` | Raw epic idea. | Nobody |
| `draft` | Being decomposed by a Hub SME into child features. | todero-sme / kemuni-sme / vespera-sme / infra-sme |
| `active` | Has children, work is in flight. Features can only enter `open` if parent epic is `draft` or `active`. | Main / PO |
| `completed` | All children done. Awaiting final check. | Auditor |
| `closed` | Final. | Archive |

### Research Workflow Statuses

| Status | Meaning | Who owns it |
|---|---|---|
| `backlog` | Research topic identified. | Nobody |
| `defined` | Scoped by PO. | PO |
| `open` | Ready for Scout. | Queue |
| `in_progress` | Scout is actively researching. | Scout |
| `completed` | Research done, findings documented. | Main / PO |
| `closed` | Final. | Archive |

---

## 1.3 Workflow Maps

### Standard Workflow (task/bug/feature/ops)

```
                        ┌──────────┐
                        │ creation │ (POST /api/issues)
                        └────┬─────┘
                             │
                        ┌────▼─────┐
              ┌─────────│ backlog  │──────────┐
              │         └────┬─────┘          │
              │              │                │ (direct close)
              │         ┌────▼─────┐          │
              │    ┌────│ defined  │────┐      │
              │    │    └────┬─────┘    │      │
              │    │         │          │      │
              │    │    ┌────▼─────┐    │      │
              │    └────│   open   │────┘      │
              │         └────┬─────┘           │
              │              │                 │
              │    ┌─────────▼──────────┐      │
              │    │   in_progress      │──────┤
              │    └──┬────────────┬────┘      │
              │       │            │           │
              │  ┌────▼─────┐  ┌──▼──────────┐│
              │  │code_review│  │product_review│
              │  └──┬───┬───┘  └──┬───┬──────┘│
              │     │   │         │   │        │
              │     │ ┌─▼─────────▼─┐ │        │
              │     │ │  approved   │ │        │
              │     │ └──────┬──────┘ │        │
              │     │        │        │        │
              │     │   ┌────▼─────┐  │        │
              │     │   │ released │  │        │
              │     │   └────┬─────┘  │        │
              │     │        │        │        │
              │     │   ┌────▼─────┐  │        │
              │     │   │completed │  │        │
              │     │   └────┬─────┘  │        │
              │     │        │        │        │
              │     │   ┌────▼─────┐  │        │
              └─────┴───│  closed  │◄─┴────────┘
                        └──────────┘
              (rollback arrows: code_review→open, product_review→open,
               in_progress→open, in_progress→backlog, open→backlog,
               open→defined, defined→backlog)
```

### Epic Workflow

```
        ┌──────────┐
        │ creation │
        └────┬─────┘
        ┌────▼─────┐
   ┌────│ backlog  │────┐
   │    └────┬─────┘    │ (direct close)
   │    ┌────▼─────┐    │
   │ ┌──│  draft   │──┐ │
   │ │  └────┬─────┘  │ │
   │ │       │         │ │ (rollback)
   │ │  ┌────▼─────┐   │ │
   │ │  │  active  │───┤ │
   │ │  └────┬─────┘   │ │
   │ │  ┌────▼─────┐   │ │
   │ │  │completed │   │ │
   │ │  └────┬─────┘   │ │
   │ │  ┌────▼─────┐   │ │
   │ └──│  closed  │◄──┘ │
   │    └──────────┘      │
   └──────────────────────┘
```

---

## 1.4 Transition Definitions

### TASK Transitions (24 total)

| From → To | Who can execute | Required fields | Post-functions |
|---|---|---|---|
| creation → backlog | anyone | title, project, acceptance_criteria, type | — |
| backlog → defined | po, main, SMEs | description, acceptance_criteria, parent_id | — |
| backlog → open | po, main | acceptance_criteria, sprint, priority, assignee, parent_id, reviewer, owner, severity | assign→owner |
| backlog → closed | anyone | — | assign→null, notify→#4-done |
| defined → open | po, main | sprint, priority, severity, assignee, reviewer, owner | assign→owner |
| defined → backlog | po, main, SMEs | — | — |
| open → in_progress | assignee | — | set_active_sprint |
| open → backlog | anyone | — | — |
| open → defined | anyone | — | — |
| open → closed | anyone | — | assign→null, notify→#4-done |
| in_progress → code_review | assignee | implementation_notes, regression_test, ref_required | assign→reviewer, kick tester+designer |
| in_progress → product_review | assignee | implementation_notes, regression_test | assign→reviewer, activate_reviewer |
| in_progress → open | assignee | — | assign→owner |
| in_progress → backlog | anyone | — | — |
| in_progress → closed | anyone | — | assign→null, notify→#4-done |
| code_review → approved | tester or designer | resolution_type, reviewer_notes, dual_review_passed | assign→deployer, notify→#3-ready-for-deploy |
| code_review → open | tester or designer | reviewer_notes | assign→owner, increment_rejection, notify→#2-rejected |
| code_review → closed | anyone | — | assign→null, notify→#4-done |
| product_review → completed | reviewer | reviewer_notes, resolution_type | assign→auditor, notify→#3-signoff |
| product_review → open | reviewer | — | assign→owner, increment_rejection, notify→#2-rejected |
| product_review → closed | anyone | — | assign→null, notify→#4-done |
| approved → released | anyone | pr_url | assign→auditor, notify→#3-signoff |
| released → closed | anyone | — | assign→null, notify→#4-done |
| completed → closed | anyone | — | assign→null, notify→#4-done |

### BUG Transitions (19 total)

Same as TASK with these differences:
- **creation → backlog** also requires: `steps_to_reproduce`, `expected_behavior`, `actual_behavior`
- **backlog → open** also requires: `environment`
- **defined → open** also requires: `environment`
- **code_review → approved** uses `test_status_passed` validator (not `dual_review_passed`)

### FEATURE Transitions (19 total)

Same as TASK with these differences:
- **creation → backlog** only requires: `title`, `project` (post: assign→po)
- **backlog → open** does NOT require: `parent_id`
- **code_review → approved** uses `dual_review_passed` (post: notify→#3-signoff, not #3-ready-for-deploy)
- **approved → released** role=`deployer` (not anyone)
- **released → closed** role=`auditor` (not anyone)
- **Extra validator (code-level):** features cannot move to `open` unless parent epic is in `draft` or `active`

### EPIC Transitions (9 total)

| From → To | Who can execute | Required fields | Post-functions |
|---|---|---|---|
| creation → backlog | anyone | title, project, description | — |
| backlog → draft | po, main | description, acceptance_criteria | — |
| backlog → closed | po, main | — | — |
| draft → active | po, main | children_exist (≥1 child) | — |
| draft → backlog | po, main | — | — |
| active → completed | anyone | — | assign→auditor, notify→#3-signoff |
| active → backlog | po, main | — | — |
| completed → closed | anyone | — | assign→null, notify→#4-done |
| closed → backlog | po, main | — | — |

### OPS Transitions (20 total)

Same as TASK with these differences:
- **backlog → open** role=`po_main_ops` (includes Ingo)
- **code_review → approved** uses `test_status_passed` (not dual_review_passed)
- **completed → closed** role=`assignee_or_ops`, requires `resolution_type`
- `ref_required` validator exempts ops type (no commit_sha required)

### RESEARCH Transitions (12 total)

| From → To | Who can execute | Required fields | Post-functions |
|---|---|---|---|
| creation → backlog | anyone | title, project, acceptance_criteria, type | — |
| backlog → defined | anyone | — | — |
| backlog → open | po, main | sprint, assignee, reviewer, owner | assign→scout |
| backlog → closed | po, main | resolution_type, reviewer_notes | assign→null, notify→#4-done |
| defined → backlog | anyone | — | — |
| defined → open | anyone | — | assign→owner |
| open → backlog | assignee | — | — |
| open → defined | anyone | — | — |
| open → in_progress | assignee | — | — |
| in_progress → backlog | assignee | — | — |
| in_progress → completed | scout only | implementation_notes, resolution_type | notify→#3-signoff, notify_kaos |
| completed → closed | po, main | — | assign→null, notify→#4-done |

---

## 1.5 Validators & Post-Functions Reference

### Validators

| Name | Logic | Used by |
|---|---|---|
| `title` | Field must be non-null, non-empty | creation for all types |
| `project` | Same | creation for all types |
| `description` | Same | backlog→defined, backlog→draft |
| `acceptance_criteria` | Same | creation, backlog→defined, backlog→open |
| `parent_id` | Must point to an existing feature (for tasks/bugs) | backlog→defined (task), backlog→open (task/bug) |
| `sprint` | Same | defined→open, backlog→open |
| `priority` | Same | defined→open, backlog→open |
| `severity` | Same | defined→open, backlog→open |
| `assignee` | Same | backlog→open, defined→open |
| `reviewer` | Same | backlog→open, defined→open |
| `owner` | Same | backlog→open, defined→open |
| `implementation_notes` | Same | in_progress→code_review, in_progress→product_review |
| `regression_test` | Same | in_progress→code_review |
| `reviewer_notes` | Same | code_review→approved, code_review→open, product_review→completed |
| `resolution_type` | Must be one of: code_change, config_change, database_change, research_completed, documentation, duplicate, expected_behavior, wont_fix, not_reproducible, deferred, no_change_required, completed | code_review→approved (task), backlog→closed (bug/ops), in_progress→completed (research), completed→closed (ops) |
| `ref_required` | Must have commit_sha OR feature_branch OR pr_url. Exempts ops/research types. | in_progress→code_review |
| `test_status_passed` | `test_status === 'passed'` | code_review→approved (bug, ops) |
| `dual_review_passed` | `tester_status === 'passed' AND designer_status === 'passed'` | code_review→approved (task, feature) |
| `children_exist` | At least 1 child issue exists (DB count check) | draft→active (epic) |
| `pr_url` | Same | approved→released |
| `steps_to_reproduce` | Same | creation (bug only) |
| `expected_behavior` | Same | creation (bug only) |
| `actual_behavior` | Same | creation (bug only) |
| `environment` | Same | backlog→open, defined→open (bug only) |

### Post-Functions

| Name | What it does | Params |
|---|---|---|
| `set_assignee` | Sets `assignee` to a value from params (`to`) or copies from another field (`source`/`from_field`). `to: null` clears assignee. | `{to: 'deployer'}` or `{source: 'reviewer'}` or `{to: null}` |
| `notify_discord` | Posts a message to a Discord channel via `postDiscord()`. | `{channel: '<discord_channel_id>'}` |
| `increment_rejection` | `rejection_count += 1`, sets `last_rejected_at` to now. | — |
| `copy_field` | Copies value from one field to another. | `{from: 'X', to: 'Y'}` |
| `set_timestamp` | Sets a timestamp field to `new Date().toISOString()`. | `{field: 'submitted_at'}` |
| `set_active_sprint` | If sprint is empty, looks up the project's active sprint and sets it. | — |
| `activate_code_review_agents` | Fires `/api/run-agent?agent=tester` + `?agent=designer`. | — |
| `activate_reviewer` | Fires `/api/run-agent` for the reviewer agent. | — |
| `notify_kaos` | Posts to localhost:3001/api/message (legacy, for research completion). | — |

### Code-Level Validators (not in workflow_transitions table)

| Rule | Logic | Location |
|---|---|---|
| **Feature epic gate** | Features cannot move to `open` unless parent epic is `draft` or `active` | route.ts:402 |
| **Backlog-first cap** | Cannot transition to `open` if >100 issues already open | route.ts:1036 (MAX_OPEN=100) |
| **3-strike loop breaker** | Sets `is_blocked=true` when `rejection_count >= 3` | route.ts:1118 |
| **Closed read-only** | PATCH returns 403 on closed issues (except closed→backlog transition) | route.ts:837 |
| **Sprint hygiene** | Auto-corrects past sprint dates to today on POST | route.ts:727 |
| **Self-chain** | After any status change, fires `/api/run-agent` for the next lane via `selfChainOnStatus()` | route.ts:73-98 |

### Condition Roles

| Role | Allowed `transitioned_by` values |
|---|---|
| `anyone` / `null` | Any value (or no transitioned_by) |
| `po_or_main` | `po`, `main` |
| `po_main_sme` | `po`, `main`, `kemuni-sme`, `vespera-sme` (note: todero-sme and infra-sme missing — known gap) |
| `po_main_ops` | `po`, `main`, `ops` |
| `assignee` | Must match the issue's current `assignee` field |
| `assignee_or_ops` | Assignee OR `ops` |
| `reviewer` | Must match the issue's `reviewer` field |
| `tester_or_designer` | `tester`, `designer`, or `ux` |
| `scout_only` | `scout` or assignee is `scout` |
| `deployer` | `deployer` |
| `auditor` | `auditor` |

---

## 1.6 Other Important Workflow Information

### Self-Chain (Event-Driven Pipeline)
When any PATCH changes an issue's status, `selfChainOnStatus()` fires `/api/run-agent` for the lane that picks up that status:

| New status | Agents kicked |
|---|---|
| `backlog` | po, todero-sme, kemuni-sme, vespera-sme, infra-sme |
| `defined` | po |
| `open` | builder, ops, scout |
| `code_review` | tester, designer |
| `approved` | deployer |
| `released` | auditor |

### Discord Notifications

| Channel | When it fires |
|---|---|
| `#0-created` | Every POST /api/issues (issue creation) |
| `#2-rejected` | code_review→open, product_review→open (rejection) |
| `#3-ready-for-deploy` | code_review→approved (task/ops) |
| `#3-signoff` | approved→released, product_review→completed, active→completed |
| `#4-done` | Any status→closed |

### Dual Review Protocol
Tasks and features require BOTH `tester_status=passed` AND `designer_status=passed` to move from `code_review → approved`. Bugs and ops only require `test_status=passed`.

### 3-Tier Decomposition
- **Tier 1:** Epic → Features (Hub SME by project)
- **Tier 2:** Feature → Tasks (PO)
- **Tier 3:** Task → Sub-tasks (Builder via Inbox, rare)

---

## 1.7 Issue Types

| Type | Purpose | Parent required | Code produced | Review type |
|---|---|---|---|---|
| `epic` | Strategic container. Groups features under a theme. | No (top-level) | No | No code review. SME decomposes into features. |
| `feature` | Product capability. Groups tasks under a deliverable. | Yes (epic) | Sometimes | Dual review (tester + designer) |
| `task` | Atomic unit of work. 1-2 days scope. | Yes (feature) | Yes | Dual review (tester + designer) |
| `bug` | Defect report with reproduction steps. | Yes (feature) | Yes | Single review (test_status_passed) |
| `ops` | Infrastructure/config work. | Optional | Yes | Single review (test_status_passed) |
| `research` | Investigation task. Findings, not code. | Optional | No | No code review. Scout→completed directly. |

---

## 1.8 Agents in Workflow

| Agent | Display name | Pickup status | Working status | WIP limit | What they do |
|---|---|---|---|---|---|
| `builder` | Builder | `open` | `in_progress` | 2 | Writes code, commits, pushes to code_review |
| `ops` | Ingo | `open` | `in_progress` | 1 | Infrastructure/config tasks |
| `tester` | Tester | `code_review` | `code_review` | 3 | Reviews code against AC, runs tsc --noEmit |
| `designer` | Designer | `code_review` | `code_review` | 3 | Reviews UX/design quality, a11y, responsive |
| `po` | Product Owner | `backlog` | `defined` | 3 | Refines issues: adds AC, priority, severity. Decomposes features into tasks. |
| `deployer` | Deployer | `approved` | `approved` | 5 | Verifies approved items have required fields for PR window |
| `auditor` | Auditor | `released` | `released` | 1 | Final verification before closing |
| `scout` | Scout | `open` | `in_progress` | 1 | Research tasks only |
| `todero-sme` | Todero SME | `backlog` (epics) | `draft` | 2 | Tier-1 decomposition: Todero epics → features |
| `kemuni-sme` | Kemuni SME | `backlog` (epics) | `draft` | 2 | Tier-1 decomposition: Kemuni epics → features |
| `vespera-sme` | Vespera SME | `backlog` (epics) | `draft` | 2 | Tier-1 decomposition: Vespera epics → features |
| `infra-sme` | Infra SME | `backlog` (epics) | `draft` | 2 | Tier-1 decomposition: Infrastructure epics → features |

---

# Part 2: Issue Fields

## 2.1 Field Definitions

### Core Identity

| Field | Type | Description |
|---|---|---|
| `id` | uuid | Primary key (auto-generated) |
| `task_key` | string | Human-readable key (TOD-1234, VES-55, KEM-16). Auto-generated from project prefix + sequence. |
| `task_number` | integer | Numeric sequence number for the key |
| `title` | string | Short summary of the issue (required on creation) |
| `description` | text | Detailed description of what needs to be done |
| `type` | enum | `epic`, `feature`, `task`, `bug`, `ops`, `research` |
| `project` | string | Which project this belongs to: `Todero`, `Kemuni`, `Vespera`, `Infrastructure` |

### Hierarchy

| Field | Type | Description |
|---|---|---|
| `parent_id` | uuid (FK) | Links to parent issue. Tasks → Feature. Features → Epic. Epics have no parent. |
| `business_id` | uuid (FK) | Links to the business/hub entity for hub-scoped filtering |
| `blocked_by` | string | ID or task_key of a blocking issue. The blocked issue can't advance until the blocker is in a terminal state. |

### Status & Workflow

| Field | Type | Description |
|---|---|---|
| `status` | enum | Current workflow status (see §1.2) |
| `status_category` | string | Derived grouping: Planned/Ongoing/Done (computed, not stored) |
| `is_blocked` | boolean | `true` when 3-strike loop breaker fires (rejection_count ≥ 3). Blocked issues are excluded from agent pickup queries. |
| `rejection_count` | integer | Number of times the issue has been bounced from review back to open. Never resets. |
| `last_rejected_at` | timestamp | When the most recent rejection happened |
| `last_rejection_reason` | text | Aggregated rejection reason from tester + designer notes |
| `fail_count` | integer | Number of test failures (related but separate from rejection_count) |
| `transitioned_by` | string | Agent ID that executed the last status transition |

### Planning

| Field | Type | Description |
|---|---|---|
| `priority` | enum | `critical`, `high`, `medium`, `low` |
| `severity` | enum | `S0` (critical), `S1` (high), `S2` (medium), `S3` (low) |
| `sprint` | string | Sprint date in YYYY-MM-DD format (the sprint's start date) |
| `sprint_id` | uuid | FK to sprints table (rarely used — sprint field is the primary) |
| `due_date` | date | Optional deadline |
| `acceptance_criteria` | text | Numbered list of what "done" looks like. Required for most transitions. |

### Assignment

| Field | Type | Description |
|---|---|---|
| `assignee` | string | Agent ID currently responsible for the issue. Auto-routed on transitions via `set_assignee` post-function. |
| `owner` | string | The agent who "owns" the issue long-term (usually builder for tasks, po for features). Used for `assign→owner` on rejection rollback. |
| `reviewer` | string | Who should review this issue in code_review. Set during defined→open. |
| `worked_by` | string | Which agent actually did the implementation work. Set when entering in_progress. |

### Code & Review

| Field | Type | Description |
|---|---|---|
| `feature_branch` | string | Git branch name (e.g. `feat/tod-1209`). Auto-generated for builder/ops agents. |
| `commit_sha` | string | Git commit hash of the implementation. Required for code_review. |
| `pr_url` | string | GitHub PR URL. Required for approved→released. Set by pr-window.py at 7am/7pm. |
| `implementation_notes` | text | What was built, how, and any caveats. Required for code_review. |
| `regression_test` | text | Command or steps to verify the fix. Required for code_review. |
| `resolution_type` | enum | How the issue was resolved. Required for closing. Values: `code_change`, `config_change`, `database_change`, `research_completed`, `documentation`, `duplicate`, `expected_behavior`, `wont_fix`, `not_reproducible`, `deferred`, `no_change_required`, `completed` |

### Dual Review

| Field | Type | Description |
|---|---|---|
| `tester_status` | string | Tester's review verdict: `pending`, `passed`, `failed`, `running`, `in_progress`, `skipped` |
| `tester_notes` | text | Tester's review notes |
| `tested_by` | string | Which agent performed the test review |
| `tester_reviewed_at` | timestamp | When tester reviewed |
| `designer_status` | string | Designer's review verdict (same values as tester_status) |
| `designer_notes` | text | Designer's review notes |
| `designed_by` | string | Which agent performed the design review |
| `designer_reviewed_at` | timestamp | When designer reviewed |
| `reviewer_notes` | text | General reviewer notes (used for product_review and legacy single-review) |
| `reviewed_by` | string | Who performed the general review |
| `test_status` | string | Overall test status (`passed`, `failed`, `pending`, `blocked`) |

### Bug-Specific

| Field | Type | Description |
|---|---|---|
| `steps_to_reproduce` | text | How to reproduce the bug. Required on bug creation. |
| `expected_behavior` | text | What should happen. Required on bug creation. |
| `actual_behavior` | text | What actually happens. Required on bug creation. |
| `environment` | string | Where the bug was found (browser, OS, etc.). Required for bug open. |

### Timestamps

| Field | Type | Description |
|---|---|---|
| `created_at` | timestamp | When the issue was created (auto-set) |
| `updated_at` | timestamp | Last modification time (auto-updated on every PATCH) |
| `started_at` | timestamp | When an agent claimed the issue (set on pickup, cleared by spawn-exit watcher on agent death) |
| `submitted_at` | timestamp | When the issue was submitted for review |
| `completed_at` | timestamp | When the issue reached a terminal state |

### Closing

| Field | Type | Description |
|---|---|---|
| `closing_notes` | text | Auditor's notes when closing. Required for released/completed→closed (for certain types). |
| `auditor` | string | Which auditor closed the issue |
| `deployer` | string | Which deployer released the issue |

---

## 2.2 Issue Type Definitions

### Epic
**Container for strategic work.** Groups related features under a theme (e.g., "Auth & Credentials", "MVP Safety Mechanisms"). Epics don't produce code directly — they're decomposed into features by Hub SMEs, which are then decomposed into tasks by PO.

- **Hierarchy:** Top-level (no parent)
- **Children:** Features
- **Workflow:** backlog → draft → active → completed → closed
- **Key rule:** Features can't enter `open` unless parent epic is `draft` or `active`
- **Created by:** Michael, KAOS, or auto-created by SME when decomposing larger work
- **Auto-routed to:** Hub SME based on project (todero-sme, kemuni-sme, vespera-sme, infra-sme)

### Feature
**Product capability that ships as a unit.** Groups tasks under a deliverable (e.g., "Notification bell with badge, drawer, and mark-all-read"). Features MAY produce code (e.g., a scaffold) but mainly exist to organize task-level work.

- **Hierarchy:** Child of epic
- **Children:** Tasks, bugs
- **Workflow:** Standard (backlog → ... → closed)
- **Key rule:** Must have `parent_id` pointing to an epic
- **Created by:** PO (Tier-2 decomposition) or SME (Tier-1)
- **Auto-routed to:** PO on creation

### Task
**Atomic unit of implementable work.** 1-2 days scope. Produces code, has a commit, goes through dual review.

- **Hierarchy:** Child of feature
- **Children:** None (sub-tasks via Inbox only, rare)
- **Workflow:** Standard (backlog → ... → closed)
- **Key rule:** Must have `parent_id` pointing to a feature. Requires `acceptance_criteria` on creation.
- **Created by:** PO (decomposing features)
- **Auto-routed to:** Builder (tasks), Ingo (if ops-flavored)

### Bug
**Defect report with reproduction steps.** Same workflow as task but requires extra fields (steps_to_reproduce, expected_behavior, actual_behavior, environment) and uses single test review instead of dual review.

- **Hierarchy:** Child of feature
- **Key rule:** Must have reproduction steps on creation
- **Created by:** Tester (during review), Michael, or auto-detected
- **Auto-routed to:** Builder

### Ops
**Infrastructure/config work.** Same workflow as task but `ref_required` validator is relaxed (doesn't need commit_sha — config changes may not have a commit). Uses single test review. The `po_main_ops` role allows Ingo to execute transitions directly.

- **Hierarchy:** Optional parent
- **Created by:** Ingo, Infra SME, KAOS
- **Auto-routed to:** Ingo (ops agent)

### Research
**Investigation task.** No code review — goes directly from `in_progress → completed` when Scout finishes. Findings go in `implementation_notes`. Notifies KAOS on completion so a human can decide next steps.

- **Hierarchy:** Optional parent
- **Created by:** KAOS, Michael
- **Auto-routed to:** Scout

---

## 2.3 Additional Field Information

### Auto-Routing on Creation
When no `assignee` is provided in POST /api/issues, the handler auto-routes based on type:

| Type | Default assignee | Routing note |
|---|---|---|
| `task`, `bug` | `builder` | Standard code work |
| `feature` | `po` | PO refines before Builder touches it |
| `epic` | Hub SME by project (todero-sme, kemuni-sme, vespera-sme, infra-sme, or main) | Tier-1 decomposition |
| `ops` | `ops` (Ingo) | Infrastructure work |
| `research` | `scout` | Research tasks |

### Default Status on Creation
New issues default to `defined` (not `open`). Open means "fully groomed, ready for Builder" and has a cap (MAX_OPEN=100). PO reviews defined items and moves to open when Definition of Ready is met.

### Sprint Auto-Correction
If sprint is missing or is a past date when creating/transitioning, the handler auto-corrects to today's date (America/New_York timezone).

### Task Key Generation
Keys are generated as `{PREFIX}-{SEQUENCE}` where PREFIX comes from the project:

| Project | Prefix |
|---|---|
| Todero | TOD |
| Infrastructure | TOD (was INF, changed 2026-04-13) |
| Kemuni | KEM |
| Vespera | VES |
| Mission Control | MC (legacy) |

### Fields That Are Computed / Auto-Set
- `id` — UUID auto-generated
- `task_key` — auto-generated from project prefix + sequence
- `task_number` — auto-incrementing integer
- `created_at` — set on POST
- `updated_at` — set on every PATCH
- `status_category` — derived from status (Planned/Ongoing/Done), not stored in DB
- `is_blocked` — set by the 3-strike loop breaker when rejection_count ≥ 3
- `started_at` — set when an agent claims via run-agent, cleared by spawn-exit watcher on agent death

### Fields That Agents Should Never Modify Directly
- `id`, `task_key`, `task_number` — identity, immutable after creation
- `created_at` — set once
- `is_blocked` — controlled by the loop breaker only
- `rejection_count`, `last_rejected_at` — controlled by `increment_rejection` post-function only

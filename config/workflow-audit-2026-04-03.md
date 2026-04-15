# Todero / Mission Control Workflow Audit

Date: 2026-04-03
Scope: live workflow engine as reconstructed from API logic and seeded migrations
Primary sources:
- `/Users/kemuniagent/mission-control/app/api/issues/route.ts`
- `/Users/kemuniagent/.openclaw/workspace/migrations/008_add_task_workflow.sql`
- `/Users/kemuniagent/.openclaw/workspace/migrations/009_seed_remaining_workflows.sql`
- `/Users/kemuniagent/mission-control/supabase/migrations/20260331064000_dual_review_gate.sql`
- `/Users/kemuniagent/mission-control/supabase/migrations/20260330150000_per_type_status_constraints.sql`

## 1) Workflow engine coverage

Supported issue types:
- task
- bug
- feature
- epic
- ops
- research

Detailed workflow statuses used across the system:
- backlog
- defined
- open
- in_progress
- code_review
- product_review
- approved
- released
- completed
- closed
- draft
- active

Important conventions already in force:
- `done` is retired
- `blocked` is a field, not a status
- `cancelled` should be represented as `resolution_type=cancelled`, not as a status

---

## 2) Condition-role gates used by transitions

- `po_or_main`
  - allowed actors: `po`, `main`

- `po_main_sme`
  - allowed actors: `po`, `main`, `kemuni-sme`, `vespera-sme`

- `po_main_ops`
  - allowed actors: `po`, `main`, `ops`

- `assignee`
  - only current assignee may transition

- `assignee_or_ops`
  - current assignee or `ops`

- `reviewer`
  - only current reviewer may transition

- `tester_or_designer`
  - tester, designer, or ux lane may resolve code review gate

- `scout_only`
  - scout-only completion path for research

---

## 3) Validators

### Standard field-presence validators
The transition engine treats these as required fields when listed on a transition:
- title
- project
- type
- description
- acceptance_criteria
- sprint
- priority
- severity
- assignee
- reviewer
- owner
- parent_id
- implementation_notes
- regression_test
- reviewer_notes
- resolution_type
- pr_url
- steps_to_reproduce
- expected_behavior
- actual_behavior
- environment

### Special validators
- `ref_required`
  - requires at least one code reference field:
    - `commit_sha`
    - `feature_branch`
    - `pr_url`

- `test_status_passed`
  - requires `test_status = passed`

- `dual_review_passed`
  - requires:
    - `tester_status = passed`
    - `designer_status = passed`

- `children_exist`
  - requires at least one child issue

---

## 4) Post-functions used by transitions

- `set_assignee`
  - set to fixed value, null, or copy from another field

- `notify_discord`
  - posts completion/review notifications to Discord

- `notify_kaos`
  - notifies main/KAOS for research completion and similar flows

- `increment_rejection`
  - increments rejection count / failure tracking

- `copy_field`
  - typically copies `reviewer_notes` to `last_rejection_reason`

- `set_timestamp`
  - stamps fields like `last_rejected_at`

- `set_active_sprint`
  - best-effort helper to set active sprint if missing

- `activate_code_review_agents`
  - wakes review agents when an issue enters code_review

---

## 5) Workflow-relevant fields

This is the practical field inventory for the workflow system.

### Core identity / planning
- `id`
  - used by API
  - required for PATCH
  - system field

- `issue_key`
  - used for human-readable tracking
  - system field
  - examples: `TOD-705`, `MC-51`

- `title`
  - required on create for all issue types
  - text

- `type`
  - required
  - enum
  - allowed values:
    - task
    - bug
    - feature
    - epic
    - ops
    - research

- `project`
  - required on create
  - text / project slug

- `description`
  - required for feature definition and epic creation
  - optional elsewhere unless transition requires it

- `acceptance_criteria`
  - required for most executable work
  - text

- `status`
  - required system field
  - enum
  - values used in workflow engine:
    - backlog
    - defined
    - open
    - in_progress
    - code_review
    - product_review
    - approved
    - released
    - completed
    - closed
    - draft
    - active

### Ownership / routing
- `assignee`
  - required before moving into open
  - may be overwritten by post-functions
  - text / agent id

- `reviewer`
  - required before open for most executable work
  - text / agent id

- `owner`
  - required before open
  - permanent accountability field
  - intended immutable after open

- `deployer`
  - optional unless deploy lane is used
  - text / agent id

- `auditor`
  - optional unless release/close audit lane is used
  - text / agent id

- `transitioned_by`
  - API validation helper
  - text
  - used to check whether the actor is allowed to perform transition
  - not really a user-authored business field

### Planning / priority
- `priority`
  - required before open for most executable work
  - enum (live API validation governs exact values)
  - operationally used values include typical labels like low / medium / high / urgent

- `severity`
  - required before open for task / bug / feature / ops
  - enum
  - expected values:
    - S0
    - S1
    - S2
    - S3

- `sprint`
  - required before open for most executable work
  - text/date-like field, usually `YYYY-MM-DD`

- `parent_id`
  - required for children where hierarchy is enforced
  - especially tasks and bugs
  - features generally expect epic parent under current model

### Implementation evidence
- `implementation_notes`
  - required to leave in_progress on most work paths
  - text

- `regression_test`
  - required for code-review path on tasks/bugs
  - text

- `commit_sha`
  - optional generally, but can satisfy `ref_required`
  - text

- `feature_branch`
  - optional generally, but can satisfy `ref_required`
  - text

- `pr_url`
  - required for approved → released on code/deploy path
  - also satisfies `ref_required`
  - URL text

### Review / completion
- `reviewer_notes`
  - required for several approval / decline paths
  - text

- `resolution_type`
  - required for decline/close paths and code approval completion paths
  - enum in API
  - exact allowed values are API-enforced, but live usage includes values like:
    - code_change
    - configuration_change
    - process_change
    - documentation
    - duplicate
    - not_planned
    - cancelled

- `test_status`
  - aggregate review state
  - enum
  - values used in practice:
    - pending
    - passed
    - failed

### Rejection / failure tracking
- `rejection_count`
  - system-maintained integer

- `last_rejection_reason`
  - auto-populated from reviewer notes on failure path

- `last_rejected_at`
  - auto timestamp

### Bug-specific fields
- `steps_to_reproduce`
  - required on bug create

- `expected_behavior`
  - required on bug create

- `actual_behavior`
  - required on bug create

- `environment`
  - required before opening a bug

### Dual review fields for code-change tickets
Applies to task / bug / feature in the current migration set.

- `tester_status`
  - enum
  - values:
    - pending
    - passed
    - failed
  - auto-set to `pending` on move to code_review

- `tester_notes`
  - tester review notes

- `tested_by`
  - tester agent id

- `tester_reviewed_at`
  - timestamp

- `designer_status`
  - enum
  - values:
    - pending
    - passed
    - failed
  - auto-set to `pending` on move to code_review

- `designer_notes`
  - designer review notes

- `designed_by`
  - designer agent id

- `designer_reviewed_at`
  - timestamp

---

## 6) Required vs optional summary by field

### Generally required at creation by type
- task: `title`, `project`, `acceptance_criteria`, `type`
- bug: `title`, `project`, `acceptance_criteria`, `type`, `steps_to_reproduce`, `expected_behavior`, `actual_behavior`
- feature: `title`, `project`, `type`
- epic: `title`, `project`, `type`, `description`
- ops: `title`, `project`, `acceptance_criteria`, `type`
- research: `title`, `project`, `acceptance_criteria`, `type`

### Generally required before moving to open
- task: `acceptance_criteria`, `sprint`, `priority`, `assignee`, `parent_id`, `reviewer`, `owner`, `severity`
- bug: `acceptance_criteria`, `sprint`, `priority`, `severity`, `assignee`, `parent_id`, `reviewer`, `owner`, `environment`
- feature (defined → open): `sprint`, `priority`, `severity`, `assignee`, `reviewer`, `owner`
- ops: `sprint`, `assignee`, `reviewer`, `owner`, `priority`, `severity`
- research: `sprint`, `assignee`, `reviewer`, `owner`
- epic: not applicable; epic uses `backlog → active`

### Required to leave in_progress
- task → code_review: `implementation_notes`, `regression_test`, `ref_required`
- task → product_review: seeded as implementation evidence path
- bug → code_review: `implementation_notes`, `regression_test`, `ref_required`
- bug → product_review: `implementation_notes`
- feature → product_review: `implementation_notes`, `ref_required` in seed data
- ops → product_review: `implementation_notes`
- research → completed: `implementation_notes`, `resolution_type`

### Required to approve / complete
- task code_review → approved: live gate now expects `resolution_type`, `dual_review_passed`
- bug code_review → approved: `resolution_type`, `reviewer_notes`, `test_status_passed`
- feature product_review → approved: `reviewer_notes`, `test_status_passed`
- ops product_review → completed: `reviewer_notes`, `test_status_passed`
- task product_review → completed: reviewer-driven no-code path
- bug product_review → completed: `reviewer_notes`

### Required to release / close on final path
- approved → released: `pr_url`
- many close/decline paths: `resolution_type`
- backlog → closed often also requires `reviewer_notes`

---

## 7) Per-type transition matrix

## task

Transitions:
- creation → backlog
- backlog → open
- open → in_progress
- open → backlog
- open → closed
- in_progress → code_review
- in_progress → product_review
- in_progress → backlog
- in_progress → open
- in_progress → closed
- code_review → approved
- code_review → open
- code_review → closed
- product_review → completed
- product_review → open
- product_review → closed
- approved → released
- released → closed
- completed → closed

Conditions:
- backlog → open: `po_or_main`
- open → in_progress: `assignee`
- in_progress → code_review: `assignee`
- in_progress → product_review: `assignee`
- in_progress → open: `assignee`
- code_review → approved: originally `reviewer`, later migrated to `tester_or_designer`
- code_review → open: originally `reviewer`, later migrated to `tester_or_designer`
- product_review transitions: `reviewer`

Validators:
- create: `title`, `project`, `acceptance_criteria`, `type`
- backlog → open: `acceptance_criteria`, `sprint`, `priority`, `assignee`, `parent_id`, `reviewer`, `owner`, `severity`
- in_progress → code_review: `implementation_notes`, `regression_test`, `ref_required`
- code_review → approved: live dual-review version = `resolution_type`, `dual_review_passed`
- approved → released: `pr_url`

Post-functions:
- backlog → open: assign owner
- in_progress → code_review: assign tester, activate review agents
- in_progress → product_review: assign reviewer
- in_progress → open: assign owner
- code_review → approved: notify Discord
- code_review → open: assign owner, increment rejection, set rejection timestamp
- product_review → completed: assign auditor, notify Discord
- approved → released: assign auditor
- final close states: clear assignee

## bug

Transitions:
- creation → backlog
- backlog → open
- backlog → closed
- open → in_progress
- open → backlog
- in_progress → code_review
- in_progress → product_review
- in_progress → backlog
- code_review → approved
- code_review → open
- product_review → completed
- product_review → open
- approved → released
- completed → closed
- released → closed

Conditions:
- backlog → open: `po_or_main`
- backlog → closed: `po_or_main`
- open/in_progress: `assignee`
- review transitions: `reviewer`

Validators:
- create: `title`, `project`, `acceptance_criteria`, `type`, `steps_to_reproduce`, `expected_behavior`, `actual_behavior`
- backlog → open: `acceptance_criteria`, `sprint`, `priority`, `severity`, `assignee`, `parent_id`, `reviewer`, `owner`, `environment`
- backlog → closed: `resolution_type`, `reviewer_notes`
- in_progress → code_review: `implementation_notes`, `regression_test`, `ref_required`
- in_progress → product_review: `implementation_notes`
- code_review → approved: `resolution_type`, `reviewer_notes`, `test_status_passed`
- product_review → completed: `reviewer_notes`
- approved → released: `pr_url`

Post-functions:
- backlog → open: assign owner
- backlog → closed: clear assignee
- open/backlog and in_progress/backlog: assign owner
- code_review/product_review entry: assign reviewer
- code_review → approved: assign deployer, notify Discord
- code_review → open: increment rejection, copy reviewer notes to last rejection reason, assign owner
- product_review → completed: assign auditor
- product_review → open: rejection tracking + assign owner
- released/completed close: clear assignee

## feature

Transitions:
- creation → backlog
- backlog → defined
- defined → open
- defined → backlog
- backlog → closed
- open → in_progress
- open → backlog
- in_progress → product_review
- in_progress → backlog
- product_review → approved
- product_review → open
- approved → released
- released → closed

Conditions:
- backlog → defined: `po_main_sme`
- defined → open: `po_or_main`
- defined → backlog: `po_main_sme`
- backlog → closed: `po_or_main`
- open/in_progress: `assignee`
- product_review transitions: `reviewer`

Validators:
- create: `title`, `project`, `type`
- backlog → defined: `description`, `acceptance_criteria`, `parent_id`
- defined → open: `sprint`, `priority`, `severity`, `assignee`, `reviewer`, `owner`
- backlog → closed: `resolution_type`, `reviewer_notes`
- in_progress → product_review: `implementation_notes`, `ref_required` in seeded data
- product_review → approved: `reviewer_notes`, `test_status_passed`
- approved → released: `pr_url`

Post-functions:
- defined → open: assign owner
- backlog → closed: clear assignee
- open → backlog / in_progress → backlog: assign owner
- in_progress → product_review: assign reviewer
- product_review → approved: assign deployer, notify Discord
- product_review → open: rejection tracking + assign owner
- approved → released: assign auditor
- released → closed: clear assignee

## epic

Transitions:
- creation → backlog
- backlog → active
- backlog → closed
- active → closed

Conditions:
- backlog → active: `po_or_main`
- backlog → closed: `po_or_main`
- active → closed: `po_or_main`

Validators:
- create: `title`, `project`, `type`, `description`
- backlog → active: `children_exist`
- backlog → closed: `resolution_type`, `reviewer_notes`

Post-functions:
- active → closed: notify Discord
- backlog → closed: clear assignee

## ops

Transitions:
- creation → backlog
- backlog → open
- backlog → closed
- open → in_progress
- open → backlog
- in_progress → product_review
- in_progress → backlog
- product_review → completed
- product_review → open
- completed → closed

Conditions:
- backlog → open: `po_main_ops`
- backlog → closed: `po_or_main`
- open/in_progress: `assignee`
- product_review transitions: `reviewer`
- completed → closed: `assignee_or_ops`

Validators:
- create: `title`, `project`, `acceptance_criteria`, `type`
- backlog → open: `sprint`, `assignee`, `reviewer`, `owner`, `priority`, `severity`
- backlog → closed: `resolution_type`, `reviewer_notes`
- in_progress → product_review: `implementation_notes`
- product_review → completed: `reviewer_notes`, `test_status_passed`
- completed → closed: `resolution_type`

Post-functions:
- backlog → open: assign owner
- backlog → closed: clear assignee
- open → backlog / in_progress → backlog: assign owner
- in_progress → product_review: assign reviewer
- product_review → completed: assign auditor, notify Discord
- product_review → open: rejection tracking + assign owner
- completed → closed: clear assignee

## research

Transitions:
- creation → backlog
- backlog → open
- backlog → closed
- open → in_progress
- open → backlog
- in_progress → completed
- in_progress → backlog
- completed → closed

Conditions:
- backlog → open: `po_or_main`
- backlog → closed: `po_or_main`
- open/in_progress/backlog: `assignee`
- in_progress → completed: `scout_only`
- completed → closed: `po_or_main`

Validators:
- create: `title`, `project`, `acceptance_criteria`, `type`
- backlog → open: `sprint`, `assignee`, `reviewer`, `owner`
- backlog → closed: `resolution_type`, `reviewer_notes`
- in_progress → completed: `implementation_notes`, `resolution_type`

Post-functions:
- backlog → open: assign scout
- backlog → closed: clear assignee
- in_progress → completed: notify Discord, notify KAOS
- completed → closed: clear assignee

---

## 8) Main design issues exposed by this audit

1. Feature workflow still allows direct execution semantics.
   - This conflicts with the intended policy that features should be parent/container only.

2. Dual review is strongest on task and not modeled consistently across all code-bearing issue situations.

3. `product_review` is overloaded.
   - It currently mixes no-code approval, feature review, and workaround paths for items that should really have been child execution issues.

4. Some behavior is still split between API truth and automation truth.
   - That makes routing and assignee state drift more likely.

5. Fields are partly transition-based and partly issue-type-based.
   - Good for flexibility, but it makes hygiene harder unless the UI clearly shows what is missing for the next transition.

---

## 9) Recommended cleanup direction

Recommended future model:
- parent/container types: `epic`, `feature`
- executable types: `task`, `bug`, `ops`, `research`
- parent issues should not carry code-review/deploy semantics directly
- all code-bearing work should move through execution children
- `product_review` should be narrowed to true no-code or parent-level approval use
- dual-review should be attached to “code-bearing work” rather than implicitly to whichever type happened to be used

That would remove most of the current TOD-649 / TOD-538 style drift.

# Issue Types — Canonical Field Reference

All work is tracked as issues in Supabase. This file is the single source of truth for issue types, fields, automations, and status flows.

---

## Hierarchy

```
Epic
 └── Feature
      └── Task / Bug
           └── Subtask (optional)
```

---

## Type Definitions

| Type | What it is | Severity | Created by | Parent required |
|------|------------|----------|------------|-----------------|
| **epic** | A large goal spanning multiple features (e.g. "Vespera Launch", "Kemuni AI Features") | — | KAOS / PO | No |
| **feature** | A discrete shippable capability (e.g. "Event Filters", "User Profiles") | — | KAOS / PO / SME | Yes (epic) |
| **task** | A concrete unit of work under a feature (e.g. "Add city filter to /events") | S0–S3 | Builder / KAOS | Yes (feature) |
| **bug** | A defect in shipped code, with steps to reproduce | S0 (always) | Tester / KAOS | Ref feature |
| **ops** | Infrastructure, config, or automation work not tied to a feature | S2 (default) | KAOS / Ops | No |
| **research** | Evaluate/investigate options, produce a written finding | S3 (default) | Scout / KAOS | No |

### Rules
- **Every task must have a parent feature** (`feature_id` set). Orphan tasks are not allowed.
- **Every feature must have a parent epic** (`parent_id` set).
- **Bugs are always S0** — they affect users and always go to designer review.
- **Ops tasks are always S2** — no Tester review unless explicitly escalated.
- **severity is set by PO/KAOS** during backlog grooming before moving a task to open (part of DoR). Reviewer is auto-assigned based on severity when the task later moves to in_review.

---

## All DB Fields

| Field | Type | Description | Who sets it | When |
|-------|------|-------------|-------------|------|
| `id` | uuid | Primary key | DB auto | On insert |
| `task_key` | text | Human-readable key (MC-123) | MC API auto | On insert |
| `task_number` | int | Sequence number | MC API auto | On insert |
| `title` | text | Short description (required) | Creator | On create |
| `description` | text | Full context, technical notes | Creator / Builder | On create or update |
| `type` | text | epic / feature / task / bug / ops / research | Creator | On create |
| `status` | text | Current state (see status flows below) | Agents / MC API | On transition |
| `priority` | text | critical / high / medium / low | Creator / KAOS | On create |
| `project` | text | Vespera / Kemuni / Mission Control / Infrastructure | Creator | On create |
| `assignee` | text | Who owns it right now | Creator / MC API auto | On create, on transition |
| `owner` | text | Permanent accountable party (accountability, not active worker) | po/kaos | Set during grooming; auto-set by type+project if not provided on POST. Never changes after open. |
| `sprint` | date | Sprint date (YYYY-MM-DD) | Creator / KAOS | On create |
| `parent_id` | uuid | Parent issue id (feature → epic, task → feature) | Creator | On create |
| `feature_id` | uuid | Feature this task belongs to (denormalized) | Creator | On create |
| `acceptance_criteria` | text | Explicit pass/fail criteria (required) | Creator | On create |
| `severity` | text | S0 / S1 / S2 / S3 — determines reviewer (see below) | po/kaos | Before moving to open (part of DoR) |
| `implementation_notes` | text | What Builder built, edge cases, how to test | Builder | Before in_review |
| `regression_test` | text | Command or steps to verify no regression | Builder | Before in_review |
| `commit_sha` | text | Git SHA of the commit | Builder | Before in_review |
| `feature_branch` | text | Git branch name | Builder | Before in_review |
| `pr_url` | text | GitHub PR URL | KAOS | At 7am/7pm window |
| `reviewer_notes` | text | Reviewer feedback (pass or fail) | Reviewer | On review |
| `test_status` | text | passed / failed / pending | Reviewer | On review |
| `resolution_type` | text | code_change / config_change / by_design / wont_fix / canceled / duplicate / cannot_reproduce | Reviewer | On done |
| `fail_count` | int | Number of failed review cycles | MC API auto | On test_status=failed |
| `worked_by` | text | Who last worked the task (for rejection routing) | MC API auto | On in_progress |
| `started_at` | timestamptz | When first moved to in_progress | MC API auto | On in_progress |
| `submitted_at` | timestamptz | When moved to in_review | MC API auto | On in_review |
| `completed_at` | timestamptz | When moved to done | MC API auto | On done |
| `due_date` | date | Optional deadline | Creator | On create |
| `model` | text | AI model used (for agent sessions) | Agent | On session start |
| `created_at` | timestamptz | Row creation time | DB auto | On insert |
| `updated_at` | timestamptz | Last update time | MC API auto | On every update |

---

## Auto-Set Fields

These fields are set automatically by the MC API on status transitions — Builder and reviewers do not need to set them manually.

| Field | Auto-set when | Set to |
|-------|---------------|--------|
| `started_at` | status → `in_progress` (first time only) | NOW() |
| `worked_by` | status → `in_progress` | current assignee |
| `submitted_at` | status → `in_review` | NOW() |
| `completed_at` | status → `done` | NOW() |
| `assignee` | status → `in_review` | based on severity: S0→designer, S1→tester, S2→po, S3→main |
| `assignee` | status → `open` (rejection) | `worked_by` (routes back to original builder) |
| `fail_count` | `test_status` → `failed` | incremented by 1 |
| `status` / `assignee` | `fail_count` reaches 3 | status=blocked, assignee=main (escalation) |

---

## Automations

These fire automatically on field changes — no manual action needed.

| Trigger | What fires | Timing |
|---------|------------|--------|
| `status` → `in_review` | n8n **tgwln7Ra04hKhbeC**: activates assigned agent | Within 3 min |
| `status` → `open` | n8n **ypkSfCq0LZ6eXDvM**: activates assigned agent (if open queue ≤ 10) | Within 3 min |
| `status` → `in_review` | MC API: fires openclaw agent activation (non-blocking) | Immediately |
| `status` → `open` | MC API: fires openclaw agent activation (non-blocking) | Immediately |
| `model` change | n8n **mDgs8S1uUBHPkQzP**: logs model switch to Discord #agent-logs | Within 5 min |
| PR created | n8n **dDcSY7ZWV04AgHmW**: posts to Discord #pr-reviews | Within 5 min |
| `status` → `done` | MC API: posts Discord #agent-logs notification | Immediately |
| `test_status` → `failed` | MC API: posts Discord test failure alert | Immediately |
| `fail_count` ≥ 3 | MC API: posts Discord escalation alert, routes to KAOS | Immediately |

---

## Severity Field

Severity determines who reviews the issue when it moves to `in_review`. Set by Builder before submitting.

| Level | Name | Examples | Auto-assigned reviewer |
|-------|------|----------|------------------------|
| **S0** | Critical | New UI feature, auth flow, user-facing flows, RSVP, profile | `designer` |
| **S1** | High | New API route, DB migration, Supabase RLS change, schema | `tester` |
| **S2** | Medium | n8n workflow, SOUL.md, env var, AGENTS.md, config | `po` |
| **S3** | Low | CSS color, text copy, comment, README | `main` |

> **Designer review (S0):** designer agent is in roster but review workflow is not yet fully wired. Designer agent receives activation message via in_review trigger. Full designer review protocol is pending MC-443 (Task workflow) and MC-447 (Feature workflow) implementation.

- Bugs are always S0.
- Ops tasks default to S2.
- S0 and S1 require full Tester/designer review before PR Queue.
- S2 and S3 auto-pass to PR Queue (no review cycle).

---

## Status Definitions & Allowed Transitions

### task — Full Workflow

Task issues follow a two-path workflow depending on whether code changes are required.

**Code path:** Backlog → Open → In Progress → Code Review → Approved → Released → Closed
**No-code path:** Backlog → Open → In Progress → Product Review → Completed → Closed
**Decline path:** Any early status → Closed (with resolution_type)

#### Valid Transitions

| From | To | Condition | Notes |
|------|----|-----------|-------|
| (creation) | `backlog` | — | Auto on POST |
| `backlog` | `open` | transitioned_by = `po` or `main` | Full DoR required |
| `open` | `in_progress` | transitioned_by = assignee | |
| `open` | `backlog` | — | Not ready |
| `in_progress` | `code_review` | transitioned_by = assignee | Evidence required |
| `in_progress` | `product_review` | transitioned_by = assignee | Evidence required |
| `in_progress` | `backlog` | — | Builder backs off |
| `in_progress` | `open` | transitioned_by = assignee | Builder rejects own work |
| `code_review` | `approved` | transitioned_by = reviewer | Resolution evidence required |
| `code_review` | `open` | transitioned_by = reviewer | Failed — rework needed |
| `product_review` | `completed` | transitioned_by = reviewer | PO approves no-code |
| `product_review` | `open` | transitioned_by = reviewer | Does need code after all |
| `approved` | `released` | — | pr_url required |
| `released` | `closed` | — | Confirmed released |
| `completed` | `closed` | — | Confirmed completed |
| any early | `closed` | — | Decline path (resolution_type required) |

#### Transition Validators

| Transition | Required fields |
|-----------|----------------|
| creation → backlog | title, project, acceptance_criteria, type |
| backlog → open | acceptance_criteria, sprint, priority, assignee, parent_id, reviewer, owner, severity |
| in_progress → code_review | implementation_notes, regression_test, one of: commit_sha / feature_branch / pr_url |
| in_progress → product_review | implementation_notes, regression_test, one of: commit_sha / feature_branch / pr_url |
| code_review → approved | resolution_type, reviewer_notes, test_status=passed |
| approved → released | pr_url |

#### Post Functions (auto-actions after transition)

| Transition | Auto-action |
|-----------|-------------|
| backlog → open | assignee = owner |
| in_progress → code_review | assignee = reviewer |
| in_progress → product_review | assignee = reviewer |
| in_progress → open (builder) | assignee = owner |
| code_review → approved | assignee = deployer; notify #completed-tasks |
| code_review → open (failed) | increment rejection_count; copy reviewer_notes → last_rejection_reason; set last_rejected_at |
| product_review → completed | assignee = auditor; notify #completed-tasks |
| product_review → open | assignee = owner |
| approved → released | assignee = auditor |
| released → closed | assignee = null |
| completed → closed | assignee = null |

#### Status Reference

| Status | Meaning |
|--------|---------|
| `backlog` | Defined but not scheduled |
| `open` | Scheduled, assigned, ready to pick up |
| `in_progress` | Being worked by Builder |
| `code_review` | Code submitted — waiting for reviewer |
| `product_review` | No-code path — waiting for PO/reviewer |
| `approved` | Code review passed — ready to deploy |
| `released` | PR merged / deployed |
| `completed` | No-code outcome confirmed |
| `closed` | Final state (released or completed confirmed) |

#### Field Requirements per Transition

- **backlog → open (DoR):** `priority`, `sprint`, `assignee`, `acceptance_criteria`, `severity` (S0–S3 set by PO/KAOS), `reviewer` (set during grooming), `owner` (permanent accountable party), `parent_id`
- **in_progress → code_review / product_review:** `implementation_notes`, `regression_test`, at least one of `commit_sha` / `feature_branch` / `pr_url`
- **code_review → approved:** `resolution_type`, `reviewer_notes`, `test_status=passed`
- **approved → released:** `pr_url`

### bug — Full Workflow

**Code path:** Backlog → Open → In Progress → Code Review → Approved → Released → Closed
**No-code path:** Backlog → Open → In Progress → Product Review → Completed → Closed
**Decline path:** Backlog → Closed (resolution_type required)

#### Valid Transitions

| From | To | Condition | Notes |
|------|----|-----------|-------|
| (creation) | `backlog` | — | Auto on POST |
| `backlog` | `open` | po_or_main | Full DoR required |
| `backlog` | `closed` | po_or_main | Decline path |
| `open` | `in_progress` | assignee | |
| `open` | `backlog` | assignee | Not ready |
| `in_progress` | `code_review` | assignee | Evidence required |
| `in_progress` | `product_review` | assignee | No-code path |
| `in_progress` | `backlog` | assignee | Builder backs off |
| `code_review` | `approved` | reviewer | Resolution evidence required |
| `code_review` | `open` | reviewer | Failed — rework needed |
| `product_review` | `completed` | reviewer | No-code path approved |
| `product_review` | `open` | reviewer | Failed — rework needed |
| `approved` | `released` | — | pr_url required |
| `completed` | `closed` | — | Confirmed |
| `released` | `closed` | — | Confirmed |

#### Transition Validators

| Transition | Required fields |
|-----------|----------------|
| creation → backlog | title, project, acceptance_criteria, type, steps_to_reproduce, expected_behavior, actual_behavior |
| backlog → open | acceptance_criteria, sprint, priority, severity, assignee, parent_id, reviewer, owner, environment |
| backlog → closed | resolution_type, reviewer_notes |
| in_progress → code_review | implementation_notes, regression_test, ref_required |
| in_progress → product_review | implementation_notes |
| code_review → approved | resolution_type, reviewer_notes, test_status=passed |
| product_review → completed | reviewer_notes |
| approved → released | pr_url |

#### Post Functions

| Transition | Auto-action |
|-----------|-------------|
| backlog → open | assignee = owner |
| backlog → closed | assignee = null |
| open → backlog | assignee = owner |
| in_progress → code_review | assignee = reviewer |
| in_progress → product_review | assignee = reviewer |
| in_progress → backlog | assignee = owner |
| code_review → approved | assignee = deployer; notify Discord |
| code_review → open | increment rejection; copy reviewer_notes → last_rejection_reason; assignee = owner |
| product_review → completed | assignee = auditor |
| product_review → open | increment rejection; copy reviewer_notes → last_rejection_reason; assignee = owner |
| approved → released | assignee = auditor |
| completed → closed | assignee = null |
| released → closed | assignee = null |

#### Status Reference

| Status | Meaning |
|--------|---------|
| `backlog` | Defined but not scheduled |
| `open` | Scheduled, assigned, ready to pick up |
| `in_progress` | Being worked by Builder |
| `code_review` | Code submitted — waiting for reviewer |
| `product_review` | No-code path — waiting for reviewer |
| `approved` | Code review passed — ready to deploy |
| `released` | PR merged / deployed |
| `completed` | No-code outcome confirmed |
| `closed` | Final state |

---

### feature — Full Workflow

**Flow:** Backlog → Defined → Open → In Progress → Product Review → Approved → Released → Closed
**Decline path:** Backlog → Closed (resolution_type required)

#### Valid Transitions

| From | To | Condition | Notes |
|------|----|-----------|-------|
| (creation) | `backlog` | — | Auto on POST |
| `backlog` | `defined` | po_main_sme | PRD complete |
| `backlog` | `closed` | po_or_main | Decline path |
| `defined` | `open` | po_or_main | Sprint scheduled |
| `defined` | `backlog` | po_main_sme | Needs more work |
| `open` | `in_progress` | assignee | |
| `open` | `backlog` | assignee | Not ready |
| `in_progress` | `product_review` | assignee | Evidence required |
| `in_progress` | `backlog` | assignee | Backs off |
| `product_review` | `approved` | reviewer | Approved + deploy |
| `product_review` | `open` | reviewer | Failed — rework |
| `approved` | `released` | — | pr_url required |
| `released` | `closed` | — | Confirmed |

#### Transition Validators

| Transition | Required fields |
|-----------|----------------|
| creation → backlog | title, project, type |
| backlog → defined | description, acceptance_criteria, parent_id |
| defined → open | sprint, priority, severity, assignee, reviewer, owner |
| backlog → closed | resolution_type, reviewer_notes |
| in_progress → product_review | implementation_notes, ref_required |
| product_review → approved | reviewer_notes, test_status=passed |
| approved → released | pr_url |

#### Post Functions

| Transition | Auto-action |
|-----------|-------------|
| defined → open | assignee = owner |
| backlog → closed | assignee = null |
| open → backlog | assignee = owner |
| in_progress → product_review | assignee = reviewer |
| in_progress → backlog | assignee = owner |
| product_review → approved | assignee = deployer; notify Discord |
| product_review → open | increment rejection; copy reviewer_notes → last_rejection_reason; assignee = owner |
| approved → released | assignee = auditor |
| released → closed | assignee = null |

#### Status Reference

| Status | Meaning |
|--------|---------|
| `backlog` | Defined but not PRD'd |
| `defined` | PRD written, acceptance criteria set |
| `open` | Scheduled, tasks being created |
| `in_progress` | Tasks in flight |
| `product_review` | Waiting for reviewer approval |
| `approved` | Approved — ready to deploy |
| `released` | PR merged / deployed |
| `closed` | Final state |

---

### epic — Full Workflow

**Flow:** Backlog → Active → Closed
**Decline path:** Backlog → Closed (resolution_type required)

#### Valid Transitions

| From | To | Condition | Notes |
|------|----|-----------|-------|
| (creation) | `backlog` | — | Auto on POST |
| `backlog` | `active` | po_or_main | Must have child issues |
| `backlog` | `closed` | po_or_main | Decline path |
| `active` | `closed` | po_or_main | All features shipped |

#### Transition Validators

| Transition | Required fields |
|-----------|----------------|
| creation → backlog | title, project, type, description |
| backlog → active | children_exist (at least one child issue with parent_id = this epic) |
| backlog → closed | resolution_type, reviewer_notes |

#### Post Functions

| Transition | Auto-action |
|-----------|-------------|
| backlog → closed | assignee = null |
| active → closed | notify Discord |

#### Status Reference

| Status | Meaning |
|--------|---------|
| `backlog` | Defined, no active work yet |
| `active` | Child features are in flight |
| `closed` | All done — final state |

---

### ops — Full Workflow

**Flow:** Backlog → Open → In Progress → Product Review → Completed → Closed
**Decline path:** Backlog → Closed (resolution_type required)

#### Valid Transitions

| From | To | Condition | Notes |
|------|----|-----------|-------|
| (creation) | `backlog` | — | Auto on POST |
| `backlog` | `open` | po_main_ops | Sprint scheduled |
| `backlog` | `closed` | po_or_main | Decline path |
| `open` | `in_progress` | assignee | |
| `open` | `backlog` | assignee | Not ready |
| `in_progress` | `product_review` | assignee | |
| `in_progress` | `backlog` | assignee | Backs off |
| `product_review` | `completed` | reviewer | Approved |
| `product_review` | `open` | reviewer | Failed — rework |
| `completed` | `closed` | assignee_or_ops | Resolution required |

#### Condition Roles

- `po_main_ops`: transitioned_by in [po, main, ops]
- `assignee_or_ops`: transitioned_by == assignee OR transitioned_by == ops

#### Transition Validators

| Transition | Required fields |
|-----------|----------------|
| creation → backlog | title, project, acceptance_criteria, type |
| backlog → open | sprint, assignee, reviewer, owner, priority, severity |
| backlog → closed | resolution_type, reviewer_notes |
| in_progress → product_review | implementation_notes |
| product_review → completed | reviewer_notes, test_status=passed |
| completed → closed | resolution_type |

#### Post Functions

| Transition | Auto-action |
|-----------|-------------|
| backlog → open | assignee = owner |
| backlog → closed | assignee = null |
| open → backlog | assignee = owner |
| in_progress → product_review | assignee = reviewer |
| in_progress → backlog | assignee = owner |
| product_review → completed | assignee = auditor; notify Discord |
| product_review → open | increment rejection; copy reviewer_notes → last_rejection_reason; assignee = owner |
| completed → closed | assignee = null |

#### Status Reference

| Status | Meaning |
|--------|---------|
| `backlog` | Defined but not scheduled |
| `open` | Scheduled, assigned, ready |
| `in_progress` | Being worked |
| `product_review` | Waiting for reviewer |
| `completed` | Work confirmed done |
| `closed` | Final state |

---

### research — Full Workflow

**Flow:** Backlog → Open → In Progress → Completed → Closed
**Decline path:** Backlog → Closed (resolution_type required)

#### Valid Transitions

| From | To | Condition | Notes |
|------|----|-----------|-------|
| (creation) | `backlog` | — | Auto on POST |
| `backlog` | `open` | po_or_main | Sprint scheduled |
| `backlog` | `closed` | po_or_main | Decline path |
| `open` | `in_progress` | assignee | |
| `open` | `backlog` | assignee | Not ready |
| `in_progress` | `completed` | scout_only | Findings written |
| `in_progress` | `backlog` | assignee | Backs off |
| `completed` | `closed` | po_or_main | Reviewed by PO |

#### Condition Roles

- `scout_only`: transitioned_by == scout OR issue.assignee == scout

#### Transition Validators

| Transition | Required fields |
|-----------|----------------|
| creation → backlog | title, project, acceptance_criteria, type |
| backlog → open | sprint, assignee, reviewer, owner |
| backlog → closed | resolution_type, reviewer_notes |
| in_progress → completed | implementation_notes, resolution_type |

#### Post Functions

| Transition | Auto-action |
|-----------|-------------|
| backlog → open | assignee = scout |
| backlog → closed | assignee = null |
| in_progress → completed | notify Discord; notify_kaos (sends openclaw message to main agent) |
| completed → closed | assignee = null |

#### Status Reference

| Status | Meaning |
|--------|---------|
| `backlog` | Defined but not scheduled |
| `open` | Scheduled, assigned, ready |
| `in_progress` | Scout is researching |
| `completed` | Findings written, awaiting PO review |
| `closed` | Final state |

---
name: bug-diagnostics
slug: bug-diagnostics
version: 1.0.0
description: Structured bug analysis for PO grooming. Given a bug's title, description, and any error details, produces: minimal repro steps, affected users/endpoints estimate, severity classification, root cause hypotheses, and related issues to check. PO embeds output in `steps_to_reproduce` and `description` before setting assignee and moving to `refined`.
metadata: {"clawdbot":{"emoji":"🐛","requires":{"bins":[]},"os":["linux","darwin","win32"]}}
---

# Bug Diagnostics Skill

## When to Use

Load this skill when grooming a **Bug** issue. Run the prompt below against the bug's title, description, and any error/log details available. Embed the structured output in the bug's `steps_to_reproduce` field and append a `## Bug Analysis` section to `description` before setting DoR fields and transitioning to `refined`.

Do NOT use for features, tasks, or ops issues.

## The Prompt

Given:
- Bug title: {title}
- Description / error details: {description}
- Steps already known: {steps_to_reproduce} (may be empty)
- Affected area: infer from title + description

Produce the following structured analysis:

---

### 1. Minimal Repro Steps

What is the shortest sequence of actions that reliably reproduces this bug?
List as numbered steps. If repro is unknown, write "Unknown — see hypotheses." and note what information is needed.

---

### 2. Affected Users / Endpoints Estimate

Who or what is affected, and how broadly?

- **Who is affected?** (all users / specific role / specific agent / specific project)
- **Which endpoints or components?** (list API routes, UI pages, or agent queues)
- **Frequency estimate:** always / sometimes / rarely / unknown

---

### 3. Severity Classification

Assign one severity level:

| Level | Definition |
|---|---|
| **S0** | User-facing data loss or complete feature failure — blocks normal use |
| **S1** | API or schema error — feature partially broken, workaround exists |
| **S2** | Config or infra issue — no data loss, indirect impact |
| **S3** | Cosmetic or minor — visible but does not impair function |

State: `Severity: S{0-3} — {one-sentence reason}`

If unclear between two levels, pick the higher (more severe) one.

---

### 4. Root Cause Hypotheses

List 2–4 plausible root causes, ordered by likelihood:

```
Hypothesis 1 (most likely): [what] — look in: [file or area]
Hypothesis 2: [what] — look in: [file or area]
Hypothesis 3: [what] — look in: [file or area]
```

Flag if this looks like a regression (worked before, broke after a recent change).

---

### 5. Related Issues to Check

List existing issues or areas that may be related:

- Same component or API route
- Same agent or status transition
- Similar error message or stack trace
- Recent commits touching the affected area

Format: `- [TOD-XXX or "area: description"] — why it might be related`
If none known: `None identified — check git log for recent changes to {affected area}.`

---

## Output Format

After running the analysis, produce this block for embedding:

```
## Bug Analysis

Analyzed: YYYY-MM-DD | Analyzed by: po

### Repro Steps
1. [step]
2. [step]

### Impact
- Who: [all users / role / agent]
- Endpoints: [list]
- Frequency: [always / sometimes / rarely / unknown]

### Severity: S{0-3} — {reason}

### Root Cause Hypotheses
1. (Most likely) [what] — look in: [file or area]
2. [alternative] — look in: [file or area]
3. [alternative] — look in: [file or area]

### Related Issues
- [TOD-XXX or area] — [why related]
```

---

## How PO Uses This

1. Load this skill when you encounter a **Bug** issue in backlog.
2. Run the prompt using all available fields (title, description, steps_to_reproduce, any error messages).
3. Write the repro steps into the `steps_to_reproduce` field via PATCH.
4. Append the full `## Bug Analysis` block to the `description` field via PATCH.
5. Set `severity` on the issue using the S0–S3 classification from step 3.
6. Set `test_tier` based on severity:
   - S0 or S1 → `e2e`
   - S2 → `integration`
   - S3 → `smoke`
7. Set remaining DoR fields (reviewer, owner, assignee: builder) and PATCH to `refined`.

---

## Example Output (embedded in description)

```
## Bug Analysis

Analyzed: 2026-04-17 | Analyzed by: po

### Repro Steps
1. Open the sprint board at /sprint-board
2. Click "Move to Review" on any builder task
3. Observe: status shows code_review briefly, then reverts to open

### Impact
- Who: All users — affects any task moved to code_review
- Endpoints: PATCH /api/issues, sprint-board UI (SprintBoardTab)
- Frequency: Always (100% repro on confirmed builds)

### Severity: S1 — API status transition partially fails; tester cannot pick up tasks, but workaround (direct PATCH) exists

### Root Cause Hypotheses
1. (Most likely) Race condition in optimistic UI update — look in: components/tabs/SprintBoardTab.tsx
2. Missing required field on PATCH causes silent rejection — look in: app/api/issues/route.ts (PATCH handler)
3. Supabase RLS policy blocking update for non-service-role client — look in: lib/supabase.ts + supabase/policies

### Related Issues
- TOD-498 — similar revert behavior seen in backlog tab; may share the optimistic-update pattern
- Check git log for recent changes to app/api/issues/route.ts (PATCH handler)
```

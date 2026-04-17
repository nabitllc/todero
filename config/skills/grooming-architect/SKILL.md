---
name: grooming-architect
description: Technical design review for Feature issues during PO grooming. Given a feature's description and AC, produces a structured technical analysis that PO embeds in the issue before handing to Builder. Reduces ambiguity and uncovers schema/API changes early.
---

# Grooming Architect Skill

## When to Use

Load this skill when grooming a **Feature** issue (type=feature). Run the analysis prompt below against the feature's description and acceptance_criteria. Embed the output in the issue's `description` field before setting assignee and moving to `defined`.

**Do NOT run for tasks, bugs, or ops** — those are scoped enough already.

---

## Analysis Prompt

Given the feature below, produce a structured technical analysis with these five sections:

```
Feature: {title}
Description: {description}
Acceptance Criteria: {acceptance_criteria}
```

### Output Format

**1. Simplest Technical Approach**
One paragraph. What is the minimal implementation that satisfies all AC? Prefer extending existing patterns over introducing new ones. Name specific files or components if known.

**2. Schema Changes**
List any new columns, tables, or indexes required. If none, write "None." Use this format:
- `table.column` — type — reason

**3. API Changes**
List any new endpoints or changes to existing ones. If none, write "None." Format:
- `METHOD /path` — new|changed — what it does

**4. Risks and Edge Cases**
Bullet list of things that could go wrong or need special handling. Include: race conditions, permission boundaries, mobile/desktop differences, data migration concerns, and third-party dependencies.

**5. Complexity Estimate**
One of: **XS** (< 2h), **S** (half day), **M** (1 day), **L** (2 days), **XL** (needs splitting).
Include a one-sentence justification.

---

## PO Workflow

1. Read the feature's `description` and `acceptance_criteria`.
2. Run the analysis prompt above (substitute the feature fields).
3. Append the structured output to the issue `description` under a `## Technical Analysis` heading.
4. If complexity is **XL**: split the feature into two or more child features before proceeding. Do not hand an XL feature to Builder.
5. If schema changes exist: add `"Schema migration required"` to `acceptance_criteria`.
6. If API changes exist: add `"API contract documented"` to `acceptance_criteria`.
7. Proceed with normal refinement (set priority, severity, assignee, sprint) and PATCH to `defined`.

---

## Example Output

```
## Technical Analysis

**1. Simplest Technical Approach**
Extend the existing `/api/issues` PATCH handler to accept a new `closing_notes` field. Store it in the `issues` table alongside `implementation_notes`. Surface it in the Issue Detail drawer under a collapsible "Closing Notes" section (reuse the existing `<NotesPanel>` component pattern from `components/tabs/IssueDetail.tsx`).

**2. Schema Changes**
- `issues.closing_notes` — text nullable — stores PO closing summary

**3. API Changes**
- `PATCH /api/issues` — changed — accepts and persists `closing_notes` field

**4. Risks and Edge Cases**
- Existing PATCH validation may reject unknown fields — check `allowedFields` list in `app/api/issues/route.ts`
- Mobile drawer height may clip long notes — test on small viewport
- Empty string vs null: decide which represents "not set" and document the convention

**5. Complexity Estimate**
**S** (half day) — Schema change is one column, API change is one field addition, UI reuses existing pattern.
```

---

## Quality Bar

The analysis is good when:
- Builder can start immediately with no clarifying questions about schema or API shape
- Risks are specific, not generic ("check permissions" is bad; "the PATCH handler's `allowedFields` array in `route.ts` must include this field or it will silently drop it" is good)
- Complexity estimate matches the task size PO creates (M feature → M or S tasks, never XL tasks)

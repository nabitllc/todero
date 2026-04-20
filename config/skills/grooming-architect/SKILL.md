---
name: grooming-architect
description: Technical design review prompt for Features — produces scope, schema changes, API changes, risks, and complexity score
---

# Grooming Architect Skill

Technical design review for Feature issues. Load this skill when grooming a Feature from backlog. It produces a structured `## Technical Design` section to embed in the feature description before writing child tasks.

## When to Use

Load when grooming a **Feature** issue (not tasks, bugs, or epics). Apply before writing child tasks so complexity and scope are known upfront.

## Input

From the feature issue:
- `description` — what the feature does and why
- `acceptance_criteria` — numbered list of testable outcomes

## Prompt

Use the following prompt, substituting `{description}` and `{acceptance_criteria}` with the actual field values:

---

You are a senior full-stack engineer reviewing a Feature for technical feasibility. Given the description and acceptance criteria below, produce a **Technical Design** analysis with exactly these five sections:

**Feature Description:**
{description}

**Acceptance Criteria:**
{acceptance_criteria}

---

### 1. Simplest Technical Approach
Describe the minimal implementation that satisfies all acceptance criteria. Prefer extending existing patterns over introducing new abstractions. Call out any reusable components or utilities already in the codebase.

### 2. Schema Changes
List any new tables, columns, indexes, or constraints required. If none, write "None". Use this format:
- `table_name.column_name` (type) — reason

### 3. API Changes
List any new endpoints, modified routes, or changed request/response shapes. If none, write "None". Use this format:
- `METHOD /path` — what changes and why

### 4. Risks & Edge Cases
List the top 2–5 risks or edge cases that could block implementation or cause regressions. Be specific: name the failure mode and who is affected.

### 5. Complexity Estimate
Score 1–8 using this scale:
- 1–2: Trivial (config change, copy update, minor UI tweak)
- 3–4: Small (single endpoint, new component with no schema change)
- 5–6: Medium (schema change + API + UI, or significant business logic)
- 7–8: Large (multiple subsystems, auth changes, migrations with data backfill)

**Score: X/8** — one sentence justification.

> If score ≥ 7, recommend splitting the feature into 2 sub-features before creating tasks.

---

## Output Format

The output should be embedded verbatim into the feature's `description` field under a `## Technical Design` heading. PATCH the feature before creating child tasks:

```bash
curl -s -X PATCH http://localhost:3000/api/issues \
  -H "Content-Type: application/json" \
  -d '{
    "id": "<feature-uuid>",
    "description": "<original description>\n\n## Technical Design\n\n### 1. Simplest Technical Approach\n...\n\n### 2. Schema Changes\n...\n\n### 3. API Changes\n...\n\n### 4. Risks & Edge Cases\n...\n\n### 5. Complexity Estimate\nScore: X/8 — justification.",
    "transitioned_by": "po"
  }'
```

## Task Sizing Guide

Use the complexity score to determine how many child tasks to create:

| Score | Tasks | Task scope |
|---|---|---|
| 1–2 | 1 task | Single implementable unit |
| 3–4 | 1–2 tasks | Split by concern (API vs UI) |
| 5–6 | 2–4 tasks | Split by layer (schema, API, UI, tests) |
| 7–8 | Stop — split the feature first | File an Inbox request (TOD-792) |

## Example Output

```
## Technical Design

### 1. Simplest Technical Approach
Add a `grooming_notes` column to the `issues` table. Extend the PATCH handler in `app/api/issues/route.ts` to accept and persist this field. No new components needed — the existing IssueDetailModal already renders `description` as markdown.

### 2. Schema Changes
- `issues.grooming_notes` (text, nullable) — stores the structured technical design output

### 3. API Changes
- `PATCH /api/issues` — add `grooming_notes` to the accepted fields list

### 4. Risks & Edge Cases
- Existing PATCH calls that don't send `grooming_notes` must not null out the field (use COALESCE or omit-if-undefined logic)
- Large grooming notes may exceed the 1MB Supabase row limit if combined with long descriptions

### 5. Complexity Estimate
Score: 3/8 — single column migration + minor API change, no new UI required.
```

---
name: grooming-architect
description: Technical design review for Feature issues during PO grooming. Given a feature's description and AC, produces structured analysis: simplest approach, schema changes, API changes, risks, and complexity estimate. PO embeds output in the issue description before handing to Builder.
---

# Grooming Architect Skill

## When to Use

Load this skill when grooming a **Feature** issue. Run the prompt below against the feature's description + acceptance criteria. Embed the structured output into the feature's `description` field before transitioning.

Do NOT use for tasks, bugs, ops, or research issues — those don't need architectural review at this stage.

## The Prompt

Given:
- Feature title: {title}
- Description: {description}
- Acceptance criteria: {acceptance_criteria}

Produce the following structured analysis:

---

### 1. Simplest Technical Approach
What is the minimal implementation that satisfies all AC?
Describe in 2-4 sentences. No over-engineering. Prefer extending existing patterns over introducing new ones.

### 2. Schema Changes
List any Supabase table or column changes needed.
Format: `table_name: add column X (type, nullable/not-null, default)` or `none`.

### 3. API Changes
List any MC API route additions or modifications needed.
Format: `METHOD /api/path — what changes and why` or `none`.

### 4. Risks & Edge Cases
What can go wrong? What assumptions might break?
List 1-4 bullet points. Flag anything that touches auth, sprint lifecycle, or agent routing as HIGH risk.

### 5. Complexity Estimate
- **Points:** 1–8 (1=trivial, 3=straightforward, 5=moderate, 8=large)
- **Why:** One sentence justification
- **Suggested split:** If > 5 points, propose 2-3 sub-tasks with their own titles.

---

## How PO Uses This

1. Load this skill when you encounter a Feature in backlog.
2. Run the prompt mentally (or via a quick Claude invocation) using the feature's existing fields.
3. Append the structured output to the feature's `description` field in a `## Technical Design` section.
4. If complexity > 5, create child tasks based on the suggested split before transitioning.
5. PATCH the feature with the enriched description before moving to next status.

## Example Output (embedded in description)

```
## Technical Design

### 1. Simplest Technical Approach
Add a `grooming_notes` JSONB column to `issues`. PO populates it during refinement via a PATCH to the MC API. Builder reads it at task start. No new routes needed.

### 2. Schema Changes
issues: add column grooming_notes (jsonb, nullable, default null)

### 3. API Changes
PATCH /api/issues — accept grooming_notes in body, pass through to Supabase update.

### 4. Risks & Edge Cases
- JSONB column requires migration — must run before deploy
- Existing PATCH calls ignore new field (safe, no breaking change)

### 5. Complexity Estimate
- Points: 2
- Why: Single column addition + passthrough field, no business logic
- Suggested split: none needed
```

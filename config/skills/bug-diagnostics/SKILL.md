---
name: bug-diagnostics
description: Structured bug analysis prompt for PO grooming workflow — produces minimal repro steps, affected users/endpoints, severity classification, root cause hypotheses, and related issues
---

# Bug Diagnostics Skill

Structured analysis for Bug issues during PO grooming. Load this skill when grooming a Bug from backlog. It produces a `## Bug Analysis` section to embed in the bug description and drives DoR field population (severity, steps_to_reproduce) before transitioning to refined.

## When to Use

Load when grooming a **Bug** issue (not features, tasks, or epics). Apply before filling DoR fields so severity and repro steps are grounded in analysis, not guesswork.

## Input

From the bug issue:
- `title` — short description of the failure
- `description` — what went wrong and any observed behavior
- `steps_to_reproduce` — any existing repro notes (may be empty)

## Prompt

Use the following prompt, substituting `{title}`, `{description}`, and `{steps_to_reproduce}` with the actual field values:

---

You are a senior engineer performing bug triage. Given the bug report below, produce a **Bug Analysis** with exactly these five sections:

**Bug Title:**
{title}

**Description:**
{description}

**Steps to Reproduce (if any):**
{steps_to_reproduce}

---

### 1. Minimal Repro Steps
Write the shortest sequence of steps that reliably triggers the bug. Use numbered steps. If the description lacks enough detail to write concrete steps, note what information is missing and write the best-guess steps based on available context.

### 2. Affected Users / Endpoints
Estimate the blast radius:
- Who is affected (all users, specific roles, specific projects, internal only)?
- Which API endpoints or UI surfaces are implicated?
- Is this blocking a workflow or a cosmetic issue?

### 3. Severity Classification
Assign a severity using this scale:
- **S0** — user-facing data loss, broken auth, or complete workflow blockage
- **S1** — API or schema-level failure, incorrect data returned, partial workflow broken
- **S2** — config, infra, or background process failure; workaround exists
- **S3** — cosmetic, copy, or minor UX issue; no functional impact

**Severity: SX** — one sentence justification.

### 4. Root Cause Hypotheses
List 2–4 plausible root causes, ordered by likelihood. For each, name:
- The component or module most likely responsible
- The failure mechanism (off-by-one, missing guard, race condition, schema mismatch, etc.)

### 5. Related Issues to Check
List 2–4 areas of the codebase or existing issues that should be checked before implementing a fix:
- Files or modules that touch the same code path
- Recent commits or migrations that could have introduced a regression
- Any known related bugs or open issues that may be the same root cause

---

## Output Format

Embed the output verbatim into the bug's `description` field under a `## Bug Analysis` heading. Also write repro steps into `steps_to_reproduce`. PATCH both fields before setting DoR fields:

```bash
curl -s -X PATCH http://localhost:3000/api/issues \
  -H "Content-Type: application/json" \
  -d '{
    "id": "<bug-uuid>",
    "description": "<original description>\n\n## Bug Analysis\n\n### 1. Minimal Repro Steps\n...\n\n### 2. Affected Users / Endpoints\n...\n\n### 3. Severity Classification\n...\n\n### 4. Root Cause Hypotheses\n...\n\n### 5. Related Issues to Check\n...",
    "steps_to_reproduce": "1. ...\n2. ...\n3. ...",
    "severity": "S1",
    "transitioned_by": "po"
  }'
```

## How PO Uses This

1. Read the bug's `title`, `description`, and `steps_to_reproduce`.
2. Apply the prompt above to produce the Bug Analysis.
3. PATCH the bug with:
   - Updated `description` (original + `## Bug Analysis` section appended)
   - `steps_to_reproduce` (from Section 1)
   - `severity` (from Section 3: S0, S1, S2, or S3)
4. Set remaining DoR fields: `reviewer: "tester"`, `owner: "builder"`, `assignee: "builder"`, `test_tier` (S0/S1 → "e2e"; S2 → "integration"; S3 → "smoke").
5. PATCH status to `refined`.

**Severity → test_tier mapping:**
| Severity | test_tier |
|---|---|
| S0 | e2e |
| S1 | e2e |
| S2 | integration |
| S3 | smoke |

## Example Output

```
## Bug Analysis

### 1. Minimal Repro Steps
1. Open the issue board at /issues
2. Filter by status=open
3. Click any issue to open the detail modal
4. Observe: the `type` field is blank even though the issue has a type set in the database

### 2. Affected Users / Endpoints
All users of the issue board are affected. The `GET /api/issues` endpoint is implicated — it appears to omit the `type` field from the SELECT clause. The detail modal and any client-side filtering that depends on `type` will behave incorrectly. This partially blocks the sub-tab filtering workflow.

### 3. Severity Classification
**Severity: S1** — API returns incomplete data causing broken UI filtering; workaround requires direct DB query.

### 4. Root Cause Hypotheses
1. `app/api/issues/route.ts` SELECT clause — `type` column missing from the field list (most likely; simple omission)
2. Column aliasing mismatch — `type` is a reserved word in some SQL dialects and may need quoting
3. Supabase RLS policy — `type` field excluded from anon key read policy (less likely; other fields work fine)

### 5. Related Issues to Check
- `app/api/issues/route.ts` — verify SELECT field list includes `type`
- Recent migrations adding or renaming the `type` column
- Any open issues referencing broken issue-type filtering (may be duplicate)
- `components/tabs/IssuesTab.tsx` — check if type is consumed from API response or hardcoded
```

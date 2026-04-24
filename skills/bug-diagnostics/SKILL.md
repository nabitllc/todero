# Bug Diagnostics Skill

Structured bug analysis for PO grooming. Run this when picking up a **Bug** issue from backlog. Produces a `## Bug Analysis` block to embed in the issue description, repro steps for `steps_to_reproduce`, and a severity classification.

## When to Use

When PO grooms a `type=bug` issue in `backlog` status. Do NOT use for tasks, features, or ops.

## Input — Read Before Analyzing

1. Issue `title`
2. Issue `description`
3. Issue `steps_to_reproduce` (may be empty)
4. Issue `project`
5. Scan recent issues: `GET http://localhost:3000/api/issues?project={project}&type=bug&status=open` — look for related bugs

## Analysis Prompt

Apply the following structure to produce the bug analysis output:

---

### 1. Minimal Repro Steps

Distill the bug into the fewest steps that reliably trigger it. Format as a numbered list:

```
1. [Setup state / precondition]
2. [Action taken]
3. [Observed result]
Expected: [What should happen instead]
```

If steps_to_reproduce is already filled and accurate, validate and keep. If missing or vague, reconstruct from the description.

### 2. Affected Scope

Estimate who/what is affected:

- **Users:** all users / logged-in users / specific role / internal agents only
- **Endpoints/components:** list the specific API route(s), component(s), or script(s) involved
- **Frequency:** always / intermittent / edge case (infer from description)

### 3. Severity Classification

Use the Todero S0–S3 scale:

| Level | Criteria | Example |
|---|---|---|
| S0 | User-facing breakage — visible error, broken flow, data loss | Issue board not loading, PATCH returning 500 |
| S1 | API or schema issue — wrong data, silent failure, bad query | GET returning stale data, missing field in response |
| S2 | Config or infrastructure issue — env, deploy, agent pipeline | Heartbeat endpoint down, queue runner misconfigured |
| S3 | Cosmetic — visual glitch, typo, minor layout issue | Wrong color, label typo, alignment off |

Pick exactly one: `S0`, `S1`, `S2`, or `S3`. Map to `severity` field value accordingly (S0→critical, S1→high, S2→medium, S3→low is NOT required — use the S-level directly in the analysis; set the issue `severity` field to the S-level string: "S0", "S1", "S2", or "S3").

### 4. Root Cause Hypotheses

List 2–4 plausible causes ranked by likelihood. Be specific — reference file paths, functions, or system boundaries where possible.

```
1. [Most likely] — [why]
2. [Second hypothesis] — [why]
3. [Less likely] — [why]
```

### 5. Related Issues to Check

Query and list any issues that may be related:
- Same endpoint or component
- Same error pattern
- Recently closed bugs in the same area

```
GET http://localhost:3000/api/issues?project={project}&type=bug
```

List any matches with their task_key and title. If none found, write "No related open bugs found."

---

## Output — What to Write

### `steps_to_reproduce` field (PATCH)

Set to the minimal repro steps from Section 1. Plain text, numbered list. If steps were already accurate, leave unchanged (no PATCH needed for this field).

### `description` field (PATCH)

Append the full analysis block to the existing description:

```
## Bug Analysis

**Affected scope:** {users} | {endpoints/components} | {frequency}

**Severity:** {S0/S1/S2/S3} — {one-line rationale}

**Repro steps:**
1. ...
2. ...
3. ...
Expected: ...

**Root cause hypotheses:**
1. [Most likely] — [why]
2. ...

**Related issues:** {task_key: title, or "None found"}
```

### `severity` field (PATCH)

Set to the S-level string: `"S0"`, `"S1"`, `"S2"`, or `"S3"`.

## After Analysis — Complete DoR and Transition

After writing the analysis, set remaining DoR fields and PATCH to `refined`:

```bash
curl -s -X PATCH http://localhost:3000/api/issues \
  -H "Content-Type: application/json" \
  -d '{
    "id": "{issue_id}",
    "status": "refined",
    "transitioned_by": "po",
    "steps_to_reproduce": "{repro steps}",
    "description": "{original description}\n\n## Bug Analysis\n\n...",
    "severity": "{S0|S1|S2|S3}",
    "reviewer": "tester",
    "owner": "builder",
    "assignee": "builder",
    "test_tier": "{smoke|integration|e2e}",
    "implementation_notes": "Bug analysis complete. Severity: {S-level}. Root cause: {top hypothesis}."
  }'
```

**test_tier guidance for bugs:**
- `smoke` — cosmetic fix, config tweak, no new code paths
- `integration` — API route fix, DB query fix, component logic fix
- `e2e` — user-facing flow broken, auth affected, lifecycle state corrupted

## Example Output

Given bug: "PATCH /api/issues returns 200 but status does not update"

```
## Bug Analysis

**Affected scope:** All agents using MC API | PATCH /api/issues | Always reproducible

**Severity:** S1 — Silent data mutation failure; API lies about success

**Repro steps:**
1. PATCH /api/issues with {"id": "<uuid>", "status": "refined"}
2. GET /api/issues/{id}
3. Status is still "backlog"
Expected: status field reflects "refined"

**Root cause hypotheses:**
1. [Most likely] Supabase update missing `.eq()` filter — updates no rows silently — app/api/issues/route.ts ~line 80
2. Status field excluded from update payload construction
3. RLS policy blocking write for anon key on status column

**Related issues:** TOD-1822: PATCH returns 200 with no-op on sprint field
```

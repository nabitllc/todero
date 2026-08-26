# PIECE: Pipeline Fidelity — every column a real status, one lane per agent

id: pipeline-fidelity
lane: Operator
channel: Pipeline Fidelity (3/9)
files owned exclusively:
  - `components/tabs/PipelineTab.tsx`
  - `lib/pipeline-stages.ts` (new)
  - `lib/__tests__/pipeline-stages.test.ts` (new)
  - `docs/rebuild/pieces/pieces6/pipeline-fidelity.md` (this file)

---

## What I actually measured, before building anything

The channel evidence and the earlier spec `pieces6-pipeline.md` were both
treated as claims. Every number below was re-counted from source or from the
running server on 2026-08-26. **Four of the five claims were wrong or stale.**

| Claim | Verdict | What is actually true |
|---|---|---|
| "7 invented display stages" | **TRUE** | `components/tabs/PipelineTab.tsx:12` `STAGES` and `lib/pipeline.ts:5` `PipelineStage` both list exactly **7**: Backlog, Definition, Building, Testing, UX Review, PR Queue, Merged. None is a status. |
| "11 real lifecycle statuses" | **FALSE — it is 16** | The canonical enumeration is `VALID_STATUSES` (`lib/constants.ts:72-77`), **16 statuses**, and it is what `app/api/issues/route.ts:1250` and `:1700` validate POST and PATCH against. `lib/issue-lifecycle.ts` is *not* an enumeration — it is five overlapping predicate sets naming only **10** distinct statuses and omitting `backlog`, `defined`, `refined`, `draft`, `active`, `completed`. The earlier spec's list of 11 included `cancelled`, which `lib/issue-lifecycle.ts:5` explicitly states **is not a status in this system**, and which is absent from `VALID_STATUSES`. |
| "column membership decided by ad-hoc conditions in the render" | **TRUE** | `lib/pipeline.ts:17-56` is a 40-line `if`-chain reading `type`, `children[]`, `tester_status`, `designer_status` and `test_status`; the render adds more (`PipelineTab.tsx:365` decides a Testing-column badge from `assignee === 'tester'`). |
| "hardcodes a 4-agent array" | **FALSE — already fixed** | `PipelineTab.tsx:24-28` carries the tombstone comment for that array; the component already calls `useAgentRoster()` (line 49), which reads `GET /api/agents`. That endpoint served **28 agents** when measured. The residual defect is different: the roster is used only to place an emoji in a stage footer, never as a lane. |
| "filters on a status string absent from the lifecycle module" | **MISLEADING** | The string is `'completed'` (`PipelineTab.tsx:472`). It **is** a real status — `VALID_STATUSES` contains it, `lib/issue-routing.ts:80` transitions `product_review → completed`, and `app/api/issues/route.ts` uses it in four places. It is absent from `lib/issue-lifecycle.ts` and from `ISSUE_STATUS_CATEGORY_MAP`, which is a defect in **those** files, reported below, not in the Pipeline. |

### The dead condition the brief missed

`test_status` **is not a column on the `issues` table.** The table has
`tester_status`, `designer_status`, `deployer_status` and `test_tier`; there is
no `test_status` (verified against `db.sqlite`'s `CREATE TABLE issues` and
against a live `POST /api/issues` response, which returns no such field).

Therefore `issue.test_status` is `undefined` on every row, and every one of
these is permanently unreachable:

- `lib/pipeline.ts:27` — `children.every(c => c.test_status === "passed")`
- `lib/pipeline.ts:40` — `if (issue.test_status === "passed")` and the entire
  UX-Review branch beneath it, which is the **only** way to reach the `UX Review`
  column. **One of the seven columns was mathematically unreachable.**
- `PipelineTab.tsx:521, 536-539, 571-575` — the Passed/Failed card border and
  the test-status badge.

### The unscoped-query claim — TRUE, and verified by request

`PipelineTab.tsx:119-120` calls
`dbUrl('issues?status=not.in.(closed,completed,released)&select=*&limit=100')`:
no `project=` clause, no `archived_at=` clause. Measured against the running
server:

```
GET /api/db/issues?status=not.in.(closed,completed,released)&select=*&limit=100
  with referer .../p/limiglow/work/bolt  ->  200  []
  with no referer                        ->  400  {"error":"unscoped_issues_read"}
```

So the query is genuinely unscoped and is rescued by the server seam injecting
`project=eq.Limiglow&archived_at=is.null` from the referer
(`app/api/db/[...path]/route.ts:145-148`). Relying on that is not the same as
writing a scoped query: `lib/db/browser.ts` exports `issuesUrl(query, scope)`
precisely so the clause cannot be forgotten, and `scripts/no-unscoped-issues.mjs`
exists because the distinction has been lost before.

---

## The stage model

Columns are **explicitly named groups of real statuses**, declared as data in
`lib/pipeline-stages.ts`. Eight columns, sixteen statuses, every status in
exactly one column.

| # | Column id | Column label | Statuses it displays | `deriveIssueStatusCategory` |
|---|---|---|---|---|
| 1 | `backlog` | Backlog | `backlog`, `draft` | Planned |
| 2 | `defined` | Defined | `defined`, `refined` | Planned |
| 3 | `ready` | Ready | `open` | Planned |
| 4 | `in_progress` | In progress | `in_progress`, `underway`, `active` | Ongoing |
| 5 | `in_review` | In review | `code_review`, `product_review`, `feature_review` | Ongoing |
| 6 | `approved` | Approved | `approved` | Ongoing |
| 7 | `signed_off` | Signed off | `released`, `wrapped`, `completed` | SignOff (`completed`: **none** — see below) |
| 8 | `closed` | Closed | `closed` | Done |

2 + 2 + 1 + 3 + 3 + 1 + 3 + 1 = **16** = `VALID_STATUSES.length`.

`draft`/`active`/`wrapped` are the epic-lifecycle statuses and `underway`/
`feature_review` the feature ones; they are grouped with their task-lifecycle
equivalents rather than given columns of their own, which is why eight columns
cover sixteen statuses.

### Defect found in a file this piece does not own — reported, not fixed

`completed` is in `VALID_STATUSES` and is written by the MC API, but it is
absent from `ISSUE_STATUS_CATEGORY_MAP` (`lib/status-category.ts:5-21`), so
`deriveIssueStatusCategory('completed')` returns `null` and a `completed` issue
has **no** status category. It is the only one of the sixteen for which that is
true. `lib/status-category.ts` is not owned by this piece and is not edited.
`lib/__tests__/pipeline-stages.test.ts` pins the fact so it cannot change
silently in either direction.

---

## ACCEPTANCE — every item observable

Run from the repo root with the dev server already up. Auth for every request:
`cookie: mc-auth=kaos2026; mc-role=owner`.
Pipeline URL: `/b/todero/p/limiglow/work/bolt`, sub-view **Pipeline**.

### A. The stage model is data, not a render condition

1. `lib/pipeline-stages.ts` exists and exports `PIPELINE_COLUMNS` as a frozen
   array of 8 objects, each with `id`, `label`, `statuses` and `category`.
   `node -e "…require ts…"` is not needed: `npm test -- pipeline-stages` proves it.
2. `grep -c "" lib/pipeline-stages.ts` — the file contains **no JSX and no React
   import**; it is importable from a `testEnvironment: node` Jest test with no
   DOM. `npm test -- pipeline-stages` passing is the proof.
3. `columnForStatus(s)` is a pure function of `s` alone. It takes **no** issue,
   no children array, no `tester_status`, no `assignee`. Verified by its
   TypeScript signature `(status: unknown) => PipelineColumn | null`.
4. `grep -n "getPipelineStage" components/tabs/PipelineTab.tsx` → **0 matches**.
   The `if`-chain in `lib/pipeline.ts` no longer decides any column.
5. `grep -n "test_status" components/tabs/PipelineTab.tsx` → **0 matches**. The
   permanently-undefined field is gone; the card reads `tester_status`,
   `designer_status` and `test_tier`, all of which are real columns.
6. `grep -n '"UX Review"\|PR Queue\|Definition' components/tabs/PipelineTab.tsx`
   → **0 matches**. No invented stage name survives.

### B. Completeness — a status with no column, and a column with no status, are both impossible

7. `npm test -- pipeline-stages` passes, and includes a test that enumerates
   `VALID_STATUSES` from `lib/constants.ts` and fails naming any status no
   column claims.
8. The same suite fails naming any status a column claims that
   `VALID_STATUSES` does not contain.
9. The same suite fails if any column declares an empty `statuses` array.
10. The same suite fails if two columns claim the same status.
11. **Proven by breaking it:** delete one status from one column's `statuses`
    array, run `npm test -- pipeline-stages`, observe a RED failure that names
    the missing status; restore it, observe GREEN. The report records the
    before/after counts.
12. `PIPELINE_MODEL_DEFECTS` is exported and computed at module load from the
    same invariants. When it is non-empty the Pipeline renders a red banner
    **in place of** the board, never an empty board.
13. `columnForStatus('in_review')`, `columnForStatus('done')` and
    `columnForStatus('blocked')` all return `null` — the three
    `RETIRED_STATUSES` are not smuggled into any column.
14. A row whose status matches no column is **not dropped**. It is collected
    into an "Unrecognised status" holding column that appears only when at
    least one such row exists, and each card prints its raw status string.

### C. Every column count traces to a real query

15. The board header prints the two queries it ran, verbatim, including their
    row caps, and the exact project total taken from
    `GET /api/issues?project=<p>&limit=1` → `total` (never `limit=0`, which
    returns every row).
16. With Limiglow at zero issues, every one of the eight columns shows the
    numeral `0` and the board shows an empty state naming the project. A real
    zero reads as a zero.
17. Insert fixtures in `backlog`, `open`, `in_progress`, `code_review`,
    `approved` and `released`; each appears in exactly the column the table
    above names, and the count badge on that column increments by exactly one.
18. Every card prints its **own status string** as text, so column position and
    status can never silently disagree.
19. Kill the request (stop the server, or point at a 500): the board is
    **replaced** by `<ApiErrorBanner>`. No "Nothing here yet" and no `0` badge
    is rendered over a failed request. `node scripts/no-silent-empty.mjs`
    exits 0.

### D. Project scope is written, not borrowed

20. `grep -n "dbUrl('issues\|dbUrl(\`issues" components/tabs/PipelineTab.tsx`
    → **0 matches**. Every issues read goes through
    `issuesUrl(query, { project })`.
21. The request URL observed in the network panel contains
    `project=eq.Limiglow&archived_at=is.null` **before** the seam adds anything.
22. When `projectFilter` is null the component renders "No project is
    scoped…" and issues **no** query at all — `issuesUrl` throws on an empty
    scope by design and must never be called with one.
23. A row whose `project` differs from the scope, should one ever arrive, is
    surfaced as a warning naming the leak — not silently filtered out of view.
24. `bash scripts/smoke-test-layout.sh` passes, including its 10-probe live
    scope guard, and `node scripts/no-invented-projects.mjs` exits 0.

### E. The lane that matters — by agent

25. A lane selector offers **Together** and **By agent**, and the choice
    survives a full page reload (`localStorage` key `pipeline-swimlane`).
26. In **By agent**, the lane list comes from `GET /api/agents` via
    `useAgentRoster()`. `grep -n "const AGENTS\|AGENTS = \[" components/tabs/PipelineTab.tsx`
    → **0 matches**; no agent id is written in the component.
27. The number of agent lanes equals the number of agents the endpoint serves.
    Measured 2026-08-26: `GET /api/agents` → **28** agents → 28 agent lanes.
28. **An agent with no work in flight is distinguishable from an agent that
    does not exist.** Every rostered agent gets a lane even at zero rows, and
    that lane reads `no work in flight`. An agent id that is not on the roster
    gets no lane at all — unless issues are assigned to it, in which case its
    lane appears badged `not on the roster`.
29. Issues with no assignee land in an `Unassigned` lane, present only when
    such rows exist.
30. Each lane's per-column counts sum to that lane's header count, and the sum
    of all lane header counts equals the board total — no row is in two lanes
    and none is lost.
31. If `GET /api/agents` fails, the lane region is **replaced** by an error
    banner naming the failure. It does not fall back to "no agents".

### F. Writes go through the MC API

32. Moving a card writes with `PATCH /api/issues` (body `{id, status}`) — the
    route that validates against `VALID_STATUSES` and enforces the lifecycle
    gates. `grep -n "method: 'PATCH'" components/tabs/PipelineTab.tsx` shows no
    `/api/db/` target.
33. A move the lifecycle refuses (e.g. → `open` without acceptance criteria)
    shows the API's own error text and the card **returns to its original
    column**. An optimistic update is never left standing over a refusal.
34. The move sheet offers **statuses**, grouped under their column headings —
    never a column, which would be ambiguous for the six columns that hold
    more than one status.

### G. Nothing else regressed

35. `npx tsc --noEmit` → exit 0.
36. `node scripts/acceptance/run.mjs` → 45/45.
37. `npm test` → no new failures beyond the known pre-existing
    `agents-route`, `agents-unconfigured`, `spawn-live` (5 tests).
38. Every fixture inserted during verification is removed, and
    `GET /api/issues?project=Limiglow&limit=1&include_archived=1` reports
    `"total":0`.

# phantom-column — `test_status`, and the guard that stops the fifth survival

**Piece:** TOD-2446. **Branch:** `rebuild/2026-08-26`.
Everything below was measured on this branch against the running dev server and
the live `db.sqlite`. Where a claim handed to this piece turned out to be wrong,
it is marked **CLAIM WRONG** and the measurement is shown.

---

## 0. The measurement that settles the schema question

```
$ node -e "…PRAGMA table_info(issues)…"
COUNT=57
```

**57 columns, counted directly, before any change on this branch.** `test_status`
is not among them. `tester_status` (cid 39) and `designer_status` (cid 43) are.

The relevant neighbours, so the shape is visible:

| cid | column | cid | column |
|---|---|---|---|
| 38 | `regression_test` | 43 | `designer_status` |
| 39 | `tester_status` | 44 | `designer_notes` |
| 40 | `tester_notes` | 45 | `designed_by` |
| 41 | `tested_by` | 46 | `designer_reviewed_at` |
| 42 | `tester_reviewed_at` | 52 | `test_tier` |

After migration 066 (this piece) the table has **61** columns. Still no
`test_status`.

The parsed migrations agree independently: `migrations/sqlite/*.sql`, applied in
filename order, yields exactly the same 57 columns for `issues`. The two sources
did not have to agree; they do.

### 0a. The claims handed to this piece, checked one by one

| Claim | Verdict | Measurement |
|---|---|---|
| `issues` has 57 columns, none of them `test_status` | **TRUE** | `PRAGMA table_info(issues)` → 57; `test_status` absent |
| `lib/issues.ts:51` declares `test_status?: string` | **TRUE** | exact line, exact text |
| `app/api/issues/route.ts:650-652` holds a `test_status_passed` gate | **TRUE, line drift** | it is at **655-657** |
| `route.ts:2019-2020` and `:2027-2028` derive the review statuses from it | **TRUE, line drift** | they are at **2037-2038** and **2045-2046** |
| `BoardTab.tsx:1663-1667` renders it | **TRUE** | exact lines |
| …"an always-empty column, because the value can never be anything but `undefined`" | **CLAIM WRONG in its detail** | the block is guarded by `{t.test_status && t.test_status !== 'none' && (…)}`, so nothing renders at all — there was never an empty column on screen. It is dead render code plus a type that lies, which is *worse* for a sweep: an empty column is at least visible. **The genuinely always-empty panel on that screen was a different one** — "Bug Details" at `:1553-1584`, which showed "No bug details provided" on every bug ever opened, plus a DoR badge at `:1509` reporting "Missing: steps_to_reproduce" no matter what anyone typed. See §7. |
| TOD-2445 fixed the write sites | **TRUE but incomplete** | the three SERVER writes are gone; a CLIENT could still send the field and get a 500. Measured, and closed in §6. |

---

## 1. ACCEPTANCE

1. **The column count is measured, not relayed.** `PRAGMA table_info(issues)`
   returns 57 before this piece and 61 after, and `test_status` is absent from
   both.
2. **Every remaining `test_status` reference is classified** — file, line,
   read/write, live/comment/tombstone/test — in §2 below, with nothing omitted.
3. **A decision is made and justified from what the code does**, not from
   preference: either the column exists (migration 066) or every live reference
   goes and a tombstone records why. `computeDualReviewState` and the real
   `tester_status`/`designer_status` columns are the evidence weighed.
4. **`BoardTab` renders no field that can never have a value.** Either it shows
   a real value or it shows nothing at all.
5. **Every gate that tests a phantom is named, its purpose stated, and it is
   either made to protect that purpose for real or deleted** — with the
   deletion recorded.
6. **The review lifecycle completes end to end** — `in_progress -> code_review
   -> tester passes -> designer passes -> approved` — with an HTTP status
   recorded for each step, both before and after the change.
7. **`scripts/no-phantom-columns.mjs` exists**, derives its truth from the live
   schema, states its own coverage boundary, and strips comments before
   scanning so tombstones never trip it.
8. **The guard is proven in BOTH directions** — a reintroduced phantom produces
   exit 1, its removal produces exit 0 — for each of its three checks, with the
   output recorded.
9. **The guard's own blind spots are measured and written down**, including the
   case where it would NOT have caught this defect.
10. **Nothing else regresses.** `npx tsc --noEmit` clean; `npm test` shows only
    the five known pre-existing failures; `node scripts/acceptance/run.mjs`
    45/45; `no-invented-projects`, `no-dead-modules`, `no-unscoped-issues` and
    `no-silent-empty` all exit 0; both migration dialects still apply from
    empty.
11. **Every fixture inserted is removed.** Limiglow ends at zero issues and
    `TOD-1` keeps its original `archived_at`.

---

## 2. Every remaining reference

### 2a. `test_status` — the phantom itself

Scanned: `app/`, `lib/`, `components/`, `hooks/`, `__tests__/`. `.next*`,
`node_modules`, `exports/` excluded.

| # | File:line | R/W | Kind | Disposition |
|---|---|---|---|---|
| 1 | `lib/issues.ts:51` (pre-change) | declaration | **LIVE** | **REMOVED** — replaced by a tombstone at `lib/issues.ts:62`. |
| 2 | `components/tabs/BoardTab.tsx:1663-1667` (pre-change) | READ ×4 | **LIVE** | **REMOVED** — replaced by a tombstone at `:1662`. |
| 3 | `app/api/issues/route.ts:655-657` (pre-change) | READ | **LIVE gate** | **REWRITTEN** — `test_status_passed` is now aliased onto the dual-review check. §4. |
| 4 | `app/api/issues/route.ts:2037-2038` (pre-change) | READ ×2 | **LIVE** | **REMOVED** — the term was permanently `undefined`. §5. |
| 5 | `app/api/issues/route.ts:2045-2046` (pre-change) | READ ×2 | **LIVE** | **REMOVED** — same. §5. |
| 6 | `app/api/issues/route.ts:1631` (new) | guard | **LIVE** | **ADDED** — a body carrying `test_status` now gets 422, not 500. §6. |
| 7 | `app/api/issues/route.ts` (`derivedTestStatus`, 5 sites) | local var | **LIVE, correct** | Kept. It is a local, never a column. TOD-2445 introduced it deliberately. |
| 8 | `app/api/issues/route.ts:1582, 1584, 2107-2113, 2176` | — | tombstone | Kept. |
| 9 | `lib/issue-routing.ts:65` | — | tombstone | Kept. Read, not edited, as instructed. |
| 10 | `lib/pipeline-stages.ts:7-15` | — | tombstone | Kept. Not owned by this piece. |
| 11 | `components/tabs/PipelineTab.tsx:13-15, 862` | — | tombstone | Kept. Not owned by this piece. |
| 12 | `lib/loop-breaker.ts:6` | — | comment | Kept. Stale prose ("succeeds (test_status=passed)"), harmless, not owned. |
| 13 | **`lib/pipeline.ts:27`** | **READ** | **LIVE, but unreachable** | **NOT FIXED — see §8.** `children.every(c => c.test_status === "passed")`. |
| 14 | **`lib/pipeline.ts:40`** | **READ** | **LIVE, but unreachable** | **NOT FIXED — see §8.** `if (issue.test_status === "passed")`. |
| 15 | **`lib/agent-queue.ts:159`** | **WRITE instruction** | **LIVE** | **NOT FIXED — see §8.** Prompt text telling the Tester agent to `PATCH … test_status=passed`. |
| 16 | `__tests__/utils/issue-routing.test.ts:21-33` | assertion | test | Kept, already inverted by TOD-2445 to assert the ABSENCE. |
| 17 | `lib/__tests__/issue-moves.test.ts:330` | assertion | test | Kept — asserts the string `'no such column: test_status'` never appears. |
| 18 | `lib/__tests__/pipeline-stages.test.ts:9` | — | comment | Kept. |
| 19 | `scripts/no-dead-modules.mjs:10` | — | comment | Kept. Not owned. |
| 20 | `scripts/archive/*.sh`, `scripts/smoke-test.sh` | WRITE | archived scripts | Not owned; they target the retired Supabase REST endpoint and do not run. |
| 21 | `config/**` (12 files) | mixed | companion repo | Not this repo's schema. `config/migrations/` is **not** applied by `npm run db:migrate`. |
| 22 | `migrations/007_dual_review_open_canonical.sql:21` | — | comment | Kept — it is the record of the original replacement decision. §3. |
| 23 | `scripts/board/*` | — | report text | The flight board's own note that this field had survived four sweeps. |

### 2b. Four MORE phantoms the same audit found — **not in the brief**

Measured the same way. All four were absent from the 57 columns:

| File:line | Field | R/W | Kind |
|---|---|---|---|
| `lib/issues.ts:40` | `steps_to_reproduce` | declaration | LIVE |
| `lib/issues.ts:41` | `expected_behavior` | declaration | LIVE |
| `lib/issues.ts:42` | `actual_behavior` | declaration | LIVE |
| `lib/issues.ts:43` | `environment` | declaration | LIVE |
| `components/tabs/BoardTab.tsx:1408, 1509, 1554-1581` | all four | READ ×10 | LIVE |
| `app/api/issues/route.ts:1551` | `environment` | READ | LIVE |
| live `workflow_transitions` row (bug, defined→open) | `environment` | **validator** | **LIVE DATA** |

These are dealt with in §7. They are the reason migration 066 exists.

---

## 3. The decision: **`test_status` must NOT exist**

Four pieces of evidence, in order of weight.

**(a) The value is derived, and the deriver already exists.**
`computeDualReviewState()` in `lib/issue-routing.ts` returns `overallTestStatus`
from `tester_status` and `designer_status` — both real columns — using exactly
the passed/failed/pending logic a stored `test_status` would hold. A column
would be a second copy of a value the code can compute on demand.

**(b) The stored copy demonstrably drifted, at scale.**
`exports/supabase/issues.json` is the pre-Neon production export: **3078 rows**,
and `test_status` was populated on **all 3078** (`passed` 584, `none` 2391,
`pending` 71, `failed` 32). Recomputing the derived verdict for every row:

```
agree=2706  disagree=372  total=3078
drift rate = 12.1%
```

Sample of the disagreement — every one of these is a closed issue whose stored
verdict says `passed` while both of its actual reviewers are still `pending`:

```
TOD-648  tester=pending designer=pending stored=passed derived=pending
INF-704  tester=pending designer=pending stored=passed derived=pending
MC-328   tester=pending designer=pending stored=passed derived=pending
```

One row in eight carried a review verdict that its own review columns did not
support. That is what a second source of truth costs.

**(c) The project already decided this, in 2026.**
`migrations/007_dual_review_open_canonical.sql:21` replaces the
`test_status_passed` validator with `dual_review_passed` for `bug`, and does the
same for `ops`. The comment on that line says so in as many words. The live
`workflow_transitions` table has **7 rows** and **none** of them names
`test_status_passed`. Nothing in the running workflow needs the column.

**(d) The UI already shows the real thing, two lines above the phantom.**
`BoardTab.tsx:1589-1605` renders a "Review Status" pair — Tester and Designer,
from the two real columns. The deleted `test_status` badge sat directly beneath
it. Restoring the column would have put a third, redundant, drift-prone badge
under two accurate ones.

**Conclusion.** No migration adds `test_status`. Tombstones are written at
`lib/issues.ts:62`, `components/tabs/BoardTab.tsx:1662`, and inside
`migrations/066_bug_report_columns.sql`, each stating the reason above so the
next reader does not have to re-derive it.

---

## 4. The gate that never fired — `test_status_passed`

**Where:** `app/api/issues/route.ts:655-657`, before this piece:

```ts
} else if (v === 'test_status_passed') {
  if (merged.test_status !== 'passed') { missing.push('test_status=passed') }
}
```

**What it was protecting:** "this issue may not be approved until review has
signed off." That is a real thing worth protecting.

**Why it could never do it.** `merged` is `{...issue, ...body}`, so
`merged.test_status` is only ever non-undefined if the CALLER supplies it. That
gives exactly two outcomes and neither is the intended one:

* omit the field → `400 Cannot move to approved: missing required fields: test_status=passed`
* supply the field → the value survives into `fields`, reaches `.update()`, and
  → `500 no such column: test_status`

**Measured, on this branch, before the fix:**

```
PATCH {"id":…,"test_status":"passed"} -> HTTP 500  no such column: test_status
```

**Disposition: rewritten, not deleted.** Deleting the branch would drop
`test_status_passed` through to the generic `merged[v]` case, producing a
different permanent 400. It is aliased onto `dual_review_passed` instead — the
check that expresses the same intent against columns that exist, and the exact
replacement migration 007 already chose. Installations still carrying the older
seed from `config/migrations/008` and `009` now get a gate that works.

---

## 5. The two derivations that read a permanently-undefined term

`route.ts:2037-2038` and `:2045-2046`, before:

```ts
if (fields.tester_status === undefined &&
    (fields.tester_notes !== undefined || fields.test_status !== undefined || fields.status !== undefined)) {
  fields.tester_status = fields.test_status === 'failed' || fields.status === 'open' ? 'failed' : 'passed'
}
```

`fields.test_status` appears twice: as one of three OR'd trigger signals, and as
one of two verdict inputs. In both positions it contributed nothing — a body
without it left the term `undefined` forever; a body with it 500'd on the write
regardless of what this branch decided. Both occurrences are removed and the
remaining signals (`tester_notes`, `status`) are the ones that actually arrive.

Verified by the lifecycle run in §9, whose tester and designer steps send only
`*_notes` and still resolve to `passed`.

---

## 6. Closing the write hole for real

TOD-2445 removed the three places the **server** wrote `test_status`. Nothing
stopped a **client** from sending it: `fields` is the request body minus four
named keys and goes into `.update()` verbatim, with no allowlist. Measured
before this piece: `PATCH {"test_status":"passed"}` → **HTTP 500**.

That was not theoretical. `lib/agent-queue.ts:159` still instructs the Tester
agent to `PATCH to approved with test_status=passed`. The outage was one agent
run away from returning.

`route.ts:1631` now rejects the field by name:

```
HTTP 422  `test_status` is not a field on an issue and never gets written. The review
          verdict lives in `tester_status` and `designer_status`; the combined value is
          derived from those two, not stored. Send `tester_status` or `designer_status`
          (passed | failed | pending) instead.
```

A 422 naming the real columns is an answer the caller can act on. A 500 is not.

---

## 7. The other four phantoms, and a second live deadlock

`environment`, `steps_to_reproduce`, `expected_behavior`, `actual_behavior` —
none of them columns, all of them read by live code, and one of them named by a
**live validator row**: `workflow_transitions`, `issue_type='bug'`,
`defined → open`, validators `[…,"environment"]`, seeded by
`migrations/sqlite/000_baseline.sql:511`, `migrations/005` and `migrations/023`.

**Measured on a real bug fixture (TOD-107), before migration 066:**

```
defined->open  (no environment)   HTTP 400  Cannot move to open: missing required fields: environment
defined->open  (WITH environment) HTTP 500  no such column: environment
```

**Both directions fail. No bug in this installation could leave `defined`.**
Same outage shape as the `test_status` one, a different column, still live
hours after TOD-2445 closed the first.

**Decision: these four DO exist — migration 066 adds them.** The reasoning is
the mirror image of §3, which is why the two decisions belong in one document:

* They are **source data**, not derived. Nothing can compute "where was this bug
  found" from another column; a human types it or it does not exist. There is no
  `computeDualReviewState` equivalent to fall back on.
* They were **real columns that were lost**, not fabrications. They were added
  by `config/migrations/009_seed_remaining_workflows.sql` — the COMPANION repo's
  migration directory, which `npm run db:migrate` does not apply — and the
  pre-Neon export still carries their values: `environment` and
  `steps_to_reproduce` non-null on 8 rows, `expected_behavior` and
  `actual_behavior` on 4. They disappeared when `000_baseline_schema.sql` was
  written.
* Deleting the references instead would have removed a gate protecting something
  real, and silently discarded correct UI — the "Bug Details" panel at
  `BoardTab.tsx:1553-1584` and the DoR check at `:1509`, which has been telling
  every bug "Missing: steps_to_reproduce" no matter what anyone typed.

`migrations/066_bug_report_columns.sql` (+ the SQLite dialect) carries all of
this in its comment, including a section headed *"WHY `test_status` IS NOT ADDED
HERE"*, so the two halves of the decision cannot be separated by a later reader.

**After 066:**

```
$ PRAGMA table_info(issues) -> COUNT=61   test_status: false   environment: true
defined->open (WITH environment) HTTP 200  status=open environment=production
```

---

## 8. What this piece did NOT fix, and why

Named plainly rather than left for a fifth sweep to rediscover.

1. **`lib/pipeline.ts:27` and `:40` still read `test_status`.** Both are inside
   `getPipelineStage()`, and that function is **imported by nobody** — measured:
   the only import of `@/lib/pipeline` anywhere is
   `PipelineTab.tsx:57`, which takes `isBlocked` and `nextPRWindow` only, and
   `getPipelineStage`/`STAGE_COLORS`/`PipelineStage` have zero references
   outside their own file. So these are dead reads, not live gates.
   `no-dead-modules.mjs` does not catch them because the MODULE is imported;
   only the function is orphaned. **The file is not on this piece's ownership
   list**, and editing an unassigned file while three builders are mid-edit is
   the collision the ownership scheme exists to prevent. It is a two-line fix
   for whoever owns it.
2. **`lib/agent-queue.ts:159` still tells the Tester agent to send
   `test_status=passed`.** Not owned by this piece. The consequence is now a
   422 with instructions instead of a 500, so the failure is legible, but the
   prompt is still wrong.
3. **`lib/loop-breaker.ts:6`** describes the loop breaker in terms of
   `test_status=passed`. Prose only, not owned.
4. **The `no-phantom-columns` guard cannot see either of items 1–2** — member
   access and prompt strings are documented blind spots. See §10.
5. **`ops` has no `open → in_progress` transition row**, and neither does
   `task`. The live `workflow_transitions` table has 7 rows and reaching
   `in_progress` requires an owner override. Noticed while building the
   lifecycle probe; unrelated to this piece and not touched.

---

## 9. The review lifecycle, end to end

Fixture `TOD-105` (ops, Limiglow), driven through the real API with
`cookie: mc-auth=kaos2026; mc-role=owner`. `tester passes` and
`designer passes` send only `*_notes` — no status, no verdict field — so the
derivation in §5 is what produces the result.

**Before this piece's changes (baseline):**

```
200  -> in_progress      status=in_progress  tester=null    designer=null
200  -> code_review      status=code_review  tester=pending designer=pending  assignee=tester
200  tester passes       status=code_review  tester=passed  designer=pending
200  designer passes     status=approved     tester=passed  designer=passed   assignee=deployer
```

**After this piece's changes:**

```
200  -> in_progress      status=in_progress  tester=null    designer=null
200  -> code_review      status=code_review  tester=pending designer=pending  assignee=tester
200  tester passes       status=code_review  tester=passed  designer=pending
200  designer passes     status=approved     tester=passed  designer=passed   assignee=deployer
```

Identical, all 200, and it ends at `approved` with the deployer assigned and
`resolution_type=config_change` auto-set. Nothing regressed.

---

## 10. The guard — `scripts/no-phantom-columns.mjs`

Modelled on `scripts/no-invented-projects.mjs`, including its comment stripper
(quote-, template- and regex-aware, so a backtick inside a regex character class
cannot desynchronise it) and its refuse-rather-than-degrade posture.

**Where truth comes from.** The live `db.sqlite` via `PRAGMA table_info` when it
exists; `migrations/sqlite/*.sql` parsed in filename order otherwise. The script
prints which. When both exist the parsed migrations are used only as a
**staleness check**: a column declared in migrations but missing from the live DB,
on a table the scan touched, is **exit 2** with "run `npm run db:migrate`" —
because a verdict rendered against a stale database flags correct code, and a
guard that flags correct code gets deleted. The reverse direction is
deliberately not an error: a parse gap in the guard is the guard's problem and
must never become a false positive.

Refuses (exit 2) if fewer than 5 tables are read, or if `issues` has fewer than
20 columns.

**Three checks.**

1. **Seam chains.** Every `.from('<table>')` starts a chain that is walked link
   by link with a paren matcher, not guessed with a regex: filter methods
   (`eq`/`neq`/`gt`/…/`order`) contribute their first string argument,
   `.select('a,b,c')` contributes each entry (handling `*`, `count`, embedded
   `x(y)` and `alias:col`), and `.insert`/`.update`/`.upsert` contribute every
   literal key of their object argument.
2. **Browser query strings.** `dbUrl('<table>?…')` and `issuesUrl('…', scope)`,
   parsing `select=`, `order=`, `col=op.value`, and the terms inside `or=(…)` /
   `and=(…)`. Template literals contribute their static prefix up to the last
   complete clause before the first `${`.
3. **Annotated row shapes.** An interface or type preceded by `// @db-table
   <name>` declares itself the row shape of that table and every field must be a
   column. `lib/issues.ts:Task` now carries that annotation.

**Baseline run on the finished tree:**

```
no-phantom-columns: schema source = db.sqlite (live, PRAGMA table_info)
no-phantom-columns: 54 table(s); `issues` has 61 column(s) (live schema checked against migrations/sqlite — not stale)
no-phantom-columns: scanned 254 files under app, lib, components, hooks
no-phantom-columns: 42 table(s) referenced; 73 dynamic table name(s) and 52 dynamic
                    column expression(s) could not be resolved statically and were NOT checked
no-phantom-columns: OK — every column named in live code exists.
exit=0
```

The last summary line is deliberate: a green run states how much it could not
see rather than implying it saw everything.

### 10a. Proof it fails when it should — all three checks, both directions

**Check 3 — the row shape.** Re-added `test_status?: string` to
`lib/issues.ts:Task`:

```
  1 phantom column reference(s) in live code:
    lib/issues.ts:61  issues.test_status
        `issues` has no column `test_status` (declared on a @db-table row shape)
exit=1
```

Note what is NOT reported: the 18-line tombstone directly above that line, which
names `test_status` seven times. Comments are stripped first. Removing the field
again → **exit 0**.

**Check 1 — seam chains.** Added a phantom write, filter and select to the
`updateTaskStatus` chain:

```
  3 phantom column reference(s) in live code:
    lib/issues.ts:105  issues.test_status  `issues` has no column `test_status` (.update())
    lib/issues.ts:106  issues.test_status  `issues` has no column `test_status` (.eq())
    lib/issues.ts:107  issues.test_status  `issues` has no column `test_status` (.select())
exit=1
```

Reverted → **exit 0**.

**Check 2 — query strings.** Added four `dbUrl`/`issuesUrl` calls:

```
  6 phantom column reference(s) in live code:
    lib/issues.ts:104  issues.test_status      … (dbUrl select=)
    lib/issues.ts:104  issues.test_status      … (dbUrl filter)
    lib/issues.ts:104  issues.test_status      … (dbUrl order=)
    lib/issues.ts:105  issues.test_status      … (dbUrl or=)
    lib/issues.ts:106  issues.test_status      … (dbUrl select=)
    lib/issues.ts:107  no_such_table.(table)   no table named `no_such_table` in the schema
exit=1
```

Reverted → **exit 0**.

### 10b. The measurement that keeps this guard honest

**With the `@db-table` annotation removed and `test_status?: string` put back on
the interface, the guard returns exit 0.** Measured:

```
annotation absent,  phantom present -> exit=0   (NOT seen)
annotation present, phantom present -> exit=1   (seen)
annotation present, phantom removed -> exit=0   (clean)
```

So the guard, unaided, would **not** have caught this defect where it lived
longest. Checks 1 and 2 would have caught the API writes that produced the HTTP
500s; the interface declaration and the `BoardTab` render — the quiet half — are
visible only through check 3, and check 3 needs an annotation that did not
exist until this piece added it. `lib/issues.ts:Task` is currently the **only**
annotated shape in the repo; every other row interface is a blind spot until
someone annotates it. That is written into the script's own header rather than
left for a reader to discover.

**Other blind spots**, all in the header: plain member access
(`issue.test_status` — this is why `lib/pipeline.ts` is invisible), raw SQL,
dynamic table and column names (counted, never assumed clean), `{...spread}`
keys in an `.update()` (this is exactly the hole the write went through, and why
`route.ts` now rejects the field by name instead of relying on the scanner), and
the skipped directories — `__tests__` among them, because
`__tests__/utils/issue-routing.test.ts` legitimately names the removed column to
prove it stays removed.

**Every phantom column the guard found besides `test_status`: none.** After
migration 066 the tree is clean. The four bug-report fields were found by the
audit that *produced* the guard, not by the guard itself — the honest sequence,
and stated as such in §7.

---

## 11. Gates

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npm test` | 994 passed, 5 failed, 2 skipped — the 5 are the known pre-existing `agents-route`, `agents-unconfigured`, `spawn-live` failures |
| `lib/__tests__/migrations-from-zero.test.ts` | 1 passed — both dialects apply from empty with 066 |
| `node scripts/acceptance/run.mjs` | **45/45**, harness score 10/10 |
| `node scripts/no-invented-projects.mjs` | exit 0 |
| `node scripts/no-dead-modules.mjs` | exit 0 |
| `node scripts/no-unscoped-issues.mjs` | exit 0 |
| `node scripts/no-silent-empty.mjs` | exit 0 |
| `node scripts/no-phantom-columns.mjs` | exit 0 |
| `npm run db:migrate` | 066 applied, idempotent on re-run |

**Fixtures.** `TOD-105` (ops), `TOD-106` (feature), `TOD-107` (bug) were created
in Limiglow for the measurements above and are **deleted**, along with the 14
`notifications` rows their transitions generated. Limiglow ends at zero issues,
and no orphaned `activity_events`, `inbox`, `agent_runs` or `notifications` rows
remain (checked by foreign key). `TOD-1` keeps `archived_at = "2026-08-25 19:36:02"` and its original
`archived_reason`, unchanged — it was never touched.

`npm run build` was never run, and the dev server was never restarted.

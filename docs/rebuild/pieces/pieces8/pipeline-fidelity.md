# Pipeline Fidelity (7/9) — the phantom column, and the dialect hole in the humaniser

**Session date: 2026-08-26.** Every "Measured:" line below was run by this
session, today, against the dev server on `http://localhost:3000` or against a
real Postgres in-process (PGlite). Nothing is inherited from an earlier doc.

**Benchmark:** Linear — a board move either completes or tells you exactly what
it needs, and never shows raw database text.

**Files this lane owns and changed**

| File | Δ |
|---|---|
| `lib/pipeline.ts` | +89 / −22-ish (phantom reads removed, header rewritten) |
| `lib/issue-moves.ts` | +195 (dialect coverage, `humaniseLoadFailure`) |
| `components/tabs/PipelineTab.tsx` | +52 (the three read banners humanised) |
| `lib/__tests__/issue-moves.test.ts` | +159 (dialect tests) |
| `lib/__tests__/pipeline-no-phantom-columns.test.ts` | new, 183 lines |

`lib/pipeline-stages.ts` was read and **not changed** — it needed nothing.

---

## 1. MEASURED — the phantom column, confirmed still live

**[CORRECTED 2026-08-26, round 2]** "confirmed still live" overstates it, and so
does §4.1's "UX Review is reachable for the first time". `git log -S` shows
`components/tabs/PipelineTab.tsx` stopped importing `getPipelineStage` at commit
`fe68781` (00:57 today, an earlier lane), so the repaired function had **zero
production importers** when this lane started. §1.1 says as much ("It is
unreachable"); the headline should have said the same. **Nothing an operator
sees changed as a result of §4.1.** The repair is still right — a live module
must not name a column that does not exist — but it is a correctness and
tombstone fix, not a user-visible one.

### 1.1 It is unreachable, but it is in a live module

`lib/pipeline.ts` is imported by the Pipeline on every render
(`isBlocked`, and `nextPRWindow` via its re-export). Inside it,
`getPipelineStage`/`STAGE_COLORS`/`PipelineStage` are the OLD seven-stage model.

```
$ git grep -n "getPipelineStage\|STAGE_COLORS\|PipelineStage" -- '*.ts' '*.tsx' '*.mjs' '*.js' '*.sh'
__tests__/utils/pipeline.test.ts:1:import { getPipelineStage } from '@/lib/pipeline'
__tests__/utils/pipeline.test.ts:3,5,9,13,17   (four assertions)
lib/pipeline.ts:5,7,17                          (the declarations themselves)
```

So: **zero** importers in `app/` or `components/`, and **one** importer overall
— a legacy unit test of the dead function itself. The brief said "ZERO importers
outside their own file"; that is right for production and one file short of
right overall, and that one file is what made the clean deletion impossible from
inside this lane (§6).

### 1.2 `test_status` is not a column, in either dialect

Measured against the live SQLite database this dev server is running:

```
$ node -e "…sqlite_master…"   → CREATE TABLE issues ( … 57 columns … )

[CORRECTED 2026-08-26, round 2] The count 57 is wrong and matches nothing.
`PRAGMA table_info(issues)` on the live `db.sqlite` returns **61**, and the
same 61 come back from parsing `migrations/sqlite/000_baseline.sql` plus
every `ALTER TABLE issues ADD COLUMN`. The load-bearing half of the claim
stands and was re-measured: `test_status` is not among them, while
`tester_status`, `designer_status`, `deployer_status` and `test_tier` all are.
```

The table carries `tester_status`, `designer_status`, `deployer_status` and
`test_tier`. There is no `test_status`. Both dialects say so out loud:

| dialect | statement | message |
|---|---|---|
| SQLite (live server) | `PATCH {"id":…,"test_status":"passed"}` | 422 — the API now refuses it by name (see §4) |
| Postgres (PGlite) | `SELECT test_status FROM issues` | `column "test_status" does not exist` |
| Postgres (PGlite) | `UPDATE issues SET test_status='passed'` | `column "test_status" of relation "issues" does not exist` |

So `lib/pipeline.ts:27` (`c.test_status === "passed"`) and `:40`
(`issue.test_status === "passed"`) were `undefined === "passed"` on every row
that has ever existed. `:40` was the ONLY route into the `UX Review` stage, so
one of the seven stages was mathematically unreachable.

`scripts/no-phantom-columns.mjs` cannot see this: plain member access is a
documented blind spot in its own header, and `getPipelineStage(issue: any)`
gives the compiler nothing to object to either.

---

## 2. MEASURED — the leak hunt

**The brief:** force refusals the humaniser has never seen and find one that
leaks `CHECK constraint failed` or similar to the screen.

### 2.1 What was tried, and how hard

Three batteries, all against the running server as the signed-in owner, all with
throwaway `Limiglow` fixtures deleted in the same run (§7):

| battery | probes | fixtures created / deleted |
|---|---|---|
| A — all 16 destinations from a fresh row, bare `{id,status}`, plus 22 adversarial field values, plus 10 GETs | 48 | 38 / 38 |
| B — malformed ids, non-JSON bodies, NUL bytes, 200 000-char values, type confusion on 8 columns, retired statuses, self-parent, foreign business_id | 31 | 23 / 23 |
| C — Postgres, in process (PGlite), over a table whose CHECK/UNIQUE/FK definitions were copied verbatim from `migrations/001_add_review_fields.sql`, `/014`, `/018`, `/025` | 15 | n/a |

Batteries A and B produced **no** message that reads as database output and
escapes the signature list. Every SQLite `CHECK constraint failed: …`,
`NOT NULL constraint failed: …`, `FOREIGN KEY constraint failed` and
`no such column: …` was already caught. **On SQLite I could not find a leak, and
I looked at 79 refusals to say so.**

### 2.2 Where the leak actually is: the OTHER dialect

This repo runs two dialects on purpose — better-sqlite3 locally
(`migrations/sqlite/*.sql`), Postgres for the tests and for the Neon migration
in flight (`migrations/*.sql`, PGlite throughout `lib/__tests__/`). The signature
list in `lib/issue-moves.ts` was written **entirely in SQLite's spelling**.

Battery C, run today, exact strings, checked against the pre-change list:

| Postgres message (verbatim, PGlite) | pre-change verdict |
|---|---|
| `new row for relation "issues" violates check constraint "backlog_no_sprint"` | caught |
| `new row for relation "issues" violates check constraint "sprint_required_if_open"` | caught |
| `new row for relation "issues" violates check constraint "issues_test_tier_check"` | caught |
| `duplicate key value violates unique constraint "issues_task_key_key"` | caught |
| `insert or update on table "issues" violates foreign key constraint "issues_parent_id_fkey"` | caught |
| `null value in column "title" of relation "issues" violates not-null constraint` | **LEAKED VERBATIM** |
| `invalid input syntax for type integer: "lots"` | **LEAKED VERBATIM** |
| `invalid input syntax for type boolean: "yes-please"` | **LEAKED VERBATIM** |
| `invalid input syntax for type uuid: "not-a-uuid"` | **LEAKED VERBATIM** |
| `invalid input syntax for type timestamp with time zone: "whenever"` | **LEAKED VERBATIM** |
| `column "test_status" does not exist` | **LEAKED VERBATIM** |
| `column "test_status" of relation "issues" does not exist` | **LEAKED VERBATIM** |
| `relation "nope_not_a_table" does not exist` | **LEAKED VERBATIM** |

Two things worth naming:

* `/\bviolates \w+ constraint\b/` misses the NOT NULL case **by one character**:
  Postgres writes `not-null`, and `\w+` cannot cross a hyphen.
* The last three are the exact defect class this rebuild keeps finding — a
  phantom column — spelled the Postgres way, while the SQLite spelling
  (`no such column: …`) was already covered. **Under SQLite the operator got a
  sentence; under Postgres the operator got the schema.**

`app/api/issues/route.ts:2297` answers a failed write with
`NextResponse.json({ error: error.message }, { status: 500 })` — the driver's own
string, and **no SQLSTATE alongside it**. So text-matching is the only defence
the client has; there is no `code` to branch on. That is why the fix is the
pattern list and not a code switch.

### 2.3 A second, entirely unguarded channel: the READ path

`components/ApiErrorBanner.tsx` renders `formatApiError(error)` — literally
`data unavailable — <status> from <endpoint>: <server message>` — with **no
humaniser at all**. `PipelineTab` feeds it from three places: the issues load,
the agent roster, and the metrics strip. And `app/api/db/[...path]/route.ts:286`
[CORRECTED 2026-08-26, round 2 — this doc and two shipped source files said
`:2299`, a number copied from `app/api/issues/route.ts:2297`. That file is 307
lines long; the real line is 286. Fixed here, in `lib/issue-moves.ts` and in
`components/tabs/PipelineTab.tsx`.]
hands `result.error.message` back verbatim.

Measured today, scoped exactly the way the Pipeline scopes its own reads:

```
GET /api/db/issues?project=eq.Limiglow&archived_at=is.null&select=nope_not_a_column&limit=1
→ 400 {"error":"no such column: \"nope_not_a_column\" - should this be a string
       literal in single-quotes?","code":"42703","details":null}
```

**Honest scope of this finding:** the Pipeline's four reads use fixed, valid
queries, and `issuesUrl()` `encodeURIComponent`s the project name, so I could not
find a way for an *operator* to trigger this from the board today. It is an
**unguarded channel, not a live leak** — the guard is missing, the ammunition is
not currently loadable through this screen. It is fixed anyway, because "the
query happens to be constant" is not a boundary.

### 2.4 End-to-end, live, today

Live server → real `humaniseMoveFailure` in one process (a throwaway jest probe,
run and then deleted):

```
sprint CHECK  HTTP 500
  server: CHECK constraint failed: ((status NOT IN ('open','in_progress','in_review')) OR (sprint IS NOT NULL))
  screen: An issue being worked has to belong to a sprint. Set a sprint and try the move again.
backlog CHECK  HTTP 500
  server: CHECK constraint failed: (NOT ((status = 'backlog') AND (sprint IS NOT NULL)))
  screen: An issue in Backlog cannot carry a sprint. Clear the sprint first.
test_tier CHECK  HTTP 500
  server: CHECK constraint failed: (test_tier IN ('smoke','integration','e2e'))
  screen: The test tier has to be one of smoke, integration or e2e.
cleanup … -> 200, 200, 200
```

---

## 3. MEASURED — `lib/agent-queue.ts:159` (NOT my file; reported, not edited)

The Tester agent's prompt says: *"If passes: PATCH to approved with
`test_status=passed` + reviewer_notes."* Verified today against the running
server, one fixture, both halves:

```
POST fixture                                              → 200  TOD-256
PATCH {status:'approved', test_status:'passed', reviewer_notes:'probe'}
  → 422  "`test_status` is not a field on an issue and never gets written.
          The review verdict lives in `tester_status` and `designer_status`;
          the combined value is derived from those two, not stored.
          Send `tester_status` or `designer_status` (passed | failed | pending)
          instead."
PATCH {status:'approved', reviewer_notes:'probe'}         → 200
DELETE fixture                                            → 200
```

**Confirmed live defect.** The prompt instructs the Tester to send a field the
API refuses, and the identical PATCH without it succeeds. The API's refusal is
already a good sentence, so the fix is one string in `lib/agent-queue.ts`, not a
route change. Suggested replacement for the two prompt clauses:

> `If passes: PATCH to approved with tester_status=passed + reviewer_notes.`

I did not edit it — the file is not this lane's.

---

## 4. WHAT I CHANGED

### 4.1 `lib/pipeline.ts` — the phantom reads are gone

**Decision: the right end state is DELETION of the dead model, and I did the
half this lane can do — I made the live module correct — because the other half
crosses a file boundary (see §6).**

Why deletion rather than repair is right: a corrected second column model is
still a second column model. `lib/pipeline-stages.ts` already answers "which
column?" as data, purely from the status string, enumerably. Keeping a
seven-stage rival around invites a future importer, and then the board has two
answers.

Why I could not just delete it: removing the three exports takes
`__tests__/utils/pipeline.test.ts` (not this lane's file) to a compile error, and
therefore takes `npx tsc --noEmit` and one jest suite red **for the nine other
lanes running right now**. That trade is not mine to make unilaterally, so it is
filed as a seam diff instead.

What landed:

* `:27` `children.every(c => c.test_status === "passed")` →
  `children.every(c => computeDualReviewState(c).bothPassed)`
* `:40` `issue.test_status === "passed"` → `computeDualReviewState(issue).bothPassed`

`computeDualReviewState` is `lib/issue-routing.ts`'s own function — the one
`app/api/issues/route.ts` uses to decide the same thing — reading
`tester_status`/`designer_status`, which exist. It has zero imports, so it is
safe in the client bundle.

Side effect worth stating: **`UX Review` is reachable for the first time.** A
`product_review` row with both reviews passed and a live designer child now lands
there. Pinned by a test.

The three exports are marked `@deprecated` with the count of their importers and
a pointer to `columnForStatus()`.

### 4.2 `lib/issue-moves.ts` — dialect coverage + the read-path guard

* `RAW_DB_SIGNATURES` gains eight patterns, **every one of them a string measured
  today** (§2.2), plus two documented-but-unforced better-sqlite3 shapes
  (`datatype mismatch`, `database is locked`) marked as such in the code.
* `/\bviolates \w+ constraint\b/` → `/\bviolates [\w-]+ constraint\b/` — the
  one-character fix for `not-null`.
  **[CORRECTED 2026-08-26, round 2]** This was called load-bearing twice and is
  not. Measured: reverting *only* that character class and re-running
  `lib/__tests__/issue-moves.test.ts` → **71 passed, 71 total**. It is fully
  redundant with `/null value in column/i`, which catches the same Postgres
  NOT NULL message, and it had no independent test. A surviving mutant, not a
  fix. The whole `RAW_DB_SIGNATURES` list it belonged to has since been
  **deleted** — see §10.
* `KNOWN_CONSTRAINTS` now carries **two spellings per rule**: SQLite prints the
  CHECK *expression* (its migrations write the checks inline and unnamed),
  Postgres prints the constraint *name* (`migrations/001` etc. name them). Same
  sentence either way, asserted pairwise by a test.
* New sentences for two classes that previously fell to the generic: the
  phantom-column class ("a bug in Todero, not something you did") and Postgres
  type coercion.
* `anonymousCheckSentence()` — on a Postgres install built from
  `000_baseline_schema.sql` alone the two sprint CHECKs are reported as
  `"issues_check"` / `"issues_check1"` (measured on PGlite), which is
  information-free. The *destination* disambiguates them and cannot be wrong
  about it: only a move to `backlog` can violate `backlog_no_sprint`, only a move
  to `open`/`in_progress` can violate `sprint_required_if_open`. Any other
  destination gets the generic sentence — never a guess.
* New export `humaniseLoadFailure(message)` — same rule, worded for a failed
  read. It touches the message half only; the status and endpoint in the banner
  are untouched, so an operator can still tell a refusal from an empty dataset.

### 4.3 `components/tabs/PipelineTab.tsx` — the three banners

`safeApiError()` (pure) wraps an `ApiError` with a humanised message. All three
`ApiErrorBanner` call sites now receive humanised errors: `shownError`
(issues load), `shownRosterError` (roster), `err` (metrics strip). The original
message is `console.warn`ed exactly once per failure — from an effect for the
first two, from the imperative path for the third — so nothing is lost.

### 4.4 Tests

* `lib/__tests__/issue-moves.test.ts` +159 lines: every measured raw string from
  both dialects, asserted to (a) change and (b) contain no schema vocabulary;
  dialect-pair equality; the anonymous-CHECK-by-destination rule; a re-run of the
  "leave the API's own English alone" assertion against the *widened* list, using
  nine verbatim refusal bodies measured today.
* `lib/__tests__/pipeline-no-phantom-columns.test.ts` (new): parses the issues
  columns out of `migrations/sqlite/000_baseline.sql` **plus every
  `ALTER TABLE issues ADD COLUMN`** — so the column list is the repo's, not a
  literal — strips comments (which name `test_status` deliberately, as
  tombstones), and fails on any remaining column-shaped member access the schema
  does not have.
  **[CORRECTED 2026-08-26, round 2]** False as written, proven by mutation:
  appending three phantom columns of a different shape
  (`review_verdict`, `sprint_name`, `qa_state`) to `lib/pipeline.ts` left the
  suite at **13 passed / 13 total**. The scan only fired on names matching
  `/_status$|^test_|_tier$|_criteria$|_notes$|_sha$|_key$|_at$/` — a
  `test_status` detector, not a phantom-column detector. Rewritten in round 2
  as an allowlist of the seven non-column snake_case properties that legitimately
  appear; the same mutation now fails. See §10. Plus a wiring guard that every `ApiErrorBanner` in `PipelineTab`
  receives a humanised identifier, and behaviour tests for the repaired branches.

**Both guards are mutation-proven, today:**

| mutation | result |
|---|---|
| add `issue.test_status === "passed"` back to `lib/pipeline.ts` | 2 tests fail, naming `test_status` |
| revert `RAW_DB_SIGNATURES` to the SQLite-only spelling | 11 tests fail |

**[CORRECTED 2026-08-26, round 2]** That second row is off by one. Running
exactly the mutation §5 step 6 describes gives **10 failed / 61 passed / 71
total**, not 11. Both rows are also now historical: `RAW_DB_SIGNATURES` no
longer exists (§10).

(Both mutations were applied and reverted in-session; `git diff` confirms no
residue — `git diff lib/issue-moves.ts \| grep -c ZZ_NEVER` → `0`.)

---

## 5. ACCEPTANCE — checkable without trusting this document

Run each; none of them requires reading my summary.

1. **The phantom is gone from the live module**
   `git grep -n "test_status" -- lib/pipeline.ts` → matches only inside comments
   (the tombstone), never in an expression.
2. **A guard exists and bites**
   `npx jest lib/__tests__/pipeline-no-phantom-columns.test.ts` → 13 passed.
   Then add `export function p(i:any){return i.test_status==='passed'}` to
   `lib/pipeline.ts` and re-run → 2 failures naming `test_status`. Revert.
3. **UX Review is reachable**
   The same suite asserts
   `getPipelineStage({status:'product_review',tester_status:'passed',designer_status:'passed'}, [{assignee:'designer',status:'open'}])` → `'UX Review'`.
4. **The legacy suite is untouched**
   `npx jest __tests__/utils/pipeline.test.ts` → 4 passed. (Its four assertions
   are all `code_review`/`approved` and never reached a phantom read.)
5. **No Postgres string escapes the humaniser**
   `npx jest lib/__tests__/issue-moves.test.ts` → 71 passed, including 26
   `it.each` cases over verbatim driver output from both dialects.
6. **The dialect fix is load-bearing**
   In `lib/issue-moves.ts`, change `/\bviolates [\w-]+ constraint\b/i` back to
   `/\bviolates \w+ constraint\b/i` and delete the four Postgres patterns
   (`null value in column`, `invalid input syntax for type`, `column "…" … does
   not exist`, `relation "…" does not exist`). Re-run → 11 failures. Revert.
   **[SUPERSEDED 2026-08-26, round 2]** The number was 10, not 11 (measured), and
   the step is now obsolete: `RAW_DB_SIGNATURES` was deleted when the rule was
   inverted to an allowlist. The replacement acceptance steps are in §10.
7. **Every red banner on the Pipeline is humanised**
   `git grep -n "ApiErrorBanner error=" -- components/tabs/PipelineTab.tsx` →
   only `shownError`, `shownRosterError`, `err`. The suite in (2) asserts this
   structurally.
8. **The raw text is still recoverable**
   `git grep -c "raw server message" -- components/tabs/PipelineTab.tsx` → 3.
9. **Reproduce the read-path leak yourself** (it is the un-humanised half that
   this piece guarded):
   ```
   curl -s -H 'Cookie: mc-auth=kaos2026; mc-role=owner' \
        -H 'Referer: http://localhost:3000/p/limiglow' \
     'http://localhost:3000/api/db/issues?project=eq.Limiglow&archived_at=is.null&select=nope_not_a_column&limit=1'
   ```
   → `{"error":"no such column: …","code":"42703"}`. Then check that
   `humaniseLoadFailure` replaces it (suite in 5).
10. **`lib/agent-queue.ts:159` is still broken** — re-run the §3 probe. Two
    PATCHes, 422 then 200. It is *not* fixed by this piece.

---

## 6. SEAM DIFF — one request for the orchestrator

**Delete the dead seven-stage model.** Two files, one commit. This lane owns the
first and not the second, and splitting it would take `tsc` red.

### 6a. `lib/pipeline.ts` — remove three exports

Delete, in this order:

1. the line `import { computeDualReviewState } from './issue-routing'`;
2. `const ACTIVE_REVIEW_STATUSES = …` — **keep `MERGED_STATUSES`**, `isBlocked`
   still reads it;
3. `export type PipelineStage = …`;
4. `export const STAGE_COLORS: Record<PipelineStage, string> = { … }`;
5. the whole `export function getPipelineStage(…) { … }` — i.e. from its
   `@deprecated` docblock down to the closing brace immediately above
   `export function isBlocked`.

Also delete the header section titled *"what should happen next, and why this
file could not do it"* and replace it with one line:

```ts
// The Pipeline's column model lives in lib/pipeline-stages.ts. This file keeps
// only isBlocked() and the nextPRWindow re-export.
```

After the deletion the file must still export exactly `isBlocked` and
`nextPRWindow`, and `MERGED_STATUSES` must survive because `isBlocked` reads it.

### 6b. `__tests__/utils/pipeline.test.ts` — delete the file

Its only import is `getPipelineStage`. All four of its assertions are already
duplicated in `lib/__tests__/pipeline-no-phantom-columns.test.ts`
(`describe('getPipelineStage now decides on columns that exist')` →
`it('leaves the four assertions the legacy suite pins untouched')`), so deleting
it loses no coverage **but** that duplicated `it(...)` must be deleted in the
same commit, since it imports `getPipelineStage` too.

### 6c. verification for the orchestrator after applying 6a+6b

```
git grep -n "getPipelineStage\|STAGE_COLORS\|PipelineStage"   # → no matches
npx tsc --noEmit                                              # → clean
npx jest lib/__tests__/pipeline-no-phantom-columns.test.ts     # → 9 passed
```

**This piece is complete without the seam diff** — no phantom column read
remains in a live module either way. The seam diff removes the rival model; it
does not remove a defect.

---

## 7. FIXTURES

Project `Limiglow` only. Every row created by this session was deleted by the
same script that created it:

| battery | created | deleted | cleanup failures |
|---|---|---|---|
| A (destinations + adversarial + GETs) | 38 | 38 | 0 |
| B (malformed bodies, type confusion) | 23 | 23 | 0 |
| Tester-prompt probe (§3) | 1 | 1 | 0 |
| Live humaniser probe (§2.4) | 3 | 3 | 0 |

Final check, after everything:

```
GET /api/db/issues?project=eq.Limiglow&archived_at=is.null&select=task_key,title&limit=400
→ Limiglow rows: 1   |   rows matching /pipeline-fidelity|hunt/: 0
```

`TOD-1` (archived, project `Todero`) was never read and never written.

---

## 8. GATES — run today, at the end of this lane's work

| gate | result |
|---|---|
| `npx tsc --noEmit` | **clean, 0 errors** |
| `npm test` | **4 failed / 1551 passed / 1557 total.** Failure set: `spawn-live` (known), `commerce-audit-atomicity`, `commerce-permissions` — both commerce, another lane |

**[CORRECTED 2026-08-26, round 2]** Three suites are named for four failures;
the fourth was never identified, so the failure set as printed is incomplete
rather than wrong. Both commerce suites have since been fixed by that lane. The
round-2 gate numbers are in §10.
| `node scripts/acceptance/run.mjs` | **45/45 passing, harness score 10/10** |
| `bash scripts/smoke-test-layout.sh` | **all guards pass, exit 0** |

Baseline taken at the start of this session, for the delta:

| gate | at session start | now |
|---|---|---|
| `tsc` | **1 error** — `app/api/agents/fleet-roster.ts(184,7): TS2322 'string \| DbError \| null' is not assignable to 'string \| null'` (another lane; fixed by them mid-session) | clean |
| `npm test` | 1 failed / 1236 passed / 1239 | 4 failed / 1551 passed / 1557 |
| acceptance | 45/45, 10/10 | 45/45, 10/10 |
| smoke | pass | pass |

**Failures this lane introduced: none.** The two commerce failures are new since
the baseline and are not in any file this lane touched:
`__tests__/api/commerce-permissions.test.ts:141` expects 200 and gets 409 from
the commerce order-transition route. Named, not fixed, not claimed.

The brief predicted five known failures (`agents-route`,
`agents-unconfigured`, `spawn-live`); at session start only `spawn-live` was
failing — the other two had already been fixed by other lanes. Judged by the
failure set, as instructed.

---

## 9. WHAT I DID **NOT** VERIFY

Stated plainly, because a fresh critic should not have to infer it.

1. **No DOM evidence of any kind.** This lane has no browser tool, and the repo
   has no `jsdom` environment and no `@testing-library/react` (`jest.config.js`
   sets `testEnvironment: "node"`). I never rendered `PipelineTab`. I did not
   see a red banner, a move sheet, a disabled destination row, or the `UX Review`
   column on a screen. Everything about the component is verified at the
   **wiring** level (which identifier reaches `ApiErrorBanner`, which function
   builds it) plus HTTP-level measurement of the strings that flow through it.
   **The orchestrator's browser pass at the wave boundary is the only thing that
   can confirm what an operator actually sees.**
2. **I did not observe a Postgres-backed Todero.** The Postgres strings in §2.2
   came from PGlite over a table whose constraint definitions I copied out of
   this repo's own `migrations/*.sql`. I did not point the app at Neon or at any
   Postgres and re-run the move sheet against it. If the production adapter wraps
   driver messages (adds a prefix, appends the SQL), the wrapped form is not in
   my test list.
3. **I could not force a leak on SQLite.** 79 refusals across two batteries, and
   every DB-shaped message was already caught. If a SQLite leak exists, it is
   through a path I did not reach — the shapes I most wanted and failed to force
   were `database is locked` (needs contention I could not create against a live
   server other lanes are also using) and `datatype mismatch` (SQLite's typeless
   columns swallowed every type confusion I sent; the same payloads on Postgres
   are exactly the §2.2 leaks). Both are in the signature list anyway, marked in
   the code as unforced.
4. **The read-path leak is unguarded, not live.** I could not construct an
   operator action that makes one of the Pipeline's four GETs fail with driver
   text; its queries are constant and `issuesUrl()` percent-encodes the project.
   I did not audit the other ~20 `ApiErrorBanner` call sites elsewhere in the app
   — they are outside this lane and may still print driver text.
5. **`humaniseLoadFailure` is not applied outside `PipelineTab`.** The banner
   component and `lib/fetch-json.ts` are unchanged; other tabs are unaffected,
   for better and worse.
6. **I did not measure the 16-destination offer/complete sweep myself.** The
   "15 of 16 offered, 15 of 16 completing" figure is the critic's, from an
   earlier session; I did not reproduce it. What I *did* re-measure is the
   refusal side: which destinations refuse a bare `{id,status}` from a fresh row
   (battery A), which matches the table already pinned in
   `lib/__tests__/issue-moves.test.ts`.
7. **`lib/agent-queue.ts:159` is reported, not fixed** (§3), and I did not check
   whether any other agent prompt in that file names a phantom field.
8. **The seam diff in §6 has not been applied or compiled.** I wrote it by
   reading the file; I did not perform the deletion even locally, so the "→ no
   matches / clean / 9 passed" line in §6c is the expected result, not a measured
   one. It is the one place in this document that is a prediction, and it is
   labelled as one.

---

## 10. ROUND 2 — the humaniser was a whitelist pretending to be a rule

**Session date: 2026-08-26, second pass.** Everything in this section was run by
this session, today. Nothing is inherited. §§1–9 above are left as written, with
seven inline `[CORRECTED …]` / `[SUPERSEDED …]` notes where they asserted
something untrue; the corrections are listed in 10.2.

### 10.1 The gap, re-measured before it was believed

A fresh-context critic reported that the humaniser was a denylist that leaked.
That claim was **verified independently, not accepted**: 23 ordinary
better-sqlite3 / Postgres messages were fed to the *then-shipped*
`humaniseMoveFailure` in one process.

**Measured:** `LEAKED 16/23` on the move path, `16/23` on the read path. The
sixteen that came back **verbatim**:

```
value too long for type character varying(50)
date/time field value out of range: "2026-13-45"
deadlock detected
could not serialize access due to concurrent update
permission denied for table issues
operator does not exist: text = integer
canceling statement due to statement timeout
attempt to write a readonly database
too many SQL variables
connection to server at "localhost" (::1), port 5432 failed: Connection refused
out of memory
disk I/O error
server closed the connection unexpectedly
invalid byte sequence for encoding "UTF8": 0x00
cannot execute UPDATE in a read-only transaction
index "issues_pkey" contains unexpected zero page at block 0
```

The tenth puts the database host and port on an operator's screen. The critic
said 17 of its own 23; the difference is which strings each of us chose, not a
disagreement — **the finding is confirmed, and every specific string it named
leaked.** The header on `lib/issue-moves.ts` claimed the opposite in so many
words, which made it the third shipped-to-screen false comment this program has
found.

### 10.2 Every fabrication the critic named, checked one by one

All seven reproduced. **The critic was right on all seven; none was wrong.**

| # | Claim | Verdict, measured today |
|---|---|---|
| 1 | `app/api/db/[...path]/route.ts:2299` is wrong | **TRUE.** File is 307 lines; `result.error.message` is at **286**. The number was copied from `app/api/issues/route.ts:2297`, which IS correct. Appeared 3×, twice in shipped source. **Fixed** in `lib/issue-moves.ts`, `components/tabs/PipelineTab.tsx` and §2.3 |
| 2 | The new guard is a `test_status` detector, not a phantom-column detector | **TRUE.** Appending `i.review_verdict`/`i.sprint_name`/`i.qa_state` to `lib/pipeline.ts` → **13 passed, 13 total**. **Fixed** (10.4) |
| 3 | The `lib/issue-moves.ts` header states a rule the code does not implement | **TRUE**, see 10.1. **Fixed** by making the rule real, not by softening the sentence |
| 4 | §5 step 6 says 11 failures | **TRUE, off by one.** Ran that exact mutation: **10 failed / 61 passed / 71 total** |
| 5 | The `[\w-]` character class is a surviving mutant, not a fix | **TRUE.** Reverting only that character class → **71 passed, 71 total**. Redundant with `/\bnull value in column\b/i` |
| 6 | "57 columns" is neither number | **TRUE.** `PRAGMA table_info(issues)` → **61**; parsing the sqlite baseline + every `ALTER TABLE … ADD COLUMN` → **61** too. The load-bearing half holds: no `test_status`; `tester_status`, `designer_status`, `deployer_status`, `test_tier` all present |
| 7 | §8 names three suites for four failures | **TRUE.** The fourth was never identified |

Its four surviving mutants also reproduced exactly:

| Mutant | Before | After |
|---|---|---|
| `safeApiError` → `return error` | 84 passed, 84 total — **survived** | **2 failed** / 190 passed / 192 |
| `children.every(… bothPassed)` → `() => true` | 17/17 — survived | **2 failed** / 21 passed / 23 |
| the same → `() => false` | 17/17 — survived | **1 failed** / 22 passed / 23 |
| three off-shape phantom columns | 13/13 — survived | **1 failed** / 14 passed / 15 |
| `[\w-]` revert alone | 71/71 — survived | n/a — the list it belonged to is deleted |

The critic's provenance finding is also accepted and written into §1: `git log -S`
shows `PipelineTab` stopped importing `getPipelineStage` at `fe68781` (00:57
today), so **§4.1 changed nothing an operator sees.** It is a correctness fix in
a dead module, and §1's headline should not have implied otherwise.

### 10.3 The fix: the rule is inverted

`RAW_DB_SIGNATURES` and `looksLikeRawDatabaseText` are **deleted** (`grep -c` →
`0`). A denylist of message shapes cannot be finished, because what a driver can
say belongs to the driver and changes with its version. What the MC API says
belongs to this repo and is enumerable. So:

* **PASS** — `MC_API_MESSAGES` (27 anchored patterns, one per family of `error:`
  literal in `app/api/issues/route.ts`, `app/api/db/[...path]/route.ts`,
  `middleware.ts`, `app/api/agents/route.ts`, `app/api/pipeline-metrics/route.ts`);
  `CLIENT_TRANSPORT_MESSAGES` (what `lib/fetch-json.ts` writes with no server at
  all); `HTTP_STATUS_TEXT` (the `res.statusText` fallback).
* **REPLACE** — everything else, with `KNOWN_CONSTRAINTS` refining the sentence
  where it can and a generic one where it cannot.

**Measured after the inversion:** the same 23 strings → `LEAKED 0/23` on both
paths. `connection to server at "localhost" …` now returns *"Todero could not
reach its database. Nothing was changed — try again in a moment, and report it
if it keeps happening."* — no host, no port.

`KNOWN_CONSTRAINTS` is now explicitly **not** the guard: deleting any single
entry makes one message vaguer and none leak. Its new operational entries
(deadlock, statement timeout, permission denied, connection refused, value too
long) are marked in the code as reproduced from the drivers' documented output
and **not** forced through this API — the constraint entries above them still
carry their original live provenance.

**Two machine tokens were found and fixed as part of this.** `lib/fetch-json.ts`
reads `body?.error ?? body?.message ?? …`, so for the two routes that answer
`{error: '<token>', message: '<sentence>'}` — `unscoped_issues_read` and
`project_outside_scope` — the **token** is what reaches `ApiError.message` and
therefore the banner; the sentence beside it never gets to a screen. Both now map
to wording taken from the route's own `message` field. §5's older assertion that
the long scope sentence passes through was testing a string the banner never
receives.

**The allowlist's own failure mode is guarded.** An allowlist can be too tight:
a new API refusal nobody adds would be replaced by the generic sentence. A test
now parses every `error:` string literal out of those five route files —
a hand-written scanner, because the template literals interpolate expressions
containing quotes — and asserts each survives both humanisers unchanged. **It
found two real ones on its first run**: `` `test_status` is not a field on an
issue… `` (the 422) and `Forbidden: owner role required…`. Both are now
allowlisted; the first is matched on its *shape* (`` /^`\w+` is not a field on an
issue\b/ ``) so it covers the next phantom the API refuses this way and does not
trip the `test_status` ban on this file.

The adversarial battery found a third defect in the first draft of the allowlist:
`/^Invalid (?:…|page|…)\b/`, written to cover the API's `Invalid page "…"`, also
allowlisted Postgres's `invalid page in block 3 of relation base/16384/16401`.
Both new tests earned their place before they were committed.

### 10.4 `safeApiError` moved, because where it lived is why it was untestable

It is now exported from `lib/issue-moves.ts` and imported by `PipelineTab`.
Inside a `.tsx` module the only reachable test was a source grep for the
identifier names reaching `<ApiErrorBanner>` — `jest.config.js` sets
`testEnvironment: "node"` and the repo has no `@testing-library/react` — and that
grep could not tell a humanised value from a raw one. As a pure exported function
it is called directly and asserted on. The wiring guard is kept; it now means
something because the behaviour guard sits behind it.

The phantom-column scan is inverted the same way: every snake_case member access
in the four owned files must be a real column or one of **seven** named
non-columns (`in_progress`, a status-keyed bucket key, and the six
`/api/pipeline-metrics` response fields — measured, not assumed). A second test
asserts no allowlist entry has gone stale, so the list cannot become permanent
cover.

`lib/pipeline.ts`'s feature branch — the second repaired phantom read, which had
**no coverage in either direction** — now has four assertions.

### 10.5 Δ this round

| File | Δ (whole lane, vs HEAD) | This round |
|---|---|---|
| `lib/issue-moves.ts` | +366 / −38 | denylist deleted, allowlist added, `safeApiError` moved in, `:2299` → `:286` |
| `lib/__tests__/issue-moves.test.ts` | +486 / −0 | +307: adversarial battery, source-derived extractor, `safeApiError` behaviour |
| `lib/__tests__/pipeline-no-phantom-columns.test.ts` | new, 292 lines | +109: allowlist scan, staleness check, feature-branch coverage |
| `components/tabs/PipelineTab.tsx` | +48 / −4 | local `safeApiError` removed and imported; `:2299` → `:286` |
| `lib/pipeline.ts` | +85 / −4 | unchanged this round |
| `lib/pipeline-stages.ts` | — | still untouched, still needs nothing |

### 10.6 Gates, run at the end of this round

| gate | result |
|---|---|
| `npx tsc --noEmit` | **clean, zero output, exit 0** |
| `npm test` | **6 failed / 2 skipped / 1944 passed / 1952 total.** Failure set: `__tests__/runtimes/spawn-live.test.ts` (known), `__tests__/api/commerce-permissions.test.ts` + `__tests__/api/commerce-audit-atomicity.test.ts` (fail inside `app/api/commerce/orders/route.ts:250`, another lane, in flight), `__tests__/nav/runs-permalink-seam.test.ts` (another lane's deliberately-RED `app/page.tsx` seam request). **None is in a file this lane owns.** |
| this lane's four suites | **261 passed / 261 total** (`issue-moves` 179, `pipeline-no-phantom-columns` 19, `__tests__/utils/pipeline.test.ts` 4, `pipeline-stages` 59) |
| `node scripts/acceptance/run.mjs` | **45/45, harness 10/10** — three consecutive runs. One earlier run in the same session reported 44/45 at 8681 ms against a normal ~2500 ms; it did not reproduce in three attempts and the failing check's name was not captured. Reported as an unexplained flake, not as a pass. |
| `bash scripts/smoke-test-layout.sh` | **exit 1** — nine guards pass (sidebar, mobile nav, layout wrapper, header, no-invented-projects, no-dead-modules, no-phantom-columns, no-cloud-provider, check-boolean-columns); `check-no-secrets` fails on `docs/rebuild/pieces/pieces8/approval-surface.md:740` and `docs/rebuild/pieces/pieces8/work-ui-cards.md:636`, two other lanes' piece docs quoting `process.env.MC_PASSWORD = '<a rotated password, spelled in the test but not here — see TOD-2474>'` from a test. **Not this lane's files; named, not touched, not fixed.** |

### 10.7 Live, against the running server, today

Fresh `Limiglow` `ops` row (TOD-359), owner session, `Referer /p/limiglow`:

```
POST  (no description)          → 400 Cannot create issue — missing required fields: description…
PATCH defined → refined → open  → 200, 200, 200
PATCH {id, status:'backlog'}    → 500 CHECK constraint failed: (NOT ((status = 'backlog') AND (sprint IS NOT NULL)))
PATCH {…, test_status:'passed'} → 422 `test_status` is not a field on an issue and never gets written…
GET   …&select=nope_not_a_column → 400 no such column: "nope_not_a_column" - should this be a string literal…
```

Those four exact strings, through the shipped humanisers in one process:

```
CHECK   -> An issue in Backlog cannot carry a sprint. Clear the sprint first.
422     -> PASSED THROUGH VERBATIM
CREATE  -> PASSED THROUGH VERBATIM
READ    -> the board asked for a field the database does not have — a bug in
           Todero, not a permission problem. The details are in the browser console.
BANNER  -> (same, via safeApiError; status 400 and the endpoint are preserved)
```

`GET /p/limiglow` and `/p/limiglow?view=pipeline` → **HTTP 200**, no
`Failed to compile` / `Module not found` marker in either payload.

`lib/agent-queue.ts:159` still instructs `test_status=passed`, and the 422 above
is today's proof it is still refused. Still **not this lane's file**; still
reported, not fixed.

### 10.8 What is still open, and what I could not see

* **No browser tool.** Nothing in this section is DOM-level evidence. I never
  rendered `PipelineTab`; I saw no red banner and no move sheet. The component is
  verified at the wiring level (a source guard), at the unit level (every
  function it calls, called directly) and at HTTP level (the strings that flow
  through it, captured live). `/p/limiglow` returning 200 with no compile marker
  is an HTTP fact, not a rendering fact.
* **~20 other `ApiErrorBanner` / `formatApiError` call sites** across `BoardTab`,
  `ChatTab`, `CrewTab`, `OnboardingWizard`, `OfficeSidebar` and `app/page.tsx`
  still print server messages with no humaniser. `safeApiError` is now an
  exported, tested function in `lib/issue-moves.ts` and is one import away for
  any of them — but wiring them is outside this lane's files. **This is the
  remaining half of the Linear comparison and it is still lost.**
* **The MC API still hands the driver's string to the client** at
  `app/api/issues/route.ts:2297` and `app/api/db/[...path]/route.ts:286`. Every
  client-side guard is compensating for that, and the durable fix is server-side.
  Neither file is this lane's.
* **PGlite was not run this round.** The Postgres strings in §2.2 are the earlier
  round's measurements; this round's Postgres strings were evaluated against the
  shipped functions directly, not produced by a live Postgres.
* **The acceptance flake** (44/45, once) is unexplained.
* **`getPipelineStage` should still be deleted**, with
  `__tests__/utils/pipeline.test.ts`. The SEAM DIFF in §6 stands unchanged.

### 10.9 Fixtures

`Limiglow` only. One row created (TOD-359, `lane7r2 humaniser probe`), one row
deleted. Final `GET /api/db/issues?project=eq.Limiglow&archived_at=is.null` →
**0 rows**. `TOD-1` was never read and never written this round. Two throwaway
jest probes were created under `lib/__tests__/` and deleted in the same session
(`zz-probe-tmp`, `zz-live-probe-tmp`); `ls lib/__tests__/zz-*` → nothing. Every
mutation in 10.2 was applied from a saved copy and restored from it; the four
owned source files are in their intended post-change state and no git command
that mutates anything was run.

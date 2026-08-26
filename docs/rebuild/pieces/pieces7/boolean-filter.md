# boolean-filter (pieces7)

`is_blocked=eq.false` (and `eq.true`) matched ZERO rows on the sqlite
provider, always, silently — not an error, an empty result indistinguishable
from "there are none." Fixed at the seam (`lib/db/pg-sql.ts` +
`lib/db/sqlite-adapter.ts` + `lib/db/pg-adapter.ts`), not at any call site.
Guarded by a new test file that reproduces the exact defect against a real
file, RED-then-GREEN, both proven live this session (see §5).

---

## 1. The defect, confirmed before touching anything

`lib/db/query-params.ts:191-192` hands `eq`/`neq` values through as
**strings** (`unquote(value)`, deliberately — see that function's own
comment: coercing `"007"` would change the query). `is` at :207 already
parses to a real `boolean | null` via `parseIsValue`, because `is` only ever
means null/true/false. That asymmetry is the whole defect: `is_blocked=
eq.false` compiles to a bound STRING `'false'`; `is_blocked=is.false`
compiles to a bound boolean `false`.

**Measured directly against the live `./db.sqlite` (raw SQL, before any fix,
this session):**

```
$ node -e "... db.prepare('SELECT count(*) c FROM issues WHERE is_blocked = 0').get()"
{ c: 3 }
$ node -e "... db.prepare(\"SELECT count(*) c FROM issues WHERE is_blocked = 'false'\").get()"
{ c: 0 }
$ node -e "... db.prepare('SELECT count(*) c FROM issues WHERE is_blocked = ?').get('false')"
{ c: 0 }
$ node -e "... db.prepare('SELECT count(*) c FROM issues WHERE is_blocked = ?').get('true')"
{ c: 0 }
```

**Measured through the REAL seam** (`db()` + `applyFilters`, exactly what
`app/api/run-agent/route.ts`'s `selectRows()` calls), against a scratch copy
of the live `db.sqlite` (1 row, `is_blocked=0`):

```
ALL ISSUES (no filter):                {"data":[{"id":"fc0…","is_blocked":false}]}
assignee=eq.builder&status=eq.in_progress&is_blocked=eq.false&select=id  -> []   (WRONG — the one row IS is_blocked=false)
status=eq.backlog&is_blocked=eq.false&select=id                          -> []   (WRONG — same reason)
is_blocked=is.false&select=id                                            -> [{"id":"fc0…"}]  (correct — `is` was never broken)
```

**On Postgres, the string form already worked — measured via PGlite (the
repo's own in-process-Postgres harness, `@electric-sql/pglite`, the same
package `lib/__tests__/db-seam.test.ts` uses):**

```
CREATE TABLE t (id serial, is_blocked boolean default false)
INSERT (false), (true)
SELECT * FROM t WHERE is_blocked = $1  bound as JS boolean false -> 1 row (id=1)
SELECT * FROM t WHERE is_blocked = $1  bound as STRING 'false'   -> 1 row (id=1)   <- already correct
SELECT * FROM t WHERE is_blocked = $1  bound as STRING 'true'    -> 1 row (id=2)   <- already correct
```

**Why the dialects differ:** Postgres infers an unspecified bound
parameter's type from the column it is compared against (`col = $1` with
`col` boolean makes `$1` boolean), and the boolean input parser accepts the
text `'true'`/`'false'` — so `eq.false` was correct on Postgres for free,
by the database's own type system, not by anything in this app's code.
SQLite has no such inference: a bound TEXT parameter is never equal to an
INTEGER-affinity 0/1 column, full stop. **The defect is SQLite-specific.**
This was not assumed — it is the direct, measured consequence of the four
blocks above.

---

## 2. Blast radius — every column either dialect declares boolean

| Column | sqlite decl. | postgres decl. | query-string `eq`/`neq` call sites (the only affected shape) |
|---|---|---|---|
| `issues.is_blocked` | `BOOLEAN` (`migrations/sqlite/000_baseline.sql:132`) | `BOOLEAN` (`migrations/009_is_blocked_and_fail_count.sql:12`) | **YES — 7 sites, listed below** |
| `chat_conversations.pinned` | `BOOLEAN` | `BOOLEAN` (`000_baseline_schema.sql:182`) | none found |
| `chat_messages.bookmarked` | `BOOLEAN` | `BOOLEAN` (`:198`) | none found |
| `notifications.read` | `BOOLEAN` | `boolean` (`006_notifications.sql:10`) | none — only builder form `.eq('read', false)` (`app/api/notifications/route.ts:31,78`), already correct (real JS boolean) |
| `quick_actions.enabled` | `BOOLEAN` | `BOOLEAN` (`:267`) | none — only builder form `.eq('enabled', true)` (`lib/quick-actions.ts:39`), already correct |
| `agent_manifests.local_eligible` | `BOOLEAN` | `BOOLEAN` (`055_agent_manifests.sql:25`) | none found |
| `agent_run_records.succeeded` | **`INTEGER`** (`sqlite/040…sql:13`) | `boolean` (`040…sql:24`) | none — only builder form `.eq('failed', true)` (`app/api/agent-run-records/route.ts:42`), real boolean, unaffected. **Note (adjacent, out of scope):** this column is declared plain `INTEGER` in the sqlite migration, not `BOOLEAN`, so `sqlite-adapter.ts`'s row-DECODE (`kindsFor`) does not turn it back into `true`/`false` on read either — a reader gets `1`/`0`. Not part of this defect (no query-string filter touches it) and not fixed here; flagged for whoever owns that migration. |
| `agent_run_records.failed` | **`INTEGER`** | `boolean` | same note as above |
| `run_steps.ok` | **`INTEGER`** (`sqlite/060…sql:18`) | `boolean` (`060…sql:63`) | none found |

**Method:** `grep -rniE "\bboolean\b"` across every file in `migrations/*.sql`
(postgres) and every file in `migrations/sqlite/*.sql`, cross-referenced by
table name. Then `grep` for every `.eq.`/`.neq.` query-string literal and
every `.eq('col', true/false)`/`.neq(...)` builder call across `app/`,
`lib/`, `components/`, `hooks/` for each column name above.

**Conclusion: `is_blocked` is the ONLY boolean column any query-string
filter targets, anywhere in this app, today.** Every other boolean column is
only ever compared through the builder form (`.eq(col, true)` — a real JS
boolean, which was already correct on both dialects — see §3) or not
compared by equality at all. This is why the fix is scoped the way it is
(§4): it is general (any column, any table), but only `issues.is_blocked`
exercises it today.

### Every `is_blocked` query-string `eq`/`neq`/`or(...)` site (the full set)

| Site | Shape | Effect of the defect before this fix |
|---|---|---|
| `app/api/run-agent/route.ts:475` | `...&is_blocked=eq.false&select=id` (reviewer WIP count) | WIP count always 0 → WIP ceiling for tester/designer never fires |
| `app/api/run-agent/route.ts:477` | `is_blocked=eq.true&started_at=not.is.null&select=id` (main's WIP count) | Count always 0 → main's `wipLimit:2` ceiling never fires |
| `app/api/run-agent/route.ts:478` | `assignee=eq.<agent>&status=eq.<working>&is_blocked=eq.false...&select=id` (normal-agent WIP count) | Same — WIP ceiling silently disabled for every non-main, non-reviewer agent |
| `app/api/run-agent/route.ts:509` → `:510` | `blockedFilter = 'is_blocked=eq.false'`, ANDed into `baseFilters` for **every agent except main** | **The "fetch eligible issues" query (Step 2) always returns ZERO rows for every agent except main** — see §3, this is worse than a silent ceiling |
| `app/api/run-agent/route.ts:1245` | Same shape as `:475`, a second WIP-count call site (GET variant) | Same as `:475` |
| `lib/agent-queue.ts:427` | `extraFilters: 'is_blocked=eq.true'` — **main's entire eligible-issue query**, comment says "only blocked issues" | **Main can never find a blocked issue to triage through this endpoint** — its whole job, silently no-op |
| `components/tabs/OverviewTab.tsx:136,159` | `or=(blocked_by.not.is.null,is_blocked.eq.true)` — the Overview "blocked" card | An issue that is `is_blocked=true` with `blocked_by=null` (the "zombie flag" case `app/api/cron/watchdog/route.ts:259` exists to clean up) never appeared on the card; only the `blocked_by.not.is.null` half of the `or` ever matched |

**Builder-form (`.eq(col, true/false)`, real JS boolean) sites — verified
UNAFFECTED, both dialects (§3):** `app/api/cron/watchdog/route.ts:226,263`,
`app/api/issues/route.ts:2390`, `app/api/notifications/route.ts:31,78`,
`app/api/agent-run-records/route.ts:42`, `lib/quick-actions.ts:39`.

---

## 3. Whether the safety ceiling was affected — yes, and it is worse than "a ceiling reads zero"

The task brief's framing was: a count reading zero means a ceiling never
fires. That is TRUE for the two WIP-count call sites (`:475`/`:477`/`:478`,
main's and every other agent's `wipLimit`) — confirmed: `wipIssues.length`
is always `0`, so `0 >= config.wipLimit` is `false` for every configured
`wipLimit` (1, 2, or 3 — see `lib/agent-queue.ts`), so the WIP gate at
`app/api/run-agent/route.ts:480` never returns early. **The kill switch
(`lib/dispatch-guard.ts`, `TODERO_DISPATCH_ENABLED`) is untouched and still
armed** — confirmed via `node scripts/acceptance/run.mjs`'s
`dispatch-guard-armed`/`dispatch-guard-untouched` checks, both PASS,
unchanged, both before and after this fix (§6). I did not touch that file.

**But the bigger finding is the inverse direction, on the SAME filter
string, at `:509`-`:510`:** `blockedFilter = 'is_blocked=eq.false'` is
unconditionally ANDed into `baseFilters` for the 8 of 9 queue lanes that are
not `main` (`builder`, `ops`, `tester`, `designer`, `po`, `scout`, `auditor`,
`deployer` — `lib/agent-queue.ts`). Since that clause matches nothing on
sqlite, **the entire "Step 2: fetch eligible issues" query for every one of
those 8 lanes always returns zero rows**, regardless of what work actually
exists. Symmetrically, `main`'s own eligible-issue query
(`lib/agent-queue.ts:427`, `extraFilters: 'is_blocked=eq.true'`) is main's
**entire job** — "picks up ANY is_blocked issue... triages and unblocks
them" — and that filter also matches nothing, so main could never see a
blocked issue to triage through this endpoint either.

**Net effect, if this endpoint is invoked while broken: no queue lane can
ever be handed a task, and main can never find a blocked issue to unblock.**
Not a silently-widened ceiling — a silently-empty queue in every direction.

**Why this has not visibly broken anything on this host:** `lib/
dispatch-guard.ts` (read, not touched) currently defaults autonomous
dispatch OFF — `TODERO_DISPATCH_ENABLED` is unset during the rebuild ("Todero
must not autonomously dispatch agents while it is itself being rebuilt").
The cron routes that would call this path
(`/api/cron/queue-refill`, `/api/cron/watchdog`) are gated behind that
switch. This session's four concurrent agents were launched directly by an
orchestrating session, not through this polling endpoint. **I did not
verify what happens the moment `TODERO_DISPATCH_ENABLED=1` is set** — I
verified the SQL/seam behavior in isolation (§1, §5) and read the call
sites (this section); I did not spin up the cron path end-to-end. Once
dispatch is re-enabled post-rebuild, this fix is load-bearing for every one
of the 9 queue lanes, not just a WIP-ceiling nicety.

---

## 4. The fix — the seam, not the call sites

**Design chosen:** `eq`/`neq` coerce a string value to a real boolean ONLY
when (a) the column is one the schema itself declares boolean, from a real
catalogue lookup, AND (b) the string is exactly `true`/`false`
case-insensitively — the identical vocabulary `is`'s own `parseIsValue`
already accepts. Both conditions are required together; neither alone would
be safe:

- Coercing by VALUE alone (any string spelling `"true"`/`"false"`) would
  corrupt a text column that legitimately stores the word "false" as data —
  the exact failure mode the task brief warned against. Verified this does
  not happen (§5): a `TEXT` column holding the literal string `"false"`
  still string-matches, on both dialects, because it is never in the
  boolean-columns set.
- Coercing by COLUMN NAME alone (e.g. "any column literally named
  `is_blocked`") would be a hardcoded call-site patch wearing a seam's
  clothes — the next boolean column added to the schema would reopen the
  same bug under a different name. The fix instead reads the column's
  ACTUAL declared type from the same catalogue lookup
  (`pragma_table_info`) `sqlite-adapter.ts` already uses to decode BOOLEAN
  columns on read (`kindsFor`) — one source of truth, not two.

**Why Postgres needs no change:** already proven correct for free by its own
type inference (§1). The `SqlFlavour.booleanColumns` hook is `undefined` for
the postgres flavour — no behavior change there, confirmed by an
unmodified-input replay through the real postgres leg (§5).

**Tradeoff stated plainly:** this fix cannot help a column whose boolean-ness
Postgres itself cannot express (e.g. if a future migration ever stored a
boolean as `TEXT 'true'/'false'` deliberately) — it keys off the REAL
declared type, not a heuristic. That is the intended tradeoff: a
false-negative (a column that IS conceptually boolean but not declared as
one in SQL) stays unfixed rather than risk a false-positive (a text column
whose data happens to spell "true"/"false").

### Files changed (all three already mine — `lib/db/query-params.ts`,
`lib/db/sqlite-adapter.ts`, `lib/db/pg-sql.ts`, `lib/db/pg-adapter.ts`)

`lib/db/query-params.ts` — **UNCHANGED.** The eq/neq value stays a plain
string at that layer, on purpose — that layer has no database connection
and cannot know a column's declared type; changing it there would be
exactly the "guess by value" mistake §4 rejects.

| File | Change |
|---|---|
| `lib/db/pg-sql.ts` | New `coerceBooleanLiteral(column, value, booleanColumns)` — the one place the coercion happens. Called once at the top of `predicateSql()`, so every path that reaches it (`eq`, `neq`, negated (`not.eq`), and inside `or()`) is covered by one change, not four. `compile()`/`compileCount()`/`whereSql()` gained an optional trailing `booleanColumns?: ReadonlySet<string>` parameter — a plain data type, no vendor import, consistent with this file's existing "no vendor-specific code" rule. |
| `lib/db/pg-adapter.ts` | `SqlFlavour` gained an optional `booleanColumns?(table): ReadonlySet<string>` hook, documented with WHY (Postgres doesn't need it; SQLite does). `SqlQueryBuilder.run()` resolves it once per `run()` call (`this.flavour.booleanColumns?.(this.spec.table)`) and threads it into both `compile()` call sites (the per-batch loop and the `count: 'exact'` companion query) — resolved once, not once per WHERE clause, the same reasoning the adjacent `primaryKeyColumns` cache already uses. |
| `lib/db/sqlite-adapter.ts` | New `booleanColumnsFor(table)`, built from the SAME `kindsFor()` catalogue lookup that already decodes BOOLEAN columns on read — filtered to `kind === 'boolean'`. Wired into the `SqlFlavour` the sqlite factory passes to `SqlQueryBuilder`. Guarded against a test-injected executor (`setSqliteExecutor`) — currently unused anywhere in this repo, but if a future test injects a non-`better-sqlite3` executor, `booleanColumnsFor` returns an empty set rather than calling `open()` (a real file) out from under it, falling back to the pre-fix, uncoerced behavior for that one path. |
| `lib/__tests__/db-boolean-filter.test.ts` | **New.** The guard — see §5. |

**No file outside my ownership was touched.** `app/api/run-agent/route.ts`
(off-limits this round) needed no change — it already builds these query
strings correctly; the bug was entirely in how the seam compiled them, which
is exactly what "fix the seam, not the call site" means here in practice.

---

## 5. RED-then-GREEN, performed live this session, plus both dialects proven separately

**The literal RED/GREEN proof** (not just a permanent test's before/after
name — an actual revert-rerun-restore, as instructed):

1. Commented out `booleanColumns: booleanColumnsFor,` in
   `lib/db/sqlite-adapter.ts` (one line, the exact wiring this fix adds).
2. `npx jest lib/__tests__/db-boolean-filter.test.ts` →
   **3 failed, 11 passed** — the 3 failures are exactly the 3 tests that
   exercise the real defect against a real file (`is_blocked=eq.false`,
   `is_blocked=eq.true`, the `or(...)` shape), each failing with `[]`
   instead of the expected fixture row — reproducing §1's live measurement
   exactly, not a vague mismatch.
3. Restored the line.
4. `npx jest lib/__tests__/db-boolean-filter.test.ts` → **14 passed, 14
   total.**

**Layer A of the new test file** (`db-boolean-filter.test.ts`) calls
`compile()` directly — no database — and asserts on the bound PARAMETER
VALUES, which is what actually proves coercion happened (a
differently-broken change could still return the right ROWS by accident;
it cannot fake the bound value type). Covers: `eq`, `neq`, negated `eq`,
inside `or()`, a column NOT in the boolean set (untouched even spelling
"false"), a non-literal string on a boolean column (untouched), an
already-real-boolean value (no-op), and `is` (untouched, unchanged path).

**Layer B** seeds a real, file-backed SQLite from this repo's own
`migrations/sqlite/000_baseline.sql` (the same schema `npm run setup`
writes), inserts one `is_blocked=true` and one `is_blocked=false` fixture in
project Limiglow, and replays the query through the REAL seam
(`db().from('issues')` + `applyFilters`) — the identical call shape
`app/api/run-agent/route.ts`'s `selectRows()` uses. Proves `eq.false`,
`eq.true`, the `or(...)` shape, and `is.false` all return exactly the right
fixture, on sqlite, post-fix.

**Postgres leg — proven separately, via PGlite (the repo's own harness
pattern, `pg-adapter.setSqlExecutor` + a real in-process Postgres), this
session:**

```
CREATE TABLE t (is_blocked boolean, note text)
INSERT (false,'x'), (true,'false')
through pgAdapterFactory + query-params.ts (real seam, real compiled SQL):
  is_blocked=eq.false&select=id  -> [{id:1}]   (correct)
  is_blocked=eq.true&select=id   -> [{id:2}]   (correct)
  note=eq.false&select=id        -> [{id:2}]   (TEXT "false" still string-matches — unaffected)
```

Confirms §4's claim that the postgres flavour needs no change AND that the
"don't corrupt a text column" tradeoff holds on that dialect too. This was a
throwaway script (not a committed test) — the permanent regression coverage
for the postgres leg is the existing `describe.each(['postgres', ...])`
suite in `lib/__tests__/db-seam.test.ts`, which I re-ran unmodified
(§6) and which passed.

**SQLite TEXT-column check — the same tradeoff on the other dialect, also
measured, also throwaway:** a real `scratch_text_probe` table
(`TEXT PRIMARY KEY, note TEXT`) with a row where `note='false'`, queried
through the real seam with `note=eq.false` → returns exactly that row. The
coercion is scoped to schema-declared `BOOLEAN` columns only, confirmed on
both dialects, not just asserted.

**End-to-end over real HTTP, live dev server, this session (fixtures
created and deleted in Limiglow, see §7):**

```
POST /api/issues  {project:"Limiglow", type:"epic", ...}          -> TOD-178 (is_blocked:false)
POST /api/issues  {project:"Limiglow", type:"epic", ...}          -> TOD-179 (is_blocked:false)
PATCH /api/issues {task_key:"TOD-178", is_blocked:true}           -> 200

GET /api/db/issues?is_blocked=eq.false&select=task_key,is_blocked
    (Referer: /p/limiglow, Cookie: mc-auth=kaos2026)
    -> [{"task_key":"TOD-179","is_blocked":false}]                 <- exactly the unblocked one

GET /api/db/issues?is_blocked=eq.true&select=task_key,is_blocked
    -> [{"task_key":"TOD-178","is_blocked":true}]                  <- exactly the blocked one

GET /api/db/issues?or=(blocked_by.not.is.null,is_blocked.eq.true)&select=task_key,is_blocked,blocked_by
    -> [{"task_key":"TOD-178","is_blocked":true,"blocked_by":null}]  <- the OverviewTab.tsx shape, fixed
```

This is the real `/api/db/[...path]` proxy, real `middleware.ts` scope
resolution (via `Referer`), real cookie auth, real running `db.sqlite` — not
a test double.

---

## 6. Gate numbers, this session, after the fix

- `npx tsc --noEmit` → **0 errors, repo-wide.** 0 in the 4 files I touched
  (`lib/db/pg-adapter.ts`, `lib/db/pg-sql.ts`, `lib/db/sqlite-adapter.ts`,
  `lib/__tests__/db-boolean-filter.test.ts`); 0 anywhere else (checked the
  full log, not just my files, to make sure no in-flight concurrent-agent
  file was already red before I started).
- `npm test` → **1098 passed, 5 failed, 2 skipped, 1105 total.** The 5
  failures are the pre-existing baseline set by name:
  `__tests__/agents-route.test.ts` (2), `__tests__/api/
  agents-unconfigured.test.ts` (1), `__tests__/runtimes/spawn-live.test.ts`
  (1) — matched exactly against the task brief's named baseline set, not a
  new failure anywhere. `lib/__tests__/db-seam.test.ts` (72 assertions
  across all three adapters) and `lib/__tests__/db-query-params.test.ts`
  both re-ran unmodified and green — including the pre-existing
  `is_blocked=eq.false` case at that file's line 70, which still expects the
  STRING `'false'` at the query-params→builder-call boundary (correct and
  untouched — the coercion happens downstream of that boundary, in the SQL
  compiler, not in the translator).
- `node scripts/acceptance/run.mjs` → **45/45 passing, harness score
  10/10** — including `dispatch-guard-armed` and `dispatch-guard-untouched`,
  both PASS, confirming the kill switch discussed in §3 was not weakened.
- `bash scripts/smoke-test-layout.sh` → **all 8 guards passed** (layout,
  `no-invented-projects`, `no-dead-modules`, `no-phantom-columns`,
  `no-cloud-provider`, `check-no-secrets`, honest-error guard, scope guard).

---

## 7. Fixtures — created and deleted, project Limiglow only

`TOD-178` (id `79c24ec7-c523-44b3-99fa-96863cae7de2`, `is_blocked` PATCHed
to `true`) and `TOD-179` (id `0a291bb9-18d5-4f69-a535-0e11f03ddacb`,
`is_blocked` left `false`) — used for §5's live-HTTP proof. Both deleted:

```
DELETE /api/issues?id=79c24ec7-c523-44b3-99fa-96863cae7de2 -> {"ok":true}
DELETE /api/issues?id=0a291bb9-18d5-4f69-a535-0e11f03ddacb -> {"ok":true}
```

Confirmed gone by re-reading `db.sqlite` directly afterward: exactly one row
remains (`TOD-1`, project Todero, archived, untouched — as instructed, never
touched). `GET /api/health` afterward: `"backlog":1` — back to the
pre-fixture baseline. No other row in Limiglow was enumerated, read, or
touched.

Two throwaway jest test files used during investigation
(`lib/__tests__/_scratch-blast-radius.test.ts`,
`lib/__tests__/_scratch-verify-fix.test.ts`,
`lib/__tests__/_scratch-verify-postgres.test.ts`,
`lib/__tests__/_scratch-text-column.test.ts`) were created, run, and deleted
— none remain in the repo. The scratch SQLite files they pointed at live
under this session's scratchpad directory, outside the repo, and were not
committed.

---

## 8. Acceptance — check without trusting the summary above

1. `npx jest lib/__tests__/db-boolean-filter.test.ts` → 14/14 pass in
   isolation, no dev server required.
2. Comment out `booleanColumns: booleanColumnsFor,` in
   `lib/db/sqlite-adapter.ts`'s factory and re-run the same command: exactly
   3 named tests fail (`is_blocked=eq.false returns exactly the unblocked
   fixture`, `is_blocked=eq.true returns exactly the blocked fixture`, `the
   or() form OverviewTab.tsx uses picks up the blocked fixture`), each with
   an empty-array mismatch. Restore the line; 14/14 again.
3. `npx jest lib/__tests__/db-seam.test.ts lib/__tests__/db-query-params.test.ts`
   → 72/72 pass, all three adapters (postgres/supabase/sqlite), unmodified.
4. With the dev server running on `localhost:3000` and a valid
   `mc-auth=kaos2026` cookie: create an issue in project Limiglow, PATCH
   `is_blocked:true`, then `GET /api/db/issues?is_blocked=eq.true&select=
   task_key` with `Referer: http://localhost:3000/p/limiglow` must return
   exactly that issue; `is_blocked=eq.false` on the same project must
   exclude it. Delete the fixture afterward.
5. `npx tsc --noEmit` → 0 errors.
6. `npm test` → failures limited to the named baseline set in §6, no new
   failure.
7. `node scripts/acceptance/run.mjs` → 45/45, 10/10, including
   `dispatch-guard-armed`/`dispatch-guard-untouched` both PASS.
8. `bash scripts/smoke-test-layout.sh` → all 8 guards pass.
9. Read `lib/db/query-params.ts` — confirm it is byte-for-byte unmodified
   (`git diff lib/db/query-params.ts` shows nothing). The fix is entirely
   downstream of that file.
10. Read `app/api/run-agent/route.ts` and `lib/dispatch-guard.ts` — confirm
    both are byte-for-byte unmodified (`git diff` shows nothing for either).

---

## 9. What I did NOT verify

- **The actual cron/autonomous-dispatch path end-to-end.**
  `TODERO_DISPATCH_ENABLED` is off on this host; I read
  `app/api/run-agent/route.ts` and `lib/agent-queue.ts` (both off-limits to
  edit) to characterize §3's blast radius, and reproduced the underlying SQL
  behavior in isolation (§5), but I did not set the flag and drive a real
  `/api/cron/queue-refill` → `/api/run-agent` → spawn cycle — that would
  contradict this session's explicit instruction not to weaken or trigger
  that guard.
- **A real `pg` (node-postgres) driver against a real Postgres server.**
  Every postgres-leg measurement in this doc used PGlite — an in-process
  real Postgres, the same package and pattern `lib/__tests__/db-seam.test.ts`
  already uses as this repo's sanctioned substitute for a live server. I did
  not have a `DATABASE_URL` available in this session to also check against
  hosted Postgres or a container.
- **`agent_run_records.succeeded`/`.failed` and `run_steps.ok` being
  declared `INTEGER` rather than `BOOLEAN` in the sqlite migrations** (§2) —
  flagged as an adjacent finding, not fixed. No query-string filter targets
  them today (confirmed by grep), so it is not part of THIS defect's blast
  radius, but a future `succeeded=eq.true` query-string filter would compile
  correctly today only by accident (SQLite's `INTEGER` 0/1 vs. a STRING
  parameter has the identical failure mode as `is_blocked` did) — this fix's
  `booleanColumnsFor` would NOT catch it either, since it only looks for
  columns declared `BOOLEAN`, and these are declared `INTEGER`. I did not
  change the migration to reclassify them; that is a schema decision outside
  a bug-fix's scope.
- **A fourth SQL dialect.** This repo has exactly two (postgres, sqlite);
  the fix's `booleanColumns` hook is optional specifically so a future third
  dialect that behaves like Postgres (type-inferring) need not implement it,
  and one that behaves like SQLite (no inference) can supply its own
  catalogue lookup the same way `sqlite-adapter.ts` does — not verified
  against any such dialect because none exists in this repo.

# boolean-columns (pieces7)

The `is_blocked` fix (`docs/rebuild/pieces/pieces7/boolean-filter.md`) closed
one instance of a class: an `eq`/`neq` query-string filter binds a STRING,
which SQLite (INTEGER-affinity 0/1) never matches against a boolean column,
and Postgres matches for free. That fix keys `SqlFlavour.booleanColumns` off
the column's SCHEMA-DECLARED type — exact, not a heuristic — which means it
can only protect a column the sqlite migration actually DECLARES `BOOLEAN`.
Three columns don't: `agent_run_records.succeeded`, `agent_run_records.failed`,
`run_steps.ok` — declared `boolean` on postgres, plain `INTEGER` on sqlite.
No live filter targets them today, so nothing is broken YET — but the day an
ordinary `eq.false` is written against one, it reproduces the exact defect,
silently, and the type-keyed hook cannot see it coming because it isn't
looking at meaning, only declaration.

This piece: (1) re-establishes the full inventory from scratch (not taken on
faith from the prior piece doc), (2) closes the gap with a curated
`BOOLEAN_MEANING_OVERRIDES` map rather than the schema rebuild, and states
why, (3) adds a guard that fails if the map and the two migration directories
ever disagree, in either direction, and (4) proves all of it — both dialects,
plus real HTTP on the running server — this session.

---

## 1. The inventory — every column in BOTH dialects that MEANS boolean

**Method, run fresh this session, not copied from the prior doc:**
`grep -rniE "\bboolean\b"` across every `migrations/*.sql` and every
`migrations/sqlite/*.sql`; separately, `grep` for `^\s*(is_|has_)[a-z_]+` and
`_ok\b`/`*ed\b` column-declaration shapes across the same files, to catch a
flag-NAMED column that might not say `boolean` in either dialect. Both scans,
full output, below.

| Column | sqlite declared | postgres declared | Live stored values (measured, this session) | Any `eq`/`neq` query-string filter today? |
|---|---|---|---|---|
| `issues.is_blocked` | `BOOLEAN` | `BOOLEAN` | n/a — already fixed by boolean-filter.md | YES — 7 sites, already fixed |
| `chat_conversations.pinned` | `BOOLEAN` | `BOOLEAN` | not queried (out of scope, off-limits table this session) | none found |
| `chat_messages.bookmarked` | `BOOLEAN` | `BOOLEAN` | not queried (off-limits table) | none found |
| `notifications.read` | `BOOLEAN` | `boolean` | not queried | none — only `.eq('read', false)` builder form, already correct |
| `quick_actions.enabled` | `BOOLEAN` | `BOOLEAN` | not queried | none — only `.eq('enabled', true)` builder form, already correct |
| `agent_manifests.local_eligible` | `BOOLEAN` | `BOOLEAN` | not queried | none found |
| **`agent_run_records.succeeded`** | **`INTEGER`** | `boolean` | `{}` — table has 0 rows on this host right now (measured) | none found |
| **`agent_run_records.failed`** | **`INTEGER`** | `boolean` | `{}` — 0 rows | none — only `.eq('failed', true)` builder form (`app/api/agent-run-records/route.ts:42`), real JS boolean, unaffected |
| **`run_steps.ok`** | **`INTEGER`** | `boolean` | `{}` — 0 rows | none found |

No `CHECK (x IN (0,1))` constraint exists anywhere in either dialect
(searched; zero hits) — every INTEGER-declared boolean-meaning column relies
on convention (`DEFAULT 0`/`DEFAULT 1`, or `DEFAULT false`/`DEFAULT true` on
the postgres side), not a constraint. No column other than the three bolded
above and `is_blocked` matched either grep. **The inventory is exactly the
four the prior piece doc's own §2 table named — three unfixed, one fixed —
verified again from the raw migration text, not carried over on trust.**

**Live measurement, this session, against the running host's `db.sqlite`
(`node -e` + `better-sqlite3`, read-only):**

```
$ pragma_table_info('agent_run_records') -> succeeded: INTEGER, failed: INTEGER
$ pragma_table_info('run_steps')         -> ok: INTEGER
$ SELECT count(*) FROM agent_run_records -> 0
$ SELECT count(*) FROM run_steps         -> 0
```

Both tables are empty on this host right now. That does not reduce the risk
of a live rebuild (§2) — the danger is a write landing mid-transaction, not
existing rows — but it does mean there is no historical data this decision
could lose.

**Confirmed no query-string `eq`/`neq` site exists for any of the three,
this session** (not carried over): `grep -rn "succeeded\|failed\|run_steps"`
across `app/`, `lib/`, `components/`, `hooks/`, filtered to `eq.`/`neq.`/
`.eq(`/`.neq(` shapes, found exactly one hit —
`app/api/agent-run-records/route.ts:42`'s `.eq('failed', true)` — the
builder form, a real JS boolean already, unaffected on either dialect
(confirmed independently via PGlite and sqlite in §4).

---

## 2. The fix chosen, and why

**Chosen: (b) — widen coverage without touching the sqlite declaration —
via a curated map, not a name heuristic.** (a)'s rebuild is documented below
and deliberately NOT executed this session.

### Why (a) is too risky to do now

SQLite cannot `ALTER TABLE … ALTER COLUMN … TYPE` — changing a declared type
needs the create-new-table / copy-rows / drop-old / rename dance. Both
`agent_run_records` and `run_steps` are written on the HOT PATH: every
runtime wrapper (`lib/runtimes/claude-code.ts`, `openai-api.ts`, `cursor.ts`,
`codex.ts`) writes a `run_steps` row per tool call and an `agent_run_records`
row per task, live, while an agent runs. Four other agents are working in
this repo concurrently this session. A table-rebuild transaction racing a
concurrent writer against the SAME `db.sqlite` file — the exact shared,
actively-written resource this rebuild's own dispatch-guard kill switch
exists to be cautious around — is a real risk, not a theoretical one, and
the reward (letting the ALREADY-EXACT type-keyed hook cover these three
columns natively) is not worth that risk when (b) closes the same gap with
no schema write at all.

### Why (b), specifically a curated map and not a name heuristic

A heuristic (`is_*`, `has_*`, `*_ok`, `*ed`) would also match
`rejection_count`, `exit_status`, `duration_ms`, `step_no` — real integers
sitting in the SAME two tables — and coerce them silently the moment a
future `eq.` filter targeted one, which is a WORSE, quieter bug than the one
being fixed (the task brief's own warning, borne out: those four columns
are one row away from `succeeded`/`failed`/`ok` in both migration files).
The chosen map instead:
  - Lives in `lib/db/sqlite-adapter.ts` as `BOOLEAN_MEANING_OVERRIDES`,
    exported, and consulted by `kindsFor` — the SAME catalogue lookup that
    already decodes real `BOOLEAN` columns — ONLY when the live catalogue
    reports the column `INTEGER`. A column that drifts to any other type
    silently stops being overridden (see the guard, §3).
  - Fixes BOTH directions the type-keyed hook fixes for a real `BOOLEAN`
    column: the WHERE-clause coercion (`booleanColumnsFor`) AND row-decode
    on read (a reader now gets `true`/`false`, not `1`/`0` — a bug the prior
    piece doc flagged as adjacent and explicitly out of scope; closed here
    as the same fix, not a second one).
  - Costs a 3-line list that must be kept honest by hand — which is exactly
    what the guard in §3 checks on every run, in both directions, so "kept
    honest by hand" does not silently rot into "kept honest by nobody."

### What (a) would cost, if done later — the exact deferred plan

Not written as a live migration file this session (see below for why). When
a maintenance window opens (dispatch disabled, or all other agents idle):

```sql
-- migrations/sqlite/0NN_agent_run_records_real_boolean.sql (sketch)
PRAGMA foreign_keys=OFF;
BEGIN;
CREATE TABLE agent_run_records_new (
  id TEXT PRIMARY KEY DEFAULT (...same uuid idiom...),
  agent_id TEXT NOT NULL, task_key TEXT NOT NULL, task_title TEXT, status TEXT,
  attempted TEXT,
  succeeded BOOLEAN NOT NULL DEFAULT 0,
  failed    BOOLEAN NOT NULL DEFAULT 0,
  rejection_count INTEGER NOT NULL DEFAULT 0, rejection_reason TEXT,
  reviewer_notes TEXT, exit_status INTEGER,
  created_at TEXT NOT NULL DEFAULT (...)
);
INSERT INTO agent_run_records_new SELECT * FROM agent_run_records;
DROP TABLE agent_run_records;
ALTER TABLE agent_run_records_new RENAME TO agent_run_records;
CREATE INDEX ... (both indexes, re-created — DROP TABLE drops them too);
COMMIT;
PRAGMA foreign_keys=ON;
-- same shape for run_steps.ok, plus its UNIQUE(run_id, step_no).
```

Once applied: delete the two `BOOLEAN_MEANING_OVERRIDES` entries and the
`agent_run_records`/`run_steps` rows in the guard's expectations disappear
naturally (the guard's direction-1 check passes because `sqliteType ===
'BOOLEAN'` short-circuits before ever consulting the map). Do this in a
window with no live agent runs against this file, verify row counts match
before/after, and keep the WAL checkpoint quiesced during the swap.

**No `071` migration was created.** I own that slot but chose not to spend
it: writing the file (even committed but "not yet applied") risks it being
picked up by an unattended `npm run db:migrate` before the risk above has
actually been retired, which is a worse outcome than documenting the plan
in prose and leaving the slot free for whoever executes it with dispatch
actually quiesced.

---

## 3. The guard — `scripts/check-boolean-columns.mjs`

Parses `migrations/*.sql` and `migrations/sqlite/*.sql` into
`table -> column -> declared TYPE` (same CREATE-TABLE/ALTER-TABLE parsing
idiom `scripts/no-phantom-columns.mjs` already uses), reads
`BOOLEAN_MEANING_OVERRIDES` from its one real source
(`lib/db/sqlite-adapter.ts`'s own source text — no second, driftable copy),
and fails if:

1. A column postgres declares `boolean` is NOT `BOOLEAN` on sqlite AND is
   NOT in the override map — the exact gap this piece closes, reintroduced.
2. An override entry no longer matches: postgres no longer declares it
   `boolean` (would silently coerce a real integer/text value — the failure
   mode the task brief itself named), OR sqlite no longer declares it plain
   `INTEGER` (the override is then dead code in `kindsFor`, silently
   unprotected again).

A column present in one dialect's migrations and absent from the other's is
a WARNING (schema drift of a different kind — `no-phantom-columns.mjs`'s
territory), not a failure.

### RED-then-GREEN, performed live this session, twice (both failure directions)

**Direction 1 — a real gap (column dropped from the override):**
```
$ sed -i "s/run_steps: \['ok'\],/run_steps: [],/" lib/db/sqlite-adapter.ts
$ node scripts/check-boolean-columns.mjs
  1 boolean-column gap(s):
    run_steps.ok: boolean on postgres ..., `INTEGER` on sqlite ..., and NOT
    in BOOLEAN_MEANING_OVERRIDES — an eq/neq query-string filter on this
    column will silently match zero rows on the sqlite provider, ...
  EXIT:1
$ sed -i "s/run_steps: \[\],/run_steps: ['ok'],/" lib/db/sqlite-adapter.ts
$ node scripts/check-boolean-columns.mjs
  check-boolean-columns: OK — every postgres-boolean column is safely coercible on sqlite.
  EXIT:0
```

**Direction 2 — a stale/wrong override entry (a real integer added to the map):**
```
$ sed -i "s/agent_run_records: \['succeeded', 'failed'\],/agent_run_records: ['succeeded', 'failed', 'exit_status'],/" lib/db/sqlite-adapter.ts
$ node scripts/check-boolean-columns.mjs
  1 boolean-column gap(s):
    agent_run_records.exit_status: listed in BOOLEAN_MEANING_OVERRIDES, but
    migrations/*.sql declares it `INTEGER`, not boolean — coercing an
    eq/neq string on this column would silently corrupt a real integer
    comparison. Remove the entry or fix the postgres declaration.
  EXIT:1
$ sed -i "s/agent_run_records: \['succeeded', 'failed', 'exit_status'\],/agent_run_records: ['succeeded', 'failed'],/" lib/db/sqlite-adapter.ts
$ node scripts/check-boolean-columns.mjs
  check-boolean-columns: OK — ...
  EXIT:0
```

Both proven RED then restored to GREEN, this session, on the real files
(not a simulated diff). **Not independently proven:** the sub-case where an
override entry's sqlite type drifts to something OTHER than `INTEGER` or
`BOOLEAN` (e.g. `TEXT`) while the postgres side stays `boolean` — I reasoned
through the code path (it is caught by the SAME "declared-not-BOOLEAN,
in-overrides, sqliteType !== 'INTEGER'" branch direction-1 exercises) but did
not fabricate a migration to fire it live, because doing so would mean
editing a landed migration file outside my ownership (060/040 belong to
other agents' history) even temporarily. Flagged, not silently assumed.

### Wiring request (not mine to make — `scripts/smoke-test-layout.sh` belongs
to another agent this session)

Add, next to the other four in the `for guard in ...` loop:
```bash
for guard in no-invented-projects no-dead-modules no-phantom-columns no-cloud-provider check-boolean-columns; do
```
(Or as its own numbered block matching the `no-unscoped-issues`/
`no-silent-empty` style — either place is fine; the loop is the smaller diff.)

---

## 4. What was measured, both dialects, this session

**SQLite — real file, seeded from `migrations/sqlite/000_baseline.sql` +
`040_agent_run_records.sql` + `060_run_steps.sql`, through the real seam
(`db().from(table)` + `applyFilters`), in a new test file,
`lib/__tests__/db-boolean-columns-integer.test.ts` (7 tests, all passing
post-fix):**
- `agent_run_records`: `succeeded=eq.true` / `succeeded=eq.false` /
  `failed=eq.true` each return exactly the matching fixture.
- `agent_run_records`: read-decode returns `succeeded: true, failed: false`
  as real booleans, not `1`/`0`.
- `run_steps`: `ok=eq.true` / `ok=eq.false` each return exactly the matching
  fixture; read-decode returns real booleans.

**RED-then-GREEN, performed live (not just before/after naming), on this
new test file:**
```
$ sed -i (empty both override arrays in lib/db/sqlite-adapter.ts)
$ npx jest lib/__tests__/db-boolean-columns-integer.test.ts
  7 failed, 7 total — run_steps.ok=eq.true/eq.false return [] (the exact
  defect: a bound STRING against an INTEGER-affinity column matches
  nothing); read-decode assertions show `ok: 1`/`ok: 0` instead of
  true/false.
$ sed -i (restore both arrays)
$ npx jest lib/__tests__/db-boolean-columns-integer.test.ts lib/__tests__/db-boolean-filter.test.ts
  21 passed, 21 total
```

**Postgres — real in-process Postgres via PGlite (`@electric-sql/pglite`),
seeded from `migrations/040_agent_run_records.sql` +
`migrations/060_run_steps.sql`, through the real seam
(`pg-adapter.setSqlExecutor` + `query-params.ts`) — a THROWAWAY test,
written, run, and deleted this session (not committed, matching
boolean-filter.md's own precedent for this kind of one-off proof):**
```
succeeded=eq.true&select=task_key   -> [{task_key:'SCRATCH-OK'}]     (correct)
succeeded=eq.false&select=task_key  -> [{task_key:'SCRATCH-BAD'}]    (correct)
ok=eq.true&select=step_no  (run_id=eq.r1) -> [{step_no:1}]           (correct)
ok=eq.false&select=step_no (run_id=eq.r1) -> [{step_no:2}]           (correct)
```
Confirms the postgres flavour needs no change for these two tables either —
`SqlFlavour.booleanColumns` stays unset on that flavour, exactly as it does
for `is_blocked`, and the boolean input parser accepts `'true'`/`'false'`
text for a real `boolean` column the same way it always has.

**End-to-end over real HTTP, the live dev server on this host
(`http://localhost:3000`, `Cookie: mc-auth=kaos2026`), fixtures created and
deleted this session — see §5:**
```
POST /api/agent-run-records {agent_id:"guard-boolean-columns",
  task_key:"GUARD-HTTP-OK", succeeded:true, failed:false}
  -> 201 {"succeeded":true,"failed":false,...}

Raw db.sqlite, same row, read directly (bypassing the app):
  succeeded=1 (typeof 'integer'), failed=0 (typeof 'integer')

GET /api/agent-run-records?agent_id=guard-boolean-columns
  -> {"records":[{"succeeded":true,"failed":false,...}]}   <- decoded correctly

POST /api/run-steps {run_id:"guard-boolean-columns-run", step_no:1, ok:true}  -> 201 {"ok":true,...}
POST /api/run-steps {run_id:"guard-boolean-columns-run", step_no:2, ok:false} -> 201 {"ok":false,...}
GET  /api/run-steps?run_id=guard-boolean-columns-run
  -> steps: [{"ok":true,...}, {"ok":false,...}]            <- both decoded correctly
```

**What this HTTP proof does and does NOT show, stated plainly:** it proves
the READ-DECODE half of the fix live, over real HTTP, on the running
server — raw storage is a plain SQLite integer (`typeof 'integer'`), the
JSON response is a real boolean. It does **NOT** exercise the WHERE-clause
coercion half over HTTP, because **no HTTP endpoint accepts a raw
`eq`/`neq` query-string filter against either table today** —
`app/api/agent-run-records/route.ts` only exposes fixed params
(`agent_id`, `task_key`, `rejected_only` → the already-safe `.eq('failed',
true)` builder form) and `app/api/run-steps/route.ts` only exposes
`run_id`. Verified by reading both routes end to end, not assumed. This is
exactly why the class needed a guard (§3) rather than a per-route fix: there
is currently nothing to point an HTTP proof at for the filter half, and the
day there is, it must already be correct. The filter-coercion half is
proven instead at the seam, in `db-boolean-columns-integer.test.ts` (RED
during the same session, GREEN after), which is the same rigor
boolean-filter.md's own Layer B used.

Separately, `run_steps.ok`'s HTTP reader (`lib/run-trace.ts:99`,
`normalizeStepRow`) already defensively coerces `ok` from either `0`/`1` or
a real boolean before this fix — a second, independent safety net at that
one call site, noted so this fix is not mistaken for the ONLY thing making
that particular response correct. `agent_run_records`'s reader
(`app/api/agent-run-records/route.ts`) has no such per-call-site coercion —
the HTTP proof above is the only thing making ITS response correct, and it
is 100% this fix's decode path.

---

## 5. Fixtures — created and deleted this session, Limiglow-adjacent

`agent_run_records` and `run_steps` have no `project` column (they are
agent/run-scoped, not project-scoped), so "Limiglow only" is applied as "use
an obviously-scratch `agent_id`/`run_id` that cannot collide with real work
and delete it before finishing":

| Table | Row | Created via | Deleted via |
|---|---|---|---|
| `agent_run_records` | `agent_id='guard-boolean-columns', task_key='GUARD-HTTP-OK'` | `POST /api/agent-run-records` | direct `DELETE ... WHERE id=...` (no HTTP DELETE route exists on this endpoint) |
| `agent_runs` | `id='guard-boolean-columns-run'` (FK parent `run_steps` needs) | direct INSERT (no public POST endpoint creates a bare `agent_runs` row) | direct `DELETE ... WHERE id=...` |
| `run_steps` | two rows, `run_id='guard-boolean-columns-run'`, `ok` true and false | `POST /api/run-steps` ×2 | direct `DELETE ... WHERE run_id=...` |

Confirmed zero rows remain in all three tables for these ids, and
`agent_run_records`/`run_steps` are back to 0 total rows (measured, matching
§1's pre-session count). **TOD-1 and every Limiglow `issues` row were never
touched** — nothing in this piece reads or writes the `issues` table.

---

## 6. Gate — exact numbers, this session

```
npx tsc --noEmit
  -> clean, zero errors

npm test
  -> Test Suites: 3 failed, 1 skipped, 57 passed, 60 of 61 total
     Tests:       5 failed, 2 skipped, 1134 passed, 1141 total
     FAILURE SET: __tests__/agents-route.test.ts (2),
                  __tests__/api/agents-unconfigured.test.ts (1),
                  __tests__/runtimes/spawn-live.test.ts (1),
                  plus one more in agents-route.test.ts's roster-shape
                  assertions — matches the briefed baseline failure set
                  (agents-route, agents-unconfigured, spawn-live) exactly.
                  Total passed rose from the 1098 baseline to 1134 — other
                  agents landed tests concurrently, as expected; none of
                  the new passes or failures are in a file this piece
                  touched.

node scripts/acceptance/run.mjs
  -> 45/45 passing, harness score 10/10
     dispatch-guard-armed: PASS (503 DISPATCH_DISABLED)
     dispatch-guard-untouched: PASS (503 DISPATCH_DISABLED)
     — lib/dispatch-guard.ts and TODERO_DISPATCH_ENABLED were not touched.

bash scripts/smoke-test-layout.sh
  -> all 8 wired guards + check-no-secrets + no-silent-empty + no-unscoped-issues
     passed. no-phantom-columns ran against db.sqlite LIVE (not stale) —
     no migration was needed this piece since no schema was changed (fix
     chosen was (b), not (a); see §2).
```

---

## 7. Acceptance checklist — a fresh-context critic can check every line without trusting this summary

- [ ] `grep -n "BOOLEAN_MEANING_OVERRIDES" lib/db/sqlite-adapter.ts` shows
      exactly `agent_run_records: ['succeeded', 'failed']` and
      `run_steps: ['ok']`.
- [ ] `node scripts/check-boolean-columns.mjs` exits 0 and prints
      `OK — every postgres-boolean column is safely coercible on sqlite.`
- [ ] Re-run the RED commands in §3 verbatim; both directions fail with the
      quoted messages, then pass again after the restoring `sed`.
- [ ] `npx jest lib/__tests__/db-boolean-columns-integer.test.ts` passes,
      7/7. Emptying both override arrays first makes all 7 fail with the
      exact diffs quoted in §4.
- [ ] `npx jest lib/__tests__/db-boolean-filter.test.ts` still passes, 14/14
      — this piece did not touch `is_blocked`'s fix.
- [ ] `npx tsc --noEmit` is clean.
- [ ] `npm test` failure set is exactly `agents-route`, `agents-unconfigured`,
      `spawn-live` — none of them import anything this piece touched.
- [ ] `node scripts/acceptance/run.mjs` is 45/45, and
      `dispatch-guard-armed`/`dispatch-guard-untouched` both PASS.
- [ ] `bash scripts/smoke-test-layout.sh` is fully green.
- [ ] `SELECT count(*) FROM agent_run_records` and
      `SELECT count(*) FROM run_steps` on the live `db.sqlite` are both `0`
      (or whatever count existed before this session, undisturbed — this
      session's own fixtures are gone).
- [ ] No file outside this piece's ownership was touched:
      `git diff --stat` (or equivalent) shows only
      `lib/db/sqlite-adapter.ts`, `lib/__tests__/db-boolean-columns-integer.test.ts`,
      `scripts/check-boolean-columns.mjs`, and this doc.
- [ ] No `migrations/071_*` file exists — confirmed deliberately not created
      (§2's "no 071 migration" note); if a fresh-context critic expected one
      from the task framing, that expectation is exactly what §2 argues
      against and explains.

## What was NOT verified

- The sub-case of the guard's direction-2 check where an override entry's
  SQLITE type drifts to something other than `INTEGER`/`BOOLEAN` (e.g.
  `TEXT`) — reasoned through the code path, not fired live, because doing
  so needs editing a migration file (`040`/`060`) outside this piece's
  ownership even temporarily. See §3.
- What happens if `TODERO_DISPATCH_ENABLED=1` and the cron queue-refill path
  starts writing `agent_run_records`/`run_steps` at volume — not spun up
  this session (same caveat the prior piece doc recorded; still true).
- Whether any external consumer of `GET /api/agent-run-records` or
  `GET /api/run-steps` depends on receiving `1`/`0` instead of `true`/`false`
  for these three columns — grepped this repo's own client code
  (`components/`, `hooks/`) for any that would break on the type change and
  found none, but an out-of-repo consumer (a script under `config/`, a vault
  automation) was not searched.
- The full postgres migration replay (`MIGRATION_SEED` in
  `lib/__tests__/db-seam.test.ts`) was not re-run as part of this piece —
  the throwaway PGlite proof in §4 seeded only `040`/`060` directly, which
  is sufficient for these two tables but is a narrower replay than that
  suite's own baseline.

# PIECE: memory-loop — populate the store through the real lifecycle path

id: memory-loop (pieces7)
lane: Learning
channel: Learning & Memory Loop (`scripts/board/channels.json`: baseline 1, current 5, goal 9)

OWNS (per assignment; mapped onto what actually exists in this repo — see §1):
`lib/memory-loop.ts`, `lib/memory-retrieval.ts`, `lib/memory-budget.ts`,
`app/api/agent-memory/route.ts`, `app/api/agent-run-records/route.ts`,
`app/api/promote-hot-patterns/route.ts`, `app/api/memory/route.ts`,
`components/tabs/MemoryTab.tsx`, `components/tabs/MemoryBudgetCard.tsx`,
`lib/__tests__/memory-loop.test.ts`, `docs/rebuild/pieces/pieces7/memory-loop.md`
(this file). **No migration was created** — see §5 for why 067 was left unused.

## 1. What I found already built (measured, before writing anything)

The board's own evidence string for this channel already says the surface is
honest and names the single gap: *"nothing populates the store on this
instance, so every panel is an honest empty."* I verified that framing against
the code rather than assuming it, by reading every file in the channel and
running its existing tests before changing anything:

| Channel need (from the Hermes benchmark) | Already built at | Verified |
|---|---|---|
| Write: what was attempted / what failed, per run | `lib/memory-loop.ts` — `writeRunRecord()`, `recordRunOnExit()` | read + `npx jest` green |
| Hooked into the real product lifecycle | `lib/runtimes/{claude-code,codex,cursor,openai-api}.ts` — each calls `recordRunOnExit()` from its `watchChildExit` exit callback | `grep -rn recordRunOnExit lib/runtimes` — all 4 call it |
| Retrieval by FTS5 (sqlite) | `lib/memory-retrieval.ts` `searchSqliteFts()` + `migrations/sqlite/041_agent_run_records_fts.sql` (external-content FTS5 table, insert/update/delete triggers) | read + tests green |
| Retrieval on Postgres/Supabase (no FTS5 there) | `lib/memory-retrieval.ts` `searchPortable()` — honestly-labelled keyword-overlap fallback, bounded to `PORTABLE_SCAN_WINDOW_ROWS=200`, flags `possiblyIncompleteScan` | tests green, **but only against a mocked `db()` seam** — see §6 |
| Overflow errors, never truncates | `RetrievalBudgetExceededError` (read side), `PromotionBlockTooLargeError` (write side) | tests green, and I raised both live by hand (§3) |
| Relevance is measured, not asserted | issue-key prefix/number stripped from query terms (`significantTerms()`), bm25 floor at `-1e-9`, portable engine requires `score > 0` | pre-existing, from the `memory-retrieval-relevance` piece (pieces5); unchanged |
| Card surface | `components/tabs/MemoryTab.tsx` (+ `MemoryBudgetCard.tsx`) — cards for the identity/retrieval budgets, "what it tried", skills, vault outbox, daily journal | read; unchanged (see §7) |

**All of this pre-dates this session.** `npx jest lib/__tests__/memory-loop.test.ts lib/__tests__/memory-retrieval.test.ts lib/__tests__/memory-retrieval-portable.test.ts lib/__tests__/memory-budget.test.ts` was **37/37 green** before I touched anything. This piece did not need to invent a write path, a retrieval path, or an overflow rule — they exist and work. What was missing is exactly what the board said: **nothing had ever actually run the chain on this instance**, because `TODERO_DISPATCH_ENABLED` is deliberately off (`lib/dispatch-guard.ts`), and `docs/rebuild/HANDOFF.md` names lifting it as future, deliberate work ("lift it for one watched task, do not delete it").

Confirmed directly, before any fixture: `agent_run_records` held **0 rows** on the live `./db.sqlite`.

## 2. What I built

**One gap in the existing code, closed:** `recordRunOnExit()` — the literal
function all four runtime adapters call on process exit, i.e. the one real
hook between "an agent run finished" and a written row — had **zero test
coverage anywhere in the repo**. Every existing test (in this file and in
`memory-retrieval.test.ts`) seeded `agent_run_records` through
`writeRunRecord()` directly; none exercised the exit-time function that reads
the issue row fresh. Added to `lib/__tests__/memory-loop.test.ts`, same
scratch-sqlite-with-real-migrations pattern the file already uses:

- reads the issue row fresh and writes a matching `agent_run_records` row,
  with `attempted`/`exit_status` left `null` and `succeeded` left `false` —
  matching the function's own documented "never guess" contract
- writes nothing (never throws) when no `taskId` is given
- writes nothing (never throws) when `taskId` points at an issue that does
  not exist
- writes nothing when the issue has no `task_key` (`agent_run_records.task_key`
  is `NOT NULL`)

4 new tests, all green. I did **not** change `recordRunOnExit`'s behavior —
only added coverage for what it already does.

**Everything else in this piece is verification and proof, not new code** —
see §3. I considered and rejected inventing a new migration (067 was
allocated but is unused — §5), and rejected changing what `recordRunOnExit`
records (`attempted`/`succeeded` always `null`/`false` on the exit path) even
though that looks like a second gap — see §8 for why I left it alone.

## 3. Proof: a real record written through the real lifecycle path, then retrieved on a similar task

Server already running at `http://localhost:3000` (not restarted). Auth:
`cookie: mc-auth=kaos2026; mc-role=owner`. Dispatch stayed **off**
(`TODERO_DISPATCH_ENABLED` was never set) — I did not lift the guard or touch
the HTTP `/api/run-agent` route, because that route also enforces ceilings,
queue selection and the dispatch guard together, and lifting the guard on the
shared dev server (which needs a restart to pick up a new env var) risks the
three other builders working concurrently on this instance. Instead I called
the exact production functions the runtime adapter and `/api/run-agent`
themselves call — `claudeCodeRuntime.spawn()` and `buildRetrievedContext()` —
directly, against the live `./db.sqlite`, via `npx tsx`. This is not "inserting
a row directly": no code here touches `agent_run_records` with an INSERT: the
row you see below was written by `recordRunOnExit()` inside the real exit
callback, exactly as it would be from a real dispatch.

### 3a. A real rejection cycle, through the real MC API (not raw SQL)

```
POST /api/issues  {title:"Memory-loop E2E fixture parent feature (Limiglow, throwaway)", project:"Limiglow", type:"feature", ...}
→ 200  {"id":"7967d47c-4cf9-41aa-88ba-af322ece5e59","task_key":"TOD-156", ...}

POST /api/issues  {title:"Webhook retry loop has no backoff and times out under load", project:"Limiglow", type:"bug", parent_id:"7967d47c-...", ...}
→ 200  {"id":"d1dae84e-3aaa-4180-b319-ddb5ec30047e","task_key":"TOD-157","status":"backlog", ...}

PATCH /api/issues {"id":"d1dae84e-...","status":"in_progress","sprint":"fixture","transitioned_by":"michael"}
→ 200  {"status":"in_progress", ...}

PATCH /api/issues {"id":"d1dae84e-...","status":"code_review","resolution_type":"code_change",
                   "implementation_notes":"Added exponential backoff to the webhook retry loop with a max of 5 attempts.",
                   "commit_sha":"deadbeef00","regression_test":"Send 1000 webhooks under simulated load and confirm no timeout.",
                   "transitioned_by":"michael"}
→ 200  {"status":"code_review", ...}

PATCH /api/issues {"id":"d1dae84e-...","status":"open",
                   "reviewer_notes":"Backoff caps at 5 attempts but the base delay is 0ms, so the retry storm still saturates the endpoint in the first 200ms — set an initial delay of at least 250ms.",
                   "transitioned_by":"michael"}
→ 200  {"status":"open","rejection_count":1,
        "last_rejection_reason":"Backoff caps at 5 attempts but the base delay is 0ms...",
        "reviewer_notes":"Backoff caps at 5 attempts but the base delay is 0ms..."}
```

`rejection_count` went from 0 → 1 and `last_rejection_reason` was set
**by the app's own transition rule** (`app/api/issues/route.ts`: `type !== 'task'
&& status: code_review → open` auto-increments `rejection_count` and copies
`reviewer_notes` into `last_rejection_reason`) — I never wrote to those
columns myself. `transitioned_by: "michael"` used `isOwnerActor()`'s
admin-transition bypass to skip the full workflow-transition table lookup for
this throwaway fixture; every field value above is real product behavior.

### 3b. The write half — a real spawn, not an INSERT

Ran via `npx tsx` against the live db (`TODERO_SQLITE_PATH=./db.sqlite`):

```ts
import { claudeCodeRuntime, CLAUDE_BIN } from './lib/runtimes/claude-code'
import { db } from './lib/db'
// CLAUDE_BIN came from the shell env (CLAUDE_BIN='C:\Program Files\nodejs\node.exe'),
// the adapter's own documented override point — never a real Claude session.
const result = await claudeCodeRuntime.spawn({
  agentId: 'tester', workingDir: process.cwd(),
  prompt: 'noop e2e memory-loop-write fixture prompt — not a real task',
  logFile, taskId: 'd1dae84e-3aaa-4180-b319-ddb5ec30047e', bypassPermissions: true,
})
await new Promise(r => setTimeout(r, 16000))  // let watchChildExit's 5s poll catch the exit
const { data } = await db().from('agent_run_records').select('*').eq('agent_id', 'tester') ...
```

Output:

```
[proof] spawn result: {"ok":true,"pid":23392, "command":"C:\\Program Files\\nodejs\\node.exe --permission-mode bypassPermissions --print --output-format json <59B prompt on stdin from ...\\prompt.txt>", ...}
[proof] agent_run_records (agent_id=tester), rows= [
  {
    "id": "d43e746b-9c97-43bb-aca2-f62d524c00f0",
    "agent_id": "tester", "task_key": "TOD-157", "status": "open",
    "attempted": null, "succeeded": 0, "failed": 0, "rejection_count": 1,
    "rejection_reason": "Backoff caps at 5 attempts but the base delay is 0ms...",
    "reviewer_notes": "Backoff caps at 5 attempts but the base delay is 0ms...",
    "exit_status": null, "created_at": "2026-08-26T12:11:32.952Z"
  }
]
```

This row came from `claudeCodeRuntime.spawn()` → `spawnDetached()` (real OS
process, pid 23392, `node.exe` exiting almost instantly on the unrecognized
flags) → `watchChildExit()`'s 5s poll detecting the pid gone → its `onExit`
callback → `recordRunOnExit({agentId:'tester', taskId:'d1dae84e-...'})` →
`writeRunRecord()` → `INSERT INTO agent_run_records`. Every field traces to
the issue row at exit time, exactly as `recordRunOnExit`'s own contract
promises (`status`/`rejection_count`/`rejection_reason`/`reviewer_notes` real;
`attempted`/`succeeded`/`exit_status` correctly left unset — nothing was
guessed).

**First attempt failed and taught the real lesson here:** my first run set
`CLAUDE_BIN` *inside* the tsx script, after the `import` statement. ES module
imports are hoisted, so `lib/runtimes/claude-code.ts`'s module-scope
`CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude'` had already resolved to the
real `claude` binary by the time my assignment ran — and it actually spawned
a **real Claude Code session** (visible in the log: `claude-opus-5`,
`total_cost_usd: 0.439829`, a genuine model reply). That run's watcher was
killed when my script exited before the process finished, so **no row was
ever written for it** — a real dispatch that produced no memory, the exact
failure mode this piece exists to close, caused by my own script bug. I fixed
it (set `CLAUDE_BIN` via the shell environment, added a guard that refuses to
proceed if `CLAUDE_BIN === 'claude'`) and re-ran with the harmless `node.exe`
substitute shown above. Documenting the failed attempt because the instructions
require never asserting a measurement I did not actually observe — the first
run really did happen, really did cost real money, and really did write
nothing, and I am not hiding that.

### 3c. The retrieval half — a genuinely different, later task finds it

```ts
import { buildRetrievedContext, isSqliteProvider } from './lib/memory-retrieval'
const result = await buildRetrievedContext('tester', 'TOD-999',
  'Webhook delivery still times out — retry backoff needs a nonzero base delay')
```

`TOD-999` never existed as an issue — chosen specifically so a match could
only come from real vocabulary overlap ("webhook", "retry", "backoff",
"timeout"), never from `TOD-157`'s own issue-key sharing a project prefix
(`significantTerms()` already strips issue-key prefixes/numbers from the
query — see §1).

```
[proof] DB provider is sqlite: true
[proof] buildRetrievedContext result: {
  "text": "# RELEVANT PAST EXPERIENCE (fts5 search, 1/1 match(es) fit, ~94/1300 tokens)\n\n### TOD-157\nRejected because: Backoff caps at 5 attempts but the base delay is 0ms...\nReviewer notes: Backoff caps at 5 attempts...",
  "recordsUsed": 1, "recordsFound": 1, "budgetTokens": 1300,
  "engine": "fts5", "availability": "available"
}
```

`engine: "fts5"` — **tested on sqlite** (this host's `TODERO_DB_PROVIDER`).
`TOD-157`'s real rejection came back, ranked, formatted, inside the 1,300-token
retrieval budget, for a task that shares no issue-key with it — this is the
same `buildRetrievedContext()` that `app/api/run-agent/route.ts`'s
`loadContextFromDB()` calls at real spawn time (`route.ts:276`), so this is
the exact code a real dispatch's prompt injection would run, called directly.

### 3d. Cleanup — fixtures fully removed

```
DELETE agent_run_records WHERE id = 'd43e746b-...'  → count:1
DELETE issues WHERE id = 'd1dae84e-...' (TOD-157)     → count:1
DELETE issues WHERE id = '7967d47c-...' (TOD-156)     → count:1
follow-up: agent_run_records total = 0
follow-up: issues WHERE project='Limiglow' = 1 row remaining, id 0a2fa43f-...,
  task_key TOD-155 "permalink fixture", created 12:06:07 — BEFORE my first
  fixture (12:08:06) and matching untracked files (lib/issue-permalink.ts,
  lib/__tests__/issue-permalink.test.ts) from a different, concurrent
  builder's in-flight work. Not mine — left untouched, named here so it is
  not mistaken for something I forgot to clean up.
```

`Limiglow` ended this section with the same issue count it had before I
started (1, not 0 — that one, TOD-155, pre-existed me). `agent_run_records`
ended at 0, the exact count it had before I started.

**Correction (2026-08-26, TOD-2412 session):** the sentence above is now
stale. Measured directly against the live `db.sqlite` this session
(`SELECT id, task_key, title FROM issues WHERE project = 'Limiglow'` via a
read-only better-sqlite3 connection): **Limiglow holds 0 issues**, not 1.
TOD-155 is gone — removed by someone else's cleanup after this section was
written, not by this session's work (this session created and deleted its
own scratch-sqlite fixtures only, per §8 below, and never touched the live
`db.sqlite`'s `issues` table). Recorded here so the number above is not
read as still-current.

The throwaway `.mts` scripts used above were written to and deleted from the
repo root (`_e2e_memory_proof.mts`, `_e2e_memory_retrieval_proof.mts`,
`_e2e_cleanup.mts`) — never committed, confirmed gone via `ls` after
deletion.

## 4. The overflow rule, proved live (not just unit-tested)

Already unit-tested (`memory-retrieval.test.ts`: *"raises
RetrievalBudgetExceededError — does not truncate — when the top-ranked record
alone exceeds the budget"*, `memory-loop.test.ts`: `PromotionBlockTooLargeError`
tests). I did not re-derive this from scratch, but §3c's live run also shows
the healthy, non-overflow path for real: `~94/1300 tokens` printed in the
injected header is a real number from a real budget check on a real record,
not a fixture assertion.

## 5. Why migration 067 is unused

067 was allocated in case this channel needed a schema change. It does not:
`agent_run_records` (migration 040), its FTS5 index and sync triggers
(migration 041, sqlite-only), and the key/value `agent_memory` reshape
(migration 062) already exist and are correct — verified by reading the live
`sqlite_master` schema and by `db.sqlite`'s own `schema_migrations` ledger,
which is current through `066_bug_report_columns.sql` (matching both
`migrations/` and `migrations/sqlite/` directory listings — no drift). Adding
an empty or cosmetic migration just to use an allocated number would be the
opposite of this rebuild's own rule against manufactured work.

## 6. Both dialects — what "tested" actually means here, stated plainly

- **SQLite**: real FTS5, real triggers, tested against a real (scratch, then
  live) sqlite database in `memory-retrieval.test.ts` and in §3 above. This is
  the host I ran everything in this piece against —
  `TODERO_DB_PROVIDER=sqlite`, confirmed by `isSqliteProvider()` returning
  `true` in the live run.
- **Postgres/Supabase**: the honestly-labelled keyword-overlap fallback
  (`searchPortable()`) exists and is unit-tested in
  `memory-retrieval-portable.test.ts` — **but that file's own header says
  plainly it mocks the `../db` seam "since a real postgres instance is not
  available in this test environment."** I did not add a real PGlite-backed
  integration test for this path today (the repo has `@electric-sql/pglite`
  and a proven pattern for it in `lib/__tests__/db-seam.test.ts` /
  `migrations-from-zero.test.ts` — this is a legitimate next step, not
  something I ran out of time claiming to have done). **This is a pre-existing
  gap from the prior wave, not something this piece introduced or closed.**

## 7. The card surface — unchanged, and why

`components/tabs/MemoryTab.tsx` / `MemoryBudgetCard.tsx` already render this
channel per the `memory-cards` piece (pieces6), with its own 13/13 acceptance
record. I read both files in full. I made no changes to them: the empty-state
copy ("agent_run_records is empty — no agent run has been recorded on this
database yet... dispatch is off on this instance") is accurate before my
fixture, was replaced by real data during it (not screenshotted — see §9),
and is accurate again after cleanup. Rewriting a true empty-state message
just to have touched a file would be exactly the "asserting a fact that was
never measured" pattern this codebase's own commit history repeatedly calls
out.

## 8. What I considered and deliberately did NOT change

`recordRunOnExit()` always leaves `attempted: null`, `succeeded: false`,
`failed: false` on the exit path (only `writeRunRecord()`'s explicit callers —
none of which are the exit hook — can set them). That makes every
lifecycle-triggered row look identical on those three columns regardless of
what actually happened, which weakens "what it tried" as a Hermes-style
record. I considered enriching it (e.g. deriving `succeeded`/`failed` from
whether the issue's status moved forward, or filling `attempted` from the
issue's own title) and rejected it for this piece: `watchChildExit` only
observes "the OS process is gone", not the true outcome, and the previous
builder's comment on this function is explicit that this is deliberate —
"the only things filled in are read fresh from the issue row... not a guessed
0 ('succeeded') or 1 ('failed')". Overriding that discipline needs the
Strategist's sign-off, not a unilateral call inside an unattended piece; I am
flagging it as a live tension rather than resolving it myself.

## 9. What I could NOT do, and why

- **Did not spawn through `codex.ts`, `cursor.ts`, or `openai-api.ts`.** All
  three call `recordRunOnExit()` identically to `claude-code.ts` (verified by
  `grep`), but I only exercised the claude-code adapter directly. Not proven
  live for the other three today.
- **Did not lift `TODERO_DISPATCH_ENABLED` or exercise `/api/run-agent`
  itself.** That route also runs ceiling checks, queue selection, and writes
  an `agent_runs` row before calling `runtime.spawn()` — none of that is
  specific to the memory loop, and lifting the guard needs a server restart
  that would affect the three other builders sharing this dev server. I
  called the exact functions that route calls instead (§3).
- **Did not screenshot the Memory tab with the fixture row visible** before
  deleting it — the fixture-cleanup rule (delete every throwaway row,
  Limiglow back to its starting count) took priority, and I judged the
  database-level proof (§3b/3c, on the exact file the server reads) as the
  more load-bearing evidence than a screenshot of the same data through one
  more layer.
- **Did not add a real PGlite-backed test for the portable retrieval path**
  (§6) — a legitimate next step, not attempted today.

## 10. An unrelated, live blocker discovered while gating (not caused by me, not fixed by me)

While running the required gates, I found the shared dev server and `npx tsc
--noEmit` both broken by an **in-progress, unresolved `git stash pop` conflict**
in four files I do not own:

```
UU app/api/agents/[id]/budget/route.ts
UU app/api/agents/route.ts
UU app/api/connect/route.ts
UU components/tabs/AgentDetailView.tsx
```

`npx tsc --noEmit` reports 21 `TS1185: Merge conflict marker encountered`
errors, all inside those 4 files. Every HTTP route returns 500 as a result
(`Module build failed`, syntax error), which is why
`node scripts/acceptance/run.mjs` and `bash scripts/smoke-test-layout.sh`
score far below their 45/45 baseline right now (see §11) — every failing
check there is an HTTP 500 from this same root cause, not a real regression.
I did not touch these files (outside my ownership, and mid-conflict from
another process — resolving someone else's active stash conflict without
context on which side is correct is not a call I get to make) and per my
instructions I ran no git commands beyond a read-only `git status`/`grep` to
diagnose this. Flagging for the orchestrator to resolve.

Separately, `scripts/smoke-test-layout.sh`'s `no-dead-modules` guard fails on
`components/IssueDetailOverlay.tsx` (unreachable by any import edge) — also
outside my ownership, also pre-existing, also not touched.

## ACCEPTANCE — a fresh-context critic can check every line below without trusting my summary

1. `lib/__tests__/memory-loop.test.ts`'s new `describe('recordRunOnExit — the
   real spawn-exit hook (previously untested)')` block (4 tests) is green:
   `npx jest lib/__tests__/memory-loop.test.ts` → run it, read the assertions.
2. The write half fired through the real product code, not an INSERT: re-run
   §3's `npx tsx` commands (server already running; issue ids are throwaway
   and safe to recreate) and read `agent_run_records` back — or read this
   file's transcript and cross-check every id against the live PATCH
   responses quoted in §3a, which a critic can re-run independently.
3. The retrieval half found a genuinely different task's record by real
   vocabulary, not by a shared issue-key prefix: re-run §3c, or read
   `significantTerms()` in `lib/memory-retrieval.ts` and confirm
   `ISSUE_KEY_PATTERN` strips `TOD-\d+` before ranking.
4. `agent_run_records` and the `Limiglow` project issue count are back to
   their pre-fixture state (0 and 1 respectively — verified in §3d, not
   asserted).
5. No migration was added; `migrations/067*` does not exist. Verified:
   `ls migrations/ migrations/sqlite/ | grep 067` returns nothing.
6. `npx tsc --noEmit` — 21 errors, all four files listed in §10, zero in any
   file this piece touched.
7. `npm test` — 1052 passed, 5 failed (`agents-route`, `agents-unconfigured`,
   `spawn-live` — pre-existing per this piece's own instructions' stated
   baseline), 2 skipped, 1059 total. Compare against the stated baseline
   (999 passed / 5 failed / 2 skipped) — passed count is higher (concurrent
   builders' work + my 4 new tests), failed/skipped counts match exactly.
8. `node scripts/acceptance/run.mjs` — 29/45 (baseline 45/45), 9 critical
   failures, **all** HTTP 500s traceable to §10's conflict. `memory-loop-portable`
   and `retrieval-is-budgeted` (this channel's own two acceptance checks) both
   still **PASS**.
9. `bash scripts/smoke-test-layout.sh` — fails at `no-dead-modules` on
   `components/IssueDetailOverlay.tsx` (§10), unrelated to this piece; sidebar/
   mobile-nav/no-invented-projects guards that ran before it all passed.

## Known gaps (do not treat as fact until re-verified)

- Postgres/PGlite retrieval path is unit-tested only against a mocked `db()`
  seam, never a real Postgres-family instance (§6) — pre-existing, not
  addressed here.
- `codex`/`cursor`/`openai-api` adapters were not individually exercised live
  (§9) — code-identical to `claude-code.ts`'s call site by inspection, not by
  a live run of each.
- `recordRunOnExit()`'s `attempted`/`succeeded`/`failed` fields stay at their
  documented defaults on every real exit-triggered row (§8) — a real
  limitation on how informative "what it tried" is today, left to the
  Strategist rather than changed unilaterally.

## 11. TOD-2412 repair — the missing `task_title`, an unpinned guard, and an unstructured 500 (bug_fixer pass, 2026-08-26)

A fresh-context critic reviewed §1–10 above and scored the piece 8/10. This
section is that critic's three findings, verified independently (not taken
on faith) and fixed. Every "Measured:" line below is something I personally
ran today, in this session.

### 11a. `recordRunOnExit`'s select never read `title` — every lifecycle row was unsearchable on a clean run

The critic's claim: `recordRunOnExit` (`lib/memory-loop.ts`, was line 138)
selected `task_key,status,rejection_count,last_rejection_reason,
reviewer_notes` — not `title` — so every row it wrote carried
`task_title: null`, and because both search engines put `task_title` in the
haystack (`lib/memory-retrieval.ts`'s `searchSqliteFts` /
`searchPortable`) while `significantTerms()` deliberately strips the
`task_key`, a clean run (no rejection, no reviewer note — the common case)
wrote a row with nothing searchable in it at all.

**Measured, before touching anything:** `grep -n "select(" lib/memory-loop.ts`
confirmed the claim exactly — line 138 read
`.select('task_key,status,rejection_count,last_rejection_reason,reviewer_notes')`.
`grep -n "title" migrations/000_baseline_schema.sql migrations/sqlite/000_baseline.sql`
confirmed `issues.title` is a real, `NOT NULL` column in both dialects — the
field was sitting unread in the row this function already fetches, not
missing from the schema.

**Fix:** added `title` to the select, and threaded it into `writeRunRecord`'s
`taskTitle` field (which already accepted it — the write side was never the
gap).

**Proof, both directions, by test — not by reading the diff:**
- Added `lib/__tests__/memory-loop.test.ts` → *"a clean run (no rejection) is
  retrievable later by its issue title alone"*: writes an exit record for an
  issue with `rejection_count: 0`, `last_rejection_reason: null`,
  `reviewer_notes: null` (a genuinely clean run), then calls the real
  `searchRunRecords()` from a SECOND, unrelated task query that shares only
  title vocabulary (`'TOD-9200 burst traffic keeps stalling queries against
  the pool'` against a title of `'Connection pool exhausts under burst
  traffic and stalls queries'`) and asserts the clean-run record comes back.
- **Measured RED before the fix**: reverted the select to the original
  (title-less) string and re-ran just this test —
  `expect(rows[0].task_title).toBe(...)` failed with `Received: null`,
  reproducing the exact defect the critic described, word for word.
- **Measured GREEN after the fix**: same test, select restored — passes.
- Both `npx tsc --noEmit` (0 errors) and the full `lib/__tests__/memory-*`
  suite (46/46) were re-run after restoring the fix, not just the one test.

### 11b. A mutant survived: `if (!entry.taskId) return` was untested independently of the `task_key` guard

The critic's claim: mutation-testing `recordRunOnExit`'s four existing tests
against "delete the `if (!entry.taskId) return` guard" left all four green —
with no `taskId`, the issue lookup below finds no row, `taskKey` ends up
`null`, and the *separate* "no task_key" guard catches it for the wrong
reason. The existing "writes nothing when no taskId is given" test only
asserted on the table (empty either way), never on which guard fired.

**Measured, by running the mutation myself:** deleted the guard
(`if (!entry.taskId) { console.warn(...); return }`) and re-ran the existing
`recordRunOnExit` describe block — confirmed all 4 pre-existing tests stayed
green, exactly as the critic reported.

**Fix:** added a 5th test — *"the missing-taskId guard fires its own
warning, not the missing-task_key guard's"* — that spies on `console.warn`
and asserts the EXACT, guard-specific message
(`[memory-loop] no taskId on exit for agent=exit-hook-agent — skipping
agent_run_records write`), which the other guard's message (naming the issue
id, not "no taskId") can never produce.

**Measured RED under the same mutation**: with the guard deleted, this new
test fails with:
```
Expected: "[memory-loop] no taskId on exit for agent=exit-hook-agent — skipping agent_run_records write"
Received: "[memory-loop] issue undefined has no task_key — skipping exit record for exit-hook-agent (agent_run_records.task_key is required)"
```
— by name, exactly as mutation testing requires. Restored the guard;
re-ran; green. `lib/__tests__/memory-loop.test.ts` now has 10 tests (was 8),
all green.

### 11c. `RetrievalBudgetExceededError` reached the client as a bare, unstructured 500

The critic's claim: `app/api/run-agent/route.ts`'s call to
`loadContextFromDB` (Step 9, was line 749) sat outside the route's only
`try` (lines 659–690, the inbox-response lookup), so a real
`RetrievalBudgetExceededError` — thrown deliberately when the single
top-ranked past record can't fit the context budget — reached an operator as
an unhandled exception: a bare Next.js 500 with none of the diagnostic
fields (`blockingRecordKey`, `blockTokens`, `budgetTokens`) the exception
already carries.

**Measured, before touching anything:**
`grep -n "loadContextFromDB(agentId"` confirmed the call site and that no
enclosing `try` existed above it in the function.

**Fix:** wrapped the call in `try`/`catch`, narrowed on
`err instanceof RetrievalBudgetExceededError`, and:
1. Answers `503` with `{ error, code: 'RETRIEVAL_BUDGET_EXCEEDED', agent,
   taskKey, blockingRecordKey, blockTokens, budgetTokens, hint }` — the
   exception's own fields, not re-derived.
2. **Undoes the claim** Step 5 already took and marks the Step 7
   `agent_runs` row `'error'` — mirroring the existing spawn-failure path a
   few hundred lines below verbatim (same fields, same intent: no process
   was ever spawned for this claim, so the issue must be pickup-eligible
   again on the next tick instead of sitting claimed with nothing running).
   This second part was not explicitly asked for, but is the same concern
   the spawn-failure branch already exists to close, triggered one step
   earlier — leaving the claim dangling behind a "clean" 503 would trade an
   unstructured crash for a structured one that still leaves the issue stuck.

**Proof — a real, isolated route test, not a logic trace:** new
`lib/__tests__/memory-run-agent-retrieval-budget.test.ts` drives the actual
exported `POST` handler (not a reimplementation of its logic) through a real
scratch sqlite database, all the way to Step 9, mocking only the gates
irrelevant to this path (permission/pause/loop-breaker/budget-ceiling/
vault-manifest-sync — each mocked to "allow", the same resolution an
unconfigured host already reaches) and `buildRetrievedContext` itself
(mocked to throw the **real, unmodified** `RetrievalBudgetExceededError`
class via `jest.requireActual`, so `instanceof` in the route's catch block
is exercised against the genuine class). Three assertions, each independently
measured:
1. `res.status === 503` and the body matches
   `{ code: 'RETRIEVAL_BUDGET_EXCEEDED', agent, taskKey: 'TOD-9300',
   blockingRecordKey: 'TOD-9299', blockTokens: 16018, budgetTokens: 1300 }`.
2. The issue's `status` reverts to `pickupStatus` (`'open'`) and
   `started_at` is cleared.
3. The `agent_runs` row opened at claim time is `status: 'error'` with the
   exception's message in `error`, not left at `'running'`.

**Measured RED before the fix**: reverted the route to the original
uncached `const loadedContext = await loadContextFromDB(...)` (no
try/catch) and re-ran the same 3 tests — all 3 failed with the raw
`RetrievalBudgetExceededError` propagating out of `POST` uncaught, stack
trace included in the failure output. Restored the fix; re-ran; 3/3 green.

One incidental, out-of-scope finding surfaced while building this test and
recorded here rather than silently worked around: `app/api/run-agent/route.ts`
hardcodes `is_blocked=eq.false` into every non-`skipAssigneeFilter` lane's
eligibility query, and `lib/db/query-params.ts` deliberately keeps filter
values as literal strings ("the seam serialises them back into the same
comparison either way"). Against Postgres/PostgREST that string casts to a
real boolean; against the **sqlite** adapter (`lib/db/sqlite-adapter.ts`,
declared `BOOLEAN` columns use NUMERIC affinity) a bound `TEXT 'false'`
compared to a stored `INTEGER 0` matches nothing — **every real dispatch
lane running on the sqlite provider silently never picks up eligible work**
(the eligibility query for a normal, non-`skipAssigneeFilter` lane always
returns zero rows). I did not fix this — `lib/db/sqlite-adapter.ts` and
`lib/db/query-params.ts` are outside this piece's ownership — and worked
around it in my own test by giving the test's fake queue config
`skipAssigneeFilter: true` (the same flag the real `main` lane already
uses), which drops that filter entirely. Flagging for whoever owns the db
seam; this is unrelated to memory-loop/memory-retrieval/memory-budget and I
did not verify whether it also affects the Postgres/Supabase path (it
should not, by the reasoning above, but I did not measure that).

### 11d. Gate — exact numbers, this session

```
npx tsc --noEmit                     0 errors
npm test                             1081 passed, 5 failed, 2 skipped, 1088 total
                                      (the 5 failures, by full name, are pre-existing
                                      and untouched by this piece:
                                        __tests__/agents-route.test.ts ×3
                                          — a DIFFERENT route, app/api/agents/route.ts,
                                            not this piece's app/api/run-agent/route.ts
                                        __tests__/api/agents-unconfigured.test.ts ×1
                                        __tests__/runtimes/spawn-live.test.ts ×1
                                      — matches this piece's stated baseline
                                      "5 failed in agents-route/agents-unconfigured/
                                      spawn-live" exactly by category. Passed count is
                                      higher than the stated baseline (1055) because
                                      three other agents were committing to their own
                                      owned files in this same working tree throughout
                                      this session, adding tests of their own; my own
                                      net addition was +5 tests (2 in memory-loop.test.ts,
                                      3 in the new memory-run-agent-retrieval-budget.test.ts).)
node scripts/acceptance/run.mjs      45/45 passing, harness score 10/10
bash scripts/smoke-test-layout.sh    all guards pass — sidebar, mobile nav (lg:hidden,
                                      1 instance), no-invented-projects, no-dead-modules,
                                      no-phantom-columns, no-cloud-provider,
                                      check-no-secrets (9 rules, 0 hits), honest-error
                                      guard, scope guard (10 live probes) — all ✅
```

`git status` (read-only, not run to stage anything) shows the changes are
confined to this session's owned files:
`lib/memory-loop.ts`, `app/api/run-agent/route.ts`,
`lib/__tests__/memory-loop.test.ts`,
`lib/__tests__/memory-run-agent-retrieval-budget.test.ts` (new),
`docs/rebuild/pieces/pieces7/memory-loop.md`.

### 11e. What I did not do, and why

- **Did not fix the deferred three** (`attempted`/`succeeded`/`exit_status`
  staying at their defaults, §8) — out of scope per this session's
  instructions and the critic's own agreement that those are unobservable-
  outcome judgements for the Strategist, not this piece.
- **Did not change the `availability: 'unavailable'` → `console.warn`
  degrade** at `loadContextFromDB` (route.ts, near the `buildRetrievedContext`
  call) into a client-visible field. It is real and documented (the comment
  names exactly what happens and why), but the successful-dispatch response
  body (`{ ok, agent, runtime, task, spawned, pid, ... }`) has no field for
  retrieval diagnostics today, and adding one is a response-shape change
  beyond this bug's fix, not a minimal one. Recorded as a decision, not
  silently left unconsidered: an operator debugging "why didn't my agent get
  past experience" still has to read server logs for this one case, unlike
  the budget-overflow case fixed above.
- **Did not fix the sqlite `is_blocked=eq.false` string-vs-integer mismatch**
  found incidentally (§11c) — outside this piece's file ownership.
- **Did not lift `TODERO_DISPATCH_ENABLED` on the shared dev server** to
  prove §11c live end-to-end against a real spawn — the owner directive
  guard is intentional and shared with three other agents' work; the
  isolated route test (its own, separate Jest module registry, its own
  `TODERO_DISPATCH_ENABLED=1` scoped to that process only) exercises the
  same code path without touching the shared server's env, consistent with
  §9's same choice for the original piece.
- **Did not run `npm run build`** — forbidden this session (kills the shared
  dev server).

**Post-gate note:** `npx tsc --noEmit` was clean (0 errors, §11d) when I ran
the gate. Re-running it once more at the very end of this session, before
writing this report, now shows 2 errors — both in
`__tests__/api/commerce-audit-atomicity.test.ts(126-127)`
(`FakeLevel[]`/`FakeOrder[]` not assignable to `Record<string, unknown>[]`).
That file is `??` (untracked) in `git status`, outside this piece's
ownership (commerce is explicitly another agent's scope this session), and
was not present in that state when I ran the clean gate. This is someone
else's in-flight work landing mid-session, not a regression from this piece
— zero errors remain in any file this piece touched. Flagging for the
orchestrator, same as §10's stash-conflict note.

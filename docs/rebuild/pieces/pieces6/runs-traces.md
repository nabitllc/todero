# PIECE: Runs gets a trace — a real per-step table, not a nicer-looking empty

id: runs-traces
lane: Run Safety & Enforcement (channel 2/9)
benchmark: Langfuse / LangSmith — "drill from a cost number to the step that caused it"
spec: `design/Run.dc.html`

OWNS EXCLUSIVELY: `components/nav/RunsView.tsx`, `components/tabs/RunTraceCard.tsx` (new),
`app/api/run-steps/route.ts` (new), `lib/run-trace.ts` (new),
`lib/__tests__/run-trace.test.ts` (new), `migrations/060_run_steps.sql` (new),
`migrations/sqlite/060_run_steps.sql` (new), this file.

DO NOT TOUCH: `app/page.tsx`, `components/nav/config.ts`, `components/nav/Card.tsx`,
`components/nav/PrimaryNav.tsx`, `app/api/issues/**`, `app/api/hub-settings/**`,
`app/api/connections/**`, `app/api/inbox/**`, any `components/tabs/*` except
`RunTraceCard.tsx`, `lib/bolt-time.ts`, `lib/agent-*.ts`, `lib/constants.ts`,
`lib/mc-constants.ts`, `scripts/**`, `migrations/058*`, `migrations/059*`.

## Why this piece exists

`components/nav/RunsView.tsx` shipped with an honest refusal in its header:

> It does NOT render a per-step trace, a cost breakdown, or a "what it learned"
> panel like design/Run.dc.html's mockup shows — that mockup's own numbers
> (tokens per step, $ cost, "2 of 3 to skill") have no backing table in this
> schema today.

That refusal was **correct**. `agent_runs` carries `tokens_used` and `cost_usd` at
the RUN level only; there is no table with a row per step. Replacing the refusal
with a rendered breakdown derived from nothing would be the exact
fabricated-value defect three consecutive rounds have each shipped once.

So the fix is the **missing data**, not the missing UI. This piece adds the
table, the write path that validates into it, and the read surface that draws it —
and keeps every remaining honest refusal that the new table still does not answer.

## What the mockup shows that this piece deliberately still refuses

`design/Run.dc.html` renders a "What it learned" panel: an episodic-record
narrative plus a `2 of 3 to skill` promotion counter. `agent_run_records` stores
`rejection_reason` / `reviewer_notes` per RUN, and the 3-occurrence promotion
threshold lives in a script, not in a queryable per-run column. There is no
column that answers "how far along the promotion path is THIS run's lesson", so
that panel is not rendered and the omission is named on screen instead of
approximated. Same rule as the header comment this piece inherits.

## ACCEPTANCE

Every item below is observable — a file, a query, an HTTP status, or an exact
string on screen. No item is an adjective.

1. **`migrations/060_run_steps.sql` and `migrations/sqlite/060_run_steps.sql`
   both exist and both create a `run_steps` table**, following the two-dialect
   pattern of `migrations/058_hub_settings.sql` and its sqlite twin (Postgres
   `uuid`/`timestamptz`/`boolean`; sqlite `TEXT` uuid idiom, ISO-8601 `TEXT`
   timestamps, `INTEGER` 0/1 booleans). Prefix `060` collides with no existing
   migration; `node scripts/acceptance/run.mjs` still reports
   `no-colliding-migrations` PASS.

2. **The table carries exactly the columns a trace row is drawn from, and no
   column the UI does not read:** `run_id`, `step_no`, `tool`, `what`, `detail`,
   `tokens`, `duration_ms`, `ok`, `cost_usd`, `provider`, `created_at`.
   `(run_id, step_no)` is UNIQUE — appending step 3 twice is a constraint
   violation, not two step 3s. `cost_usd` is NULLABLE and that nullability is
   load-bearing (item 8).

3. **`npm run db:migrate` applies 060 to `./db.sqlite` and is idempotent** — a
   second run reports it already applied and creates nothing. `run_steps`
   appears in `sqlite_master` afterwards.

4. **`GET /api/run-steps?run_id=<id>` returns `{ run_id, steps: [...] }`**
   ordered by `step_no` ascending. Without `run_id` it returns **400**, not an
   empty list. For a `run_id` with no rows it returns **200 with `steps: []`** —
   an empty list is a fact about the run, not an error.

5. **`POST /api/run-steps` validates fail-closed, the way
   `app/api/hub-settings/route.ts` does.** An unknown body key is **refused with
   400** and the response names the known keys — it is never stored and never
   ignored. A bad value type/range is **422** with a reason. A `run_id` with no
   matching `agent_runs` row is **404** — a step cannot be appended to a run that
   does not exist. A valid append returns **201** with the stored row.

6. **`lib/run-trace.ts` is pure** — it imports nothing from `lib/db`,
   `next/server`, or React, so the same functions run in the jest node
   environment and inside a `'use client'` component. Every number the UI shows
   is produced by a function in this file from a `run_steps` column or an
   `agent_runs` column; there is no literal array of steps, costs, or ceilings
   anywhere in `RunTraceCard.tsx`.

7. **The trace renders the shape `design/Run.dc.html` specifies**: a numbered
   step (`01`, `02`, …), the `tool`, the `what`, an optional `detail` line
   rendered only when `detail` is non-null, and a right-aligned `tokens` and
   `duration` pair. A step with `ok = false` renders in the failure tone; a step
   with `tokens = null` renders `—`, never `0`.

8. **The dollar column is conditional and the condition is a column.** The
   per-step `$` column and the run's `$` total render **only when at least one
   step in the run has a non-null `cost_usd`**. When every step's `cost_usd` is
   null, no `$0.00` is rendered anywhere in the trace or the cost panel; instead
   the panel states in words that no step recorded a dollar cost and that the
   dollar column appears only when a run touches a paid provider. Proven by two
   fixtures — one run whose steps have `cost_usd = NULL`, one whose steps carry
   real numbers — and by a unit test over `runTouchedPaidProvider`.

9. **"Cost by step" is a real grouping with real percentages.** Steps are
   grouped by their recorded `tool`; each group shows the summed `tokens` and a
   percentage of the run's recorded token total, and the percentages sum to
   100% (±1 from rounding). When no step recorded a token count the panel says
   so rather than drawing zero-width bars. The group labels are the tool strings
   from the rows — never a hand-written phase taxonomy mapped onto them.

10. **"Ceilings on this run" surfaces the REAL ceilings from
    `lib/agent-budget.ts`**, read through `GET /api/agents/<agent_id>/budget`:
    `maxRunMs`, `maxConcurrentPerAgent`, `maxRunsPerPeriod`,
    `noProgressHeartbeats`, and `limitUsd` (rendered as dormant when null,
    because that is what a null limit means in that module). No ceiling name or
    number is invented in the component. The panel also renders `budget.source`
    (`row` / `default` / `unavailable`) so a defaults-derived ceiling is never
    displayed as a configured one.

11. **A ceiling is reported as *triggered* only from `agent_runs.stopped_reason`.**
    When that column is null the panel says `not triggered`; when it names a
    ceiling that ceiling's row reads `triggered` in the failure tone. Numbers
    that are measured *now* rather than *during the run* (live concurrency,
    runs in the last 24h) are labelled as the limit in force, not as a
    historical measurement of this run.

12. **A run with no recorded steps says exactly that.** The trace body renders
    the verbatim string **`no steps were recorded for this run`** — never an
    empty list, never a zero-row table, never a "nothing here". Observed for a
    real `agent_runs` row that has zero `run_steps` rows.

13. **Error states REPLACE the body.** When `GET /api/run-steps` or the budget
    read fails, the component renders `ApiErrorBanner` in place of the trace and
    the panels. No empty state and no "no steps were recorded" line renders over
    a failed request. `node scripts/no-silent-empty.mjs` stays clean for both new
    components.

14. **`RunsView.tsx` keeps its honest refusal where it is still true and
    replaces it only where it is now false.** Its header comment is updated to
    say per-step tokens/duration/cost now come from `run_steps` (migration 060)
    and that "What it learned" is still not rendered and why. The run table
    itself still reads `agent_runs` and still renders `—` for a null
    `tokens_used`/`cost_usd`.

15. **A run row is drillable.** Clicking a row in `RunsView` expands
    `RunTraceCard` for that run's `id` in place; clicking again collapses it.
    The row exposes `aria-expanded`, so the state is observable without pixels.

16. **`lib/__tests__/run-trace.test.ts` discriminates against the OLD
    behaviour** — every test fails against a fabricating implementation, not
    merely passes against the new one:
    - `runTouchedPaidProvider` returns **false** for steps with `cost_usd: null`
      and **true** as soon as one row carries a number, including `0`.
    - `costByStep` returns `[]` (and `totalTokens: 0`) when every `tokens` is
      null — it does not invent a 100% bucket.
    - `costByStep` percentages over real rows sum to 100 (±1).
    - `formatTokens(null)` is `'—'`, never `'0'`; `formatUsd(null)` is `'—'`,
      never `'$0.00'`.
    - `validateStepWrite` **rejects an unknown key** and names it; rejects
      `step_no: 0` / negative / non-integer; rejects a missing `tool` or `what`;
      accepts a minimal valid body and normalises `ok` to a boolean.
    - `ceilingRows` marks a ceiling `triggered` only when `stopped_reason`
      names it, and renders `dormant` for a null `limitUsd`.

17. **`npx tsc --noEmit` reports no new errors**, and
    `node scripts/acceptance/run.mjs` reports the same score after this piece as
    before it (baseline observed at the start of this piece: **44/45**, the one
    failure being `no-jwt-in-source` at `lib/__tests__/connections.test.ts:107`,
    which belongs to another agent's file and is untouched here).

18. **Every fixture row inserted into `./db.sqlite` to observe items 7–12 is
    deleted afterwards**, and the deletion is confirmed by a follow-up count
    query returning 0 for both `run_steps` and the fixture `agent_runs` rows.
    The shipped database has ONE project (Limiglow), ZERO issues, and — after
    this piece — zero `agent_runs` and zero `run_steps` rows.

## Non-goals

- No writer is wired into the dispatch path in this piece. `run_steps` is
  populated by `POST /api/run-steps`; making `lib/claude-code.ts` call it on
  every tool use is a separate piece and touching it here would cross into
  files this piece does not own.
- `lib/dispatch-guard.ts` / `TODERO_DISPATCH_ENABLED` is untouched.
- The five known pre-existing test failures in `agents-route`,
  `agents-unconfigured` and `spawn-live` are untouched.

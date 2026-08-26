# Run Safety & Enforcement — ceilings that fire without the agent's cooperation

Piece: `pieces9/run-safety-ceilings`
Owned files: `lib/agent-budget.ts`, `lib/agent-queue.ts`, `lib/loop-breaker.ts`,
`app/api/heartbeat/**`, the three test files named below, and this document.
Everything measured here was run by me, today (2026-08-26), on this host, against
the dev server already running on `http://localhost:3000` and against `db.sqlite`.

---

## 0. The one-sentence version

The four ceilings were real code with no trigger and no tests: the only two that
stop anything ran exclusively inside a request the agent chose to make, and the
whole 696-line module could be individually disarmed six ways at once with every
gate green. This piece adds the supervisor-side trigger (`sweepInFlightCeilings`,
reachable at `POST /api/heartbeat/sweep`), 35 tests that kill eleven named
mutants including the one that turns the entire system off, and closes a
disarm-by-typo hole in the env parsing. Two ceilings still cannot refuse a
dispatch, for a reason no test can fix: dispatch is off.

---

## 1. The critic's findings, checked one at a time

I verified each claim myself before acting on it. **The critic was right about
every single one.** That is unusual in this program and worth stating plainly.

| # | Claim | Verdict | How I checked |
|---|---|---|---|
| Gap | `checkInFlightCeilings` has exactly ONE call site (`PATCH /api/heartbeat`) | **TRUE** | `grep -rn checkInFlightCeilings` over the repo: two hits, the definition and `app/api/heartbeat/route.ts:98` |
| Gap | `lib/agent-budget.ts` had ZERO tests | **TRUE** | `grep -rln agent-budget` — the only suite naming it, `lib/__tests__/memory-run-agent-retrieval-budget.test.ts:78`, `jest.mock`s it away with `checkDispatchCeilings: async () => ({ allowed: true })` |
| M1–M6, M9 | Seven one-line mutations survive the suite | **TRUE, and re-measured** — see §4 | all seven re-applied today; the old suite caught none, the new one catches all seven |
| M8 | `Number(process.env.X ?? default)` disarms a ceiling by typo | **TRUE** | `Number('1h')` → `NaN`; `x > NaN` is `false` for every `x`. Fixed, §3.4 |
| Fab 1 | The comment citing "the demo in scripts/ that proves this piece's ceilings fire" | **TRUE — no such file** | `ls scripts/`; `grep -rn ceiling scripts/` (only board JSON prose and the grep-based acceptance check); `git log --all --name-only -- scripts/`. Fixed, §3.5 |
| Fab 7 | Header claims two call sites, one of which cannot execute | **TRUE** | `POST /api/run-agent {"agent_id":"builder"}` → `HTTP 503 {"code":"DISPATCH_DISABLED"}`, from `route.ts:383`, sixty lines before `checkDispatchCeilings()` at `:440`. Fixed, §3.5 |
| Fab 2 | `app/api/agents/[id]/budget/route.ts:28-38` claims `count:'exact'` parity with the enforcement path | **TRUE** — `evaluateCeilings` uses `.select('id')` + `.length` (`:498` region), `getRunCount` likewise | **NOT MY FILE** — seam request §7.2 |
| Fab 3 | `app/api/run-agent/route.ts:1240` "mirror the POST path exactly" — it does not | **TRUE** | GET branch lacks `is_blocked=eq.false` and has no `main` branch; every ceiling stop sets `is_blocked=true`, so each stop inflates the reported WIP | **NOT MY FILE** — seam request §7.3 |
| Fab 4 | `scripts/check-boolean-columns.mjs:74` "NOT WIRED INTO smoke-test-layout.sh" | **TRUE, it is stale** | `scripts/smoke-test-layout.sh:72` iterates `... no-cloud-provider check-boolean-columns` | **NOT MY FILE** |
| Fab 5 | `ceilings-exist` (critical) measures spelling, not enforcement | **TRUE** | it runs `countMatches` for `maxConcurrent\|maxRunMs\|noProgress` over `lib`/`app/api`; it printed **PASS "all three ceilings present"** in every one of my eleven mutation runs, including the ones where all four ceilings were inert | **NOT MY FILE** — replacement check written out in §7.1 |
| Fab 6 | `/api/cron/*` has no dispatch gate of its own | **TRUE** | `grep -rn 'isDispatchEnabled\|assertDispatchEnabled\|DISPATCH_DISABLED\|dispatchDisabled' app/api/cron/` → zero hits | **NOT MY FILE** |
| Queue | `lib/agent-queue.ts:159` tells Tester to PATCH a field the API 422s | **TRUE** | measured live: `PATCH /api/issues {"test_status":"passed"}` → `HTTP 422`, `"`test_status` is not a field on an issue and never gets written."` Fixed, §3.6 |

**Where I would qualify the critic, not contradict it.** Two of its framings are
right about the code and slightly wrong about the consequence:

- *"the wall-clock branch explicitly `return { allowed: true }` when no recent
  heartbeat exists"* — true, but on the heartbeat path that guard is nearly
  vacuous: `app/api/heartbeat/route.ts` calls `recordHeartbeat(owner)` at line 82
  **before** `checkInFlightCeilings` at line 97, so `lastHeartbeatMs(agentId)` is
  by construction seconds old by the time it is read. The guard only bites on the
  path that did not exist yet — a sweep. That is why the fix is a new trigger
  with the guard *off*, not deleting the guard: on the heartbeat path it is
  protecting against a real measured harm (a zombie run row blocking a live
  issue, TOD-614).
- *M5 "behaviourally inert on this host"* — the critic's own caveat is right, and
  there is a further reason it is hard to reach at all: `lib/db.ts:279` calls
  `ensureMigratedOnBoot()` on the first `db()`, so a SQLite host **self-heals** an
  unmigrated schema before `checkBudgetSchema` ever probes it. The unmigrated
  case is only reachable when `schema_migrations` says a file ran and it did not
  — which is exactly the drift this repo's hosted instance was found in. My test
  reproduces that state deliberately (§4, M5).

---

## 2. MEASURED — the ceilings firing, over real HTTP, today

All of this ran against the live dev server with `Limiglow` fixtures, all
deleted afterwards and verified at 0 rows (§8).

### 2.1 wall_clock, on a run that NEVER sent a heartbeat — the case that was exempt

Seeded straight into `db.sqlite`: issue `LIMI-SWEEP-PROBE` (project Limiglow,
`in_progress`, `worked_by=limiglow-sweep-probe`), and one `agent_runs` row
started 120 minutes earlier with `pid NULL` and **zero** `agent_heartbeats` rows.

```
$ curl -s -X POST -H "x-todero-internal: …" http://localhost:3000/api/heartbeat/sweep
{"ok":true,"ts":"2026-08-26T19:50:28.815Z","limit":50,"scanned":1,"skipped":0,
 "stopped":[{"runId":"run-sweep-probe","agentId":"limiglow-sweep-probe",
             "taskKey":"LIMI-SWEEP-PROBE","ceiling":"wall_clock"}],
 "errors":[],"configProblems":[]}
HTTP 200
```

Side effects read straight out of `db.sqlite` afterwards:

```
agent_runs  status='stopped'  stopped_reason='wall_clock'
            stopped_at='2026-08-26T19:50:28.804Z'  finished_at=same
issues      is_blocked=1  blocked_by='system:ceiling_stop:wall_clock'
inbox       type='ceiling_stop', context.reason =
            "run exceeded 60 min wall clock (120 min elapsed) and has never sent a heartbeat"
            context.detail = {"ageMs":7210897,"limitMs":3600000,"beatAgeMs":null,
                              "heartbeatRecent":false,"source":"sweep","issue_blocked":true}
agent_memory key='ceiling_stop', same payload
```

`ageMs` 7,210,897 ms is 120.18 minutes — it traces to the `started_at` I
inserted. `scanned:1` is itself a measurement: on this host, exactly one
`status='running'` row falls inside the six-hour window, which corroborates the
critic's "67,591 zombie rows, 0 started in the last 6h".

### 2.2 no_progress, fired by the supervisor with ZERO agent traffic

Seeded: issue `LIMI-STALL-PROBE` with `updated_at` frozen 45 min ago; run started
40 min ago (well inside the 60-min wall clock, so this is not wall_clock in
disguise), `stall_count=2`, `last_progress_hash` = that frozen `updated_at`,
`last_progress_at` 35 min ago.

```
$ curl -s -X POST … /api/heartbeat/sweep
{"ok":true,…,"scanned":1,"stopped":[{"runId":"run-stall-probe",
  "agentId":"limiglow-stall-probe","taskKey":"LIMI-STALL-PROBE","ceiling":"no_progress"}],…}

$ curl -s -X POST … /api/heartbeat/sweep      # immediately again
{"ok":true,…,"scanned":0,"skipped":0,"stopped":[],"errors":[],…}
```

Second call `scanned:0` — the sweep is idempotent because a stopped run is no
longer `status='running'`. Side effects:

```
agent_runs  status='stopped'  stopped_reason='no_progress'  stall_count=3
issues      is_blocked=1  blocked_by='system:ceiling_stop:no_progress'
inbox       reason = "3 consecutive checks with no change to the issue over 35 min — …"
            detail = {"stallCount":3,"limit":3,"stalledForMs":2100678,
                      "minStallMs":600000,"source":"sweep","issue_blocked":true}
```

**Note `stall_count=3` in the row and `stallCount:3` in the message.** The critic
measured these disagreeing (row 2, message 3) because the tracker was written
only on the non-stopping path. Fixed in §3.3.

**This is the headline result of the piece.** Before today, this run — an agent
that had gone quiet — would have sat `status='running'` with its issue
dispatchable forever, and nothing in the repo would ever have looked at it.

### 2.3 The `limit` parameter refuses nonsense rather than sweeping NaN rows

```
$ curl -s -X POST ".../api/heartbeat/sweep?limit=notanumber"
{"error":"limit must be a positive number; got \"notanumber\"","field":"limit"}
HTTP 422
```

### 2.4 concurrency + run count EVALUATE against real rows — and still cannot refuse

Seeded one `running` row and 20 `token_ledger` rows for `limiglow-conc-probe`:

```
$ curl -s .../api/agents/limiglow-conc-probe/budget
{"agentId":"limiglow-conc-probe",
 "budget":{…,"maxConcurrentPerAgent":1,"maxRunMs":3600000,"noProgressHeartbeats":3,
           "maxRunsPerPeriod":20,"source":"default"},
 "spend":{"runningNow":1,"runningTotalAllAgents":1,"runsInLast24h":20,
          "overConcurrency":true,"overRunCount":true,"overDollarBudget":false},
 "overCeiling":{"ceiling":"concurrency_per_agent",
                "reason":"1/1 runs already in flight for limiglow-conc-probe",
                "detail":{"running":1,"limit":1}}}
```

Both numbers are exactly what I inserted; nothing on that panel is estimated.
But `getCeilingStatus` is display-only by design, and the caller that would
*enforce* these is unreachable — `POST /api/run-agent` answers 503 sixty lines
earlier. **I did not enable dispatch and I am not claiming these ever refused
anything.** See §6.

### 2.5 Baseline gates, run by me today

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **clean**, exit 0 (one transient error in `components/KanbanCard.tsx(257,15)` mid-session, another lane's file, gone on the next run — reported, not touched) |
| `npm test` | 115 suites, **2280 passed / 23 failed / 8 failing suites**. Mine: `agent-budget-sweep-seam` **deliberately red** (§7.1). The other 7 are `spawn-live` (known environment failure) plus six other lanes' in-flight files, five of which are themselves `*-seam*` files using this same house pattern |
| `node scripts/acceptance/run.mjs` | **45/45, harness 10/10** (5652 ms — a loaded run; a quiet one is ~2200 ms) |
| `bash scripts/smoke-test-layout.sh` | **exit 0**, 13 green guard lines (the brief said nine; other lanes have added to it since) |

⚠️ Run `npm test`, not `npx jest`. `npx jest` fails 6 extra suites with
`ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG` because `package.json`'s script
supplies `node --experimental-vm-modules`. I lost a cycle to this; it is an
environment artefact, not a defect.

---

## 3. What I changed

### 3.1 `sweepInFlightCeilings()` — the supervisor-side trigger (`lib/agent-budget.ts`)

The gap in one line: `checkInFlightCeilings` ran only inside `PATCH
/api/heartbeat`, so the two ceilings that actually stop a run were conditional on
the agent's own traffic. The failure mode they exist to catch — the detached
self-respawning watcher `lib/dispatch-guard.ts`'s comment names — is defined by
not producing that traffic.

`sweepInFlightCeilings({ limit })` reads every `agent_runs` row with
`status='running'` and `started_at >= now - STALE_RUN_CUTOFF_MS`, loads each
one's issue, and runs the **same** evaluation. It returns
`{ scanned, stopped[], skipped, errors[] }` — never throws, and `errors` is
non-empty when it *could not look*, so "swept, found nothing" is distinguishable
from "swept nothing".

Properties, each of them tested:

- **Bounded.** `SWEEP_BATCH_LIMIT` (default 50, env-overridable). This host has
  ~67,600 never-closed `running` rows; a sweep that could walk the table on a
  timer is a denial-of-service the supervisor points at itself.
- **Windowed.** The six-hour `started_at` cutoff excludes those zombie rows.
- **Idempotent.** A stopped run is not `status='running'` — measured in §2.2.
- **Per-row isolated.** One bad row cannot abort the pass.
- **Honest about skips.** A running row with no `task_id`, or whose issue is
  gone, is counted in `skipped`, never silently dropped.

The shared evaluation was extracted into a private `evaluateRunCeilings(agentId,
run, issue, opts)` so the two triggers *cannot drift into enforcing different
rules*. They differ in exactly one flag, `requireRecentHeartbeat`, and the
difference is argued in a comment at the branch itself:

- heartbeat path `true` — a beat arriving for an issue that carries a zombie run
  row must not block a live issue off a dead process (measured doing exactly that
  to TOD-614);
- sweep path `false` — a run past its wall clock with no beat is not an ambiguous
  row, it is the abandoned case, and "no beat" was the property that made it
  immune.

Either way the beat age is written into the stop detail (`beatAgeMs`,
`heartbeatRecent`, `source`), so the inbox row says which case it was.

### 3.2 `POST /api/heartbeat/sweep` (new, `app/api/heartbeat/sweep/route.ts`)

Makes the sweep reachable today without touching another lane's file. POST
because it writes (stops runs, blocks issues, sends SIGTERM). Auth is
`middleware.ts`'s existing session-or-internal-secret gate on every `/api/` path;
the route adds nothing on top and says so. `?limit=` is validated (422, §2.3).
The response carries `configProblems` (§3.4) so an operator sees a refused env
var instead of a `null` that reads like "no limit configured".

### 3.3 Two real defects in the no-progress halt

**(a) It counted requests, not stall.** The critic measured four heartbeats
inside 218 ms tripping a "3 consecutive heartbeats" halt. The counter was
measuring how *chatty* an agent is: a talkative one died in a quarter of a
second, a silent one was never touched. The halt now requires **both** N stalled
observations **and** `DEFAULT_NO_PROGRESS_MIN_MS` (default 10 min,
env-overridable, `0` restores pure counting) of real elapsed stall, measured from
`last_progress_at` falling back to `started_at`.

This is not a weakening. The false negative — the silent agent — is closed by
§3.1, which supplies observations on a *timer* rather than on the agent's own
traffic. Before this piece the ceiling fired on the wrong population; now it
fires on stall, from a clock the agent does not control.

**(b) The persisted counter disagreed with the message.** The tracker was written
only on the non-stopping path, so a stopped run's row read one lower than the
number its own inbox reason quoted (critic measured 2 vs 3). The tracker is now
persisted *before* the stop decision. Measured agreeing in §2.2.

### 3.4 Ceiling env vars are parsed strictly (`lib/agent-budget.ts`)

Every ceiling constant was `Number(process.env.X ?? default)`. `TODERO_MAX_RUN_MS=1h`
yields `NaN`, `ageMs > NaN` is `false` for every `ageMs`, and the wall clock is
gone — permanently, silently, from a plausible `.env` typo, with the budget panel
rendering the `NaN` as JSON `null` so the UI reports "no limit" and calls it
configuration. No code change required to disarm a ceiling.

`positiveIntFromEnv(name, fallback)` now refuses anything that is not a finite
number `> 0`, uses the built-in default, warns, and records the refusal in
`ceilingConfigProblems()` — exported so a panel can *say* the value was rejected.
Refusing to a working ceiling is the fail-closed direction.

### 3.5 Two fabricated comments removed (`lib/agent-budget.ts`)

- The five-line-duplication justification no longer cites a `scripts/` demo that
  has never existed. It now cites `lib/__tests__/agent-budget-ceilings.test.ts`,
  which really does load this module outside the Next runtime — a reason you can
  run.
- The header no longer claims two call sites. It lists all three and states which
  is unreachable and why, with the measured 503.
- The header's ordering list said no-progress "halts BEFORE any other ceiling",
  which is not true of the code. It now says what is true: 1 and 4 are pre-run,
  2 and 3 are in-flight, they are never in the same comparison, and no-progress
  fires first *in time* on a real stall. **I did not reorder the checks** — the
  brief asked me not to without an argument, and I do not have one: wall clock
  before no-progress means a run past a hard time limit stops for the plain
  reason rather than a derived one.

### 3.6 `lib/agent-queue.ts:159` — the Tester prompt PATCHed a 422 field

The Tester prompt instructed: *"If passes: PATCH to approved with
`test_status=passed`"*. There has never been a `test_status` column on `issues`,
and since TOD-2446 the MC API refuses it outright:

```
$ curl -s -X PATCH .../api/issues -d '{"task_key":"…","test_status":"passed"}'
{"error":"`test_status` is not a field on an issue and never gets written. The review
verdict lives in `tester_status` and `designer_status`; …","field":"test_status"}
HTTP 422
```

Every Tester run following that prompt to the letter would have had its verdict
PATCH rejected, parking the issue in `code_review` with no `reviewer_notes`.
Changed to `tester_status=passed` / `tester_status=failed` (both real columns,
`migrations/003_dual_review_gate.sql`), plus an explicit "never send
`test_status`". Prompt text is dispatched instructions, not documentation.

`lib/loop-breaker.ts:6` carried the same phantom in a comment ("Resets the
counter when an issue succeeds (`test_status=passed`)"). It now names the actual
trigger, `app/api/issues/route.ts:2515`'s `derivedTestStatus === 'passed' &&
before?.tester_status !== 'passed'`.

---

## 4. MUTATION TESTING — eleven mutants, eleven killed

Method: apply one mutation, run the two new suites, record, restore from a
byte-copy taken before any mutation. Never `git`. `md5sum` before and after the
whole run: `lib/agent-budget.ts` `4d2a65c9…` → `4d2a65c9…`,
`app/api/heartbeat/route.ts` `3427cf9c…` → `3427cf9c…`. Both **byte-identical**.

The seven from the brief plus four of my own against the new code:

| # | Mutation | Old suite | New suite | Which assertion caught it |
|---|---|---|---|---|
| M1 | `ageMs > budget.maxRunMs` → `* 1000000` | SURVIVED | **KILLED**, 6 failed | route-level wall-clock + sweep + `MUTANT M1` |
| M2 | `nextStallCount >= budget.noProgressHeartbeats` → `>= 999999999` | SURVIVED | **KILLED**, 1 failed | `MUTANT M2 — no_progress halts on the Nth unchanged check` |
| M3 | `perAgent >= budget.maxConcurrentPerAgent` → `>= 999999999` | SURVIVED | **KILLED**, 2 failed | `MUTANT M3` + the inbox act/display split test |
| M4 | `runCount >= budget.maxRunsPerPeriod` → `>= 999999999` | SURVIVED | **KILLED**, 2 failed | `MUTANT M4` + `the operator lever moves the ceiling` |
| M5 | `if (!schema.available)` → `if (false && …)` | SURVIVED | **KILLED**, 1 failed | `refuses to dispatch instead of degrading to defaults` |
| M6 | `is_blocked: true, blocked_by: 'system:ceiling_stop:…'` → `false, null` | SURVIVED | **KILLED**, 5 failed | every stop assertion, at both lib and route level |
| M9 | `if (owner && ownerRow?.id)` → `if (false && …)` in the heartbeat route | SURVIVED | **KILLED**, 1 failed | `PATCH /api/heartbeat actually reaches the ceilings` |
| M10 | sweep's `requireRecentHeartbeat: false` → `true` | n/a | **KILLED**, 4 failed | the abandoned-run test + sweep route test |
| M11 | drop the sweep's `.gte('started_at', staleCutoff)` | n/a | **KILLED**, 1 failed | `the sweep ignores never-closed zombie rows` |
| M12 | stall floor `stalledForMs >= MIN_MS` → `if (true)` | n/a | **KILLED**, 1 failed | `four checks inside a second do not stop a run` |
| M13 | `if (!Number.isFinite(parsed) \|\| parsed <= 0)` → `if (false)` | n/a | **KILLED**, 3 failed | the env-typo table |

**M9 is the one that matters most, and it is the one a library test cannot
catch.** With the new lib suite alone (30 tests, real database, all four
ceilings) M9 still **SURVIVED 30/30**, because those tests drive the module and
never ask whether anything calls it. It only dies once
`__tests__/api/heartbeat-ceilings-wired.test.ts` exercises the route handler.
That is the whole lesson of `ceilings-exist`, one level up: proving the mechanism
is not proving the wiring.

For the record, on every one of the eleven mutated runs `node
scripts/acceptance/run.mjs` continued to print
`PASS ceilings-exist  all three ceilings present`.

---

## 5. ACCEPTANCE — what a fresh critic can check without trusting me

Each is a command with an expected result. Nothing below requires reading this
document.

1. **The ceilings fire against a real database.**
   `npm test -- lib/__tests__/agent-budget-ceilings.test.ts` → **30 passed**.
   Built by applying every `migrations/sqlite/*.sql` to a temp file; no mock of
   the database, no stub of the module under test.
2. **The wiring exists.**
   `npm test -- __tests__/api/heartbeat-ceilings-wired.test.ts` → **5 passed**.
   Drives the real route handlers.
3. **Every mutant dies.** Apply any row of §4's table by hand and run those two
   suites. Each must go red, and `git diff` on the file must be empty when you
   restore it. Do not take my word for the counts — the "which assertion caught
   it" column names what you should see fail.
4. **M9 specifically.** Change `app/api/heartbeat/route.ts:97` to
   `if (false && owner && ownerRow?.id) {`. `lib/__tests__/agent-budget-ceilings.test.ts`
   still passes 30/30; `__tests__/api/heartbeat-ceilings-wired.test.ts` fails on
   `MUTANT M9`. Restore.
5. **The sweep works over HTTP.** With the dev server up, insert a Limiglow issue
   plus an `agent_runs` row `status='running'`, `started_at` 90+ minutes ago, no
   `agent_heartbeats` row, then
   `curl -s -X POST -H "x-todero-internal: $SECRET" localhost:3000/api/heartbeat/sweep`.
   Expect `stopped:[{…"ceiling":"wall_clock"}]`, `agent_runs.status='stopped'`,
   `issues.blocked_by='system:ceiling_stop:wall_clock'`, one `inbox` row of type
   `ceiling_stop` whose reason ends `and has never sent a heartbeat`. Then call it
   again: `scanned:0`. **Delete your rows.**
6. **The env hole is closed.** `TODERO_MAX_RUN_MS=1h npm test -- lib/__tests__/agent-budget-ceilings.test.ts`
   → still 30 passed, and the run prints
   `[agent-budget] TODERO_MAX_RUN_MS="1h" is not a positive number — ignoring it…`.
   Before this piece the same env var silently removed the wall clock.
7. **The Tester prompt no longer names a 422 field.**
   `grep -n "test_status=passed" lib/agent-queue.ts` → **no match**;
   `grep -n "tester_status=passed" lib/agent-queue.ts` → line 170.
8. **The comments no longer cite things that do not exist.** Both phrases still
   appear in `lib/agent-budget.ts` — deliberately, as quoted history, each
   immediately after "This header used to say" / "The previous version of this
   comment justified…". So grep for the corrections, not the absence:
   `grep -n "NO SUCH SCRIPT EXISTS" lib/agent-budget.ts` → line 76, and
   `grep -n "UNREACHABLE while" lib/agent-budget.ts` → line 42. Then read the
   two header blocks around them and check the claims yourself:
   `POST /api/run-agent {"agent_id":"builder"}` really does answer 503, and
   `ls scripts/` really has no ceiling demo.
9. **The seam is a gate, not a paragraph.**
   `npm test -- lib/__tests__/agent-budget-sweep-seam.test.ts` → **1 failed**, and
   the failure message prints the exact diff for `app/api/cron/watchdog/route.ts`.
   It goes green the moment that diff lands, and only then.
10. **Nothing about dispatch changed.** `node scripts/acceptance/run.mjs` →
    `PASS dispatch-guard-untouched  503 DISPATCH_DISABLED` and
    `PASS dispatch-guard-armed`. `git diff --stat lib/dispatch-guard.ts` → empty.
11. **Gates.** `npx tsc --noEmit` clean; `bash scripts/smoke-test-layout.sh` exit
    0; `node scripts/acceptance/run.mjs` 45/45 and 10/10; `npm test` — the only
    red suite attributable to this piece is #9, deliberately.

---

## 6. WHAT I DID NOT VERIFY — read this before scoring the piece

Stated as flatly as I can. None of these is fixed by anything in this piece.

1. **No ceiling has ever refused a real dispatch.** `TODERO_DISPATCH_ENABLED` is
   off by owner directive and I did not touch it. `concurrency_per_agent`,
   `concurrency_total`, `run_count_period`, `dollar_budget`, `schema_unavailable`
   and `read_error` are all evaluated by `checkDispatchCeilings`, whose only
   caller returns 503 sixty lines earlier. I proved they *evaluate* correctly
   against real rows (§2.4, and eight tests). I did not prove they *refuse*, and
   nothing I can write in my own files can prove it. **What would be needed:** one
   supervised window with `TODERO_DISPATCH_ENABLED=1`, on Limiglow only, with
   `TODERO_MAX_RUN_MS` set low — which is already an open decision on the flight
   board, and is the owner's to make, not mine.
2. **`process.kill(pid, 'SIGTERM')` has still never run against a real pid here.**
   Every probe row I created carried `pid NULL`, so the branch was not entered.
   `app/api/run-agent/route.ts:1073` does write a real pid, so it is not dead
   code — but "the supervisor signals the process" remains unobserved on this
   host. **What would be needed:** a real spawn, i.e. item 1; or a harmless
   long-lived child process whose pid is written into an `agent_runs` row, swept,
   and observed dying. I did not do the latter because writing a fake pid into
   the runs table is exactly the kind of fixture that kills the wrong process if
   the row outlives the child.
3. **No browser.** I did not see `CrewTab` render the over-ceiling badge or the
   new `configProblems`. I read `components/tabs/CrewTab.tsx:276-300` and verified
   the API field it consumes (§2.4). Nothing in this piece touches that file.
4. **The sweep has never run on a timer.** It is implemented, tested, and
   reachable; nothing schedules it. That is §7.1 and it is why that test is red.
   Until that diff lands, the honest claim is "the supervisor *can* act without
   the agent" — not "does, every 30 minutes".
5. **Postgres.** Everything measured is SQLite, this host's provider. The module
   goes through the `db()` seam and the migrations are two-dialect, but I did not
   run these suites against Postgres/PGlite.
6. **`concurrency_total` uses `DEFAULT_MAX_CONCURRENT_TOTAL`, not the agent's
   row.** Pre-existing, unchanged, and arguably right (a fleet-wide cap should not
   be per-agent settable) — but it means `PATCH /api/agents/{id}/budget` cannot
   move it. Not fixed; named here so it is not mistaken for an operator lever.
7. **One transient artefact I could not reproduce:** running my two suites
   together once printed `A worker process has failed to exit gracefully`. Each
   suite alone is clean, and the full `npm test` run did not print it. I did not
   chase it and I am not claiming it is benign.

---

## 7. SEAM REQUESTS — changes I need in files I do not own

### 7.1 `app/api/cron/watchdog/route.ts` — schedule the sweep  ← **expressed as a failing test**

`lib/__tests__/agent-budget-sweep-seam.test.ts` is **red on purpose** and prints
the full diff on failure. It asserts a *call*, not a spelling. It turns green the
moment the diff lands and cannot go quietly stale. Summary of the diff it prints:

```diff
+ import { sweepInFlightCeilings } from '@/lib/agent-budget'
  … inside GET(), after isAuthorized():
+ const ceilingSweep = await sweepInFlightCeilings()
  … in the response body:
+   ceilingSweep,
```

A direct import, not an HTTP call to `/api/heartbeat/sweep`: same process, no
auth handshake, no `appUrl` to get wrong, errors come back as values. The route
stays for operators and out-of-process schedulers.

### 7.2 `scripts/acceptance/checks-anywhere.mjs` — `ceilings-exist` must stop lying

This check is `critical: true` and it printed `all three ceilings present`
through **eleven** mutation runs, including six simultaneous mutations that made
every ceiling inert. It greps for identifier spellings. Replace it with a check
that runs the enforcement:

```js
{
  id: 'ceilings-fire', piece: 'agent-budget-stop', critical: true,
  desc: 'the wall-clock and no-progress ceilings actually stop a run',
  async run() {
    // The two suites drive lib/agent-budget.ts against a real migrated SQLite
    // and the real route handlers. `ceilings-exist` greps for the strings
    // maxConcurrent|maxRunMs|noProgress and passed while all four ceilings
    // were mutated inert — spelling is not enforcement.
    const r = await sh('npm test --silent -- lib/__tests__/agent-budget-ceilings.test.ts ' +
                       '__tests__/api/heartbeat-ceilings-wired.test.ts')
    return r.code === 0 ? ok('35 ceiling assertions green')
                        : no('ceiling suites red — a ceiling is not firing')
  },
},
```

If shelling out to jest is unacceptable inside the harness, the minimum
acceptable alternative is to **delete `ceilings-exist`**. A critical check that
cannot fail is worse than no check: it converted "we never tested this" into
"green" for the entire program.

### 7.3 `app/api/run-agent/route.ts:1240` — the GET WIP count contradicts its own comment

Says "mirror the POST path exactly"; the non-reviewer branch at `:1246` omits
`is_blocked=eq.false`, which the POST path at `:478` has, and has no
`skipAssigneeFilter`/`main` branch at all. **This now matters more because of
this piece**: every ceiling stop sets `is_blocked=true`, so each stop permanently
inflates the WIP that lane reports. Either add `&is_blocked=eq.false` to the GET
branch, or change the comment to say what it actually does.

### 7.4 `app/api/agents/[id]/budget/route.ts:28-38` — the `count:'exact'` parity claim is backwards

Claims parity with `checkDispatchCeilings`, which "does not use `.select('id')`
with the array length as a stand-in count". It does exactly that, in
`evaluateCeilings` and in `getRunCount`. The comment's own argument — that
`count:'exact'` avoids silently capping at the adapter's default page size —
therefore indicts the enforcement path. Either fix the comment, or (better) give
`evaluateCeilings` a real count. I did not change the enforcement path's counting
because doing so without a page-size measurement would be a guess, and this
piece's whole point is not shipping those.

---

## 8. FIXTURES — created and deleted

Project `Limiglow` only. Deleted and verified at **0 rows** in every table:

```
deleted   {"inbox":2,"agent_memory":2,"agent_heartbeats":0,"token_ledger":20,
           "agent_budgets":0,"agent_runs":3,"issues":2}
remaining {"issues":0,"agent_runs":0,"token_ledger":0,"inbox":0,
           "agent_memory":0,"agent_heartbeats":0,"agent_budgets":0}
TOD-1 untouched: {"task_key":"TOD-1","project":"Todero","status":"backlog","is_blocked":0}
```

Agents used: `limiglow-sweep-probe`, `limiglow-stall-probe`, `limiglow-conc-probe`.
Issues: `LIMI-SWEEP-PROBE`, `LIMI-STALL-PROBE`. `agent_budgets` is back to the
0-row state I found it in (`source:"default"`). The test suites never touch
`db.sqlite` — they build their own temp SQLite files and delete them.

---

## 9. Held back, and stated rather than fixed

- The two dispatch-time ceilings remain unproven *as refusals*. §6.1.
- The pid signal remains unobserved. §6.2.
- `ceilings-exist` still passes for the wrong reason, in a file I do not own. §7.2.
- The sweep still has no scheduled caller. §7.1, red test.
- `concurrency_total` is not operator-settable. §6.6.
- `/api/cron/*` still has no dispatch gate of its own (critic's Fab 6, verified,
  not my file). `/api/cron/watchdog` is gated only transitively — it POSTs to
  `/api/run-agent`, which 503s — while its own issue-mutating passes run ungated.
  Worth naming loudly because §7.1 asks that same route to start stopping runs
  and blocking issues.

---

## 10. The seam landed — `/api/cron/watchdog` now runs the sweep (2026-08-26)

Appended by the cron/watchdog lane. §9's line "the sweep still has no scheduled
caller" is now **out of date**; §7.1 is applied. Nothing above this section was
rewritten — read it as history.

### 10.1 What was applied

`lib/__tests__/agent-budget-sweep-seam.test.ts`: **1 failed / 1 total → 1 passed
/ 1 total.** The printed diff went in verbatim, in three hunks:

```diff
  app/api/cron/watchdog/route.ts
+ import { sweepInFlightCeilings } from '@/lib/agent-budget'
  … in GET(), after isAuthorized() and before createAdminClient():
+ const ceilingSweep = await sweepInFlightCeilings()
  … in the response body:
+   ceilingSweep,
```

Placed **before** the stale-claim queries, not after. A run past its ceiling
should be stopped and blocked for triage by the mechanism that knows *why*, not
merely recycled to `open` by the watchdog's reset as if the agent had simply
died. Both can touch one issue in a single tick — the ceiling stop sets
`is_blocked`, the reset moves `status` — and "open but blocked, awaiting a
human" is the intended end state, not a collision.

### 10.2 Beyond the diff — three things the seam's author could not see

**(a) `ok` was about to start lying.** The diff as printed leaves
`ok: failed.length === 0`, so the watchdog would answer `ok:true` on a tick
whose ceiling sweep could not read `agent_runs` at all.
`POST /api/heartbeat/sweep` refuses to do exactly that — its own comment: the
caller must be able to tell "looked at everything, stopped nothing" from "could
not look". Pasting the diff unchanged would have rebuilt that dishonesty one
level up, in the route that now runs on the timer. Changed to
`ok: failed.length === 0 && ceilingSweep.errors.length === 0`. No test asserted
the old value (checked: nothing under `__tests__/` or `scripts/acceptance/`
imports this route).

**(b) The "never throws" claim in the pasted comment was not quite true.**
`sweepInFlightCeilings` returns read failures in `.errors`, but `db().from()`
still *throws* `DbConfigurationError` on an unconfigured database. The comment
that went into the route says so, and names the `dbUnavailableResponse()` guard
above it as the thing that makes it moot. A comment asserting a stronger
property than the code has is the defect class this doc keeps finding.

**(c) The honest call-site list at the top of `lib/agent-budget.ts` was stale
the moment the seam landed**, and its own last line says "keep this list
honest". Updated — with the caveat below, which is the part that matters.

### 10.3 Verified today, over real HTTP, against `db.sqlite`

`TODERO_DB_PROVIDER=sqlite`; `createAdminClient()` is `db()` (`lib/hub-client.ts:99`),
so the watchdog's own queries and the sweep read one store, not two.

```
GET /api/cron/watchdog                    → 401   (no x-todero-internal header)
GET /api/cron/watchdog  + internal secret → 200 in 4.2s
  {"ok":true,…,"ceilingSweep":{"scanned":0,"stopped":[],"skipped":0,"errors":[]}}
```

Then with a fixture — issue `LIM-SEAMPROBE` (project **Limiglow**) plus one
`agent_runs` row, `status='running'`, `started_at` 2h old (past the 1h
`maxRunMs`, inside the 6h stale window), `pid` null:

```
tick 1  ceilingSweep {"scanned":1,"stopped":[{"runId":"seamprobe-run-0001",
        "agentId":"seam-ceiling-probe","taskKey":"LIM-SEAMPROBE",
        "ceiling":"wall_clock"}],"skipped":0,"errors":[]}
tick 2  ceilingSweep {"scanned":0,"stopped":[],"skipped":0,"errors":[]}   ← idempotent

agent_runs  status=stopped  stopped_reason=wall_clock  stopped_at=…21:18:34Z
issues      is_blocked=1    blocked_by=system:ceiling_stop:wall_clock
inbox       1 row, type=ceiling_stop, status=pending
agent_memory 1 row, key=ceiling_stop
```

That is the wall-clock ceiling firing **through the scheduled route**, on a run
that never sent a heartbeat — the failure mode §3.1 was built for — with the
stop recorded in all four places. Dispatch was **not** enabled to get this:
`TODERO_DISPATCH_ENABLED` was untouched and `dispatch-guard-armed` /
`dispatch-guard-untouched` are still green in the harness.

Fixtures deleted and verified: `{"inbox":1,"agent_memory":1,"agent_runs":1,"issues":1}`,
residue 0 in every table. A second, separate probe row (`LIM-SEAMPROBE2`, §10.4)
was also deleted. `db.sqlite` is back to its one row, `TOD-1`, archived, untouched.

### 10.4 Still red, and why — none of it mine

**The sweep is now only as scheduled as the watchdog is, and on THIS host the
watchdog is not scheduled at all.** `vercel.json` runs `/api/cron/watchdog` every
30 min *on a Vercel deployment*. Locally the driver is `scripts/agent-kicker.sh`,
and its watchdog call (line 33) is `curl -sf "$BASE/api/cron/watchdog"` with **no
`x-todero-internal` header** — `middleware.ts:300` gates every `/api/` path on
either that secret or a session, so it answers **401**. Measured today: the same
URL is 401 bare and 200 with the header. The script defines `SECRET` at line 16
and only uses it on the `run-agent` POST. Not my file, not fixed here; the
one-line fix is to pass `-H "x-todero-internal: $SECRET"` on lines 27 and 33.
Until then the ceiling sweep runs on the timer in production and by hand here.

**`bash scripts/smoke-test-layout.sh` is red on its last guard, and it is not
this change.** `scripts/no-unscoped-issues.mjs` is *uncommitted, mid-edit by
another lane right now* (`git status`: ` M`). Its new §2b adds four `task_key`
probes; three fail, including its own control `task_key, its OWN project, still
resolves`. Diagnosis, so the owning lane does not chase a phantom leak: **the
route is fine and the probe row is already gone by §2b.** Proof — a Limiglow row
inserted by hand and asked for directly:

```
GET /api/issues?task_key=LIM-SEAMPROBE2  Referer /p/limiglow/work/list → 200, full row
GET /api/issues?task_key=LIM-SEAMPROBE2  no referer                    → 400 unscoped_issues_read
```

Both are the intended answers. §2b's 404s are `!data` at `app/api/issues/route.ts:913`
— no row found — which happens *before* any scope logic runs. The committed
version of the guard (`git show HEAD:` → run from the scratchpad) still prints
`PASS: scope holds under 10 live probes`. So: the working-tree guard is red, the
shipped guard is green, and the boundary itself is intact.

**Untouched on purpose:** `lib/dispatch-guard.ts`, `TODERO_DISPATCH_ENABLED`,
`app/api/heartbeat/sweep/route.ts` (its header comment lines 22–26 now says
"SEAM — NOT YET WIRED … nothing schedules it", which this change made false —
flagged to the orchestrator, not edited, because that file is not mine), and the
ceiling ORDER in `lib/agent-budget.ts`, which is argued and was not touched.

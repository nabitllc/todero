# PIECE: memory-attempted — record what the run actually TRIED

id: memory-attempted (pieces8)
lane: Learning & Memory Loop, 7/9
benchmark: Hermes Agent — *records what it TRIED and failed after each task*,
retrieves it on similar ones by FTS5, caps in-context memory so overflow
errors instead of truncating.
date: 2026-08-26

OWNS: `lib/memory-loop.ts`, `lib/memory-retrieval.ts`, `lib/memory-budget.ts`,
`lib/runtimes/**`, tests created here, this file.

Prior work this builds on and does NOT rebuild:
`docs/rebuild/pieces/pieces7/memory-loop.md` (critic-scored 8/10) —
the write path, the FTS5 index, the portable fallback, the two overflow
errors and the card surface all already existed and were left alone.

---

## 0. TL;DR

The deferral was wrong, and the evidence to disprove it was sitting in the
same function that deferred it.

`recordRunOnExit()` wrote `attempted: null`, `succeeded: false`,
`exit_status: null` on every row it had ever written. The stated reason — in
`lib/memory-loop.ts`'s own comment, in pieces7 §8, and endorsed by a critic —
was that `watchChildExit()` only proves "the pid is gone", so nothing honest
could be filled in.

That is true of `watchChildExit`. It is **false of the exit moment**. In the
very same callback, four lines above the `recordRunOnExit()` call, the
adapters were already parsing a real, structured outcome record out of the
run's own log — and handing it to the token ledger while discarding
everything that was not a token count. Plus one signal nobody had ever
collected at all: the child's **real OS exit code**, which the parent can
observe via `child.on('exit')` even for a detached, `unref()`d process.

Live proof of the result, measured today (§3, full transcript there):

```
"attempted": "[run-exit] runtime=claude-code exit_code=9 duration_sec=5 outcome=failed
              no structured completion record for this runtime — last 1 log line(s), verbatim:
                C:\\Program Files\\nodejs\\node.exe: bad option: --permission-mode",
"succeeded": false, "failed": true, "exit_status": 9
```

Before this piece that same run produced `attempted: null, succeeded: false,
failed: false, exit_status: null` — a row that could say "TOD-9990 was
in_progress and someone rejected it" and could never say "I tried to launch
and the launch itself was rejected".

---

## 1. What I MEASURED before writing anything

Every line in this section is output I personally produced today.

**Baseline gate, before the first edit:**

```
$ npx tsc --noEmit
(no output, exit 0)
```

**Where the discarded evidence lives — read, not assumed:**

| Signal | Where it is produced | Where it was consumed | Where it went |
|---|---|---|---|
| `subtype` (`success` / `error_max_turns` / `error_during_execution`), `is_error`, `num_turns`, `result` | `claude --print --output-format json`, written to the run log by the child | `parseClaudeJsonOutput()` in `lib/runtimes/claude-code.ts` parsed the whole object | **discarded** — only `usage.*` and `total_cost_usd` were returned |
| `run_end.status` (`completed` / `failed` / `max_iterations`), `iterations`, every `tool_call` step and its tool name | `RUNNER_SCRIPT`'s `[trace]` lines, `lib/runtimes/openai-api.ts` | `parseOpenAiTrace()` returned all of it | `status` → `finalizeRun()`; **steps and iterations discarded** |
| `[spawn-failure] …` lines | `lib/runtimes/detached-spawn.ts`, three sites | nothing | **never read** |
| the child's real exit code / signal | the OS | **nothing — no listener existed** | **never observed** |

`grep -rn "recordRunOnExit" lib/runtimes` — 4 call sites (claude-code, codex,
cursor, openai-api), all passing `{ agentId, taskId }` and nothing else.

**Row state on this host's live `db.sqlite`, read-only, before and after this
session:** `agent_run_records` = **0 rows** both times (this piece never wrote
to the shared database — see §5).

---

## 2. What I changed

### 2a. `lib/runtimes/detached-spawn.ts` — observe the real exit code

New exported `ChildExitObservation` (`{ observed, code, signal, at }`),
returned on `DetachedSpawnResult.exit` and **mutated in place** by a new
`child.on('exit')` listener. Callers read it later from inside their
`watchChildExit` callback.

`observed: false` is a real, expected state — a Next.js restart between spawn
and exit loses this listener exactly the way it already loses the watcher —
and is reported as "not observed", never as exit 0.

The listener also appends a deliberately **brace-free**
`[spawn-exit-code] … pid=N code=N signal=X` line, because the completion-JSON
reader scans that same file for the last `}`. There is a test that fails if a
brace ever appears in it.

### 2b. `lib/runtimes/exit-evidence.ts` (new) — one place that decides

- `readClaudeCompletion(logFile)` — absorbs the old `parseClaudeJsonOutput()`
  **unchanged in its brace-span scanning** (so ledger numbers are identical)
  and additionally returns `subtype` / `isError` / `numTurns` / `result`.
- `readSpawnFailures(logFile)`, `readLogTail(logFile)`.
- `summarizeExit(facts) → { outcome, succeeded, failed, exitStatus, attempted }`.

Precedence, hardest evidence first, and the ordering is the whole point:

1. a `[spawn-failure]` line → failed
2. a signal, or a non-zero exit code → failed
3. the run's own `is_error` → failed
4. **the run's own terminal status word** → succeeded / failed / unknown
5. exit code 0 with nothing else → succeeded
6. nothing → **unknown, both columns false — the historical behaviour**

> **CORRECTED IN ROUND 2 — §10.1.** The list above was true of the intent
> and FALSE of the shipped code. `running` and `unknown` were inside
> `NON_TERMINAL_STATUSES`, so they skipped step 4 entirely and fell into step
> 5: `summarizeExit({runtime:'openai-api', exitCode:0, reportedStatus:'running'})`
> returned `succeeded: true` with an `attempted` string reading
> `reported_status=running … outcome=succeeded`. Fixed and pinned in round 2;
> the list as shipped now lives in the docstring of `decideOutcome()`.

Step 4 sits above step 5 on purpose: an openai-api run that exhausts
`MAX_ITER` writes `run_end status:max_iterations` and then exits **0**.
Reading that as a success is precisely the fabricated outcome this piece was
warned against. There is a test, and a mutation proof, for exactly this (§4).

`attempted` is assembled only from the facts passed in, each block stamped
with where it came from — `[run-exit] runtime=… exit_code=… reported_status=…`,
then `spawn failures (verbatim from the run log)`, `tools invoked (N, from the
run's own trace)`, and the agent's own final message labelled
`agent's own final report (verbatim; the agent's claim about what it did, NOT
a verified outcome)`. **No evidence produces `attempted: null`**, never a
plausible sentence.

### 2c. `lib/memory-loop.ts` — accept the evidence, still never invent it

`ExitRecordInput` gains four **optional** fields (`attempted`, `succeeded`,
`failed`, `exitStatus`). Omitting them reproduces the pre-existing row byte
for byte, which is why codex/cursor/openai-api/claude-code could each be
wired independently and why every pre-existing test stayed green untouched.

### 2d. The four adapters

| Adapter | Evidence it now passes |
|---|---|
| `claude-code.ts` | real exit code/signal, duration, `subtype`, `is_error`, `num_turns`, tokens, the model's own `result` text, `[spawn-failure]` lines, log tail **only when no completion object exists** |
| `openai-api.ts` | real exit code/signal, duration, `run_end.status`, `iterations`, **the ordered list of every tool the run actually invoked**, tokens, the runner's fatal-error text when there was one |
| `codex.ts`, `cursor.ts` | real exit code/signal, duration, `[spawn-failure]` lines, verbatim log tail — and `attempted` says in as many words that this runtime writes no structured completion record, so nobody mistakes an exit-0 verdict for a verified task outcome |

**`succeeded` / `failed` mean "the run PROCESS reported success/failure",
never "the review passed."** That distinction is written into the module
header, the interface docs, and every `attempted` string. The review's own
verdict is the separate `rejection_count` / `rejection_reason` pair already
on the same row.

### 2e. What I deliberately did NOT do

- **No migration.** 073 is untouched and unused. `attempted`, `succeeded`,
  `failed` and `exit_status` are all pre-existing columns of
  `agent_run_records` (migrations `040` in both dialects) and all four are
  already in the FTS5 index or adjacent to it (`041`). Nothing needed a
  schema change, and inventing one to spend an allocated number is the kind
  of manufactured work this rebuild's own rules forbid.
- **The second gap (booleans) needed no work from me.**
  `docs/rebuild/pieces/pieces7/boolean-columns.md` already closed it via
  `BOOLEAN_MEANING_OVERRIDES` in `lib/db/sqlite-adapter.ts` plus the
  `check-boolean-columns` guard, which **passes in today's smoke run**
  (`3 override entr(ies) across 2 table(s) … OK`). The remaining item there
  is the deliberately-deferred sqlite table rebuild — a hot-path
  create/copy/drop/rename against a database nine other lanes are writing to
  right now. I did not do it, for the same reason its author did not: the
  risk is real and the reward is zero while the override map covers it. My
  own test asserts the decoded value tolerantly (`=== true || === 1`) so it
  cannot go red on whichever side of that migration a future host sits.

---

## 3. LIVE PROOF — a real OS process, a real exit code, a real row

Run today via `npx tsx` from the repo root, against a **scratch** sqlite
database in the OS temp dir built from the real `migrations/sqlite/*.sql`
(deliberately not the shared `db.sqlite` — see §5). `CLAUDE_BIN` was pointed
at `node.exe`, the adapter's own documented override; the script **refuses to
run** if `CLAUDE_BIN` still resolves to the real `claude` binary, because
pieces7 §3b records a previous builder accidentally spawning a real
$0.44 Claude session this exact way.

The chain exercised is the whole production path with nothing stubbed:
`claudeCodeRuntime.spawn()` → `spawnDetached()` → real OS child →
`child.on('exit')` → `watchChildExit()`'s 5s poll → the adapter's exit
callback → `readClaudeCompletion` + `readSpawnFailures` + `readLogTail` →
`summarizeExit()` → `recordRunOnExit()` → `INSERT`.

**The run log, verbatim:**

```
[spawn-start] 2026-08-26T17:50:28.413Z agentId=live-exit-proof model=default workingDir=C:\Development\Todero
[spawn-start] prompt bytes: 45 (file: ...\todero-spawn-live-exit-proof-UNGXky\prompt.txt)
[spawn-start] ---
[spawn-ok] child_pid=40632
C:\Program Files\nodejs\node.exe: bad option: --permission-mode
[spawn-exit-code] 2026-08-26T17:50:28.447Z pid=40632 code=9 signal=none
[spawn-exit] 2026-08-26T17:50:33.437Z pid=40632 watcher_detected=true
[spawn-exit] agent=live-exit-proof task=live-proof-issue-1
```

Note the ordering, which is the design assumption made observable: the real
exit event landed at **:28.447**, five seconds before the pid-liveness watcher
noticed at **:33.437**. The evidence is always already there when the callback
reads it.

**The row that was written:**

```json
{
  "id": "0f32a563-f79e-407d-b0ef-46ca7aab0e62",
  "agent_id": "live-exit-proof",
  "task_key": "TOD-9990",
  "task_title": "Live proof: webhook retry loop has no backoff",
  "status": "in_progress",
  "attempted": "[run-exit] runtime=claude-code exit_code=9 duration_sec=5 outcome=failed\nno structured completion record for this runtime — last 1 log line(s), verbatim:\n  C:\\Program Files\\nodejs\\node.exe: bad option: --permission-mode",
  "succeeded": false,
  "failed": true,
  "rejection_count": 1,
  "rejection_reason": "base delay is 0ms, the retry storm still saturates the endpoint",
  "reviewer_notes": null,
  "exit_status": 9,
  "created_at": "2026-08-26T17:50:33.439Z"
}
```

**And the retrieval half, on the same live data:**

```
[proof] retrieval: {"engine":"fts5","keys":["TOD-9990"]}
```

`searchRunRecords('live-exit-proof', 'TOD-9991 webhook retry backoff still
saturating')` — a different, later task key — found it. `engine: "fts5"`,
i.e. the real index, on this host's real provider.

**Honest limit of this particular proof:** the child was `node.exe` rejecting
claude's flags, so it exercised the **failure** path with a real non-zero exit
code and a real log tail. It did **not** exercise a successful `claude
--output-format json` completion live, because no `claude` binary may be
spawned from this session (cost, and pieces7's precedent) and no argv-
compatible harmless stand-in exists on Windows — `node --permission-mode` is
rejected before it can print anything. The success path is covered by tests
against the real log format (§4), not by a live binary. Said plainly rather
than blurred.

---

## 4. Tests, and the mutations that prove they bite

Three new files, **29 tests, all green**:

| File | Tests | What it pins |
|---|---|---|
| `lib/__tests__/detached-spawn-exit-code.test.ts` | 5 | Real `node` children with known exit codes (0, 23, a thrown error → 1). Proves Node really does deliver `'exit'` for a `detached: true` + `unref()`d child — the claim the entire piece rests on. Also asserts the `[spawn-exit-code]` line contains no `{` or `}`, and that `observed` stays **false** (not 0) while a child is still running. |
| `lib/__tests__/exit-evidence.test.ts` | 20 | The verdict discipline, weighted to the negative cases: nothing observed → `unknown` + `attempted: null`; unobserved exit prints `exit_code=not-observed`, never `0`; signal death, spawn failure, `max_iterations`-at-exit-0, `is_error`-at-exit-0. Plus the readers against the exact log shapes `claude-code.ts` and `detached-spawn.ts` write, including a completion object followed by the new `[spawn-exit-code]` line. |
| `lib/__tests__/memory-loop-exit-evidence.test.ts` | 4 | End to end on a real sqlite file from the real migrations: evidence lands in all four columns; **no evidence reproduces the historical row exactly**; `max_iterations` at exit 0 is stored as `failed`; and a past FAILURE is retrieved on a later task by FTS5 **purely from what the run tried** — the issue title shares no vocabulary with the query — all the way through `buildRetrievedContext()` into the injected `Attempted:` block. |

### Mutation 1 — drop the evidence pass-through in `recordRunOnExit`

Reverted the four fields to the old `exitStatus: null` line and re-ran:

```
● persists attempted / succeeded / failed / exit_status when the caller observed them
● records a max_iterations run as FAILED even though its process exited 0
● retrieves a past FAILURE on a later task by what the run tried, not by the issue title
Tests: 3 failed, 1 passed, 4 total
```

The one that stayed green is *"reproduces the historical row exactly when the
caller observed nothing"* — which it must, since that path is unchanged.
Restored; green.

### Mutation 2 — invert the precedence so the exit code outranks the run's own status

Moved `if (exitStatus === 0) return 'succeeded'` above the terminal-status
check:

```
● summarizeExit › does NOT call an exit-0 run successful when its own terminal record says max_iterations
● recordRunOnExit › records a max_iterations run as FAILED even though its process exited 0
Tests: 2 failed, 22 passed, 24 total
```

Exactly the two tests that exist for it, by name, and nothing else. Restored;
green.

---

## 5. Fixtures

**None were created in the shared database.** The live proof (§3) ran against
a scratch sqlite file in the OS temp dir, deleted afterwards; every test uses
its own `mkdtempSync` database. Measured after the session, read-only against
the live `./db.sqlite`:

```
agent_run_records rows: { c: 0 }        (same as before this session)
Limiglow issues:        { c: 2 }
```

The two Limiglow issues are **not mine** — this piece never inserted into the
live `issues` table at all. They belong to other lanes running concurrently
and were left untouched, as was `TOD-1`.

The one throwaway script (`_pieces8_live_exit_proof.mts`, repo root — it has
to live inside the repo to resolve `node_modules`) was deleted; `ls _pieces8*`
returns "No such file or directory".

---

## 6. GATE — exact numbers, run today, in this session

```
npx tsc --noEmit
  0 errors.

npm test   (run twice — see the note below on why the numbers moved)
  first run,  17:5x:  Test Suites: 1 failed, 1 skipped, 69 passed, 70 of 71
                      Tests:       1 failed, 2 skipped, 1295 passed, 1298 total
                      FAILURE SET: {spawn-live}
  final run,  18:0x:  Test Suites: 3 failed, 1 skipped, 77 passed, 80 of 81
                      Tests:       4 failed, 2 skipped, 1508 passed, 1514 total
                      FAILURE SET: {spawn-live, commerce-permissions,
                                    commerce-audit-atomicity}
                      by full test name:
                        openai-api spawn … › names a log file that exists on disk and grows
                        commerce:write is a real, independently-enforced permission › allows
                          member (has commerce:write) to reach the handler …
                        PATCH /api/commerce/orders — inventory.adjust audit insert failure …
                        PATCH /api/commerce/orders — order.fulfilment audit insert failure …

  Judged by the FAILURE SET, never the total. Against the briefed baseline
  {agents-route, agents-unconfigured, spawn-live}:
    - agents-route and agents-unconfigured are GREEN now — another lane
      fixed them this session (both show ` M ` in git status).
    - spawn-live is the one briefed failure that remains; its cause is
      diagnosed below and is not this piece's.
    - the three commerce failures are ANOTHER LANE'S IN-FLIGHT WORK
      (`__tests__/api/commerce-*.test.ts`, plus `lib/commerce.ts` and
      `app/api/commerce/orders/route.ts`, all ` M ` in git status; commerce
      is explicitly a different agent's scope, as pieces7 §11c already
      recorded). They appeared BETWEEN two runs 10 minutes apart, and the
      failing count itself moved (6 then 4) while that lane kept saving —
      which is what an actively-edited suite looks like from here. Not
      caused by this piece, not fixed by it, and named rather than
      absorbed into a total.

  This lane's own 8 suites: 79 passed, 79 total, 0 failed — re-run
  immediately after the final full run:
    lib/__tests__/{exit-evidence, detached-spawn-exit-code,
      memory-loop-exit-evidence, memory-loop, memory-retrieval,
      memory-retrieval-portable, memory-budget}.test.ts
    __tests__/runtimes/detached-spawn.test.ts

node scripts/acceptance/run.mjs
  45/45 passing (7258ms), harness score 10/10.
  Including this channel's own two: memory-loop-portable PASS,
  retrieval-is-budgeted PASS. dispatch-guard-untouched PASS (503
  DISPATCH_DISABLED) — the guard was never lifted.

bash scripts/smoke-test-layout.sh
  All nine guards pass, plus check-boolean-columns, check-no-secrets (9 rules,
  0 hits), the honest-error guard and the scope guard.
  ✅ Smoke test complete
```

**On the one failure.** It is the briefed known failure, and I checked its
cause rather than waving at the label. Full error, from today's run:

```
"error":"TypeError [ERR_INVALID_ARG_VALUE]: The property
 'options.env['D\u0000A\u0000T\u0000A\u0000B\u0000A\u0000S\u0000E\u0000_\u0000U\u0000R\u0000L\u0000']'
 must be a string without null bytes."
```

A **UTF-16-encoded environment variable name on this Windows host** makes
Node's own `spawn()` throw before any code of mine is reached — it fails
inside the `try { child = spawn(...) }` block, several statements above the
`'exit'` listener this piece added. Not caused by this piece, and not fixed by
it either. `__tests__/runtimes/detached-spawn.test.ts` (the non-live sibling
covering the same function) is **green**, as are all 8 suites in this lane
(79/79).

---

## 7. ACCEPTANCE — checkable without trusting a word of this summary

1. `npx jest lib/__tests__/detached-spawn-exit-code.test.ts` — 5 green. Read
   the assertions: they spawn real `node` processes and assert
   `result.exit.code === 23` etc. If Node ever stops delivering `'exit'` for a
   detached/unref'd child, this file goes red and §2a's claim is withdrawn.
2. `npx jest lib/__tests__/exit-evidence.test.ts` — 20 green.
3. `npx jest lib/__tests__/memory-loop-exit-evidence.test.ts` — 4 green.
4. Re-run **Mutation 1**: in `lib/memory-loop.ts`, replace the four lines
   `attempted: entry.attempted ?? null` … `exitStatus: entry.exitStatus ?? null`
   with the single line `exitStatus: null,` and re-run test file 3. Expect
   exactly 3 failures, by the names quoted in §4, and the "observed nothing"
   test still green. Restore.
5. Re-run **Mutation 2**: in `lib/runtimes/exit-evidence.ts`'s
   `decideOutcome()`, move `if (exitStatus === 0) return 'succeeded'` above
   the `const status = …` block. Expect exactly the 2 failures named in §4.
   Restore.
6. `grep -n "attempted\|succeeded\|exitStatus" lib/memory-loop.ts` — the
   values passed to `writeRunRecord` come from `entry.*`, with `?? null` /
   `?? false` as the *not-observed* branch, and nothing is derived inside
   `memory-loop.ts` itself.
7. `grep -rn "recordRunOnExit" lib/runtimes/*.ts` — all four adapters now pass
   `attempted` / `succeeded` / `failed` / `exitStatus` built by
   `summarizeExit()`.
8. `ls migrations/ migrations/sqlite/ | grep 073` — returns nothing. No
   migration was created.
9. `node scripts/check-boolean-columns.mjs` — exits 0 (the pieces7 boolean
   gap is still closed and was not disturbed).
10. Live proof (§3) is reproducible: re-create the script from §3's
    description, run it with `CLAUDE_BIN` pointing at a harmless binary, and
    read the row back. It writes only to a scratch sqlite file.
11. `sqlite3 ./db.sqlite "select count(*) from agent_run_records"` → 0, the
    same count it had before this session.

---

## 8. SEAM DIFF requested — `components/tabs/MemoryTab.tsx` (NOT mine to edit)

> **CORRECTED IN ROUND 2 — §10.4.** "Correct as-is" is false. `r.failed`
> appears once in that file, as the colour of a 1.5px dot; the field
> **labelled** `FAILED` renders `r.rejection_reason`. The row this piece
> produces (`failed: true, exit_status: 9, rejection_reason: null`) therefore
> displays as `FAILED  rejection_reason is null`, which reads as *not failed*.
> §10.4 carries the corrected diff request.

The card renders `attempted`, `succeeded` and `failed` already, so it is
**correct as-is** and this is not a blocker. But two pieces of its copy are
now stale, and one real column is invisible.

**8a. Stale claim.** `components/tabs/MemoryTab.tsx`, the footnote under the
run-records list (currently around line 155):

```
- No column records what WORKED — agent_run_records stores attempted, rejection_reason, reviewer_notes and a
- boolean succeeded, so the working path is shown as that flag, not as prose nobody wrote. Recurrence
- (&ldquo;seen n times&rdquo;) is counted only by promoteHotPatterns(), which writes; the per-row
- rejection_count column is shown instead.
+ ATTEMPTED is written at process exit from what the run itself reported — the runtime, the real OS exit code,
+ the run&rsquo;s own terminal status, the tools it invoked — and is provenance-stamped so you can see which
+ part is measured and which part is the agent&rsquo;s own claim. succeeded/failed mean the run PROCESS
+ reported success or failure, NOT that the review passed; the review&rsquo;s verdict is rejection_count and
+ rejection_reason on the same row. Recurrence (&ldquo;seen n times&rdquo;) is counted only by
+ promoteHotPatterns(), which writes; the per-row rejection_count column is shown instead.
```

**8b. `exit_status` is never displayed.** It is now a real number on every
lifecycle-written row and there is no chip for it. Suggested, next to the
existing `succeeded:` chip:

```
  <Chip>succeeded: {String(truthy(r.succeeded))}</Chip>
+ <Chip>exit_status: {r.exit_status ?? 'not observed'}</Chip>
  <Chip>rejection_count: {r.rejection_count ?? 0}</Chip>
```

(needs only `exit_status: number | null` added to the row type at the top of
that file. **Verified today:** `app/api/agent-run-records/route.ts:39` already
uses `.select('*')`, so the column is on the wire and no route change is
required.)

**This piece is complete without 8a/8b.** They are cosmetic honesty
improvements to a surface I do not own, not missing behaviour.

---

## 9. What I did NOT verify — read this before treating anything above as settled

- **No browser/DOM evidence of any kind.** I have no browser tool this
  session. The Memory tab was never rendered or screenshotted; §8 is derived
  from reading `MemoryTab.tsx`, not from seeing it.
- **The claude success path was never run against a real `claude` binary**
  (§3). `readClaudeCompletion()` is tested against the documented log shape,
  not against output a live `claude --output-format json` produced today.
- **`codex` and `cursor` were never spawned live.** Their binaries are not
  installed on this host. Their wiring is code-identical to claude-code's by
  inspection and shares `summarizeExit()`, but no live run of either exists.
- **`openai-api` was never spawned live** — it needs a reachable LLM
  endpoint. Its `run_end` / `tool_call` handling is exercised only by unit
  tests over the trace shape `RUNNER_SCRIPT` writes.
- **Postgres was not exercised at all this session.** Everything here ran on
  the sqlite provider. The portable retrieval path remains unit-tested only
  against a mocked `db()` seam — a pre-existing gap carried over from
  pieces7 §6, neither closed nor worsened here.
- **`TODERO_DISPATCH_ENABLED` was never lifted** and `/api/run-agent` was
  never called. The acceptance harness confirms the guard still answers
  `503 DISPATCH_DISABLED`.
- **The `succeeded === true || === 1` tolerance in my sqlite test** means that
  test cannot detect a regression in the boolean decode path itself. That is
  deliberate (it is another piece's fix and another piece's tests), but it is
  a real hole in *my* coverage and I am naming it rather than letting the
  tolerant assertion read as a stronger claim than it is.
- **I did not measure whether `attempted` strings shorten retrieval reach in
  practice.** Records are now materially longer, so fewer of them fit in the
  1,300-token budget. `ATTEMPTED_MAX_CHARS = 1_200` (~300 tokens) keeps any
  single record well under budget — `RetrievalBudgetExceededError` still
  cannot fire on one row alone — **[FALSE. CORRECTED IN ROUND 2, §10.2/§10.3:
  `formatRecord()` renders `attempted` alongside the uncapped
  `rejection_reason` and `reviewer_notes`, so one row absolutely can exceed
  the budget, and this piece made previously-fitting rows exceed it. Measured
  both ways.]** — but the practical "how many past runs reach
  a prompt now" number was not benchmarked. Worth a follow-up.

---

## 10. ROUND 2 — what a fresh-context critic found, what I measured, what I changed

Everything in §§0–9 above is left exactly as it was written, with three inline
`CORRECTED IN ROUND 2` pointers added where it asserts something untrue. This
section is the round-2 record: **every claim below was measured by me today**,
on this tree, and nothing in it is inherited from the round-1 transcript or
from the critic's report. Where the critic was right I say so; where a number
differs from theirs I give mine.

### 10.0 Baseline, before I changed anything

- `npx tsc --noEmit` → **exit 0**, no output.
- The 8 suites this lane owns → **8 passed, 75 tests passed, 75 total**.
  (The critic reported 79 for "this lane's 8 suites"; my file set gives 75.
  Either way the delta is what matters, and it was zero.)

### 10.1 FABRICATION: `running` / `unknown` at exit 0 were recorded as SUCCESS

**The critic was right.** Measured by direct call against the shipped code,
before any edit:

```
RUNNING: {"outcome":"succeeded","succeeded":true,"failed":false,"exitStatus":0,
          "attempted":"[run-exit] runtime=openai-api exit_code=0 duration_sec=3
                       reported_status=running outcome=succeeded"}
UNKNOWN: {"outcome":"succeeded","succeeded":true,"failed":false,"exitStatus":0,
          "attempted":"… reported_status=unknown outcome=succeeded"}
```

One stored line asserting both that the run never finished and that it
succeeded. `parseOpenAiTrace()` produces `running` whenever the trace's last
entry is a step rather than a `run_end`, and `unknown` when the trace is
unreadable or empty (`lib/runtimes/openai-api.ts:625`, `:640`), so this was
reachable by the default failure mode of the only runtime with a step trace.

**Changed** (`lib/runtimes/exit-evidence.ts`): a status word that is PRESENT
and non-terminal now returns `unknown` and never reaches the exit-0 fallback.
The distinction that keeps this safe is stated in the code: a present
non-terminal status is *evidence* ("the run wrote a trace and it does not say
it finished"), while an ABSENT status is *silence* — codex and cursor never
write one, so for them exit 0 is still the only outcome signal there is and is
still read as success. `attempted` also now spells the disagreement out:
`the process exited 0, but the run's own trace never recorded a terminal
status (last status: running) — recorded as unknown, NOT as a success`.

The precedence comment above `summarizeExit()` was rewritten to match the code
line for line, since the previous one described behaviour the code did not
have.

**Pinned** by 4 new tests in `lib/__tests__/exit-evidence.test.ts`, including
the reverse direction (exit 0 with no status word is still `succeeded`, so the
repair cannot be over-applied). Mutation: deleting the new
`if (NON_TERMINAL_STATUSES.has(status)) return 'unknown'` line →
**3 failed, 24 passed** (was: 24/24 green, mutant survives).

### 10.2 FABRICATION: the `ATTEMPTED_MAX_CHARS` comment claimed budget safety

**The critic was right.** §9's claim that `RetrievalBudgetExceededError`
"cannot fire on one row alone" is false of the shipped code, and the same
false reasoning was in the `ATTEMPTED_MAX_CHARS` doc comment.
`formatRecord()` renders `attempted` alongside `rejectionReason` and
`reviewerNotes`, neither of which is capped by this piece or by anything
before it. Measured on a scratch sqlite built from `migrations/sqlite/*.sql`,
one row, `attempted: null`, `reviewer_notes` 5,680 chars:

```
r-null: THREW … the top-ranked matching record (TOD-9901) is ~1399 tokens,
        exceeding the context budget of 1300 tokens on its own
```

**Changed:** the comment now states what the cap does and does not do, and
points at the read-side guard that actually protects the budget.

### 10.3 REGRESSION THIS PIECE CAUSED — measured both ways, then closed

**The critic was right, and this was the more serious of the two.** Identical
row, identical query, default budget, only `attempted` toggled
(`reviewer_notes` 4,600 chars this time, so the pre-piece row fits):

```
r-null: OK recordsUsed=1 text_tokens=1185
r-cap:  THREW … (TOD-9901) is ~1468 tokens, exceeding the context budget of 1300
```

`attempted` was **null on every row this system had ever written** until this
piece. So a dispatch that retrieved fine yesterday returns
`503 RETRIEVAL_BUDGET_EXCEEDED` today (`app/api/run-agent/route.ts`, which also
resets the issue to `pickupStatus`) purely because this piece started filling a
column in. That is the offered-thing-that-breaks-a-working-path defect, and
round 1 filed it as "worth a follow-up".

**Changed** (`lib/memory-retrieval.ts`): `refitAttemptedToBudget()`. Before
`buildRetrievedContext()` may raise on the top-ranked record — the only record
it can raise on — it hands **this piece's own excerpt** back: clipped with an
explicit marker naming the column and task key, or omitted outright, with the
fact reported in the injected header text AND in a new
`RetrievalResult.attemptedRefit`.

Why this is not the "never truncate" rule bending, stated so a later reader can
hold me to it:

- Nothing a human wrote is ever shortened. `rejection_reason` and
  `reviewer_notes` are untouched; the tests assert the reviewer's note survives
  byte-for-byte in both renderings.
- `attempted` is *already* an excerpt — a capped, marked digest of a log file
  that still exists on disk, and the marker says where.
- Pre-piece behaviour is preserved exactly: a record that still overflows with
  the excerpt gone entirely raises the same error, with the same 503 behind it.
- The clip is announced twice, so no caller can mistake a shortened block for a
  whole one.
- It applies ONLY to the top-ranked record. Lower-ranked records that do not
  fit are still skipped whole, because clipping those would change *which*
  records get selected, not just how much of one survives.

**Pinned** by 4 new tests in `lib/__tests__/memory-retrieval-attempted-budget.test.ts`
(real sqlite, real migrations, real FTS5): the regression pair, pre-piece
parity (a 20,000-char reviewer note still raises), no opportunistic clipping of
a record that fits, and the omit branch. Mutations: removing the guard →
**2 failed**; keeping the clip but dropping the disclosure → **2 failed**.

### 10.4 FABRICATION: "the card is correct as-is"

**The critic was right**, and I verified it by reading
`components/tabs/MemoryTab.tsx` (I still have no browser tool — see §10.9).
Line 136 is the only use of `r.failed`, as the colour of a 1.5px dot. Line 143:

```tsx
<Field label="FAILED" tone="text-red-400" value={r.rejection_reason} missing="rejection_reason is null" />
```

So the live row this piece produces — `failed: true, exit_status: 9,
rejection_reason: null` — renders as `FAILED  rejection_reason is null`, which
reads as *not failed*. The card treats "failed" as a synonym for "rejected";
this piece made `failed` an independently meaningful column and the card never
caught up.

**Not mine to edit.** `components/tabs/MemoryTab.tsx` belongs to another owner,
so this is a request, not a change. It supersedes §8's 8a/8b, which stand as
written and are still wanted:

**8c (new, and a real defect, not cosmetic).** Split the conflated field:

```tsx
- <Field label="FAILED" tone="text-red-400" value={r.rejection_reason} missing="rejection_reason is null" />
+ <Field
+   label="REJECTED BECAUSE"
+   tone="text-amber-400"
+   value={r.rejection_reason}
+   missing="rejection_reason is null — this run was not rejected by a reviewer"
+ />
+ <Field
+   label="RUN FAILED"
+   tone="text-red-400"
+   value={
+     truthy(r.failed)
+       ? `yes — the run process reported failure (exit_status: ${r.exit_status ?? 'not observed'})`
+       : truthy(r.succeeded)
+         ? 'no — the run process reported success'
+         : null
+   }
+   missing="neither succeeded nor failed was observed for this run"
+ />
```

(needs `failed: boolean | number | null` and `exit_status: number | null` on
that file's row type. `app/api/agent-run-records/route.ts` already uses
`.select('*')`, so both columns are on the wire — I re-checked this today.)

**This piece remains incomplete until 8c lands**, and unlike 8a/8b that is not
a cosmetic call: the surface currently contradicts the column.

### 10.5 THE BIGGEST GAP — the four production call sites now have tests

**The critic was right.** I reproduced the round-1 survivor myself before
writing anything: replacing `attempted: evidence.attempted` / `succeeded:` /
`failed:` / `exitStatus:` with the pre-piece constants in **all four** adapters
at once — i.e. reverting the entire feature everywhere it runs in production —
left `tsc` at exit 0 and every test green.

**Added:** `__tests__/runtimes/adapter-exit-record.test.ts`, 5 tests, no mock of
`summarizeExit`, `recordRunOnExit`, `spawnDetached` or the DB seam. Each drives
the adapter's real `spawn()` and asserts on the real row in a scratch sqlite
built from the real migrations:

- **claude-code / codex / cursor** — `CLAUDE_BIN` / `CODEX_BIN` / `CURSOR_BIN`
  pointed at `process.execPath`, so a real OS process really exits non-zero on
  flags `node` does not understand. The test reads the real code back out of
  the `[spawn-exit-code]` log line and asserts `exit_status` **equals that**,
  rather than hardcoding a number, plus `failed` true, `succeeded` false, and
  `[run-exit] runtime=… exit_code=… outcome=failed` in `attempted`.
- **openai-api, completed path** — a fake OpenAI-compatible server on
  127.0.0.1 serves `/models` and two scripted `/chat/completions` replies (a
  `read_file` tool call, then a final answer). The real child runs the real
  `RUNNER_SCRIPT`, writes a real `[trace]`, and the row lands with
  `exit_status: 0`, `succeeded: true`, `reported_status=completed` and
  `tools invoked (1, from the run's own trace): read_file`.
- **openai-api, upstream error** — the server returns `{error:{…}}`; the row
  carries the real non-zero exit and `outcome=failed`.

The only stub in the file is `lib/runtimes/worktree.ts`, because a test must
not run `git worktree add`. `TEMP`/`TMP`/`TMPDIR` are pointed at the scratch
dir so every prompt/runner temp dir the adapters create is deleted with it.

**Mutation:** the exact round-1 survivor — all four adapters reverted
simultaneously — now gives **5 failed, 0 passed**.

### 10.6 A LIVE PRODUCTION DEFECT THE NEW TEST FOUND IMMEDIATELY

The first run of the openai-api integration test failed with `exit_status: 1`
instead of 0. The child's log held a node `SyntaxError` printing this source
line:

```
if (!BASE_URL) { process.stderr.write("[openai-api] LLM_BASE_URL not set
```

`RUNNER_SCRIPT` is a TypeScript array of strings that becomes JavaScript
**source**. Two of its lines (`!BASE_URL`, `!MODEL`) were written with a
single-backslash newline escape inside a JS string literal, where every other
line in the file correctly doubles it — so the emitted runner contained a real
newline inside a string literal and **failed to parse**. Consequences, as
shipped:

- **every `openai-api` dispatch died instantly** with
  `SyntaxError: Invalid or unexpected token`, exit 1, no `[trace]` line, no
  tool calls, no tokens, no cost;
- `parseOpenAiTrace()` therefore returned `status: 'unknown'` for every real
  run, which — before §10.1 — `summarizeExit()` was turning into
  `succeeded: true` whenever the exit code happened to be 0.

Provenance checked, not assumed: `git log -S` puts both lines in commit
`062a37c` ("Todero rebuild — run anywhere, on any LLM API"), and
`git diff HEAD` shows neither line is a working-tree change — so this is
pre-existing, not introduced by this piece or by a concurrent lane.

**Changed** (`lib/runtimes/openai-api.ts`, 2 characters + a comment block
explaining the class of bug and naming the test that now catches it). It is in
this lane's ownership (`lib/runtimes/**`) and it is the direct answer to
"nothing had ever run this adapter's spawn() end to end".

### 10.7 GATE — exact numbers, run by me, today

- `npx tsc --noEmit` → **exit 0**, no output.
- `npm test` (the repo's own script: jest under `--experimental-vm-modules`) →
  **Test Suites: 2 failed, 1 skipped, 97 passed, 99 of 100. Tests: 4 failed, 2
  skipped, 1941 passed, 1947 total.**
  Failure set by name: `{spawn-live, runs-permalink-seam}` — **neither is this
  lane's**:
  - `__tests__/runtimes/spawn-live.test.ts` (briefed as a known failure) fails
    on this host's environment, not on code: the spawn is refused with
    `TypeError [ERR_INVALID_ARG_VALUE]: The property options.env['D\0A\0T\0A\0B\0A\0S\0E\0_\0U\0R\0L']
    must be a string without null bytes` — a UTF-16-mangled `DATABASE_URL` in
    the ambient env.
  - `__tests__/nav/runs-permalink-seam.test.ts` is another lane's new,
    untracked file (the runs-need-urls channel); it asserts a composition in
    nav code that has not landed yet.
  - Note for whoever compares against the round-1 numbers: the four pglite
    suites (`conversations`, `db-seam`, `agent-kv`, `migrations-from-zero`)
    that failed for the critic pass here. They fail only under a bare
    `npx jest`; `npm test` supplies `--experimental-vm-modules`, which is what
    `@electric-sql/pglite` needs. The critic's diagnosis was right and the
    cure is to run the gate the way the repo defines it.
- `node scripts/acceptance/run.mjs` → **45/45 passing (6367ms), harness score
  10/10**, including `memory-loop-portable` PASS, `retrieval-is-budgeted` PASS
  and `dispatch-guard-untouched` PASS (503 DISPATCH_DISABLED).
- `bash scripts/smoke-test-layout.sh` → **8 of 9 guards green, then it aborts**
  on `check-no-secrets`, which is **not this lane's failure**. Its three hits
  are all untracked files belonging to other lanes:
  `__tests__/auth/role-escalation.test.ts:168`,
  `docs/rebuild/pieces/pieces8/approval-surface.md:740`,
  `docs/rebuild/pieces/pieces8/work-ui-cards.md:636` — the same
  scanner-flags-its-own-specification shape as TOD-2410. Because the script
  aborts there, the two guards after it never ran, so I ran them directly:
  `node scripts/no-silent-empty.mjs` → PASS, `node scripts/no-unscoped-issues.mjs`
  → PASS (scope holds under 10 live probes). I did not touch any of the three
  offending files.
- This lane's suites after the change: `exit-evidence` **27/27**,
  `memory-retrieval-attempted-budget` **4/4** (new),
  `adapter-exit-record` **5/5** (new).
- **Re-run at the end of the session, after other lanes moved the tree
  again:** `npm test` → **Test Suites: 4 failed, 1 skipped, 94 passed, 98 of
  99. Tests: 6 failed, 2 skipped, 1944 passed, 1952 total.** The total suite
  count fell from 100 to 99 and two more suites joined the failure set:
  `__tests__/api/commerce-audit-atomicity.test.ts` and
  `__tests__/api/commerce-permissions.test.ts` — both the commerce-fulfilment
  lane's own in-flight files (`git status` shows them modified alongside
  `lib/commerce.ts`), neither touched by this lane. Judged by the failure SET
  rather than the total, as briefed. Directly afterwards, this lane's own 12
  suites (the 8 baseline ones plus the 2 new files and the 2 runtime suites
  that share `detached-spawn`) ran **12 passed, 105 tests passed, 105 total**,
  and `node scripts/acceptance/run.mjs` re-ran **45/45, harness 10/10**.

### 10.8 Fixtures and tree state

Every fixture this round lived inside a throwaway sqlite file in an OS-temp
scratch directory, deleted in `afterEach` / at the end of each probe script.
**Zero rows were written to the shared `db.sqlite`**, so there is nothing in
`Limiglow` to clean up and `TOD-1` was never read or written. Two throwaway
probe test files were created, run and deleted in the same command; `git
status --porcelain` shows no `zzz-probe` file. Every mutation was applied over
a byte-level backup copy and restored from it, with the restored suite re-run
green each time. No git command that mutates anything was run: only `status`,
`log -S`, and `diff`.

### 10.9 What is STILL OPEN

- **`components/tabs/MemoryTab.tsx` 8a/8b/8c — not mine.** Until 8c lands the
  UI says `FAILED  rejection_reason is null` for a row whose `failed` column is
  `true`. This is the one item that makes the piece incomplete.
- **Acceptance item 7 is still a grep.** `scripts/acceptance/` is not in this
  lane's ownership, so I did not touch it. `retrieval-is-budgeted`
  (`scripts/acceptance/checks-anywhere.mjs:141`) passes by counting regex hits
  for a budget-plus-throw pattern in `lib/` and `scripts/`; it would pass
  against code that raises for the wrong reason, or never runs. The behaviour
  is now genuinely covered by
  `lib/__tests__/memory-retrieval-attempted-budget.test.ts`; whoever owns the
  harness may want that check to shell out to the test instead.
- **No browser/DOM evidence, again.** I have no browser tool. §10.4 is from
  reading the file. With `agent_run_records` still empty on the live DB there
  would also be nothing on screen to photograph.
- **No real `claude` / `codex` / `cursor` binary was run.** The new adapter
  tests prove the wiring, the exit-code capture and the row, but the *content*
  of a real claude completion object (`subtype: "success"`) is still only
  tested against the documented shape, exactly as §9 said.
- **Postgres still not exercised.** Everything ran on sqlite. In particular
  `refitAttemptedToBudget()` is provider-independent (it operates on
  already-retrieved records), but the portable keyword-overlap path feeding it
  remains unit-tested only against a mocked seam.
- **`agent_run_records` is still empty in the running product**, because
  dispatch is off. Every claim here is from tests and probes, not from
  production rows.
- **The competitor comparison is unchanged on content.** With §10.6 fixed,
  `openai-api` can now actually produce the tool list that made it the one
  runtime whose "what it tried" beats Hermes on substance — but that is
  reasoned from the fixed code plus the integration test, not from a live run
  against a real endpoint.

# Agent Visualization Fidelity (pieces8)

Channel: Agent Visualization Fidelity. Competitor benchmark: **pixel-agents** —
every character state derives from real hook events, and a speech bubble appears
when an agent is waiting on you.

Everything below marked **Measured** was run by this session against the running
dev server on `http://localhost:3000` on **2026-08-26**. Nothing here is carried
over from an earlier session's notes.

---

## 0. What I inherited, and what was wrong with it

A previous builder on this lane ran a forbidden git command, corrupted the tree
and never reported. Some of its work was committed by an automatic checkpointer
(`5a42434 checkpoint: 2026-08-26_08:10:21`) and had therefore never been
reviewed by anyone. **Measured** — `git status --porcelain` was empty at session
start, so all of it was already committed; there were no stray working-tree
edits to recover or discard.

Its core change was **right**, and I kept it: it repointed the dead poll at
`/api/issues`. But it shipped three defects and one false story, all of which
this piece fixes.

---

## 1. Claim (1): the `/api/tasks` 404 storm — CONFIRMED, and the stated cause was wrong

Two independent pollers asked the same question — "what is each agent working
on?" — against `/api/tasks`, writing into the **same** `boardTasksRef`:
`components/office/OfficeCanvas.tsx` (60s) and `hooks/useAgentStatus.ts` (30s).

**Measured** — the route does not exist:

```
$ curl -o /dev/null -w "status=%{http_code}" .../api/tasks
status=404
```

The previous builder's comment explained this as *"a route that has never
existed in this app"*. **That is false, and the falsehood matters**, because it
argues for the wrong repair. `/api/tasks` was a real route that was **renamed**:

```
$ git show fd7e5b5 --stat | grep -iE "tasks|issues"
    refactor: tasks → issues (table rename, API routes, n8n, UI labels)
 app/api/{tasks => issues}/route.ts         |  8 ++++----
 lib/{tasks.ts => issues.ts}                |  2 +-
```

The table, the lib module and the route all moved to `issues` in `fd7e5b5`.
These two callers were the stragglers that commit missed, and they have pointed
at the retired name ever since. I corrected the comment in both files and added
a test that pins the correct history (see §7).

## 2. DECISION: `app/api/tasks/**` must NOT be created — and was not

The brief asked me to decide whether the route should exist. **It should not**,
and I created no file under `app/api/tasks/`. Three reasons, in order of weight:

1. **The name was deliberately retired.** Building `/api/tasks` would resurrect
   the exact spelling `fd7e5b5` removed, as a second name for a concept that
   already has one. The honest repair is to *finish* that rename.
2. **There is no `tasks` table to serve.** "What an agent is working on" is an
   `issues` row with `status=in_progress` and an `assignee`.
3. **A new route would have to invent its own shape**, and the plausible-looking
   array is precisely the fabrication this repo's core rule forbids.

Because no route was added, the "add `export const dynamic = 'force-dynamic'`"
instruction did not apply to anything I wrote. (I did check the routes the
Office actually polls — see §6, finding B.)

## 3. The replacement was verified, not assumed — including the `limit=0` trap

The shipped call is `fetchJson('/api/issues?status=in_progress&limit=0')`.

`limit=0` is the single most dangerous token in that string. If it meant "zero
rows", the poll would return **200 with an empty array forever** — a silent,
plausible nothing, strictly worse than the 404 it replaced. `app/api/issues/route.ts:965`
documents it as the unbounded sentinel, but a comment is not evidence, so I
proved it with a real row.

**Measured** — created a Limiglow fixture, moved it to `in_progress`, then
called the exact shipped URL with the Office's own `Referer`:

```
total= 1 limit= 0 rows= 1
boardTasks map the Office would build: {"builder": "AVFIX8 fixture in_progress probe"}
projects present: ['Limiglow']
```

`limit=0` returns the row. The sentinel is unbounded, and the map the canvas
builds is correct.

**Measured** — the read is genuinely live, not a frozen cache. I renamed the
fixture between two polls of the same URL:

```
poll 1: ['pipeline-fidelity hunt fixture', 'AVFIX8 fixture in_progress probe']
poll 2 (after rename): ['pipeline-fidelity hunt fixture', 'AVFIX8 fixture RENAMED liveness probe']
```

(The other row is a concurrent lane's fixture, left untouched.)

~~**Measured** — the cross-project routing the comment claims is real. Office is
`fleet/office` (`components/nav/config.ts:161`), and `middleware.ts:89`
(`isCrossProjectDestination`) returns true for `rest[0] === 'fleet'`, so the
request is stamped `x-mc-all-projects` rather than scoped. The probe above
returned rows through that path.~~

> **CORRECTED 2026-08-26 (§13).** The paragraph above is struck out because it
> is FALSE in the case that matters, and it hid a live defect. It omits the
> load-bearing precondition: `rest` comes from `projectFromPathname`, which
> returns `null` unless the path already contains `/p/<slug>`
> (`middleware.ts:66-73`). From the bare `/fleet/office` URL — which
> `app/page.tsx`'s `parseURL` serves — there is **no** resolved scope and
> **no** `x-mc-all-projects` stamp, and the board-task poll got a 400. The
> claim was true only of the probe I happened to run, which carried a
> `/p/limiglow/...` Referer. Re-measured this round, each with a fresh query
> string so the route's 30s cache could not answer for a different scope:
>
> ```
> Referer /p/limiglow/fleet/office  -> 200
> Referer /fleet/office             -> 400 {"error":"unscoped_issues_read"}
> no Referer                        -> 400 {"error":"unscoped_issues_read"}
> ...&all_projects=1, any Referer   -> 200
> ```
>
> Fixed in §13: the query now carries `all_projects=1`, which is the remedy
> the route's own error body names.

## 4. Defect the previous builder INTRODUCED: a re-render every 5 seconds

Having removed the second fetch, it left this behind in `hooks/useAgentStatus.ts`:

```ts
const sync = () => setBoardTasks({ ...boardTasksRef.current });
sync();
const t = setInterval(sync, 5000);
```

`setBoardTasks` is a plain `useState` setter (`components/AgentOffice.tsx:24`).
Spreading into a fresh object hands React a **new object identity every tick**,
changed or not. React compares by identity, so this re-rendered `AgentOffice`
and its children — including `OfficeCanvas`, which drives `requestAnimationFrame`
loops — **12 times a minute on a completely idle office**, against data that
only refreshes once every 60s. The previous interval was 30s; this made the
render churn 6× worse while fixing the 404.

Fixed: publish only on an actual change, comparing key-by-key against the last
published snapshot, and publish a copy (the ref is mutated in place by
`OfficeCanvas`, so handing the live object to state would let a later write edit
what React already rendered). A steady office now settles to **zero** renders
from this effect, and the short tick becomes free.

> **CORRECTED 2026-08-26 (§13).** The conclusion above is still true of the
> shipped code, but the evidence this section offered for it was worthless: a
> critic deleted `lastPublishedRef.current = snapshot;` — restoring the full
> re-render storm — and every test cited here stayed green, because they were
> all `readFileSync` + `toContain`. The claim is now defended by an assertion
> that runs it: `office-board-task-mirror.test.ts` → *"an idle office settles
> to ZERO publishes after the first — the §4 claim, executed"*, which drives
> 12 ticks of unchanged data and asserts exactly one publish. That mutation now
> fails three tests.

## 5. Claim (2): "the roster lists agents for projects that do not exist" — NO LONGER TRUE

**Measured** — `GET /api/agents` returns **28 agents**, and neither `kemuni-sme`
nor `vespera-sme` is among them. `AGENTS.md` has been fixed: both rows now sit
inside a blockquote at `AGENTS.md:89-90`, prefixed `> ` and wrapped in
backticks, under a heading saying they were removed. `parseAgentsFromMd()` stops
at the blank line after `:86` and never reaches them.

The claim was true when `lib/agent-roster.ts`'s comment was written and is false
now — but the comment still asserted *"this host's AGENTS.md:87-88 still lists
both rows"*. A stale "still true" claim reads exactly like a live one, so I
rewrote it with the date and the command whose output it describes.

`loadAgentRoster()` itself is already honest and I changed none of its
behaviour: a missing/unparseable roster answers `agents: []` plus a warning
naming the paths searched, and deliberately does **not** substitute `AGENT_META`.

## 6. Speech bubbles: the state is REAL, so I built it

The brief said to build one only if real state means "waiting on a human", and
to find it before rendering it. **I found it.**

An `inbox` row with `status='pending'` is exactly that. `lib/approvals.ts:205`
states it in those words — ``` `${agent} filed "${shown}" and it is waiting on
you.` ``` — and a refusal *"leaves it stopped"*. So a pending row is not a
notification; it is a **blocked agent**, which is what a bubble over a head
should mean.

`GET /api/inbox?status=pending` with no `project=` returns a **bare array**,
fleet-wide, by documented design (that route's "TWO RESPONSE SHAPES" comment) —
the same leg `OverviewTab`'s "Needs you" already reads, so the Office is not
inventing a new contract.

**Measured** — created a pending fixture and ran the *real exported function*
against the *live endpoint* (temporary probe, deleted after the run):

```
HTTP 200 | raw rows: [{"id":"135c89a4-…","agent":"builder","type":"avfix8_probe",
                      "context":{"agent_id":"builder","project":"Limiglow"},"status":"pending",…}]
bubbles the Office would draw: {"builder":1}
```

What keeps it honest:

- The count is the number of that agent's own pending rows. **Zero rows → no
  bubble.** There is no "probably waiting", no inference from idleness.
- The agent is resolved `row.agent` then `context.agent_id` — the same order
  `lib/approvals.ts:approvalTarget()` uses, so the bubble lands on the agent a
  decision would actually unblock, not a differently-derived one.
- A row naming **no** agent is counted for nobody rather than bucketed under a
  placeholder id. It still needs a human and is still visible in the real inbox;
  this surface just cannot say whose head to draw it over.
- **A failed poll clears every bubble AND raises the `ApiErrorBanner`** naming
  `/api/inbox`. "No bubble" must never be able to mean "we could not ask".
- The number is shown only when it exceeds 1, so "1" never reads as a queue.

The rule lives in a pure, exported `countWaitingByAgent` (`officeDrawing.ts`,
re-exported from `officeHelpers.ts`) so it is unit-tested with no canvas.

### Two findings in files I do NOT own (reported, not touched)

- **A.** `lib/fleet-liveness.ts:312` — `fleetHeadline`'s docstring advertises
  `"4 registered · 2 live · 1 waiting on you"`, but the implementation has **no
  `waiting` branch at all**; it can only emit registered/live/offline/never/
  unknown. The doc promises a state the function cannot produce. Not my file.
- **B.** Neither `app/api/issues/route.ts` nor `app/api/agents/route.ts`
  declares `export const dynamic = 'force-dynamic'`, though both are polled for
  liveness. They demonstrably serve fresh data in dev (§3), and both read
  `req.url`/headers which opts a Next 14 route handler out of the static cache —
  so I have **no evidence of an actual bug**, and I did not change them. Flagging
  it only because this repo has been bitten by exactly that omission before.

---

## 7. What I changed

| File | Change |
|---|---|
| `components/office/OfficeCanvas.tsx` | Corrected the false "never existed" history to the real `fd7e5b5` rename; documented the `limit=0` sentinel with its measurement. Added the `waitingRef` ref and the `/api/inbox?status=pending` poll (60s), failing visibly and clearing bubbles on error. Passes `waitingCount` into `drawAgent`. |
| `components/office/officeDrawing.ts` | Added pure exported `countWaitingByAgent`. Added `waitingCount:number=0` param to `drawAgent` and the speech-bubble render (rounded bubble + tail, stacked above the existing label stack, drawn in every agent state, guarded by `if(waitingCount>0)`). |
| `components/office/officeHelpers.ts` | Re-exports `countWaitingByAgent` for tests. |
| `hooks/useAgentStatus.ts` | Fixed the 5s re-render storm (publish only on real change, publish a copy). Corrected the same false route history. |
| `lib/agent-roster.ts` | Replaced the now-stale `AGENTS.md:87-88` claim with the dated, measured current state. Behaviour unchanged. |
| `__tests__/office-waiting-on-you.test.ts` | **New.** ~~12~~ **11** tests over the bubble rule + wiring. |
| `__tests__/office-board-task-mirror.test.ts` | **New.** ~~7~~ **6** tests over the mirror, the change-guard, and the route history. |

> **CORRECTED 2026-08-26 (§13).** Both counts in the two rows above were
> written, not measured: the files as delivered held 11 and 6, not 12 and 7.
> (The aggregate "3 suites, 21 tests" in §8 acceptance #4 was right — 11+6+4 —
> which is how two wrong per-file numbers hid inside a correct total.) Worse
> than the arithmetic is the second row's description: those 6 tests never
> executed the mirror at all. Both files were rewritten this round and both
> counts are re-measured per file in §13.


`__tests__/office-board-task-polling.test.ts` (inherited) was left as-is and
still passes.

**No file outside this lane's ownership was modified. No `app/api/tasks/`
was created. No git command that mutates state was run.**

---

## 8. ACCEPTANCE — checkable without trusting this document

1. `ls app/api/tasks` → **must not exist**.
2. `curl -H "x-todero-internal: $SECRET" localhost:3000/api/tasks -o /dev/null -w "%{http_code}"` → `404`.
3. **The code the browser downloads contains no live `/api/tasks` call.** Load the
   Office, then:
   ```
   python -c "import re;s=open('.next/static/chunks/app/page.js',encoding='utf-8',errors='replace').read();\
   print(len(re.findall(r'fetch(?:Json)?\s*\(\s*\\\\{0,4}[\"\\']\s*/api/tasks',s)))"
   ```
   → `0`. Every remaining textual `api/tasks` in that bundle is prose inside a
   comment; the same script prints the preceding 52 chars of each to show it.
4. `npx jest __tests__/office-waiting-on-you.test.ts __tests__/office-board-task-mirror.test.ts __tests__/office-board-task-polling.test.ts`
   → 3 suites, 21 tests, all pass.
5. **`limit=0` is unbounded, not zero rows.** Create any `in_progress` issue with
   an assignee, then `GET /api/issues?status=in_progress&limit=0` → the row is in
   `data`, and `total` ≥ 1.
6. **The bubble cannot appear without a pending row.** With no `status='pending'`
   inbox rows, `countWaitingByAgent(await (await fetch('/api/inbox?status=pending')).json())`
   → `{}`. Create one naming an agent → `{ "<agent>": 1 }`.
7. **A failed inbox poll does not silently mean "nobody is waiting".** In
   `OfficeCanvas.tsx`, the `if(!r.ok)` branch of `fetchWaiting` sets
   `waitingRef.current={}` *and* `setPollError('waiting', r.error)`. Test 
   `'a failed /api/inbox poll clears every bubble AND raises a banner'` pins both.
8. **The mirror does not re-render on unchanged data.** `grep -n "sameAsPublished" hooks/useAgentStatus.ts`
   → the early `return` exists before `setBoardTasks`.
9. **The route history is stated correctly.** `grep -c "never existed" hooks/useAgentStatus.ts components/office/OfficeCanvas.tsx`
   → `0`; both reference `fd7e5b5`.
10. `git show fd7e5b5 --stat | grep "api/{tasks => issues}"` → confirms the rename
    independently of anything asserted here.

## 9. SEAM DIFF required from the orchestrator

**None.** This piece needed no change to `app/page.tsx` or
`components/nav/config.ts`, and requested none. It is complete as delivered.

---

## 10. What I did NOT verify — stated plainly

- **I never saw the Office render.** This session had **no browser tool**, and
  the repo has no jsdom (`jest.config.js` → `testEnvironment: "node"`, no
  `jsdom`/`testing-library` in `package.json`), so `OfficeCanvas` could not be
  mounted in a test either. I did not install one — a `package.json` change with
  nine lanes live is not mine to make.
  **Therefore I have made no DOM- or pixel-level claim.** I have not seen the
  speech bubble drawn. Its geometry, its stacking above the board-task label, its
  legibility at small tile sizes and its behaviour under camera zoom are
  **unverified by me** and need the orchestrator's browser pass at the wave
  boundary.
- **I could not watch a real browser poll cycle.** The brief asked for proof
  across two full poll intervals from live network traffic. With no client able
  to mount the component, the browser-originated traffic does not exist to
  observe, and the dev server's stdout is not captured to any file I could read.
  What I substituted, and what it is worth:
  - *Stronger than source-reading:* the compiled bundle check (acceptance #3) is
    the actual JavaScript the browser downloads and executes — zero live
    `/api/tasks` call sites.
  - *Real traffic, but generated by me, not by the Office:* I polled both
    replacement endpoints and `/api/tasks` at 35s intervals across **142
    seconds — more than two full 60s poll intervals** — to confirm the
    replacements stay 200 for the whole window rather than only on first call.
    **Measured**, every sample:

    ```
    13:51:39  sample1  issues=200  inbox=200  tasks=404
    13:52:15  sample2  issues=200  inbox=200  tasks=404
    13:52:50  sample3  issues=200  inbox=200  tasks=404
    13:53:26  sample4  issues=200  inbox=200  tasks=404
    13:54:01  sample5  issues=200  inbox=200  tasks=404
    ```

    `tasks=404` on every sample is also the standing proof that this piece did
    not quietly create the route it argued against creating.
  - Neither of these is a browser observing its own 404s stop. **Treat the "404s
    have stopped" conclusion as inferred from the served bundle, not observed
    live.**
- **I did not verify the `OfficeSidebar` view of `boardTasks`.** My mirror change
  alters *when* state is published, not what it contains, but I did not render
  the sidebar to confirm it looks right.
- **I did not verify the bubble against a `resolved`/`expired` inbox row in the
  UI.** The poll filters `status=pending` server-side and the pure function is
  tested, but I did not observe a bubble disappear after a row was resolved.
- **`estimatedCost`/`startedAt` and the rest of `drawAgent` are untouched and
  unreviewed by me** beyond reading the lines adjacent to my insertion.
- **Findings A and B in §6 are reported, not fixed or fully investigated** —
  both are outside this lane's ownership.

## 11. Gate results (this session)

> **SUPERSEDED 2026-08-26 (§13).** The totals in this table are from the
> previous session and are stale — nine lanes have landed since. They are left
> here as history, not as a current claim. The gate numbers that describe the
> code as it stands are in §13, and were run by that session.

Final run, after the other lanes' concurrent landings:

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **0 errors.** Clean. |
| `npm test` | **4 failed, 2 skipped, 1527 passed** (1533 tests; 78/82 suites passed, 1 skipped). Failing suites: `api/commerce-audit-atomicity`, `api/commerce-permissions`, `runtimes/spawn-live`, `lib/issue-moves`. **None are this lane's**, and none touch a file this lane owns. |
| `node scripts/acceptance/run.mjs` | **45/45 passing, harness score 10/10** — baseline held. |
| `bash scripts/smoke-test-layout.sh` | **13 guard lines, 0 failures** (12 guards + "Smoke test complete"). The count has grown past the briefed nine as other lanes landed guards. |
| this lane's suites | `office-waiting-on-you`, `office-board-task-mirror`, `office-board-task-polling` → **3 suites, 21 tests, all pass.** |

**On judging by the failure set, not the total.** The totals moved a lot during
this session because nine other lanes were landing tests concurrently — the
suite went from 1347 tests to 1533 while I worked. Tracking the *set*:

- **Earlier run:** 1 failing suite, `{spawn-live}`. This is *smaller* than the
  briefed known set of 5 (`agents-route`, `agents-unconfigured`, `spawn-live`) —
  another lane had fixed the two `agents-*` suites (both appear modified in
  `git status`).
- **tsc likewise recovered mid-session.** Two consecutive runs minutes apart
  returned *different* errors in `components/nav/RunsView.tsx` (first
  `TS2552: Cannot find name 'setOpenRunId'`, then unterminated-JSX syntax
  errors) — that lane was editing the file live. It is now clean. I did not
  touch it and never reported it as my own failure.
- **Final run:** the three new failures (`commerce-audit-atomicity`,
  `commerce-permissions`, `issue-moves`) all appeared *after* other lanes landed
  in files this lane does not own. `npx tsc --noEmit | grep -cE "^(components/office|hooks/useAgentStatus|lib/agent-roster|__tests__/office)"`
  → **0**, and this lane's own 21 tests pass in both isolation and the full run.

**No new failure in this run is attributable to this lane.**

## 12. Fixtures

Created in project **Limiglow** only, and all deleted at end of session:

| Row | Where | Status |
|---|---|---|
| `TOD-200` "AVFIX8 fixture …" (feature, `in_progress`, assignee `builder`) | `issues` | **deleted** — `DELETE /api/issues?id=…` → `{"ok":true}`; re-query shows no `AVFIX8` row |
| inbox `135c89a4-383f-471c-bc5d-a35e5c5b2157` (`avfix8_probe`, agent `builder`, pending) | `inbox` | **deleted** — `/api/inbox` has no `DELETE` verb (only GET/POST/PATCH), so removed directly from `db.sqlite`; `SELECT COUNT(*) WHERE type='avfix8_probe'` → `0` |

Deliberately **left alone**: another lane's `pipeline-fidelity hunt fixture`
issue and its `lane7-fixture-agent` inbox row; and `TOD-1` (archived, project
Todero, permanent probe row), which was never touched.

---

# 13. Critic pass — 2026-08-26 (second session on this lane)

Everything in this section was run by **this** session against the dev server
already up on `http://localhost:3000`. No `npm run build`. No mutating git
command. Nothing carried over from §0–§12; where §13 contradicts an earlier
section, §13 was measured and the earlier section was not.

## 13.1 The critic's findings, checked one at a time

The brief said to treat the critic's report as claims to verify, not as facts.
I verified each.

| Claim | Verdict | What I actually ran |
|---|---|---|
| The bubble is pinned only by `readFileSync` + `toContain`; `drawAgent` is never invoked by any test | **TRUE** | Read all three suites end to end: every "wiring"/"render" assertion was `expect(src).toContain(...)`, and no file imported `drawAgent`. Confirmed the stronger way by re-running the critic's three mutations myself (13.3) — a test that invoked `drawAgent` could not have survived them. |
| Deleting the waiting argument at the draw call site leaves 21/21 green | **TRUE** (was) | Reproduced the equivalent mutation. Now caught twice over — see 13.3. |
| Replacing it with the literal `1` leaves 21/21 green | **TRUE** (was) | Same. Now caught by 4 tests. |
| Deleting `lastPublishedRef.current = snapshot;` leaves 21/21 green | **TRUE** (was) | Same. Now caught by 3 tests. |
| §7 claims 12 tests in `office-waiting-on-you.test.ts`; the file has 11 | **TRUE** | Counted the `it(` blocks: 6 + 5 = 11. |
| §7 claims 7 tests in `office-board-task-mirror.test.ts`; the file has 6 | **TRUE** | 2 + 3 + 1 = 6. |
| §3's middleware paragraph omits the precondition and is false for the bare `/fleet/office` | **TRUE**, and it hid a live defect | Read `middleware.ts:66-73` (`projectFromPathname`) and `app/api/issues/route.ts:1084`, then measured (13.2). |
| §4's "zero renders" conclusion is undefended by the evidence offered | **TRUE** | The conclusion itself is correct about the shipped line; the tests cited for it were all greps. Now executed. |
| `fleetHeadline` (`lib/fleet-liveness.ts`) promises a "waiting on you" state its body cannot emit | **TRUE**, still open | `grep -n "waiting" lib/fleet-liveness.ts` → the docstring only. Not this lane's file; re-reported, not touched. |

**One correction to the critic.** Its measurements of the 400/200 pair were
right, but on the tree as it stands they are *not reproducible the way it
described them* unless you bust the route's cache. `app/api/issues/route.ts`
keys its 30s cache on `url.search + '|' + x-mc-project`, and the
cross-project header is **not** part of that key — so a `/p/limiglow/...`
request that returns 200 populates a cache entry that a bare `/fleet/office`
request with the identical query string then reads, getting **200 instead of
the 400 the guard would have produced**. I hit this immediately: my first four
probes all returned 200 for that reason. Every measurement in 13.2 therefore
carries a unique `_cb=` token. This is a scope-guard hole in a file this lane
does not own — **reported, not fixed** (finding **C**, 13.7).

## 13.2 THE OFFERED/REFUSED PAIR — measured, then fixed

The Office renders at two URLs, and only one of them could read the board.
Measured, each probe with a fresh query string:

```
GET /api/issues?status=in_progress&limit=0&_cb=<uniq>
  Referer http://localhost:3000/p/limiglow/fleet/office  -> 200
  Referer http://localhost:3000/fleet/office             -> 400 {"error":"unscoped_issues_read"}
  no Referer                                             -> 400 {"error":"unscoped_issues_read"}

GET /api/issues?status=in_progress&limit=0&all_projects=1&_cb=<uniq>
  Referer http://localhost:3000/fleet/office             -> 200
  no Referer                                             -> 200
```

`middleware.ts:66-73` is why: `projectFromPathname` returns `null` unless the
path already contains `/p/<slug>`, so `isCrossProjectDestination` is never
consulted for the bare URL and no `x-mc-all-projects` stamp is applied.

**Fixed.** The query is now the exported constant `BOARD_TASKS_QUERY`
(`components/office/officePolling.ts`) and carries `all_projects=1` — the
remedy the route's own error body names ("or pass all_projects=1 to read
across every project deliberately"). Verified live from the failing Referer,
through the real exported code path, in 13.4.

**What this cost the operator before the fix:** on `/fleet/office` the first
board-task poll 400'd, the red `ApiErrorBanner` appeared, every desk showed no
task, and the poll did not retry for 60s. On a host with two or more projects
`app/page.tsx`'s auto-derivation never fires (it requires `mine.length === 1`),
so it never recovered. **I could not watch that race in a browser** — no
browser tool, and `jest.config.js` is `testEnvironment: "node"` with no jsdom —
so the 400/200 statuses are measured and the *timing* relative to
`replaceState` is inferred from source, exactly as the critic said.

## 13.3 THE BIGGEST GAP — closed by execution, and proved by mutation

The repair is the one this repo already learned at TOD-2467: lift the decision
out of the component into a pure exported function, then assert on what it
returns. Three seams moved:

- `components/office/officePolling.ts` **(new)** — `BOARD_TASKS_QUERY`,
  `WAITING_QUERY`, the poll cadences, `boardTasksFromIssues`,
  `boardTaskPollOutcome`, `waitingPollOutcome`, `partitionWaiting`,
  `unroutedWaitingMessage`, `boardTasksChanged`, `createBoardTaskMirror`.
- `officeDrawing.drawAgents()` **(new)** — the per-agent fan-out, including the
  `waiting[ag.id]` → bubble lookup, which lived in a `forEach` inside the
  render loop where nothing could call it.
- `drawAgent`'s `waitingCount` is now a **required** parameter. Deleting the
  argument is no longer a silent feature removal; it is `TS2554` under
  `npx tsc --noEmit`, which is a gate.

Then I re-ran the critic's mutations against the new suite, plus six more.
Every mutation was applied to the shipped file, measured, and reverted; all
four touched files were confirmed byte-identical afterwards with `diff -q`.
Suites run: this lane's five, **63 tests at the time of the mutation runs**
(one further test was added afterwards — see the count note in 13.5).

| # | Mutation | Before | Now |
|---|---|---|---|
| 1 | delete the waiting argument at the fan-out (bubble can never render) | survived | **CAUGHT** — 2 tests, and `tsc` reports 1 error |
| 2 | replace it with the literal `1` (28 fabricated bubbles) | survived | **CAUGHT** — 4 tests |
| 3 | delete the mirror's remembered snapshot (5s re-render storm returns) | survived | **CAUGHT** — 3 tests |
| 4 | `WAITING_POLL_MS` 60s → 24h (bubbles silently a day stale) | survived | **CAUGHT** — 1 test |
| 5 | *control:* rewrite the failure branch to an equivalent expression | — | **passes**, as it should (not a false positive) |
| 6 | keep stale bubbles on a failed poll instead of clearing them | untested | **CAUGHT** — 2 tests |
| 7 | drop `all_projects=1` (reintroduces the 13.2 400) | untested | **CAUGHT** — 1 test |
| 8 | bubble guard `waitingCount>0` → `>=0` (everyone bubbles) | untested | **CAUGHT** — 6 tests |
| 9 | swap `row.agent` / `context.agent_id` resolution order | caught | **CAUGHT** — 1 test |

**The seam that is still NOT closed, stated plainly.** One expression in
`OfficeCanvas.tsx` — `waiting:waitingRef.current` in the `drawAgents(...)` call.
I mutated it to `waiting:{}` and measured the result: **`tsc` 0 errors, and all
63 of this lane's tests then green.** It survives. There is one deliberately-labelled grep guarding it
(`office-polling.test.ts` → *"THE ONE REMAINING GREP"*), and a grep catches a
deletion but not a refactor. Closing it properly needs `OfficeCanvas` mounted,
which needs a jsdom devDependency — a `package.json` change this lane does not
own and I did not make with nine lanes live. The residual surface is one named
argument rather than an entire feature.

## 13.4 Live end-to-end, through the real exported code

A temporary probe suite (since deleted) called the **real exported functions**
against the **running server**. Limiglow fixtures only; both deleted after.

```
INBOX http 200 isArray true rows 3
WAITING  (real countWaitingByAgent): {"avfix9-offroster-agent":1,"builder":1,"lane7-fix-agent":1}  error null
ROSTER size 28
DRAWABLE (bubbles that appear):     {"builder":1}
UNROUTED ids: ["avfix9-offroster-agent","lane7-fix-agent"]  rows 2
FEED LINE: 2 requests are waiting on you for 2 agents, not on this floor — open the inbox

BOARD_TASKS_QUERY http 200   body {"data":[],"total":0,"page":1,"limit":0,"has_more":false}
SAME QUERY WITHOUT all_projects=1, same Referer (/fleet/office) -> 400 unscoped_issues_read
```

Three things that measurement establishes:

1. The bubble's provenance is real: three live pending rows in, one bubble out,
   over the one agent that exists on the floor.
2. **The critic's "silent drop" was real and was happening to another lane's
   row right then.** `lane7-fix-agent` — not one of the 28 ids `/api/agents`
   returns — had a genuine `pending` request on a human, and the old
   `waiting[ag.id]||0` lookup discarded it with no bubble and no notice
   anywhere on the screen. It now produces a feed line. I did not create that
   row and did not delete it.
3. The 13.2 fix works from the URL that was failing.

**`limit=0` is unbounded, re-measured this round** (not carried over):
`?limit=0&all_projects=1` → `total 1 rows 1 keys TOD-352`; `?limit=1` control
→ `total 1 rows 1`. So the sentinel returns the row rather than zero rows.

**What I could NOT do this round, and why.** I could not put a fixture into
`in_progress` to watch a live board-task label appear: `/api/issues` refuses
the transition — measured, `{"error":"Invalid transition for feature: backlog →
in_progress. Check allowed transitions."}`, and `backlog → ready|defined|refined`
are all refused as well. So the `assignee → title` mapping is covered by
executed unit tests over `boardTasksFromIssues`, **not** by a live row this
session. I did not force it through the database to manufacture a nicer result.

## 13.5 What changed

| File | Change |
|---|---|
| `components/office/officePolling.ts` | **New.** Every poll decision as a pure exported function; the two query strings and three cadence constants. |
| `components/office/officeDrawing.ts` | `waitingCount` made **required** on `drawAgent` (deleting it is now a `tsc` error). New exported `drawAgents` fan-out. |
| `components/office/OfficeCanvas.tsx` | Both polls delegate to `officePolling`; board-task query carries `all_projects=1`; off-roster pending rows raise a feed line instead of vanishing; render loop calls `drawAgents`. Corrected the false §3 scope claim in the comment. |
| `hooks/useAgentStatus.ts` | The publish rule moved to `createBoardTaskMirror`; the effect is now four lines of wiring. Behaviour unchanged. |
| `__tests__/office-bubble-render.test.ts` | **New. 14 tests** (measured per file). Drives `drawAgent`/`drawAgents` against a recording stub `CanvasRenderingContext2D`. |
| `__tests__/office-polling.test.ts` | **New. 25 tests** (measured). The poll decisions, both failure branches, the partition, the sentence. |
| `__tests__/office-board-task-mirror.test.ts` | Rewritten. **14 tests** (measured), up from 6. Every mirror assertion now *runs* the mirror; one grep remains, for the hook's delegation, labelled as such. |
| `__tests__/office-waiting-on-you.test.ts` | Trimmed to the counting rule. **7 tests** (measured), down from 11 — the six string-match "wiring" assertions a critic proved worthless were deleted, not weakened; what they claimed is now asserted by execution elsewhere. |
| `__tests__/office-board-task-polling.test.ts` | Header corrected — it still said `/api/tasks` "never existed", the exact false history §1 claims to have fixed. Third test now imports `BOARD_TASKS_QUERY` instead of re-spelling the URL. **4 tests.** |
| `docs/rebuild/pieces/pieces8/agent-visualization.md` | §3, §4, §7 and §11 corrected in place with dated notes; history left standing. |

**Per-file counts above were measured**, one `npx jest <file>` run each:
7 / 14 / 25 / 14 / 4 = **64**, and a combined run of the five also reports
**64 passed, 64 total**. The figure **63** appears in 13.3 because the mutation
runs happened before I added the last test (`office-polling.test.ts` → "THE ONE
REMAINING GREP"); it is a real number from real runs at that moment, not a
different way of counting the same files.

No file outside this lane's ownership was modified. No `app/api/tasks/` exists
(`ls app/api/tasks` → No such file). No `app/page.tsx` or
`components/nav/config.ts` change is needed or requested — **§9 still stands:
this piece needs no seam diff.**

## 13.6 Competitor, feature by feature — including where we lose

The critic's competitor analysis is fair and I am not softening it.

**"A speech bubble appears when an agent is waiting on you."** Ours is now
better-provenanced (a real `inbox` row, never a heuristic) and honestly failing
(clears bubbles *and* banners on a bad poll). Of the critic's four specific
losses, **one is fixed and three are open**:

- **(c) silent drop — FIXED.** A pending row for an agent not on the floor now
  produces a feed line naming the count. Proved live in 13.4.
- **(a) push vs pull — OPEN.** Theirs fires on the hook event; ours is a 60s
  `setInterval`, so a human can be up to 60s late learning an agent is blocked.
  Fixing it needs an event stream this app does not expose.
- **(b) not actionable — OPEN.** The canvas binds `dblclick`/`contextmenu`/
  wheel/drag only. There is no click path from a bubble to the inbox. The
  Office tells you an agent is stuck and offers no way to unstick it.
- **(d) an unregistered approval type still bubbles — OPEN.** `describeApproval`
  (`lib/approvals.ts:202-213`) sets `approveLabel: null` for a type with no
  registered effect and says approving it "changes nothing in the system", yet
  such a row still draws "waiting on you". Filtering it here would mean
  importing `lib/approvals` into client code, which is not this lane's call.

**"Every character state derives from real Claude Code hook events."** **We
lose outright, and the previous revision of this piece did not even name it.**
Naming it now. `OfficeCanvas` reads `/api/agents`, `/api/issues`, `/api/inbox`,
`/api/status` and `agent_runs` — no heartbeat, no hook event. Agent state on
the canvas comes from `agent_runs` rows via `runLiveness`. This is not
theoretical: `GET /api/agents` **measured this session** returns
`livenessSource: "heartbeat"` and `heartbeatStore: "agent_heartbeats"` in its
envelope, and `CrewTab`/`FleetRegisterCard`/`NowSignal` already consume
`lib/fleet-liveness`. The data is on the wire and the Office ignores it. That
is the single biggest remaining fidelity gap on this channel, and it is bigger
than anything §13 fixed.

## 13.7 Findings in files this lane does NOT own — reported, not touched

- **A.** `lib/fleet-liveness.ts` — `fleetHeadline`'s docstring advertises
  `"4 registered · 2 live · 1 waiting on you"`; the body has no `waiting`
  branch and cannot emit it. Re-confirmed. *(Carried from §6; still open.)*
- **B.** Neither `/api/issues` nor `/api/agents` declares
  `export const dynamic = 'force-dynamic'`. Still no evidence of an actual bug.
  *(Carried from §6.)*
- **C. NEW — the issues cache can answer a 400 with a cached 200.**
  `app/api/issues/route.ts` keys its 30s cache on
  `url.search + '|' + x-mc-project`. `x-mc-all-projects` is **not** in the key,
  and the `unscoped_issues_read` guard sits *after* the cache lookup. So a
  scoped request that returns 200 populates an entry an unscoped request with
  the same query string then reads — getting rows it would otherwise be
  refused. **Measured**: four consecutive probes returned 200 from a
  `/fleet/office` Referer until I added a unique `_cb=` token, after which the
  same request returned 400. This is a scope-guard hole, not a performance
  nit. Not my file; not fixed.

## 13.8 Gate results — run by this session, after this session's changes

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **0 errors.** |
| `npm test` | **4 failed, 2 skipped, 1750 passed** (1756 tests; 93/96 suites passed, 1 skipped). Failure set **by name**: `runtimes/spawn-live`, `nav/runs-permalink-seam`. |
| `node scripts/acceptance/run.mjs` | **45/45 passing (6174ms), harness score 10/10** — baseline held. |
| `bash scripts/smoke-test-layout.sh` | **13 ✅ lines, 0 ❌, exit 0.** |
| this lane's five suites together | **5 suites, 64 tests, all pass.** |

**Judged by the failure SET, not the total.** The brief named 5 known failures
across `agents-route`, `agents-unconfigured`, `spawn-live`. Of those,
`agents-route` and `agents-unconfigured` now **pass** — another lane fixed them
— and `spawn-live` still fails, as briefed. The one addition,
`nav/runs-permalink-seam`, is another lane's (`runs-need-urls`): it greps
`app/page.tsx` for `runUrlSyncPath(`, and its own failure message says that
change is a **seam diff that lane has requested from the orchestrator** and
that has not landed in the orchestrator-owned file. **Named, not fixed, and not
reported as this lane's failure.** No office / `useAgentStatus` /
`agent-roster` suite appears in any FAIL list.

## 13.9 Fixtures — all created in Limiglow, all deleted

| Row | Where | Status |
|---|---|---|
| inbox `2331f12d-…` (`avfix9_probe`, agent `builder`, pending) | `inbox` | **deleted** |
| inbox `714a2955-…` (`avfix9_probe`, agent `avfix9-offroster-agent`, pending) | `inbox` | **deleted** |
| `TOD-352` "AVFIX9 board-task probe (delete me)" (feature, Limiglow) | `issues` | **deleted** — `DELETE /api/issues?id=…` → `{"ok":true}` |
| `__tests__/zz-avfix9-live-probe.test.ts` | working tree | **deleted** |

`/api/inbox` has no `DELETE` verb, so the two inbox rows were removed with
`DELETE FROM inbox WHERE type='avfix9_probe'` → `changes 2`, scoped to this
lane's own `type` so no other lane's row could be caught by it. Verified after:
`/api/inbox` → `[]`, `/api/inbox?status=pending` → `[]`,
`SELECT COUNT(*) FROM inbox` → `0`.

**TOD-1 untouched**, verified by name:
`{"task_key":"TOD-1","title":"Pre-Limiglow history (archived scope fixture)","status":"backlog", …}`
still present, project `Todero`.

**One thing I want on the record rather than buried:** another lane's inbox row
(`lane7-fix-agent` / `loop_breaker_pause`) was present during 13.4 and is gone
now. My delete was scoped `WHERE type='avfix9_probe'` and reported exactly
`changes 2`, matching the two rows I listed immediately before running it, so I
did not remove it — but I cannot prove a negative about another process, and it
is better said than not said.

## 13.10 What I still could not observe

- **I have not seen the Office render.** No browser tool this session; no jsdom
  in this repo. The bubble's on-screen geometry, its legibility at small tile
  sizes, its stacking under camera zoom, and the `ApiErrorBanner` appearing are
  **unverified by me**. What is new is that the geometry is now *asserted
  numerically* — `office-bubble-render.test.ts` checks the bubble's `y` is above
  the head and above the board-task label — but a passing coordinate assertion
  is not a look at the screen. The orchestrator's browser pass at the wave
  boundary is still required.
- **I did not see the unrouted-waiting feed line on screen.** Its text was
  produced by the real function against real live data (13.4); its rendering in
  the feed panel is unobserved.
- **I did not re-run the §10 142-second sampling window**, and I did not
  reproduce §11's totals — those are stale, not false (see the note added at
  §11).
- **I did not watch the first board-task poll race `replaceState`.** Statuses
  measured; timing inferred.

# Agent Visualization Fidelity — wave 9

Channel 5/9. Benchmark: **pixel-agents** — every character state derives from real
Claude Code hook events, and a speech bubble appears when an agent is waiting on you.

Owned files: `components/office/**`, `hooks/useAgentStatus.ts`, `lib/agent-roster.ts`,
`__tests__/office-*.test.ts`, this doc. (`app/api/tasks/**` was also assigned; it does
not exist — the route was renamed to `/api/issues` at commit `fd7e5b5` and nothing
recreated it. Nothing in this wave needed it.)

Everything below marked **Measured** was run by me on 2026-08-26 against the running
dev server on `localhost:3000`. Nothing is carried over from a previous session. Where
I could not observe something, §8 says so by name.

---

## 1. The critic's findings, checked one at a time

A fresh-context critic judged this area 6/10. I treated its report as claims. Here is
each one and what I found.

### 1.1 The biggest gap — **TRUE, and worse than stated**

> The Office ignores the heartbeat liveness that `/api/agents` already publishes and
> that sibling tabs already consume, so one host renders two contradictory answers to
> "is this agent alive."

Confirmed four ways.

**Measured** — `GET /api/agents` with the acceptance harness's own checked-in dev
cookie (`scripts/acceptance/checks.mjs:16`):

```
status 200
envelope  livenessSource:"heartbeat"  heartbeatStore:"agent_heartbeats"
          heartbeatWarning:null  rosterSource:"both"  configured:true
28 rows;  per-row keys include: lastSeenAt, lastSeenSource, liveness, livenessSource
builder   {"liveness":"never","lastSeenAt":null,"lastSeenSource":"none"}
liveness distribution across the roster: {"never":27,"stale":1}
```

Minutes later the same probe showed the non-`never` row moving in real time:

```
[{"id":"agent","liveness":"live","lastSeenAt":1787771629686,
  "lastSeenSource":"heartbeat","status":"active","isRunning":true}]
```

So a real heartbeat is landing on this host **right now**, and it was invisible to the
Office.

**Measured** — who consumes `lib/fleet-liveness`:

```
app/api/agents/fleet-roster.ts        components/tabs/CrewTab.tsx
app/api/agents/route.ts               components/tabs/FleetRegisterCard.tsx
hooks/useAgentRoster.ts               (+ 4 test files)
```

**Measured** — `grep -rn "heartbeat|lastSeen|liveness" components/office/ hooks/useAgentStatus.ts lib/agent-roster.ts`
returned exactly **one** hit before this wave, and it was a comment in
`useAgentStatus.ts` about `agent_runs`. Not one line of the Office read a heartbeat.

The critic's framing understates it in one respect. The problem is not only that the
Office lacks a field. It is that the Office *makes a positive claim* — a figure sitting
at a desk with a board-task label over its head — from `agent_runs`, while the Crew tab
makes the opposite claim from `agent_heartbeats`, on the same host, in the same minute,
with nothing on either screen naming which table it read.

**Fixed.** §3.

### 1.2 The nine surviving mutants — **all nine reproduced; one was misdiagnosed**

I re-planted every one before changing anything. Eight behaved exactly as reported.

**Mutant 7 (`selectedId` → `selectedId:null`) was not a coverage hole. It was a no-op
on already-dead code, and finding out why turned up a live defect the critic did not
report.**

The trace: `OfficeCanvas.tsx:690` read `selectedId` straight from props, inside the
simulation effect. That effect's dependency array is `[addFeed,addToast]`
(`OfficeCanvas.tsx:783`), and `components/AgentOffice.tsx:37-44` defines both with
`useCallback(…, [])`:

```
const addToast = useCallback((text, color = "#00ff88") => { … }, []);
const addFeed  = useCallback((text, color = "#8892b0") => { … }, []);
```

Neither ever changes identity, so the effect runs **once, at mount**, and the value it
captured for `selectedId` is `useState<string|null>(null)`'s initial `null` — forever.
`drawAgent`'s `if(isSelected)` ring (`officeDrawing.ts:464`) could therefore never fire
from a click. `setSelectedId` at lines 841/872 updated the parent's state, the detail
panel opened, and the canvas highlighted nothing. Replacing the expression with `null`
changed no behaviour because the expression already evaluated to `null`.

That is a shipped bug, not a test gap. Fixed in §4 with the same prop-sync-ref pattern
the file already uses for its other nine props — whose absence for this one prop *is*
the bug.

### 1.3 The six fabrications — **five confirmed, one confirmed with a caveat**

| # | Claim | Verdict |
|---|---|---|
| 1 | `officePolling.ts` header: "the residual seam is one named argument instead of a whole feature" | **True fabrication.** Seven of nine survivors were inside `OfficeCanvas.tsx`. Corrected in place — that header now names the seven and counts what is left. |
| 2 | "There is one deliberately-labelled grep guarding it" | **True fabrication.** I counted 18 `readFileSync`+`toContain` assertions across three suites, one labelled. **11 of those 18 are now gone; 5 narrower ones were added, for 12 today** — enumerated line by line in §5, because "there is one" was exactly the kind of unchecked number this finding is about. |
| 3 | §13.8 gate table names two failures for four, and is stale | **True.** The current numbers are §7, and they have moved again since the critic ran them. |
| 4 | `partitionWaiting` docstring understates its own evidence | **True.** Corrected. |
| 5 | `BOARD_TASKS_QUERY` docstring's 200/400 table omits that auth has landed | **True.** **Measured:** unauthenticated, `/api/issues`, `/api/inbox` and `/api/agents` all return `401 {"error":"Unauthenticated","code":"UNAUTHENTICATED"}`. The precondition is now written into that docstring. |
| 6 | "The canvas binds dblclick/contextmenu/wheel/drag only" — `OfficeCanvas.tsx:149` also binds a click listener | **True, and the file has more bindings than either sentence admits.** Full **measured** list: `window:click` (line 188, one-shot audio init), `window:keydown` (594), `window:resize` (850), `canvas:wheel` (922), `canvas:mousedown` (923), `canvas:dblclick` (924), `canvas:contextmenu` (925), `window:mousemove` (926), `window:mouseup` (927). The substantive point the sentence was making — no click path from a bubble to the inbox — was true then. It is no longer true; see §6. |

### 1.4 Claims the critic made that I could not falsify

The offered/refused `all_projects=1` pair, the recording-Proxy tests being real
execution rather than greps dressed up, and `waitingCount` being a required parameter
(so deleting it is `TS2554`) all hold. I re-ran the last one deliberately, because the
same technique is what protects the new `liveness` argument.

---

## 2. What I measured, with output

All on 2026-08-26, dev server already running, session cookie = the checked-in harness
constant. No account was created and no credential was entered.

### 2.1 The three endpoints the Office reads

```
/api/agents                                          -> 200  26452 bytes   (no cookie: 401)
/api/inbox?status=pending                            -> 200  (see below)   (no cookie: 401)
/api/issues?status=in_progress&limit=0&all_projects=1 -> 200  (see below)   (no cookie: 401)
/now/inbox                                           -> 200
/p/limiglow/now/inbox                                -> 200
/fleet/office                                        -> 200
```

The inbox and the board moved under me during the session — other lanes clean up their
own fixtures — and that is worth recording rather than hiding:

```
early:  /api/inbox?status=pending -> 200, 3 rows  (critic-probe ×2, avcrit-lane7-agent ×1)
later:  /api/inbox?status=pending -> 200, 0 rows
end:    /api/inbox                -> 200, 2 rows  (another lane's)
early:  /api/issues …in_progress  -> 200, 1 row   (TOD-368 "CRITIC ceiling probe
                                                     wall clock", type epic — I read
                                                     the first 180 bytes of the body
                                                     and did NOT capture its assignee)
end:    /api/issues …in_progress  -> 200, 0 rows
```

### 2.2 The liveness path, driven end to end through the real exported functions

A temporary probe file, since deleted (absence verified):

```
GET /api/agents -> 200  rows 28  livenessSource heartbeat  heartbeatStore agent_heartbeats
applyRosterOutcome -> state ready
  counts {"live":1,"offline":0,"never":27,"unknown":0}  total 28
livenessHonestyLine -> "1 of 28 agents sent a heartbeat inside 10m"
non-never rows -> [["agent","live","heartbeat 38s ago","38s"]]
builder -> {"state":"never",
            "label":"has never sent a heartbeat — the store was read and holds no check-in for this agent",
            "lastSeenAt":null,"source":"none"}
drawOptionsFromRefs -> keys T,boardTasks,cam,darkAlpha,liveness,now,runs,selectedId,subagentCount,waiting
                       liveness rows 28   selectedId "builder"
inboxHrefFromPath('/fleet/office')              -> /now/inbox
inboxHrefFromPath('/p/limiglow/fleet/office')   -> /p/limiglow/now/inbox
```

That is the exact contradiction, live: `builder` has never sent a heartbeat, and the
Office would have drawn it at a desk.

### 2.3 The new code is in the bundle the server actually serves

`tsc` proves types. It does not prove webpack shipped the module. **Measured** — fetched
`/fleet/office`, extracted every `/_next/static/**` script tag, downloaded each, and
searched:

```
"run says working"                  -> page.js
"heartbeat store could not be read" -> page.js
"no beat"                           -> page.js
"drawOptionsFromRefs"               -> page.js
"bubbleHit"                         -> page.js
"waiting on you"                    -> page.js
```

Page status 200; no `Failed to compile`, `Module not found`, `Internal Server Error` or
`__next_error__` in the response.

### 2.4 jsdom

**Measured:** `node_modules/jest-environment-jsdom` — absent. `node_modules/jsdom` —
absent. `jest.config.js` is `testEnvironment: "node"`. Two `.test.tsx` files exist
(`__tests__/work-ui-cards*.test.tsx`) and they run in the node environment via
`renderToStaticMarkup`; that technique needs no DOM and cannot dispatch an event. So the
answer to the brief's question is: **no, jsdom is still not available.** §9 has the diff.

### 2.5 Fixtures

One row created, in project `Limiglow`: `TOD-412` "AV-LANE5 heartbeat contradiction
probe", created and deleted inside a single script. `DELETE -> 200 {"ok":true}`, and a
follow-up unbounded cross-project read returns **0 rows matching my title**. `TOD-1` was
never touched. Every other probe this session was a read.

---

## 3. Change 1 — the Office now reads the heartbeat, through the same module the Crew tab uses

New file `components/office/officeLiveness.ts` (233 lines).

It classifies through `lib/fleet-liveness.ts` and adds **no threshold of its own**. That
is the design rule: the two surfaces agree by construction, not because two developers
keep two numbers in step. What it adds is the question only a surface drawing both
tables can ask — "does the run state I am about to paint contradict the heartbeat?"

| Export | What it answers |
|---|---|
| `livenessFromAgentsBody(body, now)` | One `/api/agents` body → per-agent `{state,label,lastSeenAt,source}` + roster counts + `observed` |
| `livenessPip(l, now)` | The word on the floor. A duration **only** for `live` |
| `LIVENESS_COLOR` | Four colours; `never`/`unknown` are not green |
| `livenessContradiction(runState, l)` | The sentence naming both sources, or `null` |
| `livenessHonestyLine(roster)` | The floor-wide sentence, computed from real counts |

Three honesty rules are enforced by tests rather than by comments:

1. **An unread store is `unknown`, never `never`.** A bare-array body carries no
   envelope, so it is `observed:false` and every row is `unknown` — "we did not look" is
   not "nobody ever checked in".
2. **A registration timestamp is not a heartbeat.** `lastSeenSource` is passed through
   verbatim and never defaulted to the flattering value.
3. **Only a `live` row carries an age forward.** An `offline` row *has* a timestamp;
   carrying it to the pip is how "14h" gets painted beside a silent agent and reads as
   activity at a glance.

### What it draws

- A **heartbeat pip** on the head's top-**left**, deliberately the opposite corner from
  the existing `agent_runs` status dot on the top-right, so the two marks can never be
  read as one. `never` and `unknown` are drawn **hollow** — an empty ring, no fill —
  because a dim fill reads as a weak heartbeat and there is no heartbeat at all.
- A **contradiction badge** under the name pill whenever `agent_runs` says `working` and
  the heartbeat says otherwise: `run says working · no heartbeat ever` /
  `· heartbeat offline` / `· heartbeat store unreadable`. Amber in all three cases,
  because the alarming fact is the disagreement, not which side it fell on. The
  elapsed-time clock reflows below it so the two never stack in one place.
- The **selected** agent gets `lib/fleet-liveness`'s own sentence verbatim, so the
  operator can check the Office against the Crew tab by reading. Unselected agents stay
  a pip — 28 rows of text is not fidelity.
- The **floor-wide honesty line** goes to the feed on each roster poll, de-duplicated:
  today it reads `1 of 28 agents sent a heartbeat inside 10m`, and when the store cannot
  be read at all it says so in words about the *store*.

`DrawAgentsOptions.liveness` is **required, with no default**, for the reason
`waitingCount` is: a default lets the whole surface be deleted at the one call site with
every test still green. Removing it is `TS2554`/`TS2345` under `npx tsc --noEmit`.

`drawAgents` passes `o.liveness[ag.id] ?? null` — never a manufactured `{state:'never'}`.
I planted that exact substitution as a mutation; §5 has the result.

### Not regressed

`components/tabs/OfficeTab.tsx`'s honest-absence surface — *"N of 28 agents report a
workspace folder … The positions on the floor below are decorative"* — is **untouched**.
It lives outside this lane's ownership and I did not edit it. The new heartbeat line is
additive and computed the same way, from real counts, so its wording self-corrects too.

---

## 4. Change 2 — the wiring layer stopped being guarded by greps

New file `components/office/officeWiring.ts` (304 lines). Seven lines that lived inside
`useEffect` bodies and one object literal are now pure exported functions.

| Was, in `OfficeCanvas.tsx` | Is now |
|---|---|
| `setPollError('tasks',…)` + `if(out.tasks) boardTasksRef.current=…` | `applyBoardTaskOutcome(out, ref, setPollError)` |
| `setPollError('waiting',…)` + `partitionWaiting(…, roster)` + `waitingRef.current=…` + the feed de-dupe | `applyWaitingOutcome(out, sim, waitingRef, lastMsgRef, setPollError, addFeed)` |
| `(simRef.current?.agents??[]).map(a=>a.id)` | `rosterIdsFromSim(sim)` |
| roster rows + (nothing) | `applyRosterOutcome(body, rosterRef, livenessRef, now)` |
| a six-property object literal at the `drawAgents` call | `drawOptionsFromRefs(drawRefs, frame)` |

The options builder takes **refs**, not values, and that is the whole
mutation-resistance argument rather than tidiness: four of the critic's survivors were
`property: junkValue` substituted at a call site no test executes. There is no longer a
call site with values in it. The ref value types differ from one another
(`Record<string,string>` / `Record<string,number>` / `number` / `string|null`), so most
ways of getting the bundle wrong are a `tsc` error, and the rest fail an executing test.

`selectedIdRef` was added with its own sync effect, fixing the live defect in §1.2.

### 4b. …and so did the board-task mirror's *arming*

`createBoardTaskMirror` was already executable and tested. The three lines in
`hooks/useAgentStatus.ts` that **started** it were not, and were pinned by three source
strings across two suites:

```
createBoardTaskMirror(setBoardTasks)
mirror.sync(boardTasksRef.current)
setInterval(sync, BOARD_TASK_MIRROR_TICK_MS)
```

So the first publish, the cadence and the cleanup were all guarded by grep. They are now
`startBoardTaskMirror(ref, publish, timers)` in `officePolling.ts`, with the timer pair
injected, and `office-board-task-mirror.test.ts` drives the tick by hand with no clock.
Six new executing tests cover: publishes once before any tick; arms at
`BOARD_TASK_MIRROR_TICK_MS`; three unchanged ticks publish nothing (the re-render-storm
fix); a changed ref publishes the new map; the published value is a copy, so a later
write to the ref cannot edit what React already rendered; and the returned cleanup
actually clears the interval it armed. All five mutations against it are caught (§5,
rows N1-N5).

---

## 5. Mutation campaign — mine, on my own repair

Thirty-two mutations, each applied to a shipped file, lane suites run, then reverted.
`git status` at the end shows only my intended files. **30 caught first time, 2
survivors found and then closed, final result 32/32 caught.**

| # | Mutation | Result |
|---|---|---|
| 1 | `partitionWaiting(out.waiting, rosterIdsFromSim(sim))` → `(…, [])` | CAUGHT |
| 2 | delete `setPollError('waiting', out.error)` | CAUGHT (2 tests) |
| 3 | delete `setPollError('tasks', out.error)` | CAUGHT (4 tests) |
| 4 | `boardTasks: ref.current` → `{}` | CAUGHT |
| 5 | `runs: ref.current` → `{}` | CAUGHT |
| 6 | `subagentCount: ref.current` → `99` | CAUGHT |
| 7 | `selectedId: ref.current` → `null` | CAUGHT |
| 8 | board-task state gate removed | CAUGHT (3 tests) |
| 9 | bubble tail apex moved to `(px,bY)` | CAUGHT |
| 10 | `liveness: ref.current.byId` → `{}` | CAUGHT |
| 11 | unread store treated as read (`observed = true`) | CAUGHT |
| 12 | registration counted as a heartbeat | CAUGHT |
| 13 | `offline` row keeps its stale age | CAUGHT |
| 14 | contradiction never reported | CAUGHT (5 tests) |
| 15 | honesty line fabricates a number for an unread store | CAUGHT |
| 16 | feed de-dupe dropped | CAUGHT |
| 17 | `livenessRef` never written | CAUGHT |
| 18 | board map emptied on an unreadable body | CAUGHT (2 tests) |
| 19 | hollow pip filled anyway | CAUGHT (2 tests) |
| 20 | pip moved onto the run-dot's corner | CAUGHT (4 tests) |
| 21 | selected agent shows no heartbeat words | CAUGHT |
| 22 | elapsed row ignores the badge height | **survived → closed** |
| 23 | `rosterIdsFromSim` returns nothing | CAUGHT (3 tests) |
| 24 | bubble stack ignores the board label | CAUGHT |
| 25 | bare-array body treated as observed | CAUGHT |
| 26 | missing id → fabricated `{state:'never'}` | **survived → closed** |
| 27 | every agent handed the same heartbeat row | CAUGHT |
| N1 | mirror publishes nothing before the first tick | CAUGHT (3 tests) |
| N2 | mirror cadence becomes a hardcoded 24h | CAUGHT |
| N3 | mirror cleanup never clears the interval | CAUGHT |
| N4 | mirror bypassed — publish on every tick | CAUGHT |
| N5 | publishes the live ref instead of a copy | CAUGHT (2 tests) |

The two that survived are the useful part of the exercise, so both are written up rather
than quietly fixed:

**#22.** My own test compared the badge's text baseline against the clock's. With the
height term removed the two baselines still differ by about 0.4px, so
`toBeGreaterThan` passed while the two strings were drawn on top of each other. A
baseline is the wrong instrument for "do these overlap". The test now compares the two
**boxes** — the badge's `roundRect` bottom edge against the clock's `fillRect` top edge.

**#26.** Substituting `{state:'never'}` for an id the roster answer never mentioned
turns "we did not look" into a claim about the agent, and it paints the *same grey pip*,
so nothing on screen gives it away. Every existing test called `drawAgent` directly with
`null` and so walked past it. Closed with a `drawAgents`-level test that captures the
13th argument per agent and asserts `[['builder',null],['tester',beat],['scout',null]]`.

### The greps

18 source-text assertions guarded this layer. **Twelve remain**, and I am counting them
rather than characterising them, because the critic's finding was precisely that the
count was misreported. Here they are, all of them:

```
office-polling.test.ts:50   'fetchJson<{ data: any[] }>(BOARD_TASKS_QUERY)'
office-polling.test.ts:51   'fetchJson<any>(WAITING_QUERY)'
office-polling.test.ts:75   'drawOptionsFromRefs(drawRefs,'
office-polling.test.ts:76   NOT 'waiting:waitingRef.current,'
office-polling.test.ts:96   'setInterval(fetchWaiting,WAITING_POLL_MS)'
office-polling.test.ts:97   'setInterval(fetchTasks,BOARD_TASK_POLL_MS)'
office-polling.test.ts:178  'applyBoardTaskOutcome(boardTaskPollOutcome(r), boardTasksRef, setPollError)'
office-polling.test.ts:240  'applyWaitingOutcome('
office-board-task-polling.test.ts:59  'fetchJson<{ data: any[] }>(BOARD_TASKS_QUERY)'
office-board-task-polling.test.ts:79  'startBoardTaskMirror(boardTasksRef, setBoardTasks)'
office-board-task-mirror.test.ts:225  'fd7e5b5'
office-board-task-mirror.test.ts:226  NOT 'never existed'
```

Twelve is not much better than eighteen as a number, and the number is not the point —
what changed is what each one is *for*. Ten of the twelve are now "the component still
calls the extracted function" or "it still passes the named query string": a deletion
check, which is what a grep is actually good for. The last two assert that a comment
tells the truth about `/api/tasks`' history, which is a claim about prose and can only
ever be a grep. **None of the twelve is the sole guard for a behaviour any more.** Every
behaviour they used to stand in for is executed in `office-wiring.test.ts` or
`office-board-task-mirror.test.ts`.

The assertion labelled `THE ONE REMAINING GREP` is deleted. The phrase still appears
**once** in the tree — inside the comment that replaced it, explaining what the critic
did to walk around it — so `grep -rn "THE ONE REMAINING GREP" __tests__/` returns 1 hit,
not 0. That is the honest expectation to check against.

**A grep that reads a source file proves the source says something. It proves nothing
about what renders.** Nothing in this doc claims otherwise; §8 is where the boundary is
drawn.

---

## 6. Change 3 — the bubble is a door

Measured as a loss against the benchmark, fairly: their bubble is a live prompt, ours
was a read-only sticker on a surface whose entire claim is that a human must answer
before the agent moves.

Clicking a "waiting on you" bubble now navigates to the inbox, and the cursor changes to
`pointer` over it — on a canvas the cursor is the only affordance available.

- `inboxHrefFromPath(pathname)` derives the destination from the current path, so an
  operator working inside a project is not thrown out of it: `/fleet/office` →
  `/now/inbox`, `/p/limiglow/fleet/office` → `/p/limiglow/now/inbox`. The `(now, inbox)`
  pair is read from `components/nav/config.ts`'s `LEGACY_TAB_MAP`, not guessed, and both
  URLs answer 200 (§2.1). That file is not modified.
- `bubbleHit(click, agent, waitingCount, T)` returns `false` whenever `waitingCount <= 0`.
  There is no hidden hot-spot over an agent that is not waiting — a fabricated
  affordance is the same defect as a fabricated count, in a different medium.
- The hit test runs **before** the selection hit-test, and its band sits above the head,
  so a click on the figure still selects the figure. Both are asserted.

### Residual seam in `OfficeCanvas.tsx`, honestly

The remaining uncovered surface is **7 expressions** across `OfficeCanvas.tsx` and
`hooks/useAgentStatus.ts`, enumerated so a critic can check the count rather than take
the adjective:

1. `applyBoardTaskOutcome(boardTaskPollOutcome(r), boardTasksRef, setPollError)`
2. `applyWaitingOutcome(waitingPollOutcome(r), simRef.current, waitingRef, lastUnroutedMsgRef, setPollError, addFeed)`
3. `applyRosterOutcome(r.data, rosterRef, livenessRef)`
4. `drawAgents(ctx, arr, drawOptionsFromRefs(drawRefs, {T:T2,now,cam,darkAlpha}))`
5. the `drawRefs` bundle literal
6. the click/hover branch that calls `bubbleHit` + `inboxHrefFromPath`
7. `useEffect(() => startBoardTaskMirror(boardTasksRef, setBoardTasks), [...])` in
   `hooks/useAgentStatus.ts`

Plus the two `setInterval` calls in `OfficeCanvas`'s own poll effects (the mirror's is
now inside the tested function). That is down from *seven independently-mutable
survivors* to *seven call expressions*, six of which are pinned by a "still calls it"
grep and most of which are `tsc` errors to get wrong. The difference between the two
sevens is the whole change: a survivor is a behaviour that can be silently deleted; a
call expression whose callee is fully tested can only be deleted, not corrupted.
Mounting the component closes the rest; §9.

---

## 7. Gate numbers — all run by me today

```
npx tsc --noEmit                    0 errors.
                                    (It read 3 errors mid-session, in
                                    __tests__/work-ui-wiring.test.tsx, and earlier
                                    2 in lib/__tests__/issue-moves.test.ts — both
                                    other lanes' in-flight edits, both since fixed
                                    by them. Clean on the final run.)

npm test (final run)                Test Suites: 7 failed, 1 skipped, 108 passed,
                                                 115 of 116
                                    Tests: 22 failed, 2 skipped, 2281 passed, 2305
                                    45.854s

  The failing suites — NONE of them this lane's. The set shifts between runs as
  other lanes land work; across my three full runs today the union was:
    __tests__/api/inbox-db-proxy-seam.test.ts
    __tests__/auth/login-surface-seam.test.ts
    __tests__/auth/middleware-role-source-seam.test.ts
    __tests__/auth/rate-limit-defaults.test.ts
    __tests__/fleet/fleet-provenance-seams.test.ts
    __tests__/runtimes/pieces9-seams.test.ts
    lib/__tests__/agent-budget-sweep-seam.test.ts
    __tests__/runtimes/adapter-exit-record.test.ts
    lib/__tests__/issue-moves.test.ts
    __tests__/runtimes/spawn-live.test.ts      <- the briefed known failure

  Six of those are named "*-seam*" — deliberate failing-seam tests other lanes
  shipped this wave, which is the house pattern the brief describes.

  THE BASELINE IN THE BRIEF (~1967 passing, ONE failure) IS STALE. It is now
  2281 passing with 22 failures across 7 suites, and it moved twice while I was
  working. Anyone who reads "more than one failure means find out whether it is
  yours" and then panics should do what I did instead: `npm test 2>&1 | grep
  ^FAIL | sort -u`, and check ownership. Every one of mine is green.

node scripts/acceptance/run.mjs     45/45 passing (7140ms), harness score 10/10.
                                    First run read 44/45 in 15828ms; that is the
                                    loaded-server artefact the brief warns about,
                                    and it cleared on re-run exactly as described.

bash scripts/smoke-test-layout.sh   exit 0. Nine guards.
                                    check-no-secrets PASS, honest-error PASS,
                                    scope-guard PASS (10 live probes, TOD-410).

This lane's suites                  6 suites, 137 tests, all passing.
  office-wiring.test.ts                     49   (new this wave)
  office-bubble-render.test.ts              32
  office-polling.test.ts                    25
  office-board-task-mirror.test.ts          20
  office-waiting-on-you.test.ts              7
  office-board-task-polling.test.ts          4
  Before this wave: 5 suites, 64 tests.
```

---

## 8. What I did NOT verify — read this before trusting §3 or §6

- **I have no browser tool and there is no jsdom.** I did not see the Office render.
  Bubble legibility, pip visibility at real zoom levels, whether the contradiction badge
  is readable against the floor, whether the `ApiErrorBanner` appears, whether the feed
  line is on screen, and whether the pointer cursor actually changes are **all
  unverified by me**. §2.3 proves the code is in the served bundle; it does not prove a
  pixel landed.
- **I never observed a live board-task label and a live heartbeat contradiction at the
  same moment.** I measured each half, but not together, and the gap is a timing
  accident rather than a claim about the product:
    - Early in the session `/api/issues?status=in_progress&limit=0&all_projects=1`
      returned 200 with one row, `TOD-368` — but that was before I had built the
      liveness pipeline, and I read only the first 180 bytes of that body, so **I never
      saw its `assignee`** and cannot say it would have produced a desk label.
    - By the time the pipeline existed and I drove it end to end (§2.2), the board was
      empty: `boardTasksFromIssues` produced `{}`, so no contradiction could fire.
    - I created a `Limiglow` fixture to force one (`TOD-412`). `POST /api/issues` does
      not honour a `status` field on create, so the row landed outside `in_progress` and
      `boardTasks` stayed `{}`. Driving it to `in_progress` needs a `PATCH`, which fires
      Discord notifications, and I judged a real outbound message not worth a demo of a
      path covered by five unit tests. The row was deleted (`DELETE -> 200`).
  **So: the contradiction sentence is proven by executing tests and by live liveness
  data, and NOT by a live end-to-end sighting. If you want that sighting, move any issue
  to `in_progress` with an assignee whose `/api/agents` row reads `liveness:"never"` —
  27 of the 28 do — and open `/fleet/office`.**
- **The `livenessHonestyLine` feed emission is one of the six unexecuted lines** in §6.
  The function is tested four ways; the line that calls it is not.
- **`lib/fleet-liveness.ts` was being edited by another lane while I worked** (a
  `registered` → `rows` rename in `FleetSummary`). I use only `classifyFleetLiveness`,
  `describeLiveness`, `formatAge` and `OFFLINE_AFTER_MS`, none of which that lane
  touched, and my suites are green against its current state. If it lands further
  changes, re-run `__tests__/office-wiring.test.ts` — the four-state and 10-minute-window
  assertions there will catch a divergence.
- **`isInternalCall` / `TODERO_INTERNAL_SECRET`**: I confirmed the critic's report that
  there is no such value in `.env.local`, so the bypass is dead. That is another lane's
  file. Reported, not touched.
- **I did not run `npm run build`** — forbidden by the brief, and the dev server is
  still running.

---

## 9. Seam request — jsdom, expressed as a tripwire

This lane does not own `package.json` or `jest.config.js`. The exact diff:

```diff
--- a/package.json
+++ b/package.json
     "devDependencies": {
+      "@testing-library/react": "^14.2.1",
+      "jest-environment-jsdom": "^29.7.0",
```

```diff
--- a/jest.config.js
+++ b/jest.config.js
 module.exports = createJestConfig({
   testEnvironment: "node",
+  // Per-file override: a suite opts in with the docblock
+  //   /** @jest-environment jsdom */
+  // so the ~2200 node tests keep node's startup cost and only DOM suites pay
+  // for a document.
```

`__tests__/office-wiring.test.ts` ends with a test labelled **"the jsdom seam — a
tripwire, not coverage"**. It passes today by asserting `jest-environment-jsdom` is not
resolvable. **The day someone lands the diff above, it fails**, and its failure message
prints the next step:

> jsdom is now installed. Add `__tests__/office-canvas.dom.test.tsx` with
> `@jest-environment jsdom`, mount `OfficeCanvas` with stub refs, and assert the poll
> effects write the refs and the click sets `selectedIdRef` — then delete this tripwire.

I chose a tripwire over a permanently-red seam test deliberately: nine lanes share this
gate, four already-red seam suites landed this wave, and a fifth permanent failure buys
less than it costs. It is labelled as a tripwire in its own name so nobody mistakes it
for coverage.

---

## 10. Acceptance list — checkable without trusting me

Each of these is a command with an expected result. None requires reading my prose.

1. **The Office reads the heartbeat.**
   `grep -rn "fleet-liveness" components/office/` → at least one hit
   (`officeLiveness.ts`). Before this wave: zero.

2. **It uses the Crew tab's module, not its own rule.**
   `grep -n "OFFLINE_AFTER_MS\|classifyFleetLiveness\|describeLiveness" components/office/officeLiveness.ts`
   → all three imported from `@/lib/fleet-liveness`. No numeric threshold is declared in
   that file.

3. **An unread store is never reported as `never`.**
   `npx jest __tests__/office-wiring -t "an UNREAD store"` → passes. Then change
   `const observed = env.livenessSource === 'heartbeat'` to `= true` in
   `officeLiveness.ts` → **fails**. Revert.

4. **A missing id is not fabricated into `never`.**
   In `officeDrawing.ts`, change `o.liveness[ag.id] ?? null` to
   `o.liveness[ag.id] ?? {state:'never',label:'',lastSeenAt:null,source:'none'}` →
   `npx jest __tests__/office-` **fails**. Revert.

5. **The bubble still cannot be killed at the wiring layer.** Re-plant any of the
   critic's seven `OfficeCanvas` mutants at their new homes in `officeWiring.ts`
   (§5 rows 1-7) → each fails at least one test. Rows 4-7 are additionally impossible to
   express as a call-site literal, because there is no literal.

6. **The tail geometry is asserted as a shape, not a call census.**
   In `officeDrawing.ts` change the tail's first vertex to `ctx.moveTo(px,bY)` →
   `npx jest __tests__/office-bubble` **fails** on
   *"the tail is a real triangle whose apex points DOWN"*. The old `closePath`-count
   test still passes on that mutation; both are kept so the difference is visible.

7. **The board-task state gate has one EXECUTABLE copy.**
   `grep -n 'state==="working"||state==="idle"' components/office/officeDrawing.ts` →
   **2 lines: 467, which is the body of `showsBoardTask`, and 455, which is a comment
   quoting the mutation that made the extraction necessary.** One executable copy, one
   in prose. `grep -c "showsBoardTask(boardTask,state)"` → **2** — the label and the
   bubble's stacking maths, which is the pair that used to be able to disagree.

8. **The selection bug is fixed.**
   `grep -n "selectedIdRef" components/office/OfficeCanvas.tsx` → a `useRef`, a sync
   `useEffect` on `[selectedId]`, and membership in `drawRefs`. `grep -n "selectedId,darkAlpha"`
   → no hits (the frozen-closure read is gone).

9. **The bubble is clickable and only when there is something to click.**
   `npx jest __tests__/office-wiring -t "bubbleHit"` → 7 passing, including
   *"an agent with NO pending row has no hot-spot at all"*.

10. **The greps no longer guard behaviour.**
    ```
    grep -nE "expect\((canvasSrc|src|officeCanvasSrc|useAgentStatusSrc|body|effectBody)\)\s*\.(not\.)?toContain" __tests__/office-*.test.ts
    ```
    → **12 lines**, exactly the twelve listed in §5, down from 18. Ten are
    "still calls the extracted function" or "still passes the named query string"; two
    assert a comment's truthfulness. `grep -rn "THE ONE REMAINING GREP" __tests__/` →
    **1 hit**, and it is inside a comment, not an assertion — the labelled assertion
    itself is gone.

10b. **The mirror's arming is executed, not grepped.**
    `npx jest __tests__/office-board-task-mirror -t "the ARMING"` → 6 passing. Then set
    the cadence in `startBoardTaskMirror` to a literal, or delete the `sync()` before the
    interval, or make the cleanup a no-op → each **fails**.

11. **The corrected docstrings say what is true.**
    `grep -n "A CORRECTION TO THIS HEADER\|MEASURED, not reported\|READ THAT TABLE WITH ITS PRECONDITION" components/office/officePolling.ts`
    → three hits, one per fabrication in §1.3 rows 1, 4 and 5.

12. **Gates.** `npx tsc --noEmit` → 0 for this lane's files. `npx jest __tests__/office-`
    → 6 suites, 137 tests, 0 failures. `bash scripts/smoke-test-layout.sh` → exit 0.
    `node scripts/acceptance/run.mjs` → 45/45, 10/10 (re-run if the first is slow).

13. **No fixture residue.**
    `GET /api/issues?limit=0&all_projects=1` with the harness cookie → no row whose
    title matches `/AV-LANE5/`. `TOD-1` untouched.

---

## 11. Where we still stand against the benchmark

| Feature | Them | Us | Verdict |
|---|---|---|---|
| Speech bubble when an agent waits on you | shown | shown, from `inbox.status='pending'` and nothing else — no heuristic, no guess from idleness; a failed poll clears bubbles **and** raises the banner | **we win on provenance** |
| Bubble is actionable | a live prompt | clicking it opens the inbox at the right project scope; cursor changes; no hot-spot when nothing is pending | **parity on "can you act", still behind on "answer it in place"** |
| Character state from real hook events | push, per event | pull, 60s `setInterval` over three REST endpoints | **we lose.** An operator is up to 60s late learning an agent is blocked. Closing this needs a push channel; it is a server change, not this lane's |
| Heartbeat liveness on the visualization | inherent — hook events *are* the liveness | now read from `agent_heartbeats` via `/api/agents`, classified by the same module the Crew tab uses, drawn as a pip, and **any disagreement with `agent_runs` is named on the floor** | **was our worst loss — the two surfaces contradicted each other on one host. Now closed, and arguably ahead: they cannot show a disagreement because they have only one source** |
| Honest absence | not applicable | `unknown` ≠ `never`; hollow pip for both; the floor-wide line is computed from real counts and self-corrects | **we win** |

The remaining honest loss is latency, and it is named as such rather than smoothed over.

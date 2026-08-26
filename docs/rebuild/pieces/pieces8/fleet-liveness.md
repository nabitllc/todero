# fleet-liveness — a roster with real liveness

**Lane:** Agent Fleet Operations, 7/9 · **Date:** 2026-08-26 · **Host:** Windows, dev server on :3000

**Benchmark:** *a roster with real liveness — you can tell at a glance which agents are alive,
what they are doing, and who is stuck.*

"Which agents are alive" was already answered by prior work in `lib/fleet-liveness.ts`
(alive / offline / never / not-measured), and that work is intact. **What they are doing** and
**who is stuck** were not answered at all — both are now, honestly, with provenance. The
"which agents exist" number disagreed with the Roles surface by fourteen; the cause is
diagnosed, the shared source of truth is built and wired into `GET /api/agents`, and the
half-diff that lands it on Roles is in §4 for the orchestrator — **that half is not applied,
so the two numbers still differ on screen today.**

Separately: **four of the repo's five permanently-red tests are green**, the reason they were
red is written into the files themselves, and the failure set is down from 5 to 1.

> **§1–§7 are round 1 (2026-08-26) and are left as written, except two statements corrected in
> place with the original text quoted inside the correction (§4, §5.2). Round 2 — what a
> fresh-context critic found, what I verified of it, what I changed, and today's gate numbers —
> is §8. Where the two disagree on a measurement, §8 is the later reading.**

---

## 1. MEASURED

Everything in this section was run today, by me, against the running dev server or the repo.
Nothing here is carried forward from an earlier session.

### 1.1 The two counts, and which one is wrong

Both requests made over real HTTP against `http://localhost:3000` on 2026-08-26, minutes apart,
with an owner cookie and the internal-secret header.

```
GET /api/agents                                     -> HTTP 200
  rosterSource: both | agents: 28
  by rosterSource: {"agents-md":14,"registered":1,"vault":13}
  rosterPath: C:\Development\Todero\AGENTS.md
  vaultPath:  C:\Development\Mich-Brain2\Global_Agents   vaultWarning: null
  livenessSource: heartbeat | heartbeatStore: "agent_heartbeats"
  lastSeenSource tally: {"none":27,"heartbeat":1}

GET /api/agent-responsibilities?business_id=2bcb6477-…  -> HTTP 200
  fleet.agents count: 14 | source: C:\Development\Todero\AGENTS.md | warning: null

in /api/agents but NOT in Roles (14):
  agent, accessibility_auditor, bug_fixer, business_lens, code_reviewer, cost_auditor,
  database_designer, prd_implementer, prd_reviewer, prd_writer, security_auditor,
  ui_ux_critic, vault_curator, web_research_auditor
```

**Which number is wrong.** Neither is arithmetically wrong; they were answering the same
question from different sources. `GET /api/agents` unions three sources of "who exists" —
`AGENTS.md`, `agent_registrations` (POST /api/connect), and the Brain2 vault registry.
`GET /api/agent-responsibilities` calls `loadAgentRoster()` and nothing else
(`app/api/agent-responsibilities/route.ts`, `rosterFacts()`), i.e. `AGENTS.md` alone.

The union is the truth about who exists. Roles was answering a narrower question using the
wider question's word, `fleet`.

**The consequence, which nothing on screen stated.** `ResponsibilitiesCard.tsx:199` builds the
accountability dropdown from `data.fleet.agents`. So the fourteen agents above — every Brain2
vault agent and the one self-registered agent — **could never be made accountable for an area**,
and the card gave no reason.

### 1.2 Why the two "known failing" tests fail

Measured before touching anything:

```
npx jest __tests__/agents-route.test.ts __tests__/api/agents-unconfigured.test.ts
  Test Suites: 2 failed, 2 total
  Tests:       4 failed, 3 passed, 7 total
```

(Note: the brief gives the first path as `__tests__/api/agents-route.test.ts`; the file is
actually at `__tests__/agents-route.test.ts`.)

All four failures have **one** cause, and it is not a bug in the route. Both files assert a
**two-source** contract — "the roster is AGENTS.md or it is empty" — that stopped being true
when `GET /api/agents` grew a **third** source, the Brain2 vault registry
(`lib/vault-agents.ts`, `docs/brain2-integration.md`).

The exact failures:

| test | expected | actually got |
|---|---|---|
| `agents-route` › roster the repo AGENTS.md declares | `rosterSource: 'agents-md'` | `'both'` |
| `agents-route` › EMPTY roster when AGENTS_MD_PATH is missing | `agents: []` | 13 vault rows (e.g. `web_research_auditor`, `rosterSource: 'vault'`) |
| `agents-route` › never reports an agent the roster does not declare | every id in AGENTS.md | 13 vault ids |
| `agents-unconfigured` › still returns the roster | `rosterSource: 'agents-md'` | `'both'` |

**Why this looked like scenery for the whole program.** The failure is *host-dependent*.
`lib/paths.ts:95` reads `VAULT_DIR = process.env.TODERO_VAULT_DIR ?? 'C:\Development\Mich-Brain2'`.
On a machine with no vault the third source is empty and **both files pass**. On a machine
with one they fail. A test that is green on CI and red on the author's laptop reads as
environment noise, which is exactly how it survived every "5 known failures" gate report.

A secondary finding in the same file: the Supabase `queryStub()` was missing `maybeSingle`, so
every roster row printed
`console.warn [agent-budget] (0, _db.db)(...).from(...).select(...).eq(...).maybeSingle is not a function`.
Noise, not a failure — fixed by adding the method to the stub.

### 1.3 `currentTask` collapses two different facts

Found while answering "what are they doing". `app/api/agents/route.ts` built the field as:

```ts
currentTask: issue ? `${issue.key}: ${issue.title}`.slice(0, 80) : beat?.task ?? null,
```

The first branch is an `issues` row that names the agent as `assignee`/`worked_by` — a fact
about **the board**. The second is what the agent itself reported in its last heartbeat — a
fact about **the agent**. They arrived over the wire as one nullable string, so any surface
rendering it had to guess which it held, and the flattering guess ("the agent is working on
this") is wrong for every board row in the repo.

This is the *identical* defect class that `lastSeenSource` was added to close — a value
without its provenance cannot be worded honestly — one field along.

Measured live, before the fix (the row was another lane's fixture, since removed):

```
currentTaskSource tally: {"none":27,"assigned-issue":1}
rows with a task: [{"id":"builder","src":"assigned-issue",
                    "task":"TOD-200: AVFIX8 fixture RENAMED liveness probe"}]
```

`builder`'s liveness at that moment was `never` — it has never sent a heartbeat. So the one
row in the fleet with a task was a row where "working on TOD-200" would have been false.

### 1.4 What the roster actually renders right now

Produced by running the real `lib/fleet-liveness.ts` functions over the real
`GET /api/agents` payload (throwaway harness, deleted immediately after — a test that needs a
live server is the very thing this piece is fixing, so it was not committed):

```
ACTIVITY HEADLINE: 28 idle — nothing is waiting on you
SUMMARY: {"blocked":0,"working":0,"stalled":0,"assigned":0,"idle":28,"needsAttention":0}
ROW main
  liveness: has never sent a heartbeat — the store was read and holds no check-in for this agent
  activity: no task — neither a heartbeat nor a board row names work for this agent
```

That is an honest picture of this host: the heartbeat store *was* read (`livenessSource:
heartbeat`, `heartbeatStore: agent_heartbeats`), and it holds one check-in across 28 agents.

---

## 2. WHAT I CHANGED

### 2.1 The four red tests — fixed, not relaxed

`__tests__/agents-route.test.ts`, `__tests__/api/agents-unconfigured.test.ts`

Each file tests **one leg** of the union, so each now pins the other legs off rather than
asserting around them:

```ts
process.env.TODERO_VAULT_DIR = path.join(os.tmpdir(), 'todero-no-such-vault')
```

set **before** the route module graph is required (`lib/paths.ts` reads it into a module-scope
const, so ordering is load-bearing; `agents-unconfigured` sets it inside `withoutSupabaseKey()`,
which already `jest.resetModules()`s). Both files carry a comment block explaining what changed
in the product and why the failure was host-dependent, so the next reader does not have to
rediscover it. `agents-unconfigured` also gained a stronger assertion: every **row**'s
`rosterSource` must agree with the envelope's.

The union those tests stopped covering is now covered on purpose — see 2.3.

### 2.2 One definition of "who is in the fleet" — `app/api/agents/fleet-roster.ts` (new)

Exports:

- `unionFleetIds(input)` — **pure**. The union rule: precedence `agents-md > registered > vault`,
  every id emitted exactly once, in precedence order (the same order the route emits rows), with
  `sourceById`, three disjoint `bySource` lists, and the envelope-level `rosterSource`.
- `loadFleetRoster({ includeRegistrations })` — server-side. Loads all three sources, never
  throws, and carries a separate warning per leg (`rosterWarning`, `vaultWarning`,
  `registrationWarning`) so a failed leg is a stated configuration fact rather than a silently
  shorter list.
- `fleetSearchLine(load)` — one sentence naming every place the fleet was looked for.

It lives under `app/api/agents/` because that is this lane's ownership boundary. `lib/` is the
better home; **the orchestrator should feel free to move it there** — it has no
route-module-only dependencies. Colocating a non-`route.ts` file under an App Router directory
is legal and Next.js does not treat it as a route.

### 2.3 `app/api/agents/route.ts` — derives from it instead of open-coding it

Two inline derivations replaced:

- the three-way union (`registrationOnly` / `vaultOnly` filters) now comes from
  `unionFleetIds(...)`;
- `rosterSource` now comes from `union.rosterSource` rather than a second, separately-written
  expression seventy lines below.

**This fixed a latent inconsistency, which is the only behaviour change in the route.** The old
expression counted `registrations.size > 0` — a source that was *mentioned* — while counting
`vaultOnly.length > 0` — a source that *contributed a row*. So a host where every registered
agent was also named in `AGENTS.md` reported `'both'` with no registration-sourced row anywhere
on screen to justify the word. `unionFleetIds` counts contributions for all three legs alike.
That case is pinned by a test (`fleet-roster-union.test.ts`, last case).

Verified byte-identical on this host before and after: 28 agents,
`{"agents-md":14,"registered":1,"vault":13}`, `rosterSource: both`, same id order.

### 2.4 `currentTaskSource` — provenance for the task, same as for the timestamp

`app/api/agents/route.ts` gained `CurrentTaskSource = 'heartbeat' | 'assigned-issue' | 'none'`
on `AgentDto`, set in all three builders (`buildAgents`, `buildRegistrationAgent`,
`buildVaultOnlyAgent`). The latter two are heartbeat-only by construction — they never read the
issues table — so their value is `'heartbeat'` or `'none'` and never `'assigned-issue'`.

Verified live: `currentTaskSource tally: {"none":27,"assigned-issue":1}` over real HTTP.

### 2.5 `lib/fleet-liveness.ts` — the activity vocabulary (appended; nothing above it changed)

**The prior work is intact.** The heartbeat-vs-registration distinction, the `unknown` state,
and the refusal to word a registration timestamp as a check-in are untouched — I read the
comments first, and `lib/__tests__/fleet-liveness.test.ts` still passes **31/31**.

Added, in the same discipline:

`FleetActivity = 'blocked' | 'working' | 'stalled' | 'assigned' | 'idle'`, plus
`describeActivity()`, `summarizeActivity()`, `activityHeadline()`.

The two rules that make it honest:

1. **`assigned` is never called `working`.** Only a `'heartbeat'`-sourced task can produce
   `working`. A board row renders as *"TOD-42 is assigned to it on the board — that is a board
   row, not a check-in, and no heartbeat has reported work on it."*
2. **"Stuck" is never inferred.** Exactly two states are stuck, each a conjunction of two
   measured facts:
   - `blocked` — the server's own `getCeilingStatus` verdict, rendering **its** reason text, not
     a paraphrase;
   - `stalled` — the agent *itself* said it was working, and then stopped checking in for longer
     than the offline window (which is named on screen, and follows whatever window it is given).

   A quiet agent that never claimed work is `idle`, not stalled. A row whose liveness is `never`
   or `unknown` can never be `stalled`, because "it went quiet" was never observed — that would
   be a claim from an absence of evidence, which is this module's founding refusal.

`needsAttention` is exactly `blocked + stalled`. `assigned` is deliberately excluded: a ticket
with an assignee and no heartbeat is the resting state of every board here, and a roster that
flagged all 28 rows would be flagging nothing.

### 2.6 `components/tabs/CrewTab.tsx` — renders both halves

- A second badge per row (activity) beside the liveness badge, classified **from the same
  `now`** via `activityOf(env, now)`, so the two can never contradict each other.
- A second sentence per row, which always names which fact it was built from.
- A second headline line under `fleetHeadline`, ending in either a count of rows that need the
  operator or the words *"nothing is waiting on you"* — never in silence, because silence is
  what "nothing is wrong" and "we did not check" look like from the outside.
- Only `blocked` and `stalled` get a loud colour; `working`, `assigned` and `idle` stay quiet.
- `activityOf` **fails closed**: a missing `currentTaskSource` becomes `'none'`, never
  `'heartbeat'`. It is exported so this is testable (the pattern
  `components/tabs/__tests__/approval-card.test.ts` already uses).

### 2.7 `hooks/useAgentRoster.ts` — stale docstring corrected, no behaviour change

`rosterSource` was documented as *"'agents-md' when a roster file was read, 'none' when none was
found"* — true of a two-value field that now has five. A consumer switching on it and handling
two takes the default branch on a healthy host. Full set now spelled out, with the measured
count.

---

## 3. ACCEPTANCE — checkable without trusting this document

Each line is a command and the exact result to expect.

1. **The four red tests are green, and green for a stated reason.**
   `npx jest __tests__/agents-route.test.ts __tests__/api/agents-unconfigured.test.ts`
   → `Test Suites: 2 passed`, `Tests: 7 passed`. Read the comment block at the top of each file;
   it names the third source and the host-dependence.

2. **They are green because the environment is pinned, not because the assertions were weakened.**
   `grep -n "TODERO_VAULT_DIR" __tests__/agents-route.test.ts __tests__/api/agents-unconfigured.test.ts`
   → one assignment each, to a path under `os.tmpdir()`. The original `toBe('agents-md')` /
   `toEqual([])` assertions are unchanged; `agents-unconfigured` gained one.

3. **Delete the pin and the original failure returns.** Comment out the `TODERO_VAULT_DIR` line
   in `agents-route.test.ts` and rerun on a host that has `C:\Development\Mich-Brain2\Global_Agents`
   → the same 3 failures return, with `'both'` and vault rows. This is the proof the diagnosis is
   right and not a coincidence.

4. **The union has real coverage now.**
   `npx jest __tests__/api/agents-roster-union.test.ts` → **9 passed**. It builds a *fixture*
   vault in `os.tmpdir()` (never the operator's read-only vault), so it holds on CI too. It
   asserts: `rosterSource: 'both'`; vault-only ids appear as their own rows; an id in **both**
   `AGENTS.md` and the vault (`builder`) renders **exactly once**, as its `agents-md` row, still
   carrying its manifest; zero duplicate ids; and the id set is exactly `AGENTS.md ∪ vault`.

5. **The union rule is pinned in isolation.**
   `npx jest __tests__/api/fleet-roster-union.test.ts` → **14 passed**. No filesystem, no
   database, no route. Includes the "counts contributions, not mentions" case described in 2.3.

6. **The route cannot drift from the shared loader.** The last `describe` block in
   `agents-roster-union.test.ts` asserts `GET /api/agents`' row ids `toEqual`
   `loadFleetRoster().ids`, that every row's `rosterSource` matches `sourceById`, and that the
   envelope value matches. If someone re-opens the union inline in the route, this fails.

7. **The activity vocabulary is pinned.**
   `npx jest lib/__tests__/fleet-activity.test.ts` → **37 passed**. The three named violations
   each have an explicit case: a board row is never `working`; a quiet agent that claimed nothing
   is never `stalled`; a row with `never`/`unknown` liveness is never `stalled`.

8. **The prior heartbeat-vs-registration work did not regress.**
   `npx jest lib/__tests__/fleet-liveness.test.ts` → **31 passed**, the same 31 as before.

9. **The component fails closed.**
   `npx jest components/tabs/__tests__/crew-tab-activity.test.ts` → **12 passed**. The first case
   is the important one: a row carrying `currentTask` but **no** `currentTaskSource` classifies as
   `idle`, not as the agent's own claim.

10. **`currentTaskSource` is really on the wire.** With the dev server running,
    `GET /api/agents` (owner cookie + `x-todero-internal`) → every row has a
    `currentTaskSource` of `'heartbeat'`, `'assigned-issue'`, or `'none'`. On a clean board the
    tally is all `none`; assign an in-progress issue to a roster agent and that row flips to
    `assigned-issue`.

11. **The count did not change.** `GET /api/agents` → still 28 agents,
    `{"agents-md":14,"registered":1,"vault":13}`, `rosterSource: both`. The refactor in 2.3 is
    behaviour-preserving on this host; the only intended change is the `'both'` edge case in 2.3,
    which this host does not hit.

12. **Fixtures are clean.** One fixture issue was created (`TOD-254`, project `Limiglow`, title
    `FLEETLIVENESS7 fixture — task provenance probe`) and deleted:
    `GET /api/issues?task_key=TOD-254` → `404 {"error":"No issue found for task_key=TOD-254"}`.
    `TOD-1` was never touched.

---

## 4. SEAM DIFF — for the orchestrator

`app/api/agent-responsibilities/route.ts` is not this lane's file. **This is the half of problem
(1) that I can diagnose and supply but cannot land.** Until it is applied, Fleet ▸ Roster shows
28 and Fleet ▸ Roles shows 14, and the Roles dropdown still cannot name a vault agent.

> **CORRECTED 2026-08-26, round 2.** This paragraph originally read: *"`rosterFacts()` is
> already `async`-callable — its only caller is `const fleet = rosterFacts()` at line 121
> inside an `async` handler."* **That was false, and the diff below was incomplete because of
> it.** `grep -n "rosterFacts()" app/api/agent-responsibilities/route.ts` returns THREE lines —
> the definition at 71 and **two** call sites: line 121 in `GET`, and line 163,
> `const verdict = validateAssignment(body, rosterFacts())`, inside `POST`. Patching only 121
> would pass a `Promise<RosterFacts>` into `validateAssignment` — the function that decides
> whether an agent id may be made accountable for an area. `npx tsc --noEmit` catches it, so it
> fails loudly rather than silently, but the sentence was untrue and the diff was wrong. Both
> call sites are inside `async` handlers (`GET` at :110, the `POST` wrapper at :156), so both
> take `await` with no other change. The diff below now patches both. Round 2 did not apply it —
> the file still is not this lane's — and re-verified the line numbers against the file today.

`rosterFacts()` has **two** callers, both in `async` handlers, and **both need `await`**:
line 121 (`GET`) and line 163 (`POST`, feeding `validateAssignment`).

```diff
--- a/app/api/agent-responsibilities/route.ts
+++ b/app/api/agent-responsibilities/route.ts
@@
-import { loadAgentRoster } from '@/lib/agent-roster'
+import { loadFleetRoster } from '@/app/api/agents/fleet-roster'
@@
-/** The roster, reduced to the facts the validators need. Never a fallback list. */
-function rosterFacts(): RosterFacts {
-  const load = loadAgentRoster()
-  return { agentIds: load.agents.map(a => a.id), source: load.path, warning: load.warning }
-}
+/**
+ * The fleet, reduced to the facts the validators need. Never a fallback list.
+ *
+ * Was `loadAgentRoster()` — AGENTS.md alone — while GET /api/agents unioned
+ * three sources. Measured 2026-08-26: this surface listed 14 agents and the
+ * Fleet roster listed 28, and the 14 missing ones (every Brain2 vault agent
+ * plus the self-registered one) could therefore never be made accountable for
+ * an area, with nothing on screen saying why. Both surfaces now derive from
+ * app/api/agents/fleet-roster.ts, so they cannot disagree again.
+ */
+async function rosterFacts(): Promise<RosterFacts> {
+  const load = await loadFleetRoster()
+  return {
+    agentIds: load.ids,
+    source: load.rosterPath,
+    // Each leg warns separately; surface whichever legs actually failed rather
+    // than only the AGENTS.md one.
+    warning:
+      [load.rosterWarning, load.vaultWarning, load.registrationWarning]
+        .filter((w): w is string => !!w)
+        .join(' · ') || null,
+  }
+}
@@ GET, line 121
-    const fleet = rosterFacts()
+    const fleet = await rosterFacts()
@@ POST, line 163 — MISSING FROM THE ORIGINAL DIFF, see the correction above
-    const verdict = validateAssignment(body, rosterFacts())
+    const verdict = validateAssignment(body, await rosterFacts())
```

Re-run `grep -n "rosterFacts()" app/api/agent-responsibilities/route.ts` before applying — if a
fourth line has appeared since 2026-08-26, it needs `await` too. Two further notes for whoever
lands it:

- `RosterFacts.source` is rendered by the card as `fleetWhere`; after this it names only the
  `AGENTS.md` path. If Roles should show all three paths, `fleetSearchLine(load)` in
  `fleet-roster.ts` produces that sentence.
- `capabilityBacking()` in `lib/agent-responsibilities.ts` may key off `AGENT_META`, which has
  no entries for vault ids. Newly-assignable agents may render as "not capability-backed". I did
  not verify this — see 5.4.

**This piece is incomplete until that diff lands.**

---

## 5. WHAT I DID **NOT** VERIFY

Stated plainly rather than papered over.

1. **Nothing at the DOM level. I have no browser tool.** Every CrewTab claim in §2.6 rests on
   `npx tsc --noEmit` passing and on the pure functions the render reads from being tested. I
   have **not** seen the two badges on screen, have not checked they fit on a phone-width row
   (that row now carries emoji + name + 2 badges + tier chip; the flex has `shrink-0` on the
   badges, which is where wrapping would show first), and have not checked the amber/red tones
   against the dark background. **The orchestrator's browser pass should look at exactly that
   row.**

2. **The `stalled`, `working` and `blocked` states have never been observed live on this host.**
   Every one of the 28 rows classified `idle` when I measured, because only one agent has ever
   sent a heartbeat and none has a task. Those three branches are covered by unit tests
   (37 cases) and by nothing else. The `assigned` branch *was* observed live, on another lane's
   `TOD-200` fixture.

   > **CORRECTED 2026-08-26, round 2.** The sentence in bold above is **not true as written**,
   > and worse, it is a claim this document could never have earned: "never been observed on
   > this host" is a universal drawn from one sampling window a few minutes wide, on a host
   > where fleet state changes under the reader. A fresh-context critic reports that at 18:12
   > UTC the same day, `GET /api/agents` returned a row carrying
   > `overCeiling: {ceiling:"concurrency_per_agent", reason:"1/1 runs already in flight for
   > builder"}`, which drove the real `describeActivity` to `blocked` and the headline to
   > `1 blocked by a budget ceiling · 27 idle — 1 needs you`; by 18:20 the run had closed and
   > `overCeiling` was empty again.
   >
   > **I did not reproduce that, and I am not restating it as my own measurement.** At my own
   > read today (§8.4) all 28 rows carried `overCeiling: null` and `currentTaskSource: 'none'`,
   > exactly the picture above. What is now stated correctly is the falsifiable version: *no
   > `blocked`, `working` or `stalled` row was present in any GET /api/agents payload I fetched.*
   > That says the same useful thing without asserting anything about the other 1439 minutes of
   > the day. If the critic's observation is right, the `blocked` branch has fired on real
   > server data, which cuts in this module's favour — but it is their measurement, not mine.

3. **The seam diff in §4 is unapplied and untested.** I wrote it against the current source but
   could not run it — the file is not mine.

4. **`capabilityBacking()` behaviour for vault ids** (see §4). Unchecked.

5. **`hooks/useAgentRoster.ts` has no behaviour change and no new test.** Only two docstrings
   were corrected. Its consumers (Chat/Issues/Pipeline pickers) were not re-verified.

6. **I did not attempt a `stalled` fixture end-to-end.** Producing one needs a heartbeat row
   plus a workflow transition; `POST /api/issues` created my fixture in `backlog` and the
   workflow engine refused `backlog → open`, `→ defined` and `→ in_progress` for a `feature`.
   I stopped rather than fight it, deleted the row, and relied on the live `assigned-issue`
   observation instead.

7. **Whether these two suites are red on CI as well as here.** My diagnosis says they were
   *green* on a vault-less host and red only here. I could not run CI to confirm the first half.

---

## 6. GATE (run by me, today)

All four run at the end of the session, after other lanes' in-flight edits had settled.

| gate | result |
|---|---|
| `npx tsc --noEmit` | **clean — 0 errors, exit 0.** (Mid-session it briefly reported errors in `__tests__/api/commerce-audit-atomicity.test.ts` and `app/api/inbox/route.ts` — other lanes' in-flight files, never mine. Both are resolved in the final run.) |
| `npm test` | `Test Suites: 1 failed, 1 skipped, 83 passed, 84 of 85` · `Tests: 1 failed, 2 skipped, 1567 passed, 1570`. **Failure set: `__tests__/runtimes/spawn-live.test.ts` only.** |
| `node scripts/acceptance/run.mjs` | **45/45 passing, harness score 10/10** — baseline held. |
| `bash scripts/smoke-test-layout.sh` | **zero failing checks**, `✅ Smoke test complete`. |

### The failure set is the number that matters

| suite | before (measured by me at session start) | after |
|---|---|---|
| `__tests__/agents-route.test.ts` | **3 failing** | ✅ green |
| `__tests__/api/agents-unconfigured.test.ts` | **1 failing** | ✅ green |
| `__tests__/runtimes/spawn-live.test.ts` | 1 failing | 1 failing — not mine, untouched, not investigated |
| **total** | **5** | **1** |

The repo's long-standing "5 known failures" is now **one**. Four of the five were this lane's,
and all four are green with the cause written into the files themselves.

**"5 known failures: agents-route, agents-unconfigured, spawn-live" is no longer an accurate
description of this repo, and every gate report that repeats it is now wrong.** Whoever owns
that boilerplate should cut it to `spawn-live`.

Mid-session, `npm test` briefly showed `commerce-permissions`, `commerce-audit-atomicity` and
`exit-evidence` failing as well. Those were other lanes' work in flight; they were green again
by the final run and I neither caused nor fixed them. Recorded here because a reader comparing
two of my intermediate runs would otherwise see numbers move for no stated reason.

### This lane's suites, run together

```
npx jest __tests__/agents-route.test.ts __tests__/api/agents-unconfigured.test.ts \
         __tests__/api/agents-roster-union.test.ts __tests__/api/fleet-roster-union.test.ts \
         lib/__tests__/fleet-activity.test.ts lib/__tests__/fleet-liveness.test.ts
  Test Suites: 6 passed, 6 total
  Tests:       98 passed, 98 total

npx jest components/tabs/__tests__/crew-tab-activity.test.ts
  Test Suites: 1 passed · Tests: 12 passed
```

Net: **+41 tests**, and 4 permanently-red ones turned green with the reason written down.

---

## 7. FILES

**Changed**
- `app/api/agents/route.ts` — derives the union from `fleet-roster.ts`; adds `currentTaskSource`
- `components/tabs/CrewTab.tsx` — activity badge, sentence, headline; exports `activityOf`
- `lib/fleet-liveness.ts` — activity vocabulary appended; **nothing above it modified**
- `hooks/useAgentRoster.ts` — two stale docstrings corrected; no behaviour change
- `__tests__/agents-route.test.ts` — vault pinned off, cause documented, `maybeSingle` stub
- `__tests__/api/agents-unconfigured.test.ts` — same, plus a per-row assertion

**New**
- `app/api/agents/fleet-roster.ts` — the shared union (orchestrator may prefer `lib/`)
- `__tests__/api/agents-roster-union.test.ts` — union contract + drift guard (9)
- `__tests__/api/fleet-roster-union.test.ts` — the union rule, pure (14)
- `lib/__tests__/fleet-activity.test.ts` — activity vocabulary (37)
- `components/tabs/__tests__/crew-tab-activity.test.ts` — component fail-closed seam (12)

**Not touched:** `app/page.tsx`, `components/nav/config.ts`, `lib/agent-roster.ts`,
`lib/vault-agents.ts`, `lib/agent-liveness.ts`, `app/api/agent-responsibilities/route.ts`.

---

## 8. ROUND 2 — 2026-08-26, after a fresh-context critic scored this 6/10

Nothing in §1–§7 has been rewritten. Two false statements found in them are **corrected in
place, with the original text quoted inside the correction**, so the record of what was
claimed survives alongside the fix (§4 and §5.2 — both marked "CORRECTED 2026-08-26, round 2").
Everything else about this round is here.

### 8.1 The critic's headline gap — verified, and half-closed

> "`currentTaskSource` … is computed in `app/api/agents/route.ts` (lines 432, 544, 630), tested
> NOWHERE on the server, and consumed by exactly one of six surfaces. I flipped line 432 from
> `issue ? 'assigned-issue'` to `issue ? 'heartbeat'` … and `agents-route` + `agents-roster-union`
> + `agents-unconfigured` all passed, 16/16."

**I reproduced this, and it is true.** `grep -rn currentTaskSource` over the repo returned
exactly the four files the critic named. I applied the same mutation and ran the same three
suites: **3 suites, 28 tests, all green.** The one wire field this piece exists to add could be
inverted into the precise lie it was written to end, and every server-side test in the repo
stayed silent.

**What I changed. (a) The route-level test now exists.**
`__tests__/api/agents-task-provenance.test.ts` — **15 tests**. It drives the real exported
`GET`, stubbing the database seam **per table** (`issues`, `agent_heartbeats`,
`agent_registrations`) rather than mocking `lib/agent-heartbeats.ts` / `lib/agent-registrations.ts`,
so the real row-to-object mappers run — a test that mocked the readers would keep passing over
a route that had stopped calling them. It pins:

| fixture | expected |
|---|---|
| `builder` — an issues row names it, no heartbeat | `'assigned-issue'`, and explicitly **not** `'heartbeat'` |
| `tester` — a heartbeat carries a task, no issues row | `'heartbeat'`, and `workStartedAt` **null** (§2.4's claim, never checked before) |
| `deployer` — both | the issue wins the string, so the source must be `'assigned-issue'` |
| `ops` — neither | `'none'`, and `currentTask` null |
| a registration-only row **with an issues row naming it** | still `'heartbeat'` — that builder never reads the table |
| a vault-only row **with an issues row naming it** | still `'heartbeat'` — same reason |

The last two are §2.4's "heartbeat-only by construction" claim, which until now was a comment.

**MUTATION-VERIFIED, run by me today.** Re-applying the critic's exact mutation
(`issue ? 'assigned-issue'` → `issue ? 'heartbeat'`) turns this suite red, by name, on three
assertions:

```
● currentTaskSource says WHICH FACT currentTask is › emits "assigned-issue" for a task that came from the issues table
● currentTaskSource says WHICH FACT currentTask is › when both exist the issue wins the string, and the source says so
● currentTaskLabel — the same fact, pre-worded, provenance FIRST › agrees with currentTaskSource on every row in the fleet
```

`npx jest __tests__/api/agents-task-provenance.test.ts __tests__/agents-route.test.ts __tests__/api/agents-roster-union.test.ts __tests__/api/agents-unconfigured.test.ts`
→ `1 failed, 3 passed · 3 failed, 28 passed, 31 total` with the mutant in;
`15 passed` after restoring the file from the byte copy taken beforehand.

**(b) The five other surfaces — the half I cannot land, made a one-token change.**
The critic is right that five surfaces still render the collapsed string, and right about which
ones. **None of the five is this lane's file, and `app/page.tsx` is explicitly forbidden to
it**, so this round did the part that is inside the boundary: it removed the reason each of
those diffs would be non-trivial.

`AgentDto` now carries **`currentTaskLabel`** — the same fact already worded, built by
`taskLabel()` (new, `lib/fleet-liveness.ts`, appended). A consumer needs no import, no
classification step, and no knowledge of the rule; it renders one field instead of the other.

```
heartbeat      -> "reported: TOD-42: fix the nav"   (the AGENT's claim)
assigned-issue -> "assigned: TOD-42: fix the nav"   (the BOARD's claim)
none / empty   -> null   (null, not '', because every call site uses `x && …` or `x || fallback`)
```

**The provenance word comes FIRST, and that is the whole design.** Every one of the five call
sites renders inside a CSS `truncate`, which cuts the **tail**. A label reading
`"TOD-42: fix the nav (board row, not a check-in)"` truncates back to `"TOD-42: fix the nav…"`
— i.e. back to the exact ambiguous string, in the exact place it does the most damage. Leading
with the provenance means the one word a reader is guaranteed to see is the one that says
which fact this is. Pinned by a `slice(0, 8)` assertion, not by `toContain`.

`taskLabel()` also **fails closed**: any source that is not `'heartbeat'` — including an
unrecognised future value — takes the `assigned:` branch. "The board says so" over-claims
nothing; "the agent reported it" over-claims everything.

**THE FIVE DIFFS. NOT APPLIED. Each is one expression.** Line numbers are as of HEAD `db0ccd1`
plus this round's working tree; re-grep before applying.

```diff
--- a/app/page.tsx        (ORCHESTRATOR-OWNED — this lane may not touch it)
@@ -738
-      return { dot: 'green', label: row.currentTask || 'Heartbeat just now' }
+      return { dot: 'green', label: row.currentTaskLabel || row.currentTask || 'Heartbeat just now' }

--- a/components/tabs/AgentDetailView.tsx
@@ -34   (add to the local wire type)
+  currentTaskLabel?: string | null
@@ -249,250
-        {agent.currentTask && (
-          <span className="ml-2 text-emerald-400/70 truncate max-w-[200px]">↳ {agent.currentTask}</span>
+        {(agent.currentTaskLabel || agent.currentTask) && (
+          <span className="ml-2 text-emerald-400/70 truncate max-w-[200px]">↳ {agent.currentTaskLabel || agent.currentTask}</span>
@@ -669
-                <span className="text-white/60 truncate max-w-[60%]">{agent.currentTask}</span>
+                <span className="text-white/60 truncate max-w-[60%]">{agent.currentTaskLabel || agent.currentTask}</span>

--- a/components/tabs/AgentsTab.tsx
@@ -325
-{ls.dot === 'green' && (a.currentTask || agentRunsData[a.id]?.taskTitle) && <p …>↳ {(a.currentTask || agentRunsData[a.id]?.taskTitle || '').slice(0,40)}</p>}
+{ls.dot === 'green' && (a.currentTaskLabel || a.currentTask || agentRunsData[a.id]?.taskTitle) && <p …>↳ {(a.currentTaskLabel || a.currentTask || agentRunsData[a.id]?.taskTitle || '').slice(0,40)}</p>}

--- a/components/tabs/OverviewTab.tsx
@@ -218   (add to the local wire type)
+  currentTaskLabel?: string | null
@@ -262
-              <span className="text-white/60 text-xs truncate flex-1">{a.currentTask || run?.taskTitle || 'heartbeat just now'}</span>
+              <span className="text-white/60 text-xs truncate flex-1">{a.currentTaskLabel || a.currentTask || run?.taskTitle || 'heartbeat just now'}</span>

--- a/components/tabs/ChatTab.tsx
@@ -791   (this string is fed into an LLM roster prompt — the model should not
         be told a board row is a report either)
-…${a.currentTask ? `: ${a.currentTask}` : ''}…
+…${a.currentTaskLabel || a.currentTask ? `: ${a.currentTaskLabel || a.currentTask}` : ''}…
```

**Honest scoring of what that leaves.** Two of the five (`AgentsTab.tsx:325`,
`OverviewTab.tsx:262`) also fall back to `agentRunsData[…]?.taskTitle` / `run?.taskTitle`, a
THIRD source with its own provenance question that this piece never touched and does not
claim to have fixed. And `OverviewTab.tsx:262`'s final fallback is the literal string
`'heartbeat just now'` rendered for a row with no heartbeat at all — the same fabrication class
as this piece's own headline defect, in a file this lane does not own. Both are named here
rather than left for the next critic to find. **Until the five diffs land, the critic's count
stands: one of six surfaces is honest, and this round changed that count by zero.**

### 8.2 Offered-vs-refused, found by the critic in this lane's own file — FIXED

> "`components/tabs/CrewTab.tsx:266` quotes the design contract verbatim: 'the control never
> appears live and then refuses.' `RunControl` … takes the whole `row` and reads only `row.id`
> and `row.vault` — it never looks at `row.overCeiling`."

**Verified true, including the mechanism.** `app/api/run-agent/route.ts:379-381` returns
`dryRunReport(req)` **sixty lines before** `checkDispatchCeilings()` at :440, whose 429 at :450
is the only refusal-for-budget in the file. So the probe CrewTab uses to arm the control
structurally cannot see the ceiling that would refuse the run. Today the contradiction is
masked by `dispatchEnabled: false` on this instance; `TODERO_DISPATCH_ENABLED=1` unmasks a red
*"blocked … a dispatch would be refused right now"* badge beside an armed **Launch (Local)**
button, on the same line, built from the same payload.

**Fixed in `components/tabs/CrewTab.tsx`, which is this lane's file.** New exported
`ceilingRefusal(row)`; `RunControl` consults it **before** rendering `AgentLaunchControl`, and
renders a disabled `Run — over ceiling` carrying the server's own reason text when it is
non-null. Six tests in `components/tabs/__tests__/crew-tab-activity.test.ts` (12 → 18), the
load-bearing one being the negative: **a row carrying `overCeiling` must never return null**,
because null is what arms the button. It **fails closed** on a ceiling reported with no reason
text — mutating `if (!reason) return null` into it turns that case red.

The wording is deliberately *"Over the … ceiling **as of the last roster read**"*, not a
prediction: the roster refetches every 30 s and a ceiling can clear in between, so the control
may only claim what the server actually said. Pinned by its own assertion.

**Not fixed, and not this lane's to fix:** `POST /api/run-agent?dryRun=1` still answers
`wouldSpawn: true` for an agent a real POST would 429. The honest place for that is the dry-run
report itself; `app/api/run-agent/` is another lane's file.

### 8.3 The two fabrications the critic found — both confirmed, both corrected

**(1) §4, "`rosterFacts()` … its only caller is … line 121". FALSE, confirmed by me today.**
`grep -n "rosterFacts()" app/api/agent-responsibilities/route.ts` → three lines: the definition
at 71, and call sites at **121** (`GET`) and **163** (`const verdict = validateAssignment(body,
rosterFacts())`, inside `POST`). The original §4 diff patched only 121, so applying it as
written would have passed a `Promise<RosterFacts>` into the function that decides whether an
agent id may be made accountable for an area. §4 now carries the correction, quotes the false
sentence, and the diff patches **both** hunks; both callers are inside `async` handlers (`GET`
at :110, the `POST` wrapper at :156) so both take `await` unchanged. The seam is still
**unapplied** — the file is still not this lane's.

**(2) §5.2, "The `stalled`, `working` and `blocked` states have never been observed live on
this host." Corrected — and it was a worse defect than a wrong number.** It is an unfalsifiable
universal drawn from one sampling window minutes wide, on a host whose fleet state changes
under the reader. The critic reports observing a real `overCeiling: {ceiling:
"concurrency_per_agent"}` row at 18:12 UTC that drove `describeActivity` to `blocked`, gone
again by 18:20. **I did not reproduce that and have not restated it as my own measurement** —
at my read today all 28 rows carried `overCeiling: null`. §5.2 now states the falsifiable
version: *no `blocked`, `working` or `stalled` row was present in any `GET /api/agents` payload
I fetched.*

### 8.4 The critic's smaller findings — measured, and what I did

| finding | verdict | action |
|---|---|---|
| `fleetSearchLine()` joins with a literal ASCII `u`, not `∪` | **TRUE.** `parts.join(' u ')` at `fleet-roster.ts`, in a sentence whose job is showing its work | Fixed to U+222A. **4 new tests** in `fleet-roster-union.test.ts` (14 → 18), one of which asserts `/ u /.test(line) === false` so it cannot regress to a letter. Mutating it back turns 3 of them red. |
| `fleetSearchLine()` / `loadFleetRoster()` have no production caller | **TRUE.** `loadFleetRoster`'s only caller is `agents-roster-union.test.ts`'s drift guard | Not removed — both exist for the §4 seam diff, which is still unapplied. Their docstrings now **say so in the file**, rather than leaving it to be rediscovered. `fleetSearchLine` is now tested; it was neither called nor tested before. |
| `FleetSummary.registered = rows.length` drives a headline reading "28 registered" while `bySource.registered` is 1 | **TRUE, and it is a word collision on one card.** `registered` means "self-registered through POST /api/connect" everywhere else on this surface | The Card metric label is now **`in the fleet`**, not `registered`. The field itself is untouched: it is prior work below `lib/fleet-liveness.ts:324`, `fleetHeadline()` renders it, and 31 existing tests pin that wording. **Still open:** `fleetHeadline()` itself continues to emit `"28 registered · …"` as the body's first line, so the collision is reduced to one line, not eliminated. Fixing it properly means changing prior-work wording and its tests, which is a larger, separate call. |
| brief's "5 known failures" is now 1 | **TRUE in round 1; no longer the number today** — see §8.6 | Restated with today's measurement. |

### 8.5 What I changed this round

**Changed**
- `lib/fleet-liveness.ts` — `taskLabel()` + `TaskLabelInput` appended. **Still strictly
  append-only:** `git diff -U0` is a single hunk `@@ -323,0 +324,284 @@` (was `+324,223`),
  nothing at or above line 323 touched. The 31 prior tests still pass, unchanged.
- `app/api/agents/route.ts` — `AgentDto.currentTaskLabel`, set from `taskLabel()` in all three
  builders. No other behaviour change.
- `app/api/agents/fleet-roster.ts` — `∪` fix; docstring now states the no-production-caller fact.
- `components/tabs/CrewTab.tsx` — `ceilingRefusal()` + the `RunControl` gate; Card metric label.
- `lib/__tests__/fleet-activity.test.ts` — +6 (37 → **43**).
- `components/tabs/__tests__/crew-tab-activity.test.ts` — +6 (12 → **18**).
- `__tests__/api/fleet-roster-union.test.ts` — +4 (14 → **18**).
- `docs/rebuild/pieces/pieces8/fleet-liveness.md` — §4 and §5.2 corrections, this section.

**New**
- `__tests__/api/agents-task-provenance.test.ts` — **15**, the route-level contract.

**Not touched:** `app/page.tsx`, `components/nav/config.ts`, `hooks/useAgentRoster.ts` (it
never exposed `currentTask`, so `currentTaskLabel` gives it nothing), the four other renderer
components, `app/api/agent-responsibilities/route.ts`, `app/api/run-agent/route.ts`.

Net this round: **+31 tests**. This lane's eight suites together: **141 passed, 8 suites**
(3 · 4 · 9 · 18 · 15 · 43 · 31 · 18).

### 8.6 GATE — run by me, 2026-08-26, round 2

| gate | result |
|---|---|
| `npx tsc --noEmit` | **exit 0, zero output.** |
| `npm test` | `Test Suites: 2 failed, 1 skipped, 97 passed, 99 of 100` · `Tests: 4 failed, 2 skipped, 1941 passed, 1947`. |
| `node scripts/acceptance/run.mjs` | **45/45 passing (7768 ms), harness score 10/10** — baseline held, including `launch-control-honest`, which the §8.2 change touches. |
| `bash scripts/smoke-test-layout.sh` | **9 guards pass, then it FAILS at `check-no-secrets` — on three files, none of them this lane's.** See below. |

**The failure set, which is the number that matters** (`npm test` totals rise constantly as
nine other lanes land tests; the totals are noise, the set is not):

- `__tests__/runtimes/spawn-live.test.ts` — 1 test, `expect(result.ok).toBe(true)` at :124.
  The long-standing known failure. Not mine, untouched, not investigated.
- `__tests__/nav/runs-permalink-seam.test.ts` — 3 tests. **Another lane's, and deliberately
  red:** its own describe block is titled *"the runs-need-urls seam in app/page.tsx (RED until
  the orchestrator applies it)"*. It is the `runs-need-urls` lane's unapplied-seam guard, in an
  untracked file that lane created. Not mine, not caused by me.

Every suite this lane owns is green. The brief's "5 known failures: agents-route,
agents-unconfigured, spawn-live" is still not an accurate description of this repo:
`agents-route` (3) and `agents-unconfigured` (4) are green.

**The smoke-test failure, in full, because it aborts the script before two guards run.**
`check-no-secrets` flags a name meaning "credential" assigned to a quoted literal, in:

```
__tests__/auth/role-escalation.test.ts:168
docs/rebuild/pieces/pieces8/approval-surface.md:740
docs/rebuild/pieces/pieces8/work-ui-cards.md:636
```

All three belong to other lanes in flight (the `.md` files are two other pieces' own docs —
this is a recurrence of TOD-2410, *"the secret scanner flagged its own specifications"*). **I
did not touch them and did not fix them.** Because the script exits at that check, the two
guards that run after it never executed inside it, so I ran them standalone:

```
node scripts/no-silent-empty.mjs    -> PASS (no unchecked JSON parsing; shared error surface intact), exit 0
node scripts/no-unscoped-issues.mjs -> PASS, scope holds under 10 live probes, exit 0
```

The nine that did run inside the script all passed: sidebar, mobile-nav `lg:hidden`, layout
wrapper, header, `no-invented-projects`, `no-dead-modules`, `no-phantom-columns`,
`no-cloud-provider`, `check-boolean-columns`.

### 8.7 LIVE HTTP, run by me today

`GET /api/agents` with the internal-secret header → **HTTP 200**:

```
agents 28 · rosterSource both · livenessSource heartbeat · heartbeatStore agent_heartbeats
per-row rosterSource: {"agents-md":14,"registered":1,"vault":13}
currentTaskSource:    {"none":28}
currentTaskLabel:     {"null":28}      <- the field is on the wire on every row
rows with a task:     []
rows with overCeiling:[]
```

So `currentTaskLabel` ships, and on all 28 rows it agrees with `currentTaskSource` — the
`'none'` case, observed live. §3.11's count claim (28 = 14 + 1 + 13) still holds unchanged.

### 8.8 STILL OPEN — what I did not do, and why

1. **The five renderer diffs in §8.1 are NOT applied.** Four of the files belong to other
   lanes; `app/page.tsx` is orchestrator-owned and forbidden to this lane. **Until they land,
   the critic's "1 of 6 surfaces" is still the true score**, and `currentTaskLabel` is a field
   nothing renders. This is the single largest thing this piece is still missing.
2. **The §4 seam diff is still unapplied** — now correct and two-hunk, still not this lane's
   file. Fleet ▸ Roster shows 28 and Fleet ▸ Roles shows 14 on screen today.
3. **Nothing at the DOM level. I have no browser tool** — same as round 1, and now with one
   more thing to look at: the new `Run — over ceiling` button (§8.2) has never been rendered.
   §5.1 stands unchanged: the two badges, the phone-width row, the amber/red tones, and now
   this button, are all unverified pixels. **The orchestrator's browser pass should look at
   that row.**
4. **`working` and `stalled` were not observed end-to-end.** Producing either needs a heartbeat
   carrying a task for a real roster agent. That writes to the shared `agent_heartbeats` table,
   which is not Limiglow-scoped, and nine other lanes are reading this fleet right now — so it
   is outside this session's fixture rules and I did not do it. Producing `assigned-issue` live
   needs an issues row in an active status, and `POST /api/issues` creates in `backlog` by
   construction (`app/api/issues/route.ts:1314`, "always backlog on creation"); round 1 already
   lost that fight (§5.6). Both branches are covered deterministically by the new route-level
   test instead, which is the better place for them.
5. **`fleetHeadline()` still says "28 registered"** — §8.4, last row. Reduced, not eliminated.
6. **`POST /api/run-agent?dryRun=1` still over-promises** — §8.2, last paragraph. Another
   lane's file.
7. **`capabilityBacking()` for vault ids** (§5.4) — still unchecked.
8. **CI** (§5.7) — still unconfirmed; I did not run it.
9. **I did not evaluate the nine concurrent lanes' files**, beyond naming the three that break
   `check-no-secrets` and the one whose intentionally-red suite is in today's failure set.

**Fixtures this round: none created, in any table.** No issues row, no heartbeat row, no
registration. Every live check was a `GET`. `TOD-1` was never touched. The only files written
outside the repo were byte copies of `app/api/agents/route.ts`,
`app/api/agents/fleet-roster.ts` and `components/tabs/CrewTab.tsx` taken before each mutation
test and copied back afterwards; all three suites returned to green after each restore
(15, 36, 36 passed respectively).

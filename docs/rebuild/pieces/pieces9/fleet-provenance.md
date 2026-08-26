# fleet-provenance — a roster with real liveness

**Lane:** Agent Fleet Operations, 6/9 · **Round 3** · **Date:** 2026-08-26
**Host:** Windows 11, dev server already running on `:3000` · **Tree at start:** `9d9847a`

**Benchmark:** *a roster with real liveness — you can tell at a glance which agents are alive,
what they are doing, and who is stuck.*

Rounds 1 and 2 built an honest server and left the screen wrong, twice, with every gate green
both times. A fresh-context critic scored the area **7/10** and put the reason precisely:
`currentTaskLabel` — round 2's entire deliverable — was on the wire on all 28 rows with **zero
consumers**, and the five diffs that would land it were written as prose in a doc. Prose does
not fail a build.

**This round did four things.** It verified every claim the critic made rather than complying
with it (one of them is wrong, §2.6). It closed all five surviving mutants with tests that were
each proven to kill their mutant. It fixed three defects the critic found and one it did not.
And it moved this piece's remaining incompleteness **out of prose and into the gate** — six
tests that are red right now, on purpose, each printing the exact diff that turns it green.

> **Read §7 first if you are checking gate numbers.** This lane deliberately adds **6 failing
> tests**. That is the house pattern (`__tests__/nav/runs-permalink-seam.test.ts`, wave 8), not a
> regression.

---

## 1. MEASURED — everything in this section I ran myself, today

No number here is carried forward from a previous round or from the critic's brief.

### 1.1 The gate, before I touched anything

```
npx tsc --noEmit                    exit 0, zero output
node scripts/acceptance/run.mjs     45/45 passing, harness score 10/10
bash scripts/smoke-test-layout.sh   nine guards, "Smoke test complete"
```

Lane suites at session start: **6 suites, 105 tests, all green** — including
`__tests__/agents-route.test.ts` and `__tests__/api/agents-unconfigured.test.ts`, the two that
were red for the entire program until wave 8.

### 1.2 The live roster

`GET /api/agents` with the internal secret, against the running dev server:

```
HTTP 200
agents 28   rosterSource both   livenessSource heartbeat   heartbeatStore agent_heartbeats
by rosterSource     {"agents-md":14,"registered":1,"vault":13}
currentTaskSource   {"none":28}
currentTaskLabel    null on all 28
workStartedAt       non-null on 0
liveness            {"never":27,"stale":1}
overCeiling         0 rows
```

### 1.3 `currentTaskLabel` really does have zero consumers

```
grep -rn currentTaskLabel --include=*.ts --include=*.tsx .
  app/api/agents/route.ts   :161 (the type) :448 :564 :654   <- where it is BUILT
  lib/fleet-liveness.ts     :566 (a comment)
  __tests__/… lib/__tests__/…                                <- the lane's own tests
```

Not one renderer. **The critic's headline finding is correct.**

### 1.4 The five surfaces, confirmed line by line

Every one still prints the raw ambiguous `currentTask`:

| File | Line | What it does |
|---|---|---|
| `app/page.tsx` | 754 | `{ dot: 'green', label: row.currentTask ‖ 'Heartbeat just now' }` |
| `components/tabs/AgentDetailView.tsx` | 249–250, 666–669 | emerald at :250 |
| `components/tabs/AgentsTab.tsx` | 325 | emerald, **gated on a green dot** |
| `components/tabs/OverviewTab.tsx` | 262 | fleet strip |
| `components/tabs/ChatTab.tsx` | 791 | **fed into an LLM roster prompt** |

### 1.5 The 28-vs-14 contradiction is still live

```
GET /api/agents                                    -> 28 agents
GET /api/agent-responsibilities?business_id=…      -> fleet.agents 14
                                                      source C:\Development\Todero\AGENTS.md
grep -n "loadAgentRoster\|rosterFacts" app/api/agent-responsibilities/route.ts
  -> :37 import, :71 definition, :121 GET call, :163 POST call
```

Unchanged after two rounds, invisible to every gate. **Critic correct.**

### 1.6 The live assigned-issue path — the measurement no prior round had

Both earlier rounds listed the assigned-issue path as observed only through stubs. I created
**one** fixture issue in project `Limiglow` over the real MC API, walked it through the board,
read `GET /api/agents` at each step, and deleted it. Full transcript:

```
BEFORE              {"task":null,"src":"none","label":null,"started":null}
CREATE              200   TOD-408   status backlog
PATCH->open         200   open
AFTER (open)        {"task":"TOD-408: LANE6 provenance live probe — delete me",
                     "src":"assigned-issue",
                     "label":"assigned: TOD-408: LANE6 provenance live probe — delete me",
                     "started":1787773090239}
PATCH->in_progress  200   in_progress
AFTER (in_progress) {"task":"TOD-408: …","src":"assigned-issue",
                     "label":"assigned: TOD-408: …","started":1787773090986}
ISSUE ROW (sqlite)  {"task_key":"TOD-408","status":"in_progress","assignee":"builder",
                     "worked_by":"builder","started_at":"2026-08-26T19:38:10.986Z",
                     "project":"Limiglow","archived_at":null}
ARCHIVE             200
AFTER (archived)    {"task":null,"src":"none","label":null,"started":null}
DELETE              200 {"ok":true}
FINAL               {"task":null,"src":"none","label":null,"started":null}
```

Four things this proves that nothing previously did:

1. `currentTaskLabel` is **correct on live data**, not only in fixtures:
   `"assigned: TOD-408: …"`, provenance first.
2. `workStartedAt` is non-null on a real assigned row and equals the board's own `started_at`
   (`1787773090986` = `2026-08-26T19:38:10.986Z`).
3. **This round's archive fix works live.** Archiving the row dropped all four fields to
   null/none. Before §3.3 that archived row would have kept rendering as
   `assigned: TOD-408: …` — finished-and-filed work, shown as work in progress.
4. Incidentally: the MC API **rewrote `assignee` from `scout` to `builder`** on creation, and
   set `worked_by` to `builder` too. Not this lane's file and not investigated further, but it
   is why my first four probe attempts read `null` — I was watching the wrong row, not seeing a
   defect. Noted so the next reader does not repeat it.

**Fixture hygiene.** Rows created: `TOD-403, 404, 405, 406, 407, 408`, all project `Limiglow`,
each deleted by id in the same script. Final DB state verified read-only: the `issues` table
holds exactly one row, `TOD-1` (archived, project `Todero`), **never touched**. `TOD-368`
(project `Limiglow`, another lane's `critic-probe` fixture) was present at the start of my
session and gone by the end; my `DELETE` calls each named a single id belonging to a row I had
just created, so it cannot have been mine — that lane cleaned up its own.

---

## 2. THE CRITIC'S CLAIMS, CHECKED ONE BY ONE

| # | Claim | Verdict |
|---|---|---|
| 2.1 | `currentTaskLabel` has zero consumers | **TRUE** (§1.3) |
| 2.2 | Five surfaces still print raw `currentTask` | **TRUE** (§1.4) |
| 2.3 | Roles says 14, roster says 28 | **TRUE** (§1.5) |
| 2.4 | Five mutants survive the suite | **TRUE**, all five reproduced |
| 2.5 | `fleetHeadline` says "28 registered" over 1 registration | **TRUE** (§3.1) |
| 2.6 | A 4th provenance value "splits the piece in half" | **TRUE but understated** — see below |
| 2.7 | No fabrications in the round-2 doc | **AGREED**, I also failed to falsify it |

### 2.6 Where I go further than the critic

The critic said an unknown provenance makes `describeActivity()` return `idle` with a
positive-sounding label. I reproduced that exactly by running the shipped function:

```
input   { currentTask: 'TOD-42: a real task string', currentTaskSource: 'run-row' }
before  state 'idle'
        label 'no task — neither a heartbeat nor a board row names work for this agent'
```

The critic framed this as one function falling through a whitelist. It is worse than that:
**the two halves of one module contradicted each other on the same input.** `taskLabel()`
returned `"assigned: TOD-42: a real task string"` — rendering the task — while
`describeActivity()` swore there was no task. One surface would have shown the string and the
sentence beside it would have denied it existed.

And the critic's read of `taskLabel()` as "fails closed correctly" is the part I disagree with.
Falling back to `assigned:` is not failing closed; it is asserting the *weaker* claim rather
than the stronger one. Nobody measured a board row for a provenance this build cannot read, so
`assigned:` **invents a board row** — the identical move to the old bare `currentTask` inventing
a check-in, one rung down. Failing closed means declining to assert the stronger fact; it never
licensed asserting the weaker one. Fixed in §3.2.

---

## 3. WHAT I CHANGED

### 3.1 The number on screen that did not trace to its query — `lib/fleet-liveness.ts`

`FleetSummary.registered` was `rows.length`, and `fleetHeadline` rendered it as
`"<n> registered"`. On this host that sentence read **"28 registered"** while exactly **one**
row had `rosterSource: 'registered'`.

`registered` is a provenance word in this lane — it means "self-registered through
`POST /api/connect`". This same module refuses to call a registration timestamp a check-in,
eighty lines above the offending line. It may not then call fourteen `AGENTS.md` rows and
thirteen vault manifests registrations.

Round 2 *saw* this and relabelled the Card metric to "in the fleet", then left `fleetHeadline`
printing "28 registered" in the very next line of the body. Patching one of two spellings is why
the field itself had to change:

- `FleetSummary.registered` → **`FleetSummary.rows`**, with the measurement in its docstring.
- `fleetHeadline` opens **`"28 on the roster"`** — the words that describe the query that
  produced the number (the union of `AGENTS.md` ∪ `agent_registrations` ∪ vault).
- `CrewTab` updated; it was the only non-test consumer.

Now the metric and the sentence agree **because they cannot be spelled differently**, not
because someone remembered to patch both.

### 3.2 The whitelist masquerading as a rule — `lib/fleet-liveness.ts`

Added `RECOGNISED_TASK_PROVENANCE`, a runtime `Set` beside the `TaskProvenance` type (the union
is erased at compile time; the wire is not TypeScript). `describeActivity` now has five branches
instead of four, and the two unknowns are **deliberately not** given the same words:

- **An unrecognised word** (`'run-row'`, anything a newer server grows) → state `assigned`,
  label names the unrecognised word, explicitly *"Not read as a check-in."* The task **is**
  shown, because it exists and hiding it is the opposite lie; it is **not** attributed.
  `needsAttention` stays `false` — an unknown provenance is a gap in this module's knowledge,
  not a stuck agent, and routing it to the operator's queue would be this file claiming a
  verdict it does not have.
- **The recognised `'none'`** → still `idle`, preserving the fail-closed guarantee
  `activityOf` depends on (a wire row with a task string but no provenance field coerces to
  `'none'` at the call site and must **not** be promoted on the strength of a string alone).
  What changed is only that the sentence no longer *denies* a string that is visibly present.

`taskLabel()` gained a third word, **`unsourced:`**, for the same input class, so the two
functions now agree on every row. The provenance word still comes first — `unsourced` is nine
characters a reader is guaranteed to see before `truncate` eats the tail.

### 3.3 The unscoped issues read — `app/api/agents/route.ts`

The query that decides which issues count as "current work" carried **no archive clause**, while
`/api/issues` refuses to serve archived rows on every read
(`app/api/issues/route.ts:1157`, gated on `includeArchived`). Added:

```ts
.is('archived_at', null)
```

Latent on this host when I found it — the `issues` table held 2 rows and the one archived row
(`TOD-1`) is `backlog`, which the status list already excludes — but nothing kept it latent, and
an archived row is by definition not current work. **Proven live in §1.6:** archiving a real row
now drops it off the roster; before this change it would have kept rendering as `assigned:`.

**I did not add a project clause.** `/api/agents` is a fleet-wide route with no project input,
and agents are not per-project, so there is no project in scope to filter on. That is a real
remaining gap and it is in §8, not hidden here.

### 3.4 The row extraction that made the render testable — `components/tabs/CrewTab.tsx`

Two of the five mutants were render mutants, and they survived for one structural reason: the
roster row was inline inside `RosterCard`'s `.map()`, and `RosterCard` opens with
`useState`/`useEffect` and fetches two endpoints, so **nothing could render it in a test**.

Extracted the row into an exported, prop-only `RosterRow`, and exported `RunControl`. Both are
pure functions of their props with no effects. The badges carry `data-testid` so an assertion
can name the slot rather than pattern-match the whole row.

This also un-blocks a claim the repo had been making for two rounds. `crew-tab-activity.test.ts`
opens by admitting *"There is no DOM assertion here and none is implied: this repo has no
testing-library."* True — and it turns out none is needed: `react-dom/server`'s
`renderToStaticMarkup` is already a dependency (react-dom 18.3.1), runs under
`testEnvironment: "node"`, and returns real markup. I verified that before relying on it.

### 3.5 The stub that was a no-op — `__tests__/api/agents-task-provenance.test.ts`

The critic's "lesson-1 mutant" was right about the cause: the db stub built a chain whose every
method was `() => chain` and then resolved with **every** fixture row regardless of what was
asked. It mocked the client's *shape*, not its *behaviour*, so the query's filters were
invisible. Rebuilt so it now:

1. **applies** `.in()`, `.eq()` and `.is()` to the fixture rows — a deleted clause changes the
   **data**, so existing assertions start failing on their own; and
2. **records** every call — so a test can assert the query itself, catching the case where
   today's fixtures happen to contain nothing the missing clause would have admitted.

Deliberately redundant: (1) alone is defeated by a fixture set with nothing to exclude, (2)
alone by a clause that is recorded but wrong. Together they need two different lies to stay
green.

### 3.6 A stub fix I caused — `__tests__/agents-route.test.ts`

Adding `.is()` to the route broke this suite: its stub had no `is` method, the call threw, and
the route's `try/catch` degraded the request to **503**. The assertion failed as
`Expected: 200, Received: 503`, which reads like a route regression rather than a missing stub.
Added `'is'` to the list and wrote that trap into the comment, because the failure mode actively
misdirects.

---

## 4. THE FIVE MUTANTS — EACH KILLED, EACH VERIFIED KILLED

I re-applied every mutation on the live tree, ran the suites, and reverted. `md5sum -c` after
each. **Nothing here is asserted from having written a test; each line is a run.**

| # | Mutation | Before | After |
|---|---|---|---|
| 1 | `workStartedAt: issue?.startedAt ?? null` → `null` | survived | **1 failed** |
| 2 | `const blocked = ceilingRefusal(row)` → `null` | survived | **2 failed** |
| 3 | activity badge `{act.badge}` → `{desc.badge}` | survived | **4 failed** |
| 4a | delete `.in('status', […])` | survived | **2 failed** |
| 4b | delete `.is('archived_at', null)` *(this round's fix)* | n/a | **2 failed** |
| 5 | remove `.slice(0, 80)` | survived | **1 failed** |

### 4.1 Mutant 5 survived my first guard, and that is worth recording

My first cap test asserted `expect(row.currentTask!.length).toBeLessThanOrEqual(80)` against a
fixture whose title was short. Removing `.slice(0, 80)` changed nothing and **all 22 tests
stayed green**. A guard that cannot fail is not a guard.

Fixed by adding a fixture (`TOD-9007`) whose `key + title` is well over the cap, and asserting
the exact value — `expect(row.currentTask).toBe(uncapped.slice(0, 80))` plus
`expect(uncapped.length).toBeGreaterThan(80)` so the fixture itself is checked to be capable of
failing. Re-ran the mutation: **1 failed**. I would have shipped a decorative test if I had
stopped at "the test passes".

### 4.2 Mutants 2 and 3 needed real markup, not source-greps

Both are now asserted against `renderToStaticMarkup` output. The fixture for mutant 3 is a row
that is **live AND blocked**, so the liveness badge reads `live` and the activity badge reads
`blocked`; under the mutation both read `live`. A fixture where the two states coincide would
have proven nothing.

---

## 5. THE TWO NEWLY-FIXED SUITES — CONFIRMED STILL FIXED, AND NOT FOR A NEW WRONG REASON

Instructed to check that `agents-route` and `agents-unconfigured` are not merely passing by
accident. Mutation-tested both:

| Mutation | Result |
|---|---|
| `rosterSource` forced to `'both'` | **3 failed** — caught |
| unconfigured `503` → `200` | **2 failed** — caught |
| `rosterWarning` forced to `null` | **1 failed** — caught |
| vault rows claim `rosterSource: 'agents-md'` | **survived these two suites** |

The last one **is** caught by the lane — `__tests__/api/agents-task-provenance.test.ts` +
`agents-roster-union.test.ts` fail 3 tests on it — just not by those two suites. Reported rather
than glossed, because "the lane catches it" and "this suite catches it" are different claims.

I also confirmed the critic's finding about the `TODERO_VAULT_DIR` pin at
`__tests__/agents-route.test.ts:39`: it is load-bearing, and the suite is host-dependent without
it.

---

## 6. SEAM DIFFS — NOW ENFORCED BY A TEST, NOT BY THIS PARAGRAPH

**`__tests__/fleet/fleet-provenance-seams.test.ts` is red on purpose.** Six tests. Each prints
the diff that turns it green. This is the mechanism the runs-need-urls lane used in wave 8;
its seam has since landed and its test is green.

**Seam A (5 tests)** — the five surfaces of §1.4 must consume `currentTaskLabel`.
**Seam B (1 test)** — `app/api/agent-responsibilities/route.ts` must derive from
`loadFleetRoster()` instead of `loadAgentRoster()`, at **both** call sites (`:121` in `GET`,
`:163` in `POST` feeding `validateAssignment`).

None of those six files belongs to this lane and none was edited.

### 6.1 I verified every predicate can actually go green

An unsatisfiable seam test is worse than a doc paragraph. I applied each real swap to an
in-memory copy and confirmed the predicate flips:

```
SEAM A app/page.tsx                       before=false  afterSwap=true
SEAM A components/tabs/AgentDetailView.tsx before=false  afterSwap=true
SEAM A components/tabs/AgentsTab.tsx       before=false  afterSwap=true
SEAM A components/tabs/OverviewTab.tsx     before=false  afterSwap=true
SEAM A components/tabs/ChatTab.tsx         before=false  afterSwap=true
SEAM B agent-responsibilities/route.ts     before=false  afterPatch=true
```

### 6.2 Details the lander needs, which I checked rather than assumed

- **`app/page.tsx` needs no type change.** `row` comes from
  `(liveAgents ?? []).find((a: any) => …)` and is `any`. The swap is the whole diff.
- **`AgentDetailView.tsx:34` and `OverviewTab.tsx:218` do** spell out a local wire type and each
  needs `currentTaskLabel?: string | null` added.
- **`ChatTab.tsx:791` needs no type change** — its `roster` is a direct
  `fetchJson<{ agents: any[] }>('/api/agents')` at :785, **not** `useAgentRoster()`. That
  mattered: had it come from the hook, the swap would silently render `undefined`, because
  `RosterAgent` carries no task field at all.
- **`AgentsTab.tsx` may be dead code.** `CrewTab`'s own header says CrewTab was its only caller
  and no longer renders it. If that holds, this swap is hygiene rather than a user-visible fix —
  deleting the file would satisfy the seam equally. Stated in the failure message so nobody
  lands it believing they fixed a screen.
- **Seam B leaves a stale comment.** `agent-responsibilities/route.ts:25` reads *"loadAgentRoster()
  is the only thing this route asks."* That becomes false. The seam check strips comments before
  matching, so a stale comment will **not** hold the test red — which is exactly why the failure
  message calls it out: nothing else will catch it.

---

## 7. GATE NUMBERS — RUN BY ME, TODAY, AT THE END

```
npx tsc --noEmit
  exit 0, zero output.

  Transiently red mid-session, and NOT by me: 3 × TS2739 in
  __tests__/work-ui-wiring.test.tsx (missing `expanded`/`onToggle` at :832/:837/:843),
  the work-ui-cards lane's file. It was clean at my session start, went red while I
  worked, and that lane added the two props before I finished. Recorded because I
  reported it as broken earlier in this document's own drafting and the honest
  version is that it fixed itself under me — expect unrelated files to move.

npm test   — LAST FULL RUN OF MY SESSION
  Test Suites: 10 failed, 1 skipped, 105 passed, 115 of 116 total
  Tests:      32 failed, 2 skipped, 2259 passed, 2293 total

  OF THOSE, MINE ARE EXACTLY SIX, all in one suite, all deliberate (§6):
    npx jest __tests__/fleet/fleet-provenance-seams.test.ts
      -> Test Suites: 1 failed, 1 total   Tests: 6 failed, 6 total

  THE OTHER 26 ARE NOT MINE, and I am not reporting a repo-wide number as if it
  were stable: nine lanes are committing while I write this. The suite count went
  from 109 to 116 DURING my session. Several of the other failures are other
  lanes' own deliberate seam tests, landing the same house pattern this round
  used — __tests__/auth/login-surface-seam.test.ts,
  __tests__/auth/middleware-role-source-seam.test.ts,
  __tests__/api/inbox-db-proxy-seam.test.ts, __tests__/runtimes/pieces9-seams.test.ts.
  Plus __tests__/runtimes/spawn-live.test.ts, the known pre-existing failure, and
  in-flight work in lib/__tests__/approvals*.test.ts, agent-budget-ceilings and
  work-ui-wiring.

  So the honest form of the baseline claim is the per-suite one above, not a
  repo total. A reader checking this lane should run the ten lane suites in §7's
  last line, not `npm test`.

node scripts/acceptance/run.mjs     45/45 passing (11601ms), harness score 10/10
bash scripts/smoke-test-layout.sh   nine guards pass, "Smoke test complete"
```

The acceptance run took 11.6s against a normal ~2.2s. Per the brief that means the server is
loaded (nine lanes), not that the product broke — it still passed 45/45.

**Lane suites: 10 suites, 158 tests, 152 passing, 6 deliberately red.** Up from 8 suites / 141
tests at the start of the round.

---

## 8. ACCEPTANCE — CHECKABLE WITHOUT TRUSTING ME

Each item is a command and the result you should get.

1. **The headline number traces to its query.**
   `npx jest lib/__tests__/fleet-liveness.test.ts -t "never opens with the provenance word"`
   → green. Then change `fleetHeadline`'s first segment back to `` `${summary.rows} registered` ``
   → that test fails.

2. **The unknown provenance no longer denies a task it is holding.**
   `npx jest lib/__tests__/fleet-activity.test.ts -t "a provenance this build cannot read"`
   → 6 green. Delete the `RECOGNISED_TASK_PROVENANCE` branch in `describeActivity` → they fail.

3. **`taskLabel` and `describeActivity` agree on every input.**
   `npx jest lib/__tests__/fleet-activity.test.ts -t "agrees with taskLabel on the very same row"`
   → green.

4. **All five mutants are dead.** Re-apply any row of §4's table, run the named suite, get the
   stated failure count, revert. The table is reproducible; that is the point of printing it.

5. **The archive clause works on live data, not just fixtures.** Create an issue in `Limiglow`,
   move it to an active status (needs a `sprint` — there is a DB CHECK constraint), read
   `GET /api/agents` for its `worked_by` agent, then set `archived_at` and read again. The task
   must disappear. Transcript in §1.6. **Delete the row.**

6. **The seams are red and print their diffs.**
   `npx jest __tests__/fleet/fleet-provenance-seams.test.ts` → 6 failed, each with a diff.
   Apply any one diff → that test goes green. Verified in §6.1.

7. **Nothing outside this lane's files changed.** `git status --porcelain`; the entries
   attributable to this lane are exactly: `lib/fleet-liveness.ts`, `app/api/agents/route.ts`,
   `components/tabs/CrewTab.tsx`, `lib/__tests__/fleet-{liveness,activity}.test.ts`,
   `__tests__/agents-route.test.ts`, `__tests__/api/agents-task-provenance.test.ts`,
   `__tests__/fleet/`, `components/tabs/__tests__/crew-tab-render.test.tsx`,
   `docs/rebuild/pieces/pieces9/`.

8. **Fixtures are gone.** Read-only: `select * from issues` in `db.sqlite` → exactly one row,
   `TOD-1`, project `Todero`, archived. Untouched.

---

## 9. WHAT I DID **NOT** VERIFY, AND WHAT IS STILL WRONG

**Stated plainly, because a surface that cannot say where a value came from should say so.**

### Not verified

- **Anything at the pixel level.** I have no browser tool. §3.4's tests assert **markup**, which
  is strictly more than the previous round had and strictly less than looking at the screen.
  Unseen: the amber/red tone classes, the two badges' appearance side by side, the row at phone
  width, and the `Run — over ceiling` button as rendered.
- **The new headline text on the actual Fleet screen.** I confirmed
  `GET /p/limiglow/fleet/team` and `GET /` both answer **HTTP 200** after the `CrewTab`
  restructure, so the page compiles and serves. But `CrewTab` is `'use client'` and loads the
  roster in an effect, so `"28 on the roster"` is **not** in the server-rendered HTML and
  `curl | grep` finds nothing. I have therefore verified that the string is what the tested
  function returns, and that the page serves — **not** that a human sees it. The one-line
  restructure risk (a mis-wired prop on the extracted `RosterRow`) is covered by the markup
  tests in §3.4, not by observation.
- **The `Run — over ceiling` branch on this host.** `POST /api/run-agent?dryRun=1` returns
  `{dispatchEnabled: false}` here, so the armed-then-blocked path is unreachable live. It is
  now covered by markup tests; it has still never been observed on a running instance.
- **A heartbeat-sourced task on live data.** Nothing in this repo writes heartbeats carrying
  tasks, so `currentTaskSource: 'heartbeat'` has never been seen outside fixtures. The
  `assigned-issue` path I did observe live (§1.6); the `heartbeat` path I did not.
- **Whether `capabilityBacking()` breaks under seam B.** Flagged by round 1, still unchecked —
  `AGENT_META` has no entries for vault ids, so newly-assignable agents may render as "not
  capability-backed". Carried into the seam-B failure message for whoever lands it.
- **Why the MC API rewrites `assignee`** from the value supplied at creation (§1.6, item 4).
  Observed, not investigated; not this lane's file.

### Still wrong after this round

- **The benchmark's headline gap is not closed, only enforced.** Five of six surfaces still
  print the ambiguous string. I cannot edit those files. The difference from round 2 is that the
  build is now red about it instead of silent.
- **Roles still says 14 while the roster says 28.** Same reason; same treatment.
- **`/api/agents`' issues query has no project clause** (§3.3). `/api/issues` refuses an
  unscoped read; this route is fleet-wide and has no project in scope to filter on, so the fix
  is a design question — should the roster show an agent's work from *any* project? — not a
  one-line patch. I did not answer it. `scripts/no-unscoped-issues.mjs` still never probes
  `/api/agents`.
- **`who is stuck` is structurally empty on real data.** All 28 rows are idle, no heartbeat
  carries a task, and no ceiling is over. The definitions are good; the column has nothing to
  show. That is a data-plane gap, not a UI one, and this lane cannot fix it.

### Broken outside my ownership — reported, not touched

- **`__tests__/work-ui-wiring.test.tsx`** — **resolved by its own lane before I finished.** It
  held 3 `tsc` errors (`TS2739`, missing `expanded`/`onToggle` at :832/:837/:843) for part of my
  session; my final `npx tsc --noEmit` is exit 0 with zero output. Left here as a record of what
  I saw, not as an open defect.
- **`lib/__tests__/issue-moves.test.ts`** — crashes with
  `ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING_FLAG` from PGlite in `sweepPostgres`. This file reads
  `app/api/agents/route.ts`, so I checked whether I caused it: I ran the suite with the **HEAD
  version** of `route.ts` swapped in and got the **identical crash**. Not mine.
- **Stray probe files left in the tree by another lane:**
  `__tests__/runtimes/zzprobe-reach.test.ts`, `zzprobe2.test.ts`, `zzprobe3.test.ts`.

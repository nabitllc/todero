# runs-need-urls — a run gets an address

**Channel:** Navigation & Deep Linking (7/8)
**Benchmark:** LangSmith — every trace has a URL. Linear — any view is a link. No screen unreachable.
**Date of every measurement below:** 2026-08-26, against the dev server running on `http://localhost:3000`.
**Status:** INCOMPLETE until the seam diff in §5 is applied to `app/page.tsx` by the orchestrator. Everything else in this doc is landed and measured.

> **§§1-9 are the first round, kept verbatim including the parts later shown to
> be wrong. §10 (2026-08-26, second round) records what was re-measured, what
> was corrected, and what is still open. Three claims in §§1-9 are corrected in
> place below and marked `CORRECTED IN §10`; the incompleteness above is now
> also a RED test — `__tests__/nav/runs-permalink-seam.test.ts`.**

---

## 1. What I measured before changing anything

### 1.1 A run had no address at all

```
$ curl -s -o /dev/null -w '%{http_code}\n' \
    -H 'cookie: mc-auth=kaos2026; mc-role=owner' \
    http://localhost:3000/api/agent-runs/00000000-0000-4000-8000-000000000000
405
```

`405`, with an **empty body**. `app/api/agent-runs/[id]/route.ts` exported only
`PATCH` (internal, `x-internal-secret`). There was no way to read a single run
over HTTP. The only way to see one was to scroll `components/nav/RunsView.tsx`'s
list and click a `<tr>` whose open state lived in `useState` and nowhere else.

Compare an issue, which has been fully addressable since the issue-permalink
piece: `/p/<slug>/i/<key>` opens it, survives reload, and every board row is a
real `<a href>`.

### 1.2 The Runs destination has exactly one view, and it is not a run

`components/nav/config.ts:81-88`:

```ts
{
  id: 'runs',
  label: 'Runs',
  question: 'What did that agent actually do, and what did it cost?',
  views: [
    { id: 'all', label: 'All runs' },
  ],
},
```

### 1.3 `agent_runs` has no project column — measured, not assumed

```
$ node -e "const D=require('better-sqlite3');const db=new D('db.sqlite',{readonly:true});
           console.log(db.prepare('PRAGMA table_info(agent_runs)').all().map(c=>c.name).join(','))"
id,agent_id,task_id,task_title,status,started_at,completed_at,finished_at,
tokens_used,cost_usd,output,error,created_at,pid,stall_count,last_progress_hash,
last_progress_at,stopped_reason,stopped_at,log_file
```

A run's project is derivable **only** through `task_id -> issues.project`, and a
run with `task_id IS NULL` has no project at all. Nothing in this piece invents
one. (`agent_runs` also had **zero rows** on this machine at the time —
`select count(*) -> 0` — so every live probe below runs against fixtures I
created and deleted; see §7.)

### 1.4 The brief's premise about per-step cost is now stale

My brief said RunsView "honestly refuses to render per-step cost because
`agent_runs` has no step table". That refusal was true when RunsView shipped and
is **no longer the current state**: `migrations/060_run_steps.sql` added the
table and `components/tabs/RunTraceCard.tsx` (another lane's file, which I did
not touch) draws the trace from it. I fabricated no step data and added no new
per-run numbers. The one thing still named-as-absent — design/Run.dc.html's
"What it learned" panel and its "2 of 3 to skill" counter — remains absent.

---

## 2. The path shape, and the alternative I rejected

```
/[b/<biz>/][p/<slug>/]runs/r/<agent_runs.id>
```

The obvious shape, by analogy with `/i/<key>`, is `/p/<slug>/r/<id>`. **It is
wrong here, and the reason is in `middleware.ts`, not in taste.**

`middleware.ts`'s `isCrossProjectDestination` treats `runs/*` (with `fleet/*`
and `settings/projects`) as deliberately cross-project: it resolves **no**
`x-mc-project` for those screens and stamps `x-mc-all-projects: 1` instead,
because — its own words — agent-level aggregates "span every project an agent
has ever touched; scoping them would hide the cross-project picture they exist
to show." `RunsView` says the same thing on screen.

A run permalink at `/p/<slug>/r/<id>` would sit **outside** that exemption, so
middleware would resolve a project scope for it — a scope the list it drills
into does not have. The drill-down would then be *narrower than the list above
it*: a Todero run, plainly visible in the Limiglow operator's cross-project run
list, would fail the instant they clicked it. That is a link that renders and
does not work, which is the exact defect this channel exists to remove.
`middleware.ts` is not mine to edit, and it should not be — the exemption is
correct.

Putting the run id **under its own destination** makes the existing rule apply
unchanged. Two things fall out:

1. The permalink is never narrower than the list, so every row can be a real
   `<a href>` that actually resolves.
2. It degrades without any router change: `parseURL` sees `runs` (a
   DestinationId), then `r`, which is not in `viewsOf('runs')` (`['all']`), so
   it falls back to `DEFAULT_VIEW.runs`. A run URL lands on the Runs list rather
   than on `now`. **Caveat, stated plainly: this is a reading of
   `app/page.tsx:172-179`, not a measurement — `parseURL` is not exported and
   this repo has no jsdom, so I could not execute it.**

`r` cannot collide: it is not a DestinationId, not a `LEGACY_TAB_MAP` key, and
not a view id of `runs`. All three are asserted in the test file rather than
remembered.

---

## 3. What I changed

| File | Change |
|---|---|
| `lib/run-permalink.ts` | **New.** Pure decision functions: `normalizeRunId`, `rawRunSegment`, `parseRunIdFromPath`, `runPermalinkPath`, `runBackdropPath`, `runMountPath`, `runUrlSyncPath`, `navigateToRunPermalink`, `closeRunPermalink`, plus `RUN_SEGMENT` / `RUN_DESTINATION` / `RUN_BACKDROP_VIEW` / `RUN_ID_PATTERN`. Same shape as `lib/issue-permalink.ts` — a pure function the router calls — because that shape is what made the issue permalink testable at all. |
| `app/api/agent-runs/[id]/route.ts` | Added `GET`. Returns one run, its **own** project (resolved through `task_id -> issues.project`), and what the request resolved as. Enforces the scope boundary in §4. `PATCH` unchanged in behaviour: its inline `/^[0-9a-f-]{36}$/` now imports `RUN_ID_PATTERN`, which is byte-identical (asserted in a test), so the id a permalink will *build* cannot drift from the id the API will *accept*. |
| `components/nav/RunsView.tsx` | The URL is now the only source of truth for which run is open — the `openRunId` `useState` is **gone**. Reads `rawRunSegment(location.pathname)` on mount and on every `popstate`. Every row's agent cell is a real `<a href>`. A run outside the `limit=100` window is fetched by id and rendered above the table. A malformed segment renders an explicit "that is not a run id" banner instead of a silent list. |
| `lib/__tests__/run-permalink.test.ts` | **New.** 38 tests. |
| `__tests__/api/agent-runs-permalink-scope.test.ts` | **New.** 12 tests, CI-safe (stubbed seam, no server). |

`RunTraceCard` is imported and rendered, never edited — it belongs to another
lane.

### What is deliberately NOT in the GET response

`output` (a full agent transcript) and `log_file` (a server filesystem path).
Neither is anything RunsView renders. A read endpoint added for a permalink
should not quietly become a wider read than the list it drills out of.

---

## 4. The scope boundary — proven by request

`GET /api/agent-runs/<id>` does **not** call `lib/scope.ts`'s
`resolveProjectScope`, and that is a deliberate reading of that file rather than
an omission. Its header scopes itself to "the surfaces that have no
cross-project mode" and says a surface that cannot state a reason to widen "does
not belong in this file". Runs *can* state one, and middleware already wrote it
down. Feeding runs through `resolveProjectScope` would 400 every read from the
Runs screen — correctly, per its Rule 1, and uselessly.

What the route enforces instead, from the two headers middleware computes and
**deletes any inbound copy of** before recomputing:

| Header | Meaning | Rule |
|---|---|---|
| `x-mc-all-projects: 1` | request came from a deliberately cross-project screen | any run readable |
| `x-mc-project: <name>` | request came from a project-scoped screen | run must **prove** it belongs — `task_id -> issues.project` must equal `<name>` |
| neither | no resolvable boundary | `400`, per `lib/scope.ts`'s Rule 1 |

The scoped branch is **not what the UI walks** — a run permalink is always under
`runs/*`, so it always arrives cross-project. It exists so this endpoint cannot
be a **side channel**: without it, any project-scoped screen (Work, Now, Memory),
or any script holding a session cookie and a scoped Referer, could read another
project's run titles and errors one id at a time through a route no scope guard
was watching.

> **CORRECTED IN §10** — "a run permalink is always under `runs/*`, so it always
> arrives cross-project" is FALSE, and was measured false on 2026-08-26:
> `referer .../runs/r/<id>` arrived with NEITHER header and the route answered
> `400 unscoped_run_read`. A run permalink arrives cross-project only when a
> `/p/<slug>` is also in the address. The sentence is left standing because this
> doc does not rewrite its own history — see §10.1 for the probe and §10.3 for
> the fix.

### 4.1 The live probe matrix (real requests, run today)

Fixtures: three `agent_runs` rows I created and deleted (§7) —
`…501` attached to a **Limiglow** issue, `…502` attached to **TOD-1** (project
Todero — read only, never modified), `…503` with `task_id NULL`.

```
runs referer, Limiglow run                                     200   project="Limiglow"  crossProject=true
runs referer, FOREIGN (Todero) run                             200   project="Todero"    crossProject=true
runs referer, no-task run                                      200   project=null        crossProject=true
runs LIST referer, FOREIGN run                                 200
work referer, Limiglow run                                     200
work referer, FOREIGN run                                      404   code=run_not_in_scope
work referer, no-task run                                      404   code=run_not_in_scope
NO referer at all                                              400   code=unscoped_run_read
forged x-mc-all-projects: 1  + work referer                    404   code=run_not_in_scope
forged x-mc-project: Todero  + work referer                    404   code=run_not_in_scope
forged both, NO referer                                        400   code=unscoped_run_read
malformed id                                                   400   code=invalid_run_id
well-formed but unknown id                                     404   code=run_not_found
no session cookie                                              401   (middleware auth)
```

The two forged-header rows are the load-bearing ones: middleware strips both
inbound copies, so a caller cannot widen itself by asking. The `no-task run` row
is the fail-closed one: "belongs to no project" does **not** satisfy "belongs to
Limiglow".

Verbatim body of the foreign-run refusal from a scoped screen:

```json
{"error":"This screen is scoped to \"Limiglow\" and run aaaa1111-2222-4333-8444-555555555502
 belongs to \"Todero\". Agent runs span every project an agent touches — open it from the
 Runs screen, which is deliberately cross-project, rather than from a project-scoped screen.",
 "code":"run_not_in_scope"}
```

Note the field placement: the **sentence** is in `error` and the **code** in
`code`, because `lib/fetch-json.ts`'s `readApiError` reads
`body.error ?? body.message` for what it shows a human. Putting the code in
`error` would have rendered `run_not_in_scope` on screen and thrown the
explanation away.

### 4.2 Mutation-tested, with the killed test names

Two mutations applied to landed code, run, then reverted:

**Mutation 1** — `if (scope && project !== scope)` → `if (false && scope && …)`
(the scope branch disabled, the shape a critic used successfully twice on the
previous scope guards). `3 failed, 9 passed`:

```
● the scope boundary › 404s a foreign run asked for from a project-scoped screen
● the scope boundary › 404s a run with no project at all from a project-scoped screen
● the scope boundary › does not let a cross-project claim override a resolved scope
```

**Mutation 2** — `runMountPath` returns `canonicalPath` unconditionally (i.e.
reintroduces the exact bug this piece fixes). `4 failed, 34 passed`:

```
● runMountPath › re-attaches the run segment to a canonical path
● runMountPath › does better than suppression: a cold-loaded run GAINS the resolved scope
● runMountPath › preserves a malformed segment rather than dropping it
● runUrlSyncPath › keeps the run in the path it writes, so a scope sync cannot erase the permalink
```

Both reverted; `50 passed, 50 total` afterwards.

---

## 5. SEAM DIFF — required, orchestrator-owned, piece is incomplete without it

`app/page.tsx` erases the run id from the address bar. Two places, both
`replaceState`. Until this lands: **clicking a run works and the back button
works, but a full reload of a run permalink does not survive.**

### 5.1 Import (near line 64, beside the `issue-permalink` import)

```diff
 import {
   issueUrlSyncPath,
   parseIssueKeyFromPath,
   rawIssueSegment,
 } from '@/lib/issue-permalink'
+import { rawRunSegment, runMountPath, runUrlSyncPath } from '@/lib/run-permalink'
```

### 5.2 Mount-time canonicalisation (currently line 452)

Today `buildPath(business, 'runs', 'all', project)` is `/p/limiglow/runs` — the
`/r/<id>` is gone milliseconds after load.

```diff
     if (k) {
       setIssueKey(k)
     } else {
-      window.history.replaceState({ biz: business, destination: d, view: v, project }, '', buildPath(business, d, v, project))
+      // runs-need-urls: the canonical path is still computed; the run segment
+      // is re-attached to it, so a run permalink both survives the rewrite AND
+      // gains the /b/<biz>/p/<slug> prefix the parse resolved.
+      window.history.replaceState(
+        { biz: business, destination: d, view: v, project },
+        '',
+        runMountPath(rawRunSegment(window.location.pathname), buildPath(business, d, v, project)),
+      )
     }
```

### 5.3 Project-scope sync (currently line 528)

```diff
     const path = buildPath(selectedBusiness, destination, view, selectedProject)
     const current = window.location.pathname + window.location.search
-    const sync = issueUrlSyncPath(issueKey !== null, current, path)
+    // runs-need-urls: composes with the issue rule, never replaces it — the
+    // issue rule still decides WHETHER to write; this decides WHAT gets
+    // written, so a scope sync cannot erase an open run permalink.
+    const sync = runUrlSyncPath(
+      rawRunSegment(window.location.pathname),
+      issueUrlSyncPath(issueKey !== null, current, path),
+    )
     if (sync) {
```

**No other change to `app/page.tsx` is needed.** `RunsView` takes no new prop:
it reads the URL itself and listens for the same `popstate` the existing
back/forward effect listens for, so there is no second routing mechanism and no
prop-drilling through the render gate. `goTo()` already calls `pushURL(...)`,
which writes a path with no run segment, so navigating away from Runs closes an
open run — no change needed there either.

---

## 6. ACCEPTANCE — checkable without trusting this summary

A fresh critic can verify each of these directly. Items 1-8 hold **today**;
items 9-10 hold **only after §5 is applied**.

1. **The endpoint exists and did not before.**
   `git show HEAD:app/api/agent-runs/\[id\]/route.ts | grep -c 'export async function GET'` → `0`.
   `grep -c 'export async function GET' app/api/agent-runs/\[id\]/route.ts` → `1`.
   With the server up: `curl -o /dev/null -w '%{http_code}' -H 'cookie: mc-auth=kaos2026; mc-role=owner' -H 'referer: http://localhost:3000/p/limiglow/runs/all' http://localhost:3000/api/agent-runs/00000000-0000-4000-8000-000000000000` → `404` (not `405`).

2. **No project is invented.** `grep -n "project" app/api/agent-runs/\[id\]/route.ts` — the only assignment to `project` reads `issues.project` via `run.task_id`. There is no literal project name anywhere in the file, and `PRAGMA table_info(agent_runs)` still has no project column.

3. **A foreign run does not leak to a scoped screen.** Re-run the §4.1 matrix against your own fixtures. The load-bearing rows: `work referer + foreign run` → `404 run_not_in_scope`, and the same request with `x-mc-all-projects: 1` or `x-mc-project: Todero` added by hand → still `404`.

4. **Absence is not "every project".** No `referer`, no headers → `400 unscoped_run_read`. Not `200`, not an empty run.

5. **The scope branch is not dead code.** Apply mutation 1 from §4.2. Three named tests must go red. If they do not, the boundary is decorative and this piece failed.

6. **`RunsView` has no open-run state of its own.** `grep -n 'openRunId, setOpenRunId\|useState<string | null>(null)' components/nav/RunsView.tsx` — there is no `setOpenRunId`. The only run identity comes from `rawRunSegment(window.location.pathname)`.

7. **Rows are real links.** `grep -n '<a' components/nav/RunsView.tsx` — the agent cell carries `href={hrefFor(r.id, open)}`, which is `runPermalinkPath` / `runBackdropPath`. Not a `div` with an `onClick`.

8. **The segment cannot be shadowed.** `npx jest lib/__tests__/run-permalink.test.ts -t 'cannot collide'` — four tests assert `r` against `DESTINATIONS`, `viewsOf('runs')`, `LEGACY_TAB_MAP`, and the position of the destination segment.

9. **(After §5) A reload survives.** Open a run, copy the URL, hard-reload. The address bar still reads `…/runs/r/<id>` and the run is open. *This is the item I could not verify — see §8.*

10. **(After §5) A cold-loaded run gains its scope.** Load `/runs/r/<id>` with no prefix. After scope derivation the address bar reads `/b/todero/p/limiglow/runs/r/<id>` — canonical **and** still a permalink. This is strictly better than the issue permalink, which suppresses the rewrite entirely and therefore never gains the `/p/<slug>` segment.

    > **CORRECTED IN §10** — this item is correctly written in the future tense
    > of "after §5". `lib/run-permalink.ts`'s `runMountPath` docblock described
    > the same behaviour in the PRESENT tense, in a file that ships, while
    > `grep -c 'run-permalink' app/page.tsx` → `0`. That docblock is now headed
    > **NOT WIRED UP YET**, and `__tests__/nav/runs-permalink-seam.test.ts` is
    > red until the seam lands.

---

## 7. Fixtures — created and removed

Three `agent_runs` rows, ids `aaaa1111-2222-4333-8444-55555555550{1,2,3}`,
inserted directly into `db.sqlite` (the browser db proxy's `WRITABLE_TABLES` is
`issues`/`notifications`/`inbox` only, so there was no HTTP path to create one).
All three deleted after the probes; verified `count(*) where id like 'aaaa1111%'`
→ `0`.

Row `…502` points its `task_id` at **TOD-1**'s id to make a cross-project run
observable. TOD-1 was **read only** — never updated, never un-archived, never
deleted. No other lane's rows were touched, and no `issues` row was created or
modified by this piece at all.

---

## 8. What I did NOT verify — explicitly

- **Anything at the DOM level.** I have no browser tool in this session. I did
  not see RunsView render. Every claim about what appears on screen is a claim
  about the code I wrote, not an observation. The orchestrator's browser pass at
  the wave boundary is what would confirm it.
- **Acceptance items 9 and 10** (reload survival, cold-load scope gain). They
  depend on the §5 seam diff, which I am not permitted to apply, and on a
  browser, which I do not have. The *decision functions* those items rest on are
  mutation-tested (§4.2); the *wiring* is not, because `app/page.tsx` cannot be
  imported or rendered by this repo's suite (`testEnvironment: "node"`,
  `jest-environment-jsdom` not installed — confirmed today,
  `ls node_modules/jest-environment-jsdom` → not present; `parseURL`/`buildPath`
  are not exported).
- **`parseURL`'s graceful-degradation behaviour** for `…/runs/r/<id>` before the
  seam lands (§2, point 2). That is a code reading of `app/page.tsx:172-179`,
  not a measurement, for the same reason.
- **Middleware's own-path branch.** I proved the `Referer` branch live (that is
  the one every SPA fetch uses). `isCrossProjectDestination` firing on the
  request's *own* path is a code reading; no HTTP probe distinguishes it.
- **`RunsView`'s new branches under real React.** There is no rendering test for
  this component — this repo cannot render components at all. The list-load,
  loading, error, empty, invalid-segment, and fetched-detail branches are
  type-checked and reasoned, not executed.
- **Postgres.** Everything live was measured against the sqlite adapter. The GET
  goes through the `db()` seam and touches no dialect-specific SQL, and this
  piece adds **no migration** (`agent_runs` and `issues` both already have every
  column it reads), so there is no two-dialect obligation here — but I did not
  run it on Postgres.

---

## 9. Gates (run today, after the change)

```
npx tsc --noEmit                 clean, exit 0
npm test                         1508 passed, 4 failed, 2 skipped / 1514
                                 failure set: commerce-audit-atomicity,
                                 commerce-permissions, spawn-live — none mine
node scripts/acceptance/run.mjs  45/45 passing, harness score 10/10
bash scripts/smoke-test-layout.sh  all guards ✅, zero ❌
```

**On the failure set:** my brief named the baseline as *agents-route,
agents-unconfigured, spawn-live*. Those first two now **pass** — another lane
fixed them. What fails instead is `__tests__/api/commerce-audit-atomicity.test.ts`
and `__tests__/api/commerce-permissions.test.ts` (plus `spawn-live`, still, and
environmental). Those are commerce-lane files; I own none of them and touched
none of them. Two further suites — `commerce-partial-fulfilment` and
`migrations-from-zero` ("migration 074 … both dialect files exist and agree") —
failed in one full run and passed in the next while the total rose from 1444 to
1514 tests, which is another lane landing files mid-run, not a defect of mine.

My own tests: `50 passed, 50 total` across the two new files.

---

# 10. SECOND ROUND — 2026-08-26, after a 6/10 critique

Everything in §§1-9 is the first round and is left exactly as it was written,
including the parts this section shows were wrong. What follows is what I
measured **today**, what I changed, and what is still open.

Nothing below is quoted from the critique. Every line is a probe I ran, a suite
I executed, or a file I read on this machine today. Where the critic was right I
say so; where I could not confirm something I say that instead.

## 10.1 The critique's claims, checked one at a time

| Claim | Verdict | How I checked it |
|---|---|---|
| The §5 seam is not applied; `grep -c 'run-permalink' app/page.tsx` → 0 | **TRUE** | `grep -c` → `0`. `git status --porcelain app/page.tsx` → empty. |
| A run permalink under `runs/*` does **not** always arrive cross-project | **TRUE** | Live: `referer .../runs/r/<id>` → `400 unscoped_run_read`; `.../runs/all` → 400; `.../b/todero/runs/all` → 400; `.../p/limiglow/runs/r/<id>` → 200. |
| `runMountPath`'s docblock describes behaviour the app does not have | **TRUE** | The function is real and tested; nothing calls it. Present tense in a shipping file. |
| The transcript/log-path test is decorative | **TRUE** | Reproduced: appended `,output,log_file` to `RUN_COLUMNS`; the two piece suites reported `50 passed, 50 total` and the live endpoint returned `"output":"SECRET-TRANSCRIPT-LIMIGLOW","log_file":"/var/secret/limiglow.log"` at HTTP 200. Reverted. |
| Nothing guards that a run row is a link (mutation M8) | **TRUE** | `grep -rl RunsView __tests__ scripts` → no hits. The component was referenced by no test and no guard script. |
| `toggleRun` compares the raw segment to a lower-cased id | **TRUE**, by reading | With an upper-cased id in the URL the row renders open (`openRunId` normalises) while the click handler thinks it is closed. I cannot execute this — no jsdom, no browser. |

Nothing the critic verified as **passing** was found to be wrong, and all of it
still passes after this round — see 10.4.

One correction to the critique, and it makes the headline worse rather than
better. It reported that it could not confirm the effect ordering between
RunsView's mount read and app/page.tsx's `replaceState`, leaving open the
possibility that a child effect wins the race. It does not, and this is
determinable from the source without a browser: **`app/page.tsx:921` gates every
destination behind `!selectedProject`**, so `RunsView` is not mounted at all
until `/api/businesses` and `/api/projects` have resolved — strictly after the
mount-time `replaceState` at `app/page.tsx:452` has already run. There is no
effect ordering, no module-load capture, and no address-bar re-assertion from
inside `components/nav/` that is not a race with a parent effect this piece
cannot see fire. **The seam is the fix. Nothing in the files this piece owns
substitutes for it.**

## 10.2 What I changed

| File | Change |
|---|---|
| `app/api/agent-runs/[id]/route.ts` | The false comment is replaced by the measurement that falsifies it, in place, with the four probe results. The cross-project fact is now also derived from the `Referer` when middleware could not resolve one (10.3). The `unscoped_run_read` sentence no longer points the operator at a screen the route was rejecting. |
| `lib/run-permalink.ts` | `runMountPath`'s docblock keeps its description but is now headed **NOT WIRED UP YET**, with the `grep` result and the render-gate reason no workaround exists. New `isProjectlessRunsReferer`. |
| `components/nav/RunsView.tsx` | `toggleRun` compares the **normalised** id (`parseRunIdFromPath`), so an upper-cased permalink's close control does what it says. Header records the render-gate finding. |
| `__tests__/api/agent-runs-permalink-scope.test.ts` | The decorative leak test now reads back the recorded `.select(...)` **argument**. New: the issues lookup selects `project` and nothing else; nine tests for the project-less Runs referer. 12 → 23 tests. |
| `lib/__tests__/run-permalink.test.ts` | Nine tests for `isProjectlessRunsReferer`, including every rejection case. 38 → 47 tests. |
| `__tests__/nav/runs-view-rows-are-links.test.ts` | **New.** 7 tests. The guard that was missing entirely. |
| `__tests__/nav/runs-permalink-seam.test.ts` | **New.** 4 tests, **3 of them RED on purpose** — see 10.7. |

`app/page.tsx` and `components/nav/config.ts` were not touched. `middleware.ts`
was not touched.

## 10.3 The second gap: the project-less Runs screen (SEAM REQUEST for middleware)

`middleware.ts`'s `isCrossProjectRequest` calls `projectFromPathname` first and
returns `false` whenever that returns `null` — which it does for **any** path
with no `/p/<slug>`. So the un-prefixed form of a deliberately cross-project
screen gets neither header, and the endpoint built for the run permalink refused
the screen the run permalink is reached from, while its own refusal text told the
operator to use `/p/<project>/runs`.

I could not fix this where it belongs: `middleware.ts` is not this piece's file.
The route now derives the same fact from the same `Referer` middleware derives
everything else from, via a pure tested function.

**This grants nothing, and that is a measurement rather than an argument.**
Middleware's project resolution is a title-case codec, not a registry, so an
invented slug is accepted. Measured today:

```
referer /p/totally-made-up-slug/runs/all  +  a Todero run  ->  200
```

Anyone who could reach a run through `isProjectlessRunsReferer` could already
reach it by typing a project that does not exist. What the function removes is a
refusal, not a boundary. It is deliberately narrow: same-origin only; `runs`
only (not `fleet`, not `settings/projects`); and any path carrying a `p` segment,
well-formed or not, returns `false` — ambiguity stays a 400.

**The real cure, for whoever owns `middleware.ts`:**

```diff
 function isCrossProjectRequest(req: NextRequest): boolean {
   const own = projectFromPathname(req.nextUrl.pathname)
   if (own) return isCrossProjectDestination(own.rest)
+  // A path with no `/p/<slug>` is not "unknown" — for `runs`/`fleet` it is the
+  // un-prefixed form of a screen already exempted two lines above. Falling
+  // through to `false` here is what made `/runs/r/<id>` unreachable.
+  if (isCrossProjectDestination(stripBizPrefix(req.nextUrl.pathname))) return true
   const referer = req.headers.get('referer')
```

(plus the same for the `Referer` branch below it, and a two-line `stripBizPrefix`
helper that peels a leading `/b/<biz>` and returns the remaining segments.) When
that lands, `isProjectlessRunsReferer` becomes redundant and should be deleted
along with its tests — it is a compensation, not a design.

## 10.4 The live probe matrix, re-run today, after the change

Fixtures: three `agent_runs` rows, ids `dddd2222-3333-4444-8555-6666666666{01,02,03}`
— `…01` on a Limiglow issue, `…02` on TOD-1 (project Todero, **read only**),
`…03` with `task_id NULL`. All three carried a fake `output` and `log_file` so a
leak would be visible. All three deleted afterwards (`changes=3`,
`count(*) where id like 'dddd2222%'` → 0, `agent_runs` back to 0 total).

```
referer                              run          before      after
/p/limiglow/runs/r/<id>              Limiglow     200         200   crossProject=true
/p/limiglow/runs/all                 FOREIGN      200         200   project="Todero"
/p/limiglow/runs/all                 no-task      200         200   project=null
/runs/r/<id>                         Limiglow     400  ->     200   <- THE FIX
/runs/all                            FOREIGN      400  ->     200   <- THE FIX
/b/todero/runs/all                   Limiglow     400  ->     200   <- THE FIX
/b/todero/runs/r/<id>                FOREIGN      400  ->     200   <- THE FIX
/fleet/roster                        Limiglow     400         400   (deliberately unchanged)
/p/limiglow/work/list                Limiglow     200         200
/p/limiglow/work/list                FOREIGN      404         404   run_not_in_scope
/p/limiglow/work/list                no-task      404         404   run_not_in_scope
(none)                               Limiglow     400         400   unscoped_run_read
forged x-mc-all-projects + work ref  FOREIGN      404         404   forgery stripped
forged x-mc-project      + work ref  FOREIGN      404         404   forgery stripped
forged both, no referer              FOREIGN      400         400
https://evil.example/runs/all        Limiglow     400         400   cross-origin
malformed id                         -            400         400   invalid_run_id
unknown well-formed id               -            404         404   run_not_found
no session cookie                    Limiglow     401         401   (middleware auth)
```

The 200 body was re-read key by key after the change:
`id,agent_id,task_id,task_title,status,started_at,completed_at,finished_at,tokens_used,cost_usd,stopped_reason,stopped_at,error`
— no `output`, no `log_file`, on a row that had both.

## 10.5 Mutations — six applied this round, six killed by name

Every one applied to landed code, run, reverted, and the suites re-run clean
afterwards (`77 passed, 77 total` across the three green piece suites).

| # | Mutation | Result |
|---|---|---|
| M-A | `RUN_COLUMNS` += `,output,log_file` — **the mutation that survived last round with a live 200 leak** | `1 failed` · `never even ASKS the database for the agent transcript or the server log path` |
| M-B | drop `!scope &&` from the referer derivation | `1 failed` · `echoes crossProject=false for a scoped request whose referer names /runs` |
| M-C | drop the same-origin check in `isProjectlessRunsReferer` | `2 failed` · `does NOT fire cross-origin…` · `does not fire for a cross-ORIGIN referer that names /runs` |
| M-D | drop the `/b/<biz>` peel | `3 failed` · `leaves a project segment sitting where the destination check will reject it` · `fires under a /b/<biz> prefix…` · `tolerates a /b/<biz> prefix ahead of runs…` |
| M-E | `isProjectlessRunsReferer` returns `true` unconditionally | `6 failed`, including `does NOT fire for any destination other than runs` and `does not fire for /fleet…` |
| M8 | the row's `<a href={hrefFor(...)}>` → `<span>` — **the mutation that passed every gate last round** | `1 failed` · `renders an <a> whose href comes from hrefFor` |

Two lines I wrote this round could **not** be killed by any mutation, so they
were deleted rather than shipped: an `if (rest[0] === 'p') return false` early
return in `isProjectlessRunsReferer` (the line below it already returns `false`
for that input), and a `!headerCrossProject &&` short-circuit in the route (the
`||` below already covers it). A line that cannot be wrong is not a guard.

`__tests__/nav/runs-view-rows-are-links.test.ts` reads the **source text**, not a
render, and says so in its own header. This repo cannot render a component
(`testEnvironment: "node"`, no `jest-environment-jsdom`). It proves the anchor is
in the file; it does not prove it paints. Its first draft failed on RunsView's own
JSX comment explaining that the row deliberately carries no button role — the
TOD-2410 shape, where a scanner flags its own specification — so it now strips
comments before matching.

## 10.6 Gates, run today, after every change and every revert

```
npx tsc --noEmit                   exit 0, clean
npm test                           1823 passed, 4 failed, 2 skipped / 1829
                                   failure set: runs-permalink-seam (3, MINE, red
                                   by design — see 10.7), spawn-live (1, baseline)
node scripts/acceptance/run.mjs    45/45 passing, harness score 10/10
bash scripts/smoke-test-layout.sh  12 guards green, zero failures  [see below]
```

The 12 smoke guards: sidebar-in-build, mobile-nav `lg:hidden`, main layout
wrapper, header, no-invented-projects, no-dead-modules, no-phantom-columns,
no-cloud-provider, check-boolean-columns, check-no-secrets, honest-error
(`no-silent-empty`), scope (`no-unscoped-issues`).

**The smoke test went red later in the session, on another lane's file, and I am
not fixing it.** `check-no-secrets` now flags
`__tests__/auth/role-escalation.test.ts:168` (`process.env.MC_PASSWORD =
'<a rotated password, spelled in the test but not here — see TOD-2474>'`) and the copy of that same line quoted inside
`docs/rebuild/pieces/pieces8/approval-surface.md:740` — both untracked (`??` in
`git status`), both landed between my two smoke runs, neither in this piece's
ownership. `node scripts/check-no-secrets.js` names no file of mine. Because the
script exits at that guard, `no-silent-empty` and `no-unscoped-issues` never got
to run inside it, so I ran both directly: `PASS: no unchecked JSON parsing under
app/ or components/`, `PASS: shared error surface intact`, and `PASS: scope holds
under 10 live probes`. The all-green run above is the one that measures this
piece's changes.

`agents-route` and `agents-unconfigured` — named as baseline failures in my brief
— **pass** now; another lane fixed them. One further suite,
`__tests__/zz-avfix9-live-probe.test.ts`, failed in one full run and had been
**deleted from the tree** by the time I re-ran three minutes later; it is not
mine and I make no claim about it. Separately, `issues` rows in project Limiglow
went 2 → 0 under me mid-session (another lane's cleanup). This piece never wrote
to `issues` at all — TOD-1 is byte-identical before and after (id
`fc000da5-9bd0-4cdf-a780-207537d9ceef`, `updated_at 2026-08-25T21:40:28.769Z`,
`archived_at 2026-08-25 19:36:02`).

## 10.7 STILL OPEN — the headline gap is NOT fixed, and now it is loud

**A run permalink still does not survive a reload.** That is unchanged from the
first round and it is the one thing this channel is graded on. The fix is three
edits to `app/page.tsx` (§5), which this piece is not permitted to make and did
not make.

What changed is that the incompleteness is no longer only a paragraph.
`__tests__/nav/runs-permalink-seam.test.ts` **fails, by name, and prints the
whole diff in its failure message**, for exactly as long as
`grep -c 'run-permalink' app/page.tsx` returns `0`. Three of its four tests are
red right now. That is deliberate and it is the correct state: last round every
gate was green while the feature did not work, and a disclosure that costs
nothing is a disclosure that gets skipped.

Applying §5 turns all three green. Nothing else in this piece needs to change.

Also still open, and honestly unobservable from here:

- **Everything at the DOM level**, again. No browser tool this session either. I
  did not see RunsView render. I could not watch a reload lose the id, could not
  test back/forward, and could not confirm the upper-cased-id fix behaves on
  screen the way the source now says it does.
- **Acceptance items 9 and 10** (§6) remain unverified for both reasons above.
- **Per-span addressability.** `viewsOf('runs')` is `['all']`; nothing *inside* a
  run has its own URL. LangSmith gives an individual span one. Not attempted
  here — it needs a view id in `components/nav/config.ts`, which is
  orchestrator-owned.
- **Postgres.** Everything live was measured on the sqlite adapter. This piece
  still adds no migration and touches no dialect-specific SQL.

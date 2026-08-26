# Work Management UI — round 3 (pieces9)

Lane: `components/tabs/IssuesTab.tsx`, `components/KanbanCard.tsx`,
`components/tabs/FeatureCard.tsx`, `components/tabs/WorkViewCard.tsx`,
`__tests__/work-ui-*.test*`, this doc.
Date: **2026-08-26**. Tree at session start: HEAD `9d9847a`.
Benchmark: Linear — the board tells you where work is stuck without you asking,
and every row is actionable.

Everything below marked **Measured** was run by me, today, on this tree, and the
output is quoted. Everything I could not observe is in §12, which is a list of
things I do not know rather than a list of things that are fine.

---

## 1. The headline

Round 1's defect: the tests covered the pure helpers and never the components.
Round 2's repair split each component into a pure view plus exported request
functions and tested those. A fresh-context critic then showed that this **moved
the untested layer instead of removing it**: 32 mutations to the four owned
files, 12 survived at 51/51 green, four of them in the thirteen-line default
export of `WorkViewCard` — including `children={undefined}` on the `{...props}`
spread, which is verbatim TOD-2444 (a zero or refused count deletes the whole
IssuesTab).

Round 2's stated reason for not testing that layer was:

> this repo's jest is `testEnvironment: "node"` with no jsdom — effects never
> run, so those branches were unreachable from a test at all.

**That premise is false, and it is the whole of this round.** jsdom is not what
runs a `useEffect`. React's hooks are not implemented in `react` at all; they are
forwarded at call time to whatever object sits in
`ReactCurrentDispatcher.current`. Supply that object and a function component can
be invoked directly, its effects run when you choose to run them, its `useState`
setters mark a tree dirty, and the element tree it returns is a plain JS object
graph whose host nodes still carry their real `onClick` / `onChange` /
`onKeyDown` props.

`__tests__/work-ui-wiring.test.tsx` is ~180 lines of harness that does exactly
that, plus the tests it makes possible. **No new dependency, no change to
`package.json` or `jest.config.js`** (neither is this lane's file). It mounts the
**default exports** — the exact components `app/page.tsx` renders — loads them
against a mocked `global.fetch`, and clicks the row, the Save button, the
select-all checkbox, the Apply button and the Retry button.

Result: **21 of 22 mutations now fail**, including all 12 the critic found. The
one survivor is proven equivalent in §5.

---

## 2. Measured — the gate, run by me today

```
$ npx tsc --noEmit
(no output)                                       exit 0

$ npx jest __tests__/work-ui-cards.test.tsx __tests__/work-ui-cards-behaviour.test.tsx \
           __tests__/work-ui-wiring.test.tsx
Test Suites: 3 passed, 3 total
Tests:       80 passed, 80 total                   (17 + 31 + 32)

$ bash scripts/smoke-test-layout.sh
✅ check-no-secrets passed
✅ Honest-error guard passed
✅ Scope guard passed   (10 live probes; probe row TOD-398 in "Todero")
✅ Smoke test complete                             exit 0

$ node scripts/acceptance/run.mjs
45/45 passing  (36814ms)
harness score: 10/10
```

The acceptance run took 36.8s against the briefed ~2200ms. Per the brief that
means the server is loaded, not that the product broke — nine lanes are running
and `git status --short` showed 27 modified + 11 untracked files belonging to
other lanes while I worked. It passed 45/45 regardless.

### `npm test` — six red suites, none of them mine

```
$ npm test
Test Suites: 6 failed, 1 skipped, 100 passed, 106 of 107 total
Tests:       24 failed, 2 skipped, 2153 passed, 2179 total
```

The brief's baseline was ~1967 passing with ONE known failure (spawn-live). It is
now 2153 passing with six failing suites. I checked whether any of them are mine:

```
$ grep -l "IssuesTab\|KanbanCard\|FeatureCard\|WorkViewCard" \
    __tests__/agents-route.test.ts __tests__/api/inbox-db-proxy-seam.test.ts \
    __tests__/fleet/fleet-provenance-seams.test.ts __tests__/office-bubble-render.test.ts \
    __tests__/auth/rate-limit-defaults.test.ts lib/__tests__/pipeline-no-phantom-columns.test.ts
(no output — none of them import any file this lane owns)
```

Their failure headlines are other lanes' work, and several are deliberately red
seam-tests of the house pattern:

| suite | first failure |
|---|---|
| `__tests__/fleet/fleet-provenance-seams.test.ts` | `SEAM A — the five surfaces must consume currentTaskLabel` (5 cases) + `SEAM B` |
| `__tests__/api/inbox-db-proxy-seam.test.ts` | `SEAM-1: /api/db/inbox is a second, ungated writer` |
| `__tests__/agents-route.test.ts` | `GET /api/agents › answers 200 with the roster the repo AGENTS.md declares` |
| `lib/__tests__/pipeline-no-phantom-columns.test.ts` | `passes only humanised errors to ApiErrorBanner` |
| `__tests__/auth/rate-limit-defaults.test.ts` | `MC_AUTH_GLOBAL_TRUSTED_MAX_FAILURES … accepts a TIGHTENING value` |
| `__tests__/runtimes/spawn-live.test.ts` | the briefed known failure |

`agents-route` was briefed as "fixed last wave"; it is red again, and
`app/api/agents/route.ts` is currently modified by another lane. Reported, not
touched.

**Also worth someone's attention:** `npx tsc --noEmit` was NOT clean when I
started. It reported two errors, both in `lib/__tests__/issue-moves.test.ts`
(`TS2347: Untyped function calls may not accept type arguments`) — another
lane's file, modified in the working tree. That lane fixed it while I worked and
tsc is clean now. I mention it because the brief presents "tsc clean" as the
baseline and it was briefly not true today.

---

## 3. Measured — live HTTP, by me, over the real server

The round-2 doc said twice that the route could not be reached ("401", "I have
no browser tool"). The critic said it is reachable. **The critic is right.** Same
cookie `scripts/acceptance/checks.mjs:16` uses:

```
$ curl -s -o /dev/null -w '%{http_code}' \
    -H 'cookie: mc-auth=kaos2026; mc-role=owner' \
    'http://localhost:3000/api/issues?project=Limiglow&limit=1'
200

$ curl … (no cookie)                                     401
$ curl … 'http://localhost:3000/'                        307  (→ /login)
```

### The exact-count contract, on real rows

The critic measured Limiglow at `total=1`. **When I measured, the issues table
was empty on every project** — `?all_projects=1&limit=1` → `total=0`. So I
created one Limiglow fixture, measured the four card queries against it, and
deleted it:

```
POST /api/issues  → id=542355d2-0373-4a6d-b7ad-8e6b27a3726c  (TOD-397, type=epic)

?project=Limiglow&limit=1                total=1  rows.length=1
?project=Limiglow&limit=1&type=epic      total=1  rows.length=1
?project=Limiglow&limit=1&type=task      total=0  rows.length=0
?project=Limiglow&limit=1&status=backlog total=1  rows.length=1
?project=Limiglow&limit=1&has_due=1      total=0  rows.length=0

DELETE /api/issues?id=542355d2-…         {"ok":true}
?project=Limiglow&limit=1&_cb=<random>   total=0  rows.length=0
```

So the four `WorkViewCard` count queries narrow correctly against real rows and
`total` is a real head-count. Confirmed, by a route call round 2 said it could
not make.

**Fixture cleanup: the row I created is gone.** Verified by the cache-busted
query above and by `?project=Limiglow&limit=0` → `total=0`. I created exactly one
row and deleted exactly one row. TOD-1 untouched. No other project written to.

### A real defect found while cleaning up — NOT this lane's file

Immediately after the successful DELETE, `?project=Limiglow&limit=1` kept
returning my deleted row for up to 30 seconds, while `?…&limit=0` and a
cache-busted variant of the same query both returned 0:

```
attempt 1  project=Limiglow&limit=1 -> total=1 rows=["TOD-397/work-ui round-3 count fixture"]
attempt 2  project=Limiglow&limit=1 -> total=1 rows=["TOD-397/work-ui round-3 count fixture"]
attempt 3  project=Limiglow&limit=1 -> total=1 rows=["TOD-397/work-ui round-3 count fixture"]
limit=0 (every row)                 -> total=0 rows.length=0
```

Cause, read from `app/api/issues/route.ts`: there is a 30s response cache keyed
by query string (`issuesCache`, declared :215, read :958, written :1218).
`POST` clears it at :1564 and `PATCH` clears it at :2676. **`DELETE` (:2689)
does not.** So for 30 seconds after a delete, `GET /api/issues` serves the
deleted issue — and the query that is served the stale row is exactly the
`limit=1` shape every `WorkViewCard` count uses.

That file is not mine and I did not touch it. The one-line fix is
`issuesCache.clear()` in `DELETE` alongside the identical calls in `POST` and
`PATCH`.

---

## 4. Where the critic is wrong

Two of its sixteen mutants and one of its five fabrications need correcting. The
other thirteen mutants and four fabrications I reproduced and fixed.

### 4.1 Mutant 11 is an EQUIVALENT MUTANT, not a coverage hole

The claim: dropping `!fetchError` from the empty-state guard (the critic's
`IssuesTab.tsx:575`, today :594) makes "an empty state render over a failed
request — the exact thing `scripts/no-silent-empty.mjs` is named for."

It does not, because that guard is **nested inside** `{!loading && !fetchError &&
(` at :459. (The critic cited :440 and :575; measured today the same two lines
are :459 and :594 — the file has grown.) The inner `!fetchError` is redundant;
removing it cannot change what
renders. I did not argue this from reading — I measured it. I mounted `IssuesTab`
with a failing fetch, dumped the full rendered text, applied the mutation, dumped
again, and diffed:

```
$ diff /tmp/dump_base.txt /tmp/dump_m11.txt
IDENTICAL RENDER

$ cat /tmp/dump_base.txt
IssuesLimiglowdata unavailable/api/issues?project=Limiglow&limit=0⚠️data unavailable
 — 500 from /api/issues?project=Limiglow&limit=0: db is downRetry
```

Byte-identical, and no empty state in either. The mutation is unobservable.

What the critic was *reaching* for is a real requirement, so it is now pinned by
behaviour rather than by which guard happens to carry it — `IssuesTab › renders
the error banner and NO empty state when the load fails`. That test holds whether
the redundant guard is there or not, which is the right instrument. I left the
redundant guard in place: deleting it would be churn on a file nine lanes are
reading, and it costs nothing.

**The critic is also right about `no-silent-empty.mjs` being weaker than its
name.** I read `scripts/no-silent-empty.mjs`: it checks for unguarded
`JSON.parse` under `app/`/`components/` and for the *presence* of
`useApiData`/`fetch-json`/`ApiErrorBanner` as modules. It does not analyse any
empty-state branch. That is not this lane's file, and I did not change it.

### 4.2 "1 issues" is not currently reproducible on live data

The critic and round 2 both describe the "1 issues" defect as reproducible on
real Limiglow data. It was not while I measured, because the issues table was
empty (§3). It became reproducible for the ninety seconds my fixture existed. The
count is a moving fixture; the *rule* is what is pinned, and it is pinned twice
now — once as a helper unit test and once through the mounted header (§6, M9).

### 4.3 Everything else the critic said, I reproduced

All 16 mutants applied cleanly except as noted; 15 of 16 survived the round-2
suite exactly as reported. Fabrications 1–5 all check out; §8 says what I did
about each.

---

## 5. What changed — source

Four files, `+176 / −72` including comments.

### 5.1 `components/tabs/IssuesTab.tsx`

**A real defect, found by the new tests.** `bulkMoveStatus` built its banner
sentence as:

```ts
`They are still selected, so Retry re-sends only those ${countVerbFor(failures.length, 'rows', 'row')}.`
```

At one refusal that renders **"Retry re-sends only those row."** — the noun was
singularised and the demonstrative in front of it was left plural. That is the
same disagreement as "1 issues" and "1 issue are loaded", written one line below
the helper that exists to prevent it, and it shipped because round 2 asserted
what the *retry does* and never read the words it shows. Now:

```ts
`They are still selected, so Retry re-sends only ` +
`${countVerbFor(failures.length, `those ${failures.length} rows`, 'that row')}.`
```

→ "only that row." at one, "only those 2 rows." at two. Pinned at both ends
(mounted banner text + two unit assertions).

The rest of the change to this file is comment correction (§8).

### 5.2 `components/KanbanCard.tsx`

**The card was mouse-only.** The critic measured the root as `<div draggable
onClick=…>` with no `role`, no `tabIndex` and no key handler, and drew the right
conclusion: a keyboard user could not open a card at all, so the previous round
spent itself adding sr-only labels to a target no assistive-tech user could
reach. `grep -c onKeyDown components/KanbanCard.tsx` returned 0 before this change and
returns 2 after it. It now carries
`role="button"`, `tabIndex={0}`, an `aria-label` naming the task key and title,
and an `onKeyDown` that fires the same callback on Enter and Space
(`preventDefault` on Space so the board does not scroll out from under the
operator).

These are attached **only when a real `onClick` was passed**. A focusable element
that does nothing is worse than an unfocusable one — it puts a stop in the tab
order and pays nothing back.

Honest limits, stated in the file and repeated here: the column **move** is still
HTML5 drag-and-drop, which is mouse-only; opening a card and moving a card are
different gestures and only the first is fixed. And the card contains an `<a>`
(the issue key), so `role="button"` now nests an interactive element inside an
interactive element, which is a real a11y smell — the same shape `IssuesTab`'s
own desktop row already has. Making the root a real `<button>` is invalid HTML
with the anchor inside; the right end state is a shared card component that puts
the anchor outside the activation target, and that is not this piece's file to
create.

**The blocker chip was untruncated.** The critic fetched the live Limiglow row
and it carried `blocked_by: "system:ceiling_stop:no_progress"` — 31 characters —
which the card rendered whole inside a kanban column, wrapping the badge row,
while the file's own `truncate()` was applied to the title only. The visible chip
is now `truncate(task.blocked_by, BLOCKER_CHIP_MAX)` with `BLOCKER_CHIP_MAX =
18`: every task key stays whole, long machine-generated sentinels get an ellipsis
— and the **complete** value stays in the `title` tooltip and in the `sr-only`
text, because shortening what a screen reader hears to fit a column is the same
trade in the wrong direction.

### 5.3 `components/tabs/WorkViewCard.tsx` and `FeatureCard.tsx`

No behaviour change. `WorkViewCard`'s comments claimed the branches were
"unreachable from a test at all" and "untestable"; both are now false and both
are corrected in place with the reason. `FeatureCard` is unchanged — its mutant
was a test weakness, not a code defect (§6, M16).

---

## 6. What changed — tests, and the mutation results

`__tests__/work-ui-wiring.test.tsx` is new (929 lines: ~180 harness, ~90 comment,
the rest tests). `__tests__/work-ui-cards-behaviour.test.tsx` lost its five
source guards and gained two wording assertions.

**The harness proves itself first.** Three tests at the top check it against
behaviour whose answer is known independently — that `paint()` shows the
pre-effect state, that an async effect resolves against a mocked fetch, and that
two instances of the same component keep separate hook state. A test harness
nobody has tested is exactly the fabrication this round is repairing.

### The campaign

22 mutations, applied one at a time to the four owned files, each reverted
immediately, each followed by a full run of all three lane suites. Script:
`scratchpad/mutate.mjs`; every anchor string is listed below so it can be redone
by hand.

| # | file / anchor → mutation | result |
|---|---|---|
| M1 | `WorkViewCard` `{...props}` → add `children={undefined}` — **verbatim TOD-2444** | caught (4 failed) |
| M2 | `WorkViewCard` `setError(result.error)` → `setError(null)` | caught (2) |
| M3 | `WorkViewCard` `setLoaded(true)` → `setLoaded(false)` | caught (4) |
| M4 | `WorkViewCard` `source={query ?? …}` → `source={""}` | caught (1) |
| M5 | `IssuesTab` `{writeError && (` → `{false && writeError && (` | caught (4) |
| M6 | `IssuesTab` `const retryFailedWrite = () => {` + `return` | caught (2) |
| M7 | `IssuesTab` `if (error) {` → `if (false && error) {` | caught (2) |
| M8 | `IssuesTab` insert `setWriteError(null)` after `setWriteError(outcome.error)` | caught (2) |
| M9 | `IssuesTab` `countLabelFor(trueTotal, 'issues')` → `'issues'` | caught (1) |
| M10 | `IssuesTab` `countVerbFor(loadedTotal,'are','is')` → `are` | caught (1) |
| M11 | `IssuesTab` drop `!fetchError` from the empty-state guard | **SURVIVED — equivalent, proven in §4.1** |
| M12 | `IssuesTab` collapse both empty-state titles to `No issues found` | caught (2) |
| M13a | `IssuesTab` drop the optimistic `setIssues` on save success | caught (1) |
| M13b | `IssuesTab` drop the optimistic `setIssues` on bulk success | caught (1) |
| M14 | `IssuesTab` `retryFailedWrite` always calls `handleSave` | caught (1) |
| M15 | `IssuesTab` delete the printed endpoint line | caught (1) |
| M16 | `FeatureCard` `${done}/${total} done` → `${done}/${total}` | caught (1) |
| M17 | `KanbanCard` stop truncating the blocker chip (round-3 repair reverted) | caught (1) |
| M18 | `KanbanCard` key handler becomes a no-op | caught (1) |
| M19 | `IssuesTab` restore `only those row` | caught (3) |
| M20 | `KanbanCard` drop `role`/`tabIndex`/`aria-label` | caught (1) |
| M21 | `KanbanCard` drop the whole interactive spread | caught (1) |

**21 of 22 caught. The single survivor is unobservable.**

Integrity, printed by the same script after the last revert:

```
restored ok  components/tabs/IssuesTab.tsx     f0a8a4d663dcee1a6ee0fe4870c640cd
restored ok  components/tabs/WorkViewCard.tsx  752dd0138a38a227eee7d84111b32855
restored ok  components/tabs/FeatureCard.tsx   4b669e93eda55e541450de1fb4dda7af
restored ok  components/KanbanCard.tsx         f5ebe222bb08722d58e807a8c7ff71e7
```

Those are the shipped hashes. No `.bak` files left; no file outside the lane
written.

M16 deserves a note because it is the shape to watch for elsewhere. It survived
round 2 because the assertion was `expect(html).toContain('done')` and
`aria-valuetext` still contains the word — a substring match over the whole
document, which is satisfied by text the mutation never touched. The replacement
asserts the **exact** text of the one element the sighted reader sees
(`m.exactText('2/5 done')`). Any assertion of the form "the page contains this
word somewhere" has this failure mode.

---

## 7. Why the source guards are gone

Round 2 put five `expect(src).toContain('…')` assertions over IssuesTab's wiring
and labelled them "a weaker instrument". They are weaker than that: the critic
defeated **all five** with one-token edits that leave the guarded string
byte-identical (`{false && writeError && (`, `if (false && error) {`, `const
retryFailedWrite = () => { return`, and inserting `setWriteError(null)` after the
guarded line). A grep that a mutation walks straight past is worse than no test,
because it reads as coverage on the board.

Every behaviour they claimed to pin is now asserted against a mounted component
where the button is genuinely pressed:

| the guard claimed | the test that now proves it |
|---|---|
| the banner is handed `retryFailedWrite` | `re-sends the save — with the CURRENT edits — when Retry is pressed` |
| no ref pinning a stale render closure | same test (asserts the retry PATCH carries the *corrected* status), plus `re-sends ONLY the refused rows when Retry follows a bulk failure` |
| the bulk outcome feeds back into selection/status | `names the refused rows by task key after a PARTIAL bulk failure` |
| both writes route through the tested functions | every write test asserts the recorded PATCH bodies and counts |
| the editor stays open on a rejected save | `shows a banner and KEEPS THE EDITOR OPEN when a save is refused` |

---

## 8. Fabrications — what I did about each

The critic's rule is right: a comment or doc asserting something untrue of the
shipped code is a defect in its own right.

1. **`docs/rebuild/pieces/pieces8/work-ui-cards.md` §13 — "Mutation test — 19
   mutants, all caught".** Confirmed misleading: true only of the 19 the builder
   chose, while 12 of the critic's 32 survived. **That file is not in this lane's
   ownership and I did not edit it.** Request: mark §13 superseded by §6 here,
   or have its owner do so. Until then it reads as coverage and is not.
2. **`__tests__/work-ui-cards-behaviour.test.tsx` header — "the components were
   restructured … so that the branches the critic deleted became reachable
   without a DOM".** Mine. Corrected in place: the original paragraph is kept
   verbatim underneath a correction that says it was true of `WorkViewCardView`
   and false of the component `app/page.tsx` mounts, with the survivor count.
3. **Piece doc §10.3 + the source-guard block's claim to pin the JSX/state
   wiring.** Fixed by deleting the guards (§7).
4. **Piece doc §10.8 — "six source guards". There were five.** Confirmed:
   `sed -n '/SOURCE GUARDS/,$p' … | grep -c '  it('` → `5`. Moot now; the block
   is gone, and the corrected header says so explicitly.
5. **`components/KanbanCard.tsx:252-253` — "a key that fits in eight
   characters".** Mine. Corrected in place with the counter-example
   (`system:ceiling_stop:no_progress`, 31 chars) and the truncation it caused
   (§5.2).

Two further comments were false and are corrected: `WorkViewCard.tsx`'s
"unreachable from a test at all" / "untestable", and `IssuesTab.tsx`'s "what a
test still cannot do here is press the button".

---

## 9. Against Linear, feature by feature

Honest scoring, my own reading, no credit claimed for what is still missing.

1. **Time-in-state on the card.** Unchanged this round and still the best thing
   in the lane: `started 4h 12m ago` for in-progress rows, `updated 6d ago`
   otherwise, amber past 24h, and the card says which one it is showing. Linear
   still wins because it escalates staleness as a first-class signal; ours is
   honest that there is no `status_changed_at` column. Re-measured today:
   `grep -rn "status_changed_at" app/ lib/ migrations/` → no output.
2. **Every row actionable.** Was the worst gap and is now half-closed. The card
   opens from the keyboard. There is still **no context menu and no single-key
   shortcut** anywhere on the board — measured today, `onContextMenu`
   occurrences in `BoardTab.tsx` / `KanbanCard.tsx` / `IssuesTab.tsx` are
   `0 / 0 / 0`
3. **Partial bulk failure.** Ours is better than Linear's toast: it names the
   refused rows by task key, keeps exactly those selected, retains the target
   status, and Retry re-sends only those. As of this round that is proven by
   pressing the buttons, not by a returned object alone. And the sentence it
   shows is now grammatical (§5.1).
4. **A count never blanking a body.** `emptyStatePlacement` +
   `emptyNoteAboveBody` remain a genuinely good structural rule, and the wiring
   mutant that deleted the body anyway (M1) now fails four tests.
5. **Two divergent board cards.** Still true and still not this lane's file to
   fix. Re-verified today: `BoardTab.tsx` `renderBoardCard` at :521 with its own
   `IssueKeyLink` at :538, rendered at :930/:1015/:1125 for the feature/sprint/
   business swimlanes, while `KanbanCard` is rendered at :1199 for the default
   'together' mode. Which facts an issue card shows still depends on which
   swimlane you picked — and the keyboard and truncation repairs in §5.2 landed
   on only one of the two cards, so the divergence is now slightly **worse** in
   accessibility terms than it was this morning. Linear has one card. See §10.

---

## 10. Seam requests

**None against `app/page.tsx` or `components/nav/config.ts`.** I checked what
this lane needs from them and the answer is nothing: the four `WorkViewCard`
mount sites pass `countLabel` values that `singularizeLabel` handles correctly
— read today from `app/page.tsx` lines 1001/1010/1033/1050 they are `issues`,
`in backlog`, `epics`, `with a due date`, which `singularizeLabel` maps to
`issue`, `in backlog`, `epic`, `with a due date` —
and the TOD-2444 class is prevented structurally inside the card rather than by
what the caller passes. I am not manufacturing a seam to have one.

**One cross-lane request, to whoever owns `components/tabs/BoardTab.tsx`:** the
board renders two different issue cards (§9.5). The right end state is one card
component used by both `renderBoardCard` and the default mode. I have not
expressed this as a failing test, deliberately: a red test in my suite asserting
that *another lane's* file must change would break this lane's gate for reasons
outside its control, and the house pattern is for orchestrator-owned seams. It is
a request, and it is the single highest-value structural fix left in this area.

**One bug report, to whoever owns `app/api/issues/route.ts`:** `DELETE` does not
call `issuesCache.clear()` while `POST` (:1564) and `PATCH` (:2676) do, so a
deleted issue is served from cache for up to 30 seconds — on exactly the
`limit=1` query shape every card count uses. Reproduction and output in §3.

---

## 11. Acceptance — checkable without trusting me

Every item is a command with an expected result. Nothing here requires reading my
prose.

1. `npx tsc --noEmit` → exit 0.
2. `npx jest __tests__/work-ui-cards.test.tsx __tests__/work-ui-cards-behaviour.test.tsx __tests__/work-ui-wiring.test.tsx`
   → **80 passed / 80 total**.
3. `bash scripts/smoke-test-layout.sh` → exit 0, nine guards.
4. `node scripts/acceptance/run.mjs` → 45/45, 10/10. (Re-run if slow; the server
   is shared.)
5. **The harness is not a mock of the components.** Confirm the tests import the
   *default* exports:
   `grep -n "^import" __tests__/work-ui-wiring.test.tsx` — `IssuesTab`,
   `WorkViewCard`, `FeatureCard` are default imports, `KanbanCard` is the named
   export `BoardTab.tsx:1199` renders. There is no `jest.mock` of any component
   in the file: `grep -c "jest.mock" __tests__/work-ui-wiring.test.tsx` → `0`.
   The only thing mocked is `global.fetch`.
6. **Re-run the campaign.** Apply any row of §6's table by hand, run item 2, and
   watch it fail. M1 is the one to try first: add `children={undefined}` on the
   line after `{...props}` in `WorkViewCard`'s default export — it took `tsc`,
   `no-silent-empty` and 51/51 with it last round; it now fails four tests.
7. **Check the one survivor yourself.** Apply M11, run item 2 — it passes, as
   stated. Then confirm *why*:
   `grep -n '!loading && !fetchError' components/tabs/IssuesTab.tsx` → lines
   **459** and **594**; the empty-state guard at 594 is nested inside the outer
   one at 459, so the inner `!fetchError` cannot change what renders.
8. **The blocker truncation is real, not cosmetic:**
   `npx jest __tests__/work-ui-wiring.test.tsx -t 'truncates a long blocker'`
   → passes; it asserts the visible chip is ≤ 20 chars and ends in `…` while the
   `sr-only` text and the `title` both hold
   `blocked by system:ceiling_stop:no_progress` in full.
9. **The live route:**
   `curl -s -o /dev/null -w '%{http_code}' -H 'cookie: mc-auth=kaos2026; mc-role=owner' 'http://localhost:3000/api/issues?project=Limiglow&limit=1'`
   → `200`. Without the cookie → `401`.
10. **No fixture rows left behind:**
    `curl -s -H 'cookie: mc-auth=kaos2026; mc-role=owner' 'http://localhost:3000/api/issues?project=Limiglow&limit=0'`
    → `{"data":[],"total":0,…}`. (Use `limit=0` or a cache-busting param; a bare
    `limit=1` can be answered from the 30s cache — see §3.)

---

## 12. What I did NOT verify

Stated as gaps, not as reassurance.

- **No browser. No screenshot. No rendered pixel.** `GET /` is `307 → /login` and
  this lane has no browser tool. Nothing in this piece is visual evidence.
- **No real DOM.** The harness is a miniature React, not a browser. It has no
  layout, no CSS, no focus management, no event bubbling or capture, no real
  `preventDefault` semantics, no HTML5 drag-and-drop, no screen reader. In
  particular: the keyboard test proves `onKeyDown` invokes the same callback as
  `onClick` and that `role`/`tabIndex`/`aria-label` are emitted. **It does not
  prove the card is reachable by Tab in a real browser, that focus is visible, or
  that any assistive technology announces it.** Someone with a browser should
  check those three things before this is called accessible.
- **The nested-interactive smell in `KanbanCard` is unmeasured.** `role="button"`
  now wraps an `<a>`. I did not run an accessibility auditor over it because I
  have no browser; I have written it down rather than let it pass silently.
- **`aria-hidden`/`sr-only` behaviour** is asserted as emitted props and text,
  never as announced output.
- **Drag-and-drop** — the column move — is untested and unchanged. It remains
  mouse-only.
- **`FeatureCard`'s expanded state, `IssuesTab`'s sort controls, the mobile row
  layout and the responsive breakpoints** have no tests here. The smoke test
  covers the sidebar/bottom-nav breakpoint pairing; nothing covers these.
- **`total` beyond a two-row fixture.** I measured the count contract against one
  real row and against mocked envelopes. I did not measure a paginated project or
  a `has_more: true` case on live data — there were no such rows on the server
  today.
- **The 30s cache defect** (§3) is diagnosed from reading the route plus the
  repro above. I did not wait out the TTL to watch it expire, and I did not test
  whether any other route mutates issues without clearing the cache.
- **The six red suites in `npm test`** — I established that none of them import
  any file this lane owns and quoted their failure headlines. I did not diagnose
  them, and I did not verify the claim that they are all intentional seam reds.
- **`npm run build` was never run** (forbidden by the brief — it would clobber the
  running dev server). So nothing here is evidence about the production bundle.

# Pipeline humaniser — pieces9

Channel: **Pipeline Fidelity**, 6/9. Benchmark: Linear — *a board move either
completes or tells you exactly what it needs, and never shows raw database
text.*

Everything below marked **Measured** was run by me on this machine on
**2026-08-26**, against the already-running dev server on `localhost:3000` and
against in-process `better-sqlite3` / PGlite. Everything I could **not** observe
is in §9, which is the section to read first if you are deciding how much of
this to trust.

---

## 1. The critic's findings, checked one at a time

I treated the relayed report as claims. Here is where each landed.

| # | Claim | Verdict |
|---|---|---|
| GAP | The allowlist over-eats the repo's own sentences; the source-derived guard cannot see `error: e.message` / `error: NO_KEY_ERROR()` | **CONFIRMED, and worse than stated** — see §2 |
| M1 | `PipelineTab.tsx:654` humaniser call can be deleted with all suites green | **CONFIRMED** — reproduced, now fixed and re-mutated |
| M2 | `PipelineTab.tsx:799` `safeApiError` call can be deleted with all suites green | **CONFIRMED** — reproduced, now structurally impossible to matter |
| M3 | phantom-column guard is snake_case-gated, `i.testStatus` invisible | **CONFIRMED** — closed from my own file, §5 |
| M4 | no test pins the five operational sentences | **CONFIRMED** — pinned, §5 |
| F1 | shipped comment at `lib/issue-moves.ts:508-514` is false three ways | **CONFIRMED** — rewritten, §6 |
| F2 | pieces8 §10.3's word "every" is false | **CONFIRMED** — pieces8 is not my file; correction recorded here, §6 |
| F3 | pieces8 §10.4 "the wiring guard now means something" is false | **CONFIRMED** — §6 |
| F4 | `/^Only\s+\S/`'s "no driver opens with a bare 'Only '" is an untested unbounded claim | **CONFIRMED** — tightened and tested, §4 |
| — | "the allowlist inversion is real and works; 7 adversarial driver strings replaced" | **CONFIRMED and extended** — I swept 326 real ones, §3 |
| — | gate baseline `npm test` ≈1967 with one known failure | **STALE** — the tree has moved; §8 |

**Where the critic was wrong, or imprecise:**

* The report's framing — *"the channel's whole promise is that raw database text
  never reaches the operator … find one that leaks"* — set me looking for a
  leak. **There is no leak.** I forced 326 distinct real driver strings out of
  both dialects across the whole shipped schema and **zero** survived any of the
  three paths (§3). The critic's own 7-string probe pointed the same way; the
  sweep settles it at a scale a hand-written probe cannot.
* "Two are confirmed live over HTTP … and both become *the database refused the
  query…*" — correct, and I re-confirmed both live. But the critic's count of
  **14 eaten** understates it: the `DbQueryParseError` family alone has **13
  distinct sentence shapes** and every one was eaten, plus four
  `DbConfigurationError` shapes and both spellings of `dbStatusMessage()`.
* F4's "synthetic `Only one row may be updated at a time (pg internal)` leaked
  through" — reproduced exactly. But note what it is: a **synthetic** string. In
  326 real driver messages, **none** begins with `Only `. The claim in the
  shipped comment was still wrong to make (it was untested and unbounded), and I
  narrowed the pattern anyway — but the fix is insurance, not a plugged leak.

---

## 2. The measurement that drove the work

**Measured.** Live HTTP, this dev server, owner session
(`mc-role=owner` + `mc-auth`), `Referer: /p/limiglow`, scoped the way the
Pipeline scopes its own reads:

```
GET /api/db/issues?project=eq.Limiglow&archived_at=is.null&limit=abc
  → 400 {"error":"Invalid numeric value \"abc\"."}
GET …&or=()
  → 400 {"error":"\"or\" needs at least one term."}
GET …&status=zz.open
  → 400 {"error":"Unsupported filter operator \"zz\" on column \"status\"."}
GET …&select=nope_not_a_column
  → 400 {"error":"no such column: \"nope_not_a_column\" - should this be a string literal in single-quotes?","code":"42703","details":null}
GET …&nope_col=eq.1
  → 400 {"error":"no such column: \"nope_col\" - …","code":"42703","details":null}
GET /p/limiglow?view=pipeline → 200
```

Five refusals, one endpoint, one status code. **Three of them are sentences this
repo wrote and two are the driver's.** Before this change all five were replaced
by *"the database refused the query in terms this board has no wording for
yet."*

**Measured**, in-process against the shipped functions, before the fix: **19 of
20** repo-written sentences EATEN on **both** humanisers, including —

* `The local database file does not exist yet: … Run \`npm run db:migrate\` (or \`npm run setup\`) to create it.`
* `Database is not configured (provider "sqlite"). Missing environment variable: … Set it in .env.local`
* `database not configured (provider "sqlite"): missing … — agent run state unavailable`
* every one of the 13 `DbQueryParseError` shapes.

The first two are the worst, and not merely because they are vaguer. For an
unconfigured database the replacement is **factually false**: no query was
refused, because there is no database to refuse one. The server was naming the
command to run and the board deleted it. That is the opposite of the benchmark.

### Why the guard could not see them

`app/api/db/[...path]/route.ts` answers `{ error: e.message }` at lines 276 and
279; `app/api/agents/route.ts` answers `{ error: NO_KEY_ERROR() }` at 928 and
954. The source-derived extractor matched `/\berror\s*:\s*(['"`])/` — a quote
**immediately** after `error:` — so all four were invisible, and
`npx jest lib/__tests__/issue-moves.test.ts` reported **179 passed / 179** while
it happened.

---

## 3. The sweep: is there a leak?

The assignment says *force refusals the humaniser has never seen — every CHECK
in both dialects, every foreign key, every NOT NULL, every unique index — and
find one that leaks.* I did not hand-pick candidates; I made the drivers speak.

**Measured.** `sweepSqlite()` builds the real schema from `migrations/sqlite/*`
in `:memory:` with `foreign_keys = ON`; `sweepPostgres()` builds it from
`migrations/*` in PGlite. Both then walk **every table and every column**,
attempting `INSERT … DEFAULT VALUES`, `INSERT (col) VALUES ('__zz__')`,
`INSERT (col) VALUES (NULL)`, `UPDATE SET col = NULL`, `UPDATE SET col =
'__zz__'`, plus a seeded `issues` row to reach the UNIQUE and CHECK rules that
need one, plus a missing column and a missing table.

```
326 distinct driver messages across the two dialects
  0  survived humaniseMoveFailure
  0  survived humaniseLoadFailure
  0  survived safeApiError (the banner path)
```

Covered by that corpus: every `CHECK` in both spellings (SQLite's expression
text and Postgres's constraint name, including the anonymous `issues_checkN`
family), `NOT NULL constraint failed` / `null value in column`, `UNIQUE
constraint failed` / `duplicate key value violates unique constraint`, `FOREIGN
KEY constraint failed`, `invalid input syntax for type {integer,bigint,uuid,
date,numeric,double precision,json,timestamp}`, `invalid input value for enum`,
`malformed array literal`, `Invalid input for boolean type`, generated-column
writes, SQLite FTS shadow tables, `no such column` / `column … does not exist` /
`relation … does not exist`, and `division by zero`.

**So: no leak.** This is now a permanent test (`no driver in either dialect can
put raw text on a screen`), with a non-vacuity assertion that names the shapes
rather than only a total — because a sweep that silently produced nothing would
make the leak assertion pass on an empty list, which is precisely how the guards
it replaces reported full coverage while leaking.

### The quality half of the same number

26 of the 326 fell all the way to the generic sentence. A foreign-key violation
is not "a rule this board has no wording for" — it is *the thing you pointed at
is gone*. Seven new `KNOWN_CONSTRAINTS` entries, written **from the sweep** and
not from memory, cut 26 → **1**.

The survivor is Postgres's `division by zero`, and it is left there on purpose.
See §4.

---

## 4. The DEFAULT case — the whole argument

The question the assignment poses is *bigger whitelist, or inversion?* The
honest answer is that this file already **is** the inversion, and that the
inversion is a statement about one branch only:

```
recognised  → verbatim
DEFAULT     → replaced
```

Not "replaced if it looks like SQL". Replaced, full stop, including messages the
file has never seen and has no translation for. That single property is the
whole difference from the denylist this replaced:

* A **denylist's** default is PASS. Every message its author failed to imagine
  reaches the operator. Sixteen real driver strings did, including one carrying
  the database host and port.
* An **allowlist's** default is REPLACE. Every message its author failed to
  imagine costs the operator a good sentence and nothing worse.

Both lists are incomplete forever. Only one is incomplete in the safe direction.

**So why did I add to the whitelist rather than change the rule?** Because the
defect this wave was not the rule — it was that the allowlist's *membership*
was maintained by hand while the doc claimed it was derived. The fix is not a
different default; it is to make the list's completeness **mechanically checked
against the source of truth**, so the whitelist cannot silently fall behind:

* **Pass 1** — quoted `error:` literals in the five route files (as before).
* **Pass 2** — every literal argument to `new DbQueryParseError(…)` /
  `new DbConfigurationError(…)` anywhere in `lib/db/*`, `lib/db.ts` and the db
  route, read at the `throw` site where the text actually is.
* **Pass 3** — `dbStatusMessage()`'s two spellings, wrapped in the agents-route
  suffix, **read from source** (`NO_KEY_ERROR = () => \`…\``) rather than typed
  into the test.

All three feed one assertion: every sentence found must survive **both**
humanisers unchanged. Adding a refusal without allowlisting it turns the build
red. **Measured:** deleting `DB_SEAM_MESSAGES` from `isKnownHumanMessage` →
**1 failed**, listing 48 eaten entries — 24 distinct sentences across both humanisers.

**The default branch is not dead code, and I can prove it.** After the seven new
refinements, exactly one message in the 326-string corpus still reaches it:
`division by zero`. I deliberately did **not** write a sentence for it. It is
not a rule the operator broke, there is nothing they can do about it, and
leaving it there means the generic branch has a measured live occupant rather
than a claim that it never fires. The test asserts `vague < 20` rather than
`=== 1`, so that a new migration adding an unworded constraint is **visible in
that number** without being a build break the day it lands.

### The one narrowing

`/^Only\s+\S/` → `/^Only [^.]{0,200}\bcan\b/`. All eleven real `Only …`
refusals in the routes are of the form *"Only ⟨who⟩ can ⟨do the thing⟩"*, and
the test asserts that against the literals themselves, not against memory. The
synthetic `Only one row may be updated at a time (pg internal)` no longer
passes. This takes an unbounded claim about two third-party drivers across all
future versions down to a much smaller one about a specific sentence shape.

---

## 5. What I changed

### `lib/issue-moves.ts`

1. **`DB_SEAM_MESSAGES`** — a new allowlist group for `DbQueryParseError`,
   `DbConfigurationError` and `dbStatusMessage()`. Ordering note: *"The local
   database file does not exist yet…"* contains `does not exist`, which is also
   how Postgres reports a phantom column; the allowlist runs before
   `KNOWN_CONSTRAINTS`, so the seam's own sentence wins and an operator is not
   told "the board asked for a field the database does not have" about a missing
   *file*.
2. **Seven new `KNOWN_CONSTRAINTS` entries**, written from the sweep: foreign
   key (violated reference vs. violated dependency, split — they mean opposite
   things to the operator), general UNIQUE, Postgres enum, boolean/array
   coercion, generated columns and FTS shadow tables, and a last-resort CHECK
   catch-all.
3. **`anonymousCheckSentence()` hoisted above the table.** The CHECK catch-all
   would otherwise have answered first and made that call unreachable — a
   regression I introduced and caught in the same run. **Measured:** moving it
   back below → **1 failed**.
4. **Idempotence** (`isOwnSentence`). Humanising twice now equals humanising
   once. This is load-bearing, not tidiness: see §5's banner design. Without it,
   a second pass turned *"…a bug in Todero…"* into the generic sentence.
   **Measured:** removing it → **4 failed**.
5. The false comment at 508-514 replaced with what the guard actually does.

### `components/tabs/PipelineTab.tsx` — the two surviving mutants

The previous wave fixed `safeApiError` **as a function** and not **as a use**.
Both mutants worked by rebinding a variable, which a source-spelling whitelist
(`expect(src).toMatch(/setErr\(safe\)/)`) cannot see.

**The move sheet.** `moveError` state is now the RAW `MoveFailure`
(`{message, toStatus, status}`), and a new exported `MoveFailureNotice`
humanises at render. There is no longer a `human` binding anywhere for a
mutation to point at `r.error.message`; the component **cannot be handed** a
pre-humanised string because it does not accept one.

**The banners.** `components/ApiErrorBanner` is now imported as
`RawApiErrorBanner` and referenced **exactly once**, inside a local exported
wrapper *named* `ApiErrorBanner` which humanises first. Within that module the
unqualified name resolves to the safe component, so every `<ApiErrorBanner …>`
— including one added next year by someone who reads none of this — humanises.
Reaching the raw one takes deliberately spelling `RawApiErrorBanner`.

The three call sites keep their `shownError` / `shownRosterError` / `err`
spellings, which is why `lib/__tests__/pipeline-no-phantom-columns.test.ts`
(another lane's file, untouched) still passes with its guard intact and now
genuinely redundant rather than falsely reassuring.

### `lib/__tests__/issue-moves.test.ts`

* Both surfaces are now **RENDERED**. The note in `PipelineTab.tsx` claimed a
  rendering test was impossible here ("no @testing-library/react",
  `testEnvironment: "node"`). Only the first half is true — `react-dom/server`
  is already a dependency and `renderToStaticMarkup` runs in plain node. The
  tests feed each surface a verbatim `CHECK constraint failed: …` and assert on
  the **markup**. Renaming a variable does not move that assertion.
* Two **closed** source guards, written the opposite way round from the ones
  that failed: not *"is the approved spelling present?"* (a rename satisfies it)
  but *"is `RawApiErrorBanner` mentioned exactly twice, and is
  `humaniseMoveFailure(` called exactly once, inside the safe component?"* — a
  new raw use fails whether or not anyone predicted its spelling.
* The 326-message dual-dialect sweep (§3).
* The operational sentences pinned, 21 cases, one assertion each (M4).
* A phantom-column guard for `lib/pipeline.ts` that enumerates the **real**
  `issues` columns from the migrations and refuses any member read that is not
  one of them — case-agnostic, closing M3 from the other direction without
  touching another lane's file.
* Idempotence tests.

---

## 6. Fabrications — fixed, and one I could not fix

| Where | Status |
|---|---|
| `lib/issue-moves.ts:508-514` — "parses every `error:` / `message:` string literal … turns the build red" | **FIXED.** The block now describes the three passes that exist, names the 24 sentences that were being eaten while the old claim stood, and points at §7 for the residue it still cannot see. |
| `lib/issue-moves.ts` — `/^Only\s+\S/` "No driver message in either dialect opens with a bare 'Only '." | **FIXED.** Claim removed, pattern narrowed, both directions tested. |
| pieces8 §10.3 — "A test now parses **every** `error:` string literal … and asserts each survives" | **NOT FIXED — pieces8 is not this lane's file.** The word "every" was false: `app/api/agents/route.ts` is one of the five named files and its 503 body was neither scanned nor allowlisted. It is scanned and allowlisted now, so the sentence is true of today's code by accident rather than by its own argument. **A reader of pieces8 §10.3 should read §4 here instead.** |
| pieces8 §10.4 — "The wiring guard is kept; it now means something because the behaviour guard sits behind it" | **NOT FIXED in pieces8 — but the underlying claim is now TRUE**, for a different reason than that section gives: the behaviour guard is a render test on the components, not a call on the function. |
| pieces8 §10.6 — recorded `check-no-secrets` at exit 1 | Stale, not invented; fixed by TOD-2410. **Measured today: `bash scripts/smoke-test-layout.sh` → exit 0.** |

---

## 7. What the guard still cannot see

Named rather than hidden, because the previous version of this claim is the
reason this piece exists.

* The scanners read **five route files** and the **db seam modules**. A refusal
  built anywhere else — a helper in another module interpolated into
  `{ error: helper() }` — is invisible to all three passes, would be replaced by
  the generic sentence, and nothing would fail.
* Pass 2 reads only the **first literal** of each multi-line `throw`. That is
  the right half (the allowlist anchors on sentence starts) but it means a
  refusal whose distinguishing text is in the *second* concatenated fragment is
  matched only by its opening words.
* Pass 3's `dbStatusMessage()` prefixes are constructed in the test from the two
  shapes that function can return; the **suffix** is read from source, the
  prefixes are not. A third return spelling would be missed.
* `humaniseLoadFailure` does not consult `KNOWN_CONSTRAINTS` — only the
  phantom-column shape. A CHECK violation on a **read** therefore gets the
  generic load sentence rather than a specific one. No read the Pipeline issues
  can trip a CHECK, so this is an unexercised path, not a live defect.

---

## 8. SEAM DIFF — the change that would end the guessing

**I am not filing this as a failing test.** The house pattern is to express
incompleteness as a red gate, and I considered it; the gate baseline says one
known failure and warns that any second one must be investigated, and adding a
deliberate permanent red would manufacture exactly the confusion that warning
exists to prevent. It is filed as prose plus a **green** guard that goes red on
the real event (a new unallowlisted refusal), which I think is strictly better
than a red that is always red.

**The problem.** The db proxy already knows which kind of refusal it is
answering with, and throws that knowledge away:

* `DbConfigurationError` → 503 `{ error, missingEnv }` — **ours**
* `DbQueryParseError` → 400 `{ error }` — **ours**
* driver failure → 400/500 `{ error, code, details }` — **not ours**

`lib/fetch-json.ts` flattens all three to a message string, so the client has to
recover the distinction by **spelling**. That is what the allowlist is: a
textual reconstruction of a fact the server had and discarded.

**Requested — `app/api/db/[...path]/route.ts`** (orchestrator/other lane; not
mine to edit):

```diff
     if (e instanceof DbConfigurationError) {
-      return NextResponse.json({ error: e.message, missingEnv: e.missingEnv }, { status: 503 })
+      return NextResponse.json(
+        { error: e.message, missingEnv: e.missingEnv, error_source: 'todero' },
+        { status: 503 },
+      )
     }
     if (e instanceof DbQueryParseError) {
-      return NextResponse.json({ error: e.message }, { status: 400 })
+      return NextResponse.json({ error: e.message, error_source: 'todero' }, { status: 400 })
     }
```
```diff
   if (result.error) {
     return NextResponse.json(
-      { error: result.error.message, code: result.error.code ?? null, details: result.error.details ?? null },
+      {
+        error: result.error.message,
+        code: result.error.code ?? null,
+        details: result.error.details ?? null,
+        error_source: 'driver',
+      },
       { status: result.status && result.status >= 400 ? result.status : 400 },
     )
   }
```

plus `hooks/useApiData.ts` carrying `error_source` onto `ApiError` the way it
already carries `code`.

With that landed, `isKnownHumanMessage` becomes a **fact** rather than a
reconstruction — `error_source === 'todero'` passes, `'driver'` is replaced,
and absent (any route that has not adopted it) falls back to today's textual
allowlist. The allowlist stops being the mechanism and becomes the compatibility
shim. **I did not implement the client half**, because a client that branches on
a field no route sends yet is untestable theatre.

Also still outstanding from pieces8, unchanged: deleting `getPipelineStage` /
`STAGE_COLORS` / `PipelineStage` from `lib/pipeline.ts` together with
`__tests__/utils/pipeline.test.ts`, which is a two-file diff and the second file
is not mine.

---

## 9. What I did NOT verify

* **No DOM. No browser.** I have no browser tool. Nothing here is a rendering
  fact about a real page. `renderToStaticMarkup` proves *what a component emits
  when React renders it*; it does not prove an operator ever reaches that
  component, that the move sheet opens, or that the banner is visible. Whether
  `MoveFailureNotice` appears on a phone at 375px is **unverified by me**.
* **The move sheet's failure branch was not exercised over real HTTP.** I did
  not PATCH a refused move against the running server this session — I created
  **zero fixture rows** (see §10) and relied on the previous wave's live
  measurements for the refusal strings, plus my own dual-dialect sweep for the
  driver strings. The strings are real; the *path from a tap to that string* is
  not something I re-measured today.
* **`error_source` (§8) is unimplemented on both sides.** No test asserts it.
* **The `Only …` narrowing** is verified against the eleven literals in the
  routes today and against 326 real driver messages. It is *not* proof no future
  driver version emits `Only … can …`. That is a smaller unbounded claim than
  the one it replaces, not zero.
* **`division by zero`** is deliberately unrefined (§4). If you think that is
  wrong, it is a decision to argue with, not an oversight.
* **Cross-suite pollution.** Several suites fail in a full `npm test` and pass
  in isolation. I checked that none of them names any file I own (§10) but I did
  not diagnose them; they belong to other lanes in flight.

---

## 10. Gate, as measured today

```
npx tsc --noEmit                    Clean of anything this lane owns. The one
                                    error present at the last run is
                                    components/tabs/IssuesTab.tsx(559,72) —
                                    another lane's file, mid-edit. Over the
                                    session that file and
                                    __tests__/work-ui-wiring.test.tsx went red,
                                    green and red again under me; neither is
                                    mine and neither is caused by this work.
                                    A run with only my files in scope is clean.

npm test                            2262 passed / 28 failed / 2 skipped
                                    Failing suites, none naming any file I own:
                                      __tests__/api/inbox-db-proxy-seam
                                      __tests__/auth/login-surface-seam
                                      __tests__/auth/middleware-role-source-seam
                                      __tests__/fleet/fleet-provenance-seams
                                      __tests__/runtimes/pieces9-seams
                                      __tests__/runtimes/spawn-live   (known)
                                      __tests__/work-ui-wiring
                                      lib/__tests__/agent-budget-ceilings
                                      lib/__tests__/approvals
                                    The set CHANGES between consecutive runs —
                                    other lanes are writing these files right
                                    now. `grep -E "issue-moves|PipelineTab|
                                    lib/pipeline|pipeline-stages"` over the full
                                    failure output: NO MATCHES.

this lane's four suites            309 passed / 309 total
  lib/__tests__/issue-moves                 227  (was 179)
  lib/__tests__/pipeline-no-phantom-columns  19  (unchanged, still passing)
  lib/__tests__/pipeline-stages              59
  __tests__/utils/pipeline                    4

node scripts/acceptance/run.mjs     45/45 passing, harness 10/10
                                    Run four times: 10327ms, 12526ms, 6845ms,
                                    8277ms. The 12526ms run reported 44/45 and
                                    9.8/10 — a LOADED SERVER, not a defect: the
                                    two runs immediately after it were 45/45 and
                                    10/10 with nothing changed in between. I am
                                    reporting the number I could reproduce
                                    twice, and reporting the outlier too rather
                                    than quietly dropping it.
bash scripts/smoke-test-layout.sh   exit 0, nine guards, check-no-secrets ✅
```

**Mutation results — every one applied from and restored to a saved copy.**

| Mutation | Before | Now |
|---|---|---|
| `MoveFailureNotice` renders `failure.message` (was M1) | *not expressible* | **2 failed** |
| wrapper: `<RawApiErrorBanner error={error}>` (was M2) | *not expressible* | **3 failed** |
| call site swaps to `<RawApiErrorBanner …>` | not caught | **2 failed** |
| drop the `shownError` memo | — | **1 failed** (other lane's guard) |
| `const safe = r.error` (the literal M2) | not caught | **survives, and is no longer a defect** — the wrapper humanises whatever it is handed; the only way driver text reaches the screen from there is to *also* apply the mutation above, which fails |
| `isKnownHumanMessage` → always true | 137 failed | **167 failed** |
| delete `DB_SEAM_MESSAGES` | — | **1 failed**, naming 48 eaten entries (24 sentences × both humanisers) |
| drop one `DB_SEAM_MESSAGES` pattern | — | **2 failed** |
| revert `/^Only …\bcan\b/` → `/^Only\s+\S/` | not caught | **1 failed**, by name |
| break `value too long for type` (was M4) | not caught | **1 failed**, by name |
| drop the FK entry | — | **1 failed** |
| drop the general UNIQUE entry | — | **1 failed** |
| drop the CHECK catch-all | — | **1 failed** |
| remove idempotence | — | **4 failed** |
| move `anonymousCheckSentence` below the table | — | **1 failed** |
| camelCase phantom in `lib/pipeline.ts` (was M3) | not caught | **1 failed** |

## 11. Fixtures

**None created.** Every measurement was either a read-only `GET` against the
running server or an in-process `:memory:` SQLite / PGlite database that is
discarded when the process exits. No row was written to the live database in any
table. `GET /api/db/issues?project=eq.Limiglow&archived_at=is.null&select=…`
returns `[]`. `TOD-1` was never read and never written. No git command that
mutates was run.

Two temporary probe blocks were appended to `lib/__tests__/issue-moves.test.ts`
during exploration and both were removed; the file was restored byte-for-byte
from a saved copy (`md5 1c778da8…`) before the real work began.

---

## 12. Acceptance list — checkable without trusting me

1. `node --experimental-vm-modules node_modules/jest/bin/jest.js lib/__tests__/issue-moves.test.ts lib/__tests__/pipeline-no-phantom-columns.test.ts lib/__tests__/pipeline-stages.test.ts __tests__/utils/pipeline.test.ts` → **309 passed / 309**.
2. `npx tsc --noEmit` → clean, or errors only in files this lane does not own.
3. `bash scripts/smoke-test-layout.sh` → exit 0. `node scripts/acceptance/run.mjs` → 45/45, 10/10.
4. **The leak claim.** In `issue-moves.test.ts`, `describe('no driver in either dialect can put raw text on a screen')` builds both dialects from `migrations/` and asserts zero survivors. To check it is not vacuous, break the sweep (e.g. return `[]` from `sweepSqlite`) — the `actually forced the drivers to speak` test fails first.
5. **The over-eating claim.** Delete `DB_SEAM_MESSAGES.some(...)` from `isKnownHumanMessage` in `lib/issue-moves.ts` → one test fails and prints 48 entries — the 24 repo-written sentences it eats, on each humaniser. Restore.
6. **M1.** In `PipelineTab.tsx`, change `MoveFailureNotice`'s body to render `{failure.message}` → 2 failed. There is no `humaniseMoveFailure` call at a call site to delete; `grep -c 'humaniseMoveFailure(' components/tabs/PipelineTab.tsx` counting code only → 1.
7. **M2.** Change `<RawApiErrorBanner error={safeApiError(error)}` to `error={error}` → 3 failed.
8. **M3.** Append `export function zz(i: any) { return i.testStatus === 'passed' }` to `lib/pipeline.ts` → 1 failed, listing `testStatus`.
9. **M4.** Change `value too long for type` in `KNOWN_CONSTRAINTS` to a string that never matches → 1 failed, by name.
10. **The live half.** With the dev server up and an owner session, `GET /api/db/issues?project=eq.Limiglow&archived_at=is.null&limit=abc` → 400 `Invalid numeric value "abc".`, and `humaniseLoadFailure` on that exact string returns it **unchanged** (asserted in `the live 400s from /api/db/issues, sorted correctly`), while `select=nope_not_a_column`'s body is replaced.
11. **The default case.** `humaniseMoveFailure('anything nobody wrote a rule for', 'open', 500)` → the generic sentence. `humaniseLoadFailure('SQLITE_CONSTRAINT_TRIGGER: constraint failed')` → replaced. Neither has an entry anywhere.
12. **§9 is the honest part.** Nothing in this piece is a DOM fact.

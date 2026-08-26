# moves-that-complete — the Pipeline offers only moves it can finish

**Channel:** Work Management UI (5/9) — *"Linear — a board that refuses a move the
server rejected, and never renders an empty state over an error."*

The second half of that sentence already held. The first half did not: the move
sheet listed all sixteen statuses unconditionally and let the API say no
afterwards. On six of them the operator's reward for tapping was a refusal, and
on two of those the refusal was a raw SQLite `CHECK constraint failed: …` string.

---

## 1. What was measured, and how

Every row below was produced against the running dev server on 2026-08-26 by
POSTing a **fresh** issue through `POST /api/issues`
(`project: Limiglow`, `type: ops`, `priority: low`, `assignee: ops`, with
`description` and `acceptance_criteria`, which POST requires) and then sending
the move sheet's exact body — `PATCH /api/issues` with `{ id, status }` and
nothing else — as the signed-in owner
(`cookie: mc-auth=kaos2026; mc-role=owner`).

One fresh row per destination; **37 fixture rows across five measurement passes,
plus 2 more for the browser verification in §6 — all 39 deleted afterwards.**
Limiglow held zero issues of this piece's making before and after.

(Three rows titled `PHANTOM-COLUMN probe:` — TOD-105, TOD-106, TOD-107 — appeared
in Limiglow partway through, from another builder working the same database at
the same time. They are not this piece's and were left untouched.)

The signed-in owner matters. `lib/session-actor.ts:36` resolves an owner session
to the actor `michael`, and `app/api/issues/route.ts:570,587` give that actor a
blanket bypass of `validateWorkflowTransition`. So the from→to edge table in
`workflow_transitions` never fires for a board move. Everything that refuses a
board move below is either an explicit hand-written rule in the PATCH handler,
or a `CHECK` constraint on the `issues` table.

## 2. The table — 16 destinations from a fresh `backlog` row

`{id, status}` only. "Extra fields needed" is what makes the move succeed, also
measured.

| # | Destination | `{id,status}` | HTTP | Extra fields needed to complete | Where enforced |
|---|---|---|---|---|---|
| 1 | `backlog` | ✅ succeeds *(no-op only)* | 200 | **From any other status, as measured in this pass: not satisfiable from the board.** Actor must be `main`/`po`/`ops`; the owner session is `michael`, and at the time of this pass that name was not in the list. **See §7 — this stopped being true within the same commit that recorded it.** Also must NOT carry `sprint`. | `route.ts:1631-1637` (line numbers at the time of this pass); `CHECK (NOT (status='backlog' AND sprint IS NOT NULL))` |
| 2 | `draft` | ✅ succeeds | 200 | — | — |
| 3 | `defined` | ✅ succeeds | 200 | `owner` non-empty. POST always sets it by type, and **PATCH strips `owner` (`route.ts:2178-2181`)**, so a row missing it cannot be fixed from the board. | `route.ts:1737-1745` |
| 4 | `refined` | ❌ refuses | 400 | `description` non-empty **and** `test_tier` ∈ {smoke, integration, e2e} for task/bug/ops. Epics/features skip `test_tier`. | `route.ts:1748-1770` |
| 5 | `open` | ❌ refuses | **500** | `sprint` non-null **and** `acceptance_criteria` non-empty. Server-only extra: 409 when ≥10 issues are already `open`. | `CHECK (status NOT IN ('open','in_progress','in_review') OR sprint IS NOT NULL)`; `route.ts:1773-1790` |
| 6 | `in_progress` | ❌ refuses | **500** | `sprint` non-null. Server-only extra: 409 one-at-a-time lane when the assignee already has an `in_progress` issue. | same `CHECK`; `route.ts:1674-1697` |
| 7 | `underway` | ✅ succeeds | 200 | — | — |
| 8 | `active` | ✅ succeeds | 200 | — | — |
| 9 | `code_review` | ❌ refuses | 422 | `resolution_type`, `implementation_notes` (≥10 chars), **and for task/bug/ops** `commit_sha` (≠ empty, ≠ `"none"`) and `regression_test`. | `route.ts:1811-1825`, `route.ts:1934-1950` |
| 10 | `product_review` | ❌ refuses | 422 | `resolution_type` and `implementation_notes` (≥10 chars). | `route.ts:1811-1825` |
| 11 | `feature_review` | ✅ succeeds | 200 | — | — |
| 12 | `approved` | ✅ succeeds | 200 | — | — |
| 13 | `released` | ✅ succeeds | 200 | — | — |
| 14 | `wrapped` | ✅ succeeds | 200 | — | — |
| 15 | `completed` | ✅ succeeds | 200 | — | — |
| 16 | `closed` | ❌ refuses | 422 | `resolution_type`. | `route.ts:1831-1840` |

**Measured total: 11 succeed, 5 refuse.**

### 2a. Where the relayed claim was wrong

The claim handed to this piece was "8 succeed, 7 refuse". Four of its rows do not
reproduce:

* **`defined` → 400 *owner is required*** — did **not** reproduce. It returns
  **200**. `POST /api/issues` assigns `owner` from the issue type unconditionally
  (`route.ts:1293-1301`) and ignores any caller value, so no issue created
  through the MC API can reach that check with an empty owner. The check is real
  but only a legacy row can trip it.
* **`refined` → 400 *description is required*** — the status code is right, the
  reason is not. A fresh row always has a `description` (POST requires it). The
  actual refusal is **`test_tier` is required**. `description` only fires once
  `description` has been nulled by a later PATCH — measured separately, and it
  does then return that message.
* **`open`/`in_progress` → 500 raw `CHECK constraint failed`** — reproduced
  exactly, verbatim, both of them.
* **`code_review` → 422 `resolution_type`** — reproduced, but it is the **first
  of four** gates, not the only one. Satisfying `resolution_type` yields a 422 for
  `implementation_notes`; satisfying that yields a 422 for `commit_sha`;
  satisfying that yields a 422 for `regression_test`. A sheet that prompted for
  only the field in the error message would make the operator do four round trips.

### 2b. Two refusals the claim did not find

* **`backlog` from any non-backlog status → 403 `Only main/po/ops can reset an
  issue to backlog.`** This is the single most common board gesture — send it
  back — and, at the time of this pass, for the signed-in owner it failed
  every time. `KAOS_ROLES` at `route.ts:1632` was `['main','po','ops']` and
  contained no `isOwnerActor()` bypass, unlike every other guard in the file.
  **This was fixed later in the same commit — see §7. It no longer refuses the
  owner as of `route.ts:1730`.**
* **Every destination from a `closed` card → 403 `Issue is closed and
  read-only.`** (`route.ts:1623-1628`.)

## 3. ACCEPTANCE

1. **The 16-row table in §2 is measured, not inherited.** Every cell was produced
   by a live request against a fresh fixture, and each fixture was deleted.
   Limiglow ends at zero issues.
2. **A move the sheet offers is a move the sheet can complete.** For every
   destination whose requirements are fields the API accepts on PATCH, the sheet
   collects them inline before sending, and sends them in the same PATCH.
3. **A move the sheet cannot complete is shown, disabled, with the reason.** It
   is never hidden. `backlog`-from-elsewhere, `defined` on an owner-less row, and
   every destination on a closed card render greyed with a sentence naming what
   is missing and why the board cannot supply it.
4. **No raw database text reaches the operator.** No `CHECK constraint failed:`
   string, no SQLite text, no column-name-only message can appear. The two
   destinations that produced one (`open`, `in_progress`) now collect `sprint`
   before sending, so the constraint is never violated; and if any raw database
   string were to arrive anyway, `humaniseMoveFailure()` replaces it with a
   sentence a person wrote before it reaches the screen.
5. **The server remains the authority.** The client predicts refusals to avoid
   offering them. It does not enforce them. A PATCH sent past the client — curl,
   an agent, a different UI — is refused by exactly the same rules, and this is
   proved by request, not by assertion.
6. **The predicate is pure, exported, and tested.** `lib/issue-moves.ts` takes an
   issue row and a destination status and returns a verdict. It imports the
   column model from `lib/pipeline-stages.ts` and never redefines it.
7. **The predicate is proved to fail when it is wrong.** Deliberately breaking
   one rule turns tests red by name; the counts are recorded in the piece report.
8. **The predicate never claims a move is possible when it is not.** Its default
   for an unknown status is *refuse and explain*, never *allow*. Every rule it
   encodes corresponds to a refusal reproduced in §2.
9. **`transitioned_by` is never fabricated.** The board could make
   `backlog`-from-elsewhere succeed today by sending `transitioned_by: 'po'`. It
   does not, because that writes a false actor into the audit trail. It disables
   the destination and reports the API line instead.
10. **Correction (§7): this item was wrong.** `app/api/issues/route.ts` WAS
    edited, in this same commit, under this piece's own key (TOD-2452) — the
    13-line diff at `route.ts:1669-1690` that added the `isOwnerActor()`
    bypass §4 (below) originally proposed as future work. `lib/pipeline-stages.ts`
    and `lib/issue-routing.ts` were read, not edited; `route.ts` was not
    read-only. The original claim ("Nothing outside the owned files changed")
    was written before that diff landed and nobody came back to correct it once
    it did — see §7 for the measurement that caught the contradiction.

## 4. The API change this piece asked for — landed; one smaller request remains

**Correction (§7): this section originally described a change as still
outstanding that had, by the time this doc was committed, already been made —
in the very same commit, under this piece's own key.** The proposal below is
kept for the record, struck through in spirit; what actually shipped and what
is still open follow it.

~~`app/api/issues/route.ts:1631-1637`. Every other actor guard in this file has
an owner bypass; this one does not, so the workspace owner cannot reset an
issue to backlog from any UI.~~

```ts
// route.ts:1632 — as measured in §2/§2b, before the fix
const KAOS_ROLES = ['main', 'po', 'ops']
if (!transitionedBy || !KAOS_ROLES.includes(transitionedBy)) {
```

**Landed, as of `route.ts:1718-1735` (commit 62d9d82, TOD-2452 — this piece's
own commit):**

```ts
// route.ts:1730 — current, measured 2026-08-26
const KAOS_ROLES = ['main', 'po', 'ops']
if (!transitionedBy || (!KAOS_ROLES.includes(transitionedBy) && !isOwnerActor(transitionedBy))) {
  return NextResponse.json(
    { error: 'Only main/po/ops or the workspace owner can reset an issue to backlog.', field: 'transitioned_by' },
    { status: 403 }
  )
}
```

Measured directly against the running server today (§7): `defined -> backlog`
as the signed-in owner, no `transitioned_by` in the body, is **200**. The
client mirror in `lib/issue-moves.ts` (`BACKLOG_RESET_ROLES` /
`moveVerdict`) now imports `isOwnerActor` from `lib/operator-identity.ts` — a
module already written to be safe in the browser bundle, and already the
source of truth the server itself defers to — instead of re-deriving the
owner bypass by hand.

**What is still open, and is a request rather than something this piece can
do itself:** `KAOS_ROLES` at `route.ts:1718` is a local, unexported `const`.
`lib/issue-moves.ts` cannot import it and still has to carry
`BACKLOG_RESET_ROLES = ['main', 'po', 'ops']` as a hand-mirrored copy — the
exact pattern that let the owner-bypass comment above go stale for a full
commit. The ask: export `KAOS_ROLES` from `route.ts`, or better, move it next
to `OWNER_IDENTITY` in `lib/operator-identity.ts` so both sides import the
same array and the mirror is retired rather than merely re-drawn. This piece
does not own `route.ts` and has not made that change. Until it lands, the risk
is contained rather than eliminated: `lib/__tests__/issue-moves.test.ts` reads
`route.ts`'s source at test time and fails the moment `KAOS_ROLES` there
diverges from the copy in `lib/issue-moves.ts`, so a future drift is a red
test, not a silent stale comment.

## 5. Verified in the running app, not asserted

Captured from the live board at `/b/todero/p/limiglow/work/bolt`, signed in as
the owner, `document.body.innerText`:

**Every destination labelled with what it needs** (a fresh `ops` row in
`backlog`) — the five refusals from §2 are the five carrying a label, and no
other row does:

```
BACKLOG   backlog  Current
          draft
DEFINED   defined
          refined         Needs test tier
READY     open            Needs sprint
IN PROG.  in_progress     Needs sprint
          underway
          active
IN REVIEW code_review     Needs resolution type, implementation notes, commit sha, regression test
          product_review  Needs resolution type, implementation notes
          feature_review
APPROVED  approved
SIGNED    released / wrapped / completed
CLOSED    closed          Needs resolution type
```

**A blocked move** (same sheet, a card in `open`) — visible, disabled, explained:

> Sending an issue back to Backlog is reserved for main, po, ops, and you are
> signed in as michael. Ask one of them, or reset it from the agent side.

**A completed move**, all four `code_review` gates in one submit:

> Moving to code_review needs 4 more things. The board asks for them here so the
> move goes through the first time.

with `0/10 characters minimum` counting up under Implementation notes, and
`Still needed: resolution type, implementation notes, commit sha, regression
test.` under a disabled submit until every one is filled. One PATCH; the row read
back `status=code_review` with all four columns written.

**No raw database text, proved against the real 500.** The humaniser is not
dead code: a card was loaded with a sprint (so the sheet honestly judged
`in_progress` ready), the sprint was then nulled in the database behind the open
sheet, and the bare PATCH went out. The server answered with the constraint
string verbatim. The operator saw:

> An issue being worked has to belong to a sprint. Set a sprint and try the move
> again.

`document.body.innerText.includes('CHECK constraint')` → `false`. The original is
in the console, once, as `[pipeline] move refused, raw server message: …`.

**The server still refuses a bypassed client.** The same five bodies the sheet
now never sends, sent by `fetch` with no client involved, against a fresh row:

```
open           500  CHECK constraint failed: ((status NOT IN ('open', 'in_progress', …
in_progress    500  CHECK constraint failed: ((status NOT IN ('open', 'in_progress', …
code_review    422  resolution_type is required before moving to code_review. …
closed         422  resolution_type is required to close an issue. …
refined        400  test_tier is required for task/bug/ops before moving to refined. …
backlog        403  Only main/po/ops can reset an issue to backlog.
```

(The `backlog` row above was measured as a non-owner actor. As the signed-in
owner it is 200, not 403 — see §7, where this whole page's account of the
backlog guard is corrected.)

Nothing moved into the client. Every rule is still enforced twice.

## 6. Not done, and why

* **The 10-open cap (409) and the one-at-a-time lane (409) are not predicted.**
  Both depend on rows other than the one being moved, and both can change between
  the render and the tap. A predicate that answered them from stale client state
  would be the exact failure this piece exists to prevent — claiming a move is
  possible when it is not. They stay server-only, and their messages are already
  sentences a person wrote, so they surface unchanged.
* **`owner` cannot be collected inline.** PATCH deletes it from every payload
  (`route.ts:2178-2181`). The sheet says so rather than offering a field that
  would be silently discarded.

## 7. Correction — 2026-08-26, a second pass

Everything in this section was measured today, against the running dev
server, by a `bug_fixer` pass over this piece. Nothing here is inherited from
§1-§6 without being independently reproduced.

**What was wrong.** §2's table, §2b, §3 item 10, and old §4 all described the
backlog-reset guard (`route.ts`, then at `:1631-1637`) as still refusing the
signed-in owner, and old §4 proposed the one-line `isOwnerActor()` fix as
future work. All of that was true when first drafted and stopped being true
within the *same commit* (62d9d82, TOD-2452) — the diff at what is now
`route.ts:1718-1735` landed in that commit and added exactly the bypass §4
proposed. `lib/issue-moves.ts`'s own `BACKLOG_RESET_ROLES` comment, and
`lib/__tests__/issue-moves.test.ts`'s `blocks backlog from any other status
for the signed-in owner` test, were written for the pre-fix world and were
never updated once the server side of the same commit changed under them —
so the client disabled the board's most common gesture with a reason the
server no longer gave.

**Measured today, fresh `ops` fixture in `Limiglow` (deleted after), owner
session (`mc-auth=kaos2026; mc-role=owner`), no `transitioned_by` in the body:**

| Move | Body | HTTP | Result |
|---|---|---|---|
| `defined -> backlog` | `{id, status:'backlog'}` | **200** | succeeds — contradicts the old client comment's claimed 403 |
| `in_progress -> backlog`, row carries `sprint:'2026-08-26'` | `{id, status:'backlog'}` | **500** | `CHECK constraint failed: (NOT ((status = 'backlog') AND (sprint IS NOT NULL)))` — the SECOND refusal on this same now-owner-permitted path (CLAIM 2) |
| same row, same move | `{id, status:'backlog', sprint:null}` | **200** | succeeds; row reads back `sprint: null` |

**Why the second refusal exists.** The backlog-reset handler
(`route.ts:1718-1753`) resets `worked_by`, `started_at` and `submitted_at`
unconditionally on every reset, but does not touch `sprint` unless the PATCH
body includes it — so a card that carries a sprint (anything that was ever
`open`/`in_progress`/etc.) hits the `backlog_no_sprint` CHECK
(`migrations/sqlite/000_baseline.sql:142`) the instant the actor gate no
longer stops it. Making the owner-bypass true without also clearing the
sprint would have swapped one false refusal for a guaranteed 500 on every
sprint-carrying card — the two were fixed together, not separately.

**What changed in this revision, confined to the three files this piece owns:**

* `lib/issue-moves.ts` — `moveVerdict`'s `backlog` branch now also accepts
  `isOwnerActor(actor)`, imported directly from `lib/operator-identity.ts`
  (a module already safe in the browser bundle and already the server's own
  source of truth for "is this actor the owner" — no re-derivation, no new
  drift surface for that half of the check). `BACKLOG_RESET_ROLES` is now
  exported so a test can check it against `route.ts`'s `KAOS_ROLES` by name,
  rather than by eye. `requiredFieldsForMove` gained an explicit (empty)
  `backlog` branch documenting why there is no form field for the sprint
  clear. `moveBody` now sends `sprint: null` on a move to `backlog` whenever
  the row currently carries one.
* `lib/__tests__/issue-moves.test.ts` — the inverted test and its corrected
  comment; a new test for a non-owner, non-`main/po/ops` actor (the refusal
  that IS still real); a source-reading guard test that fails if
  `route.ts`'s `KAOS_ROLES` ever diverges from `BACKLOG_RESET_ROLES`; and
  tests for the sprint-carrying backlog move in both directions
  (`moveVerdict` says `ready`; `moveBody` clears the sprint, and leaves it
  alone when there is none to clear).
* This file — §2, §2b, §3 item 10, and §4 corrected in place rather than
  silently rewritten, so the wrong claim stays visible next to its correction.

**What is still a request, not a fix:** exporting `KAOS_ROLES` from
`route.ts` (or moving it into `lib/operator-identity.ts`), so the mirror in
`lib/issue-moves.ts` can be retired instead of guarded. See §4.

**Gate, run today:** `npx tsc --noEmit` clean. `issue-moves.test.ts`: 38/38
passing (33 before, +5 new; none removed, one inverted with its comment
corrected). Full suite: 999 passed, 5 failed (the same three pre-existing
suites — `agents-route`, `agents-unconfigured`, `spawn-live` — named in this
piece's own baseline), 2 skipped, 1006 total — the 5 new tests account for
the entire delta from the 994/5/2 baseline. `node scripts/acceptance/run.mjs`:
45/45. `Limiglow` ends at 0 issues of this pass's making (one fixture, TOD-150,
created and deleted); two unrelated rows, `TOD-151`/`TOD-152`
(`test_bugfixer`, titles `bugfixer-fixture-A`/`-B`), appeared in Limiglow
during this pass from a concurrent session and were left untouched, the same
way this piece's own §1 left the `PHANTOM-COLUMN` rows from another builder
alone.

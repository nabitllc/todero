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
| 1 | `backlog` | ✅ succeeds *(no-op only)* | 200 | **From any other status: not satisfiable from the board.** Actor must be `main`/`po`/`ops`; the owner session is `michael`. Also must NOT carry `sprint`. | `route.ts:1631-1637`; `CHECK (NOT (status='backlog' AND sprint IS NOT NULL))` |
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
  back — and for the signed-in owner it fails every time. `KAOS_ROLES` at
  `route.ts:1632` is `['main','po','ops']` and contains no `isOwnerActor()`
  bypass, unlike every other guard in the file.
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
10. **Nothing outside the owned files changed.** `lib/pipeline-stages.ts`,
    `app/api/issues/route.ts` and `lib/issue-routing.ts` were read, not edited.

## 4. The one API change this piece would ask for

`app/api/issues/route.ts:1631-1637`. Every other actor guard in this file has an
owner bypass; this one does not, so the workspace owner cannot reset an issue to
backlog from any UI.

```ts
// route.ts:1632 — current
const KAOS_ROLES = ['main', 'po', 'ops']
if (!transitionedBy || !KAOS_ROLES.includes(transitionedBy)) {
```

```ts
// proposed — one condition, matching route.ts:570 and route.ts:587
const KAOS_ROLES = ['main', 'po', 'ops']
if (!transitionedBy || (!KAOS_ROLES.includes(transitionedBy) && !isOwnerActor(transitionedBy))) {
```

`isOwnerActor` is already imported at `route.ts:30`. This piece does not own that
file and did not make the change. Until it lands, ACCEPTANCE 3 covers the gap
honestly: the destination is visible, disabled, and explained.

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

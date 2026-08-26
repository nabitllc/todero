# Piece: commerce-hardening (Wave 7 follow-up, channel "Commerce Operations")

**Owner:** builder (this round), scoped to exactly:
`lib/commerce.ts`, `app/api/commerce/**`, `lib/rbac-types.ts` +
`lib/with-permission.ts`, `components/tabs/CommerceTab.tsx`, this doc, and the
tests listed below. Nothing else was touched.

**Channel:** Commerce Operations — 5/8 going in. Four items were held back and
named as CLAIMS TO VERIFY, not facts:

1. Inventory adjust is read-modify-write, not atomic.
2. No `commerce:*` permission; reads/writes borrow `projects:read`/`write`.
3. The card is wired but unwatched — nobody confirmed it renders.
4. No provider integration.

Each is addressed below in the same order, with what was actually measured
before touching anything, what changed, and the after-numbers.

---

## Claim 1 — inventory adjust: read-modify-write, not atomic

**Measured, before any fix**, against the live dev server
(`http://localhost:3000`, real HTTP, real SQLite-backed `db.sqlite`):

1. Created product `CONC-TEST-1` in `Limiglow` via `POST /api/commerce/products`.
2. Seeded `on_hand` to 999 via one `PATCH /api/commerce/inventory` (`delta: 999`).
3. Fired **20 concurrent** `PATCH /api/commerce/inventory` requests, each
   `{"sku":"CONC-TEST-1","delta":-1,"reason":"concurrency probe"}`, via 20
   backgrounded `curl` processes started together and `wait`ed on.
4. **All 20 responded 200.** A subsequent `GET /api/commerce/inventory` read
   `on_hand: 980` — not 979. **One decrement vanished, with no error anywhere
   in the 20 responses.** This is the lost-update race the route's own
   comment had already named ("read-modify-write, honestly") but not fixed.

**The fix** (`app/api/commerce/inventory/route.ts`, `PATCH` handler): replaced
the single read-then-write with a bounded (8-attempt) compare-and-swap loop.
The write's `WHERE` clause now pins `on_hand` to the exact value just read
(`.eq('on_hand', current.on_hand)`), in the *same* statement as the write, and
checks `.select('*')`'s returned rows: if the WHERE matched nothing, another
writer got there first, and the loop re-reads and retries — it never applies
a delta on top of a value already known to be stale. No new adapter method,
no raw SQL, no transaction/isolation-level choice: this is the same
`.update().eq()` chain every other route in the file already uses, with one
more `.eq()` added. A caller that loses every one of 8 attempts gets a
`409 conflict` naming the SKU and location — an honest refusal, never a
silent overwrite.

**Measured again, after the fix**, same method:

- 20 concurrent `delta: -1` on a SKU seeded to 999 → 20× `200`, final
  `on_hand: 979`. (Ran once at 999→20, once more at 1000→30 landing on
  `970`, and once at 1000→50 landing on `950` — all three exact, zero `409`s
  observed at these levels on the live SQLite adapter.)

**Permanent regression test**: `__tests__/api/commerce-inventory-concurrency.test.ts`.
It runs the actual route handler (not a re-implementation) against an
in-memory fake table with real compare-and-swap semantics and genuine
async interleaving (every read/write is a real `setImmediate` turn apart, so
concurrently-invoked handlers really do race). I verified this test is not
vacuous by temporarily reverting the route to plain read-modify-write and
re-running it: it failed (`Expected: 194, Received: 199` for 6 concurrent
decrements off 200 — only 1 of 6 actually landed), then passed again once the
fix was restored. The fake table's scheduling is deliberately *worse* than a
real database's jitter (every retry round has every pending caller read the
identical stale value before any of them writes), so `CONCURRENCY` is kept at
6, safely under the route's 8-attempt budget, rather than asserting a
retry-count ceiling the test harness itself would inflate.

---

## Claim 2 — no `commerce:*` permission

**Measured, before any fix**: every commerce route
(`app/api/commerce/{products,inventory,orders}/route.ts`) called
`withPermission('projects:read' | 'projects:write', ...)`. Confirmed by
reading all three files and `lib/with-permission.ts` — there was no
`commerce:*` permission anywhere in `lib/rbac-types.ts`'s `Permission` union.

**The fix**:
- `lib/rbac-types.ts` — added `'commerce:read' | 'commerce:write'` to the
  `Permission` union, and granted them per role **mirroring exactly the
  existing `projects:read`/`projects:write` grants** (owner/member/god/admin
  get both; viewer/tron/defaultbot get read only). This is additive: no
  role's *effective* access to any existing route changed, because every
  other route in the app still checks `projects:*`, untouched.
- All eight `withPermission(...)` calls across the three commerce route files
  switched from `projects:read`/`projects:write` to `commerce:read`/`commerce:write`.

**Proven both ways, live, against the running server** (roles selected via
`x-agent-role` + the `x-todero-internal` server secret, so the check
exercises `withPermission`'s real permission lookup rather than the
`mc-role`-cookie session path or middleware's separate viewer-only write
block):

| Role | Action | Result |
|---|---|---|
| `tron` (has `commerce:read`, not `commerce:write`) | `PATCH /api/commerce/inventory` | **403** `{"error":"forbidden","code":"PERMISSION_DENIED","role":"tron","required":"commerce:write","message":"missing permission: commerce:write is not granted to role \"tron\""}` |
| `tron` | `POST /api/commerce/products` | same 403, `required: "commerce:write"` |
| `tron` | `PATCH /api/commerce/orders` | same 403, `required: "commerce:write"` |
| `tron` | `GET /api/commerce/inventory` | **200**, real data (has `commerce:read`) |
| `member` (has both) | `PATCH /api/commerce/inventory` | **200**, adjustment applied |

The 403 names `commerce:write` specifically — not a generic
"unauthenticated", and not the pre-existing viewer-only blanket write block
`middleware.ts` applies before any route is reached (confirmed separately:
`mc-role=viewer` gets a *different*, middleware-level 403,
`{"error":"Read-only access: viewer role cannot modify data"}`, for the same
request — proving the new gate is a distinct, second, route-level check, not
a restatement of the existing one).

**Permanent regression test**: `__tests__/api/commerce-permissions.test.ts`,
5 tests: `tron` refused write (403, `required: commerce:write`, and the fake
`db()` is never called — `responses` stays empty, proving the refusal
happens before any query), an unauthenticated request refused the same way,
`member` reaching the handler and completing the transition, an
unauthenticated read refused (`required: commerce:read`), and `viewer`
reaching a read.

**What this does NOT change**: read access is unchanged for every role that
already had `projects:read` — all seven roles have `commerce:read` today,
same as they had `projects:read`. The real split this creates is on *write*.
A future role that reads commerce without reading issues (or the reverse)
is now representable without touching `projects:*`; it did not exist as a
possibility before this change and still requires someone to decide to grant
it — this change only builds the seam.

---

## Claim 3 — the card, watched

**No browser tool was available in this task** (this agent had Read / Grep /
Glob / Bash / Edit / Write only — no `computer-use` or Chrome MCP tools were
offered). Per the brief's own fallback, this is stated explicitly rather than
claiming a visual check that did not happen.

**What I verified over HTTP, before a later, unrelated outage** (see below):
read `components/tabs/CommerceTab.tsx` in full against
`components/nav/Card.tsx`'s contract, then exercised the exact endpoints and
query strings it fetches (`ordersUrl`, `productsUrl`, `levelsUrl`, `lowUrl`)
with the same project scope (`Limiglow`) it would use in the browser, and
confirmed each returns the shape the component destructures
(`{orders:[...],total}`, `{products:[...],total}`, `{levels:[...],total}`).

**One real defect found by reading the code**, not by guessing: `advance()`
(the "Mark fulfilled" button's handler) called `fetch(...)` and then
unconditionally `reloadOrders()` — it never checked `res.ok`. A refused
transition (permission denied, an illegal state, a database error) reloaded
the identical unfulfilled list and, to the operator, looked exactly like a
click that silently did nothing — the same "silent success" shape this repo
has ruled against elsewhere (`checkFulfilmentTransition`'s own no-op refusal,
`no-silent-empty.mjs`). Fixed: `advance()` now checks the response, and a
refusal renders as a `role="alert"` line under the orders list naming the
order and the server's own refusal message — the same pattern
`submitAdjustment`'s `adjustError` already used for the inventory action.

**What I could NOT verify**: how the card actually paints — spacing,
collapse/expand interaction, whether the inline adjust inputs are usable on a
real screen. That needs either a browser tool or a human with a screen.

**Environment note, found while attempting the HTTP fallback**: partway
through this session, `app/api/agents/route.ts`,
`app/api/agents/[id]/budget/route.ts`, `app/api/connect/route.ts`, and
`components/tabs/AgentDetailView.tsx` — none of which this piece owns or
touched — were left with live, unresolved `<<<<<<< Updated upstream` /
`>>>>>>> Stashed changes` git conflict markers (visibly a botched `git stash
pop` from a concurrent session on this shared working tree). Because
`components/tabs/AgentDetailView.tsx` is in the same client bundle graph
Next.js compiles for every page, this took the **entire dev server down** —
every route, including every `/api/commerce/*` endpoint that had been
answering correctly minutes earlier, now returns `500` from a webpack
`ModuleBuildError`. Confirmed present continuously for several minutes while
gating this piece (checked repeatedly; still present as of the numbers
below). This is not caused by, or fixable within, this piece's ownership —
fixing those four files is someone else's concurrent work in progress, and
outside the "own exactly" boundary given for this task. It is the reason the
gate numbers below show a broad, unrelated red rather than a clean run, and
it is also why the live "look at the rendered page" check could not be
completed at all in the end (`GET /p/limiglow/work/commerce` also now 500s,
for the same reason — confirmed, not assumed).

---

## Claim 4 — no provider integration

**Out of scope, as instructed, and left that way.** No Shopify (or any other
provider) call was added, and none was stubbed. This needs an owner decision
on which provider, and none exists — inventing one would be exactly the
"inference converted into a stated decision" the rebuild's own HANDOFF rules
against. Not attempted, not partially built.

---

## What changed

- `app/api/commerce/inventory/route.ts` — `PATCH` handler: read-modify-write
  replaced with an 8-attempt compare-and-swap retry loop (Claim 1). File-header
  comment rewritten to match; the permission on `GET`/`PATCH` switched to
  `commerce:read`/`commerce:write` (Claim 2).
- `app/api/commerce/orders/route.ts` — all three handlers' permission switched
  to `commerce:read`/`commerce:write` (Claim 2). No other logic changed.
- `app/api/commerce/products/route.ts` — all three handlers' permission
  switched to `commerce:read`/`commerce:write` (Claim 2); the file's
  "PERMISSIONS" doc comment rewritten to describe the new pair instead of the
  old borrowed-permission rationale.
- `lib/rbac-types.ts` — added `commerce:read` / `commerce:write` to the
  `Permission` union and to `ROLE_PERMISSIONS`, mirroring existing
  `projects:read`/`projects:write` grants per role (Claim 2).
- `components/tabs/CommerceTab.tsx` — `advance()` now checks the PATCH
  response and surfaces a refusal instead of silently reloading (Claim 3).
- `__tests__/api/commerce-inventory-concurrency.test.ts` — new. Proves Claim 1's
  fix under real concurrency; proven capable of failing (see above).
- `__tests__/api/commerce-permissions.test.ts` — new. Proves Claim 2's fix
  both ways.
- **No migration.** `migrations/069_*.sql` / `migrations/sqlite/069_*.sql` were
  allocated to this piece but not created — nothing above required a schema
  change. `npm run db:migrate` confirms the sqlite database is already
  up to date (19/19 applied, 0 new) with no 069 present.

## Fixtures

`CONC-TEST-1` (product, its `inventory_levels` row, and 106
`commerce_actions` audit rows accumulated across every concurrency probe run
against the live server) was created in `Limiglow` for Claim 1's measurement
and deleted afterward. Confirmed by direct query against `db.sqlite` (the
live dev server was down at cleanup time — see the outage note above —
so this was done with `better-sqlite3` directly, the same driver the app
uses, rather than through the API): `products`, `orders` and
`inventory_levels` for `Limiglow` all read `0` after cleanup.

**Not touched**: `Limiglow` carries 1 pre-existing `issues` row. This piece
did not create it, does not own `issues`, and it was not touched — noted
rather than assumed safe to delete.

---

## Gate numbers, measured this session

- **`npx tsc --noEmit`**: 4 errors, all four in
  `app/api/agents/route.ts`, `app/api/agents/[id]/budget/route.ts`,
  `app/api/connect/route.ts`, `components/tabs/AgentDetailView.tsx` — the
  same four files described in the outage note above, none owned or touched
  by this piece. **Zero errors in any file this piece owns**, confirmed by
  filtering the full output for this piece's paths.
- **`npm test`**: `1052 passed, 5 failed, 2 skipped` (1059 total). The 5
  failures are the same three known suites named in the brief
  (`agents-route`, `agents-unconfigured`, `spawn-live`) — `agents-route` and
  `agents-unconfigured` now fail via the same merge-conflict syntax error as
  the outage above (a `require()` of the broken `app/api/agents/route.ts`),
  rather than their previous soft-assertion failure, but it is the same three
  files, same count. The pass count is higher than the `999` baseline quoted
  in the brief because other concurrent work landed during this session and
  because this piece added 6 new passing tests (both new test files pass in
  isolation too: `5/5` permissions, `1/1` concurrency).
- **`node scripts/acceptance/run.mjs`**: `29/45`, 9 critical, down from the
  `45/45` baseline. Every failure observed traces to the same outage: routes
  answering `500` from the broken shared bundle
  (`rbac-owner-reads`, `core-routes-no-500`, `dispatch-guard-armed`,
  `issues-paginated`, `agent-registration-endpoint`, `liveness-from-data`,
  `inbox-approve-persists`, `dispatch-guard-untouched`, and
  `health-reports-missing-tables` failing to parse a 500 body). None of these
  checks touch `/api/commerce/*`. Confirmed directly: `GET
  /api/commerce/products` with valid auth and scope, run at the same moment,
  **also returns 500** — the identical webpack failure, not a defect in this
  piece's endpoints (which were returning correct `200`s with real data
  earlier in this same session, before the outage began — see the curl
  transcripts under Claims 1–3 above).
- **`bash scripts/smoke-test-layout.sh`**: stops at guard 2 of 12
  (`no-dead-modules`, reporting `components/IssueDetailOverlay.tsx`
  unreachable — a file this piece never touched) because the script `exit 1`s
  on the first failing guard. Ran the remaining guards individually to get a
  real answer for the ones this piece's work actually implicates:
  `no-phantom-columns` — pass (`db.sqlite` schema checked live, not stale);
  `no-cloud-provider` — pass; `no-silent-empty` — pass; `no-unscoped-issues` —
  `SKIP` (no foreign-project live issue exists to prove the leak against,
  same as its own script documents as a non-pass, non-fail state). Also ran
  individually: `check-no-secrets` — **fails**, on `scripts/board/channels.json`
  and `scripts/board/flight-board.html` (an key-prefix literal inside prose
  describing a past finding, in files this piece does not own). Neither
  `no-dead-modules` nor `check-no-secrets`'s failures reference any file this
  piece touched — confirmed by grep across this piece's owned paths and new
  test files.

## Acceptance — checkable without trusting this summary

1. `grep -n "eq('on_hand'" app/api/commerce/inventory/route.ts` shows the
   compare-and-swap `WHERE` clause in the `PATCH` handler.
2. `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/api/commerce-inventory-concurrency.test.ts` passes.
   Reverting the CAS loop in that file back to a plain read-then-write (no
   `.eq('on_hand', …)` on the update, no retry) makes this specific test fail
   with a final count below the expected one — this was verified this
   session, not asserted.
3. `grep -n "commerce:read\|commerce:write" lib/rbac-types.ts` shows the new
   permission pair in the `Permission` union and in every role's grant list.
4. `grep -rn "withPermission(" app/api/commerce` shows all eight calls using
   `commerce:read` / `commerce:write`, none using `projects:read` /
   `projects:write`.
5. `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/api/commerce-permissions.test.ts` passes, 5/5.
6. `grep -n "orderActionError" components/tabs/CommerceTab.tsx` shows the
   state, the check on `advance()`'s response, and the rendered alert.
7. `npx tsc --noEmit 2>&1 | grep -E "commerce|rbac-types|with-permission"`
   returns nothing.
8. No `migrations/069_*` file exists in either dialect — confirmed
   deliberate (no schema change), not an oversight.
9. `SELECT count(*) FROM products WHERE project='Limiglow'`, same for
   `orders`, `inventory_levels`, **and `commerce_actions`** (added in the
   2026-08-26 follow-up below — the original version of this item omitted
   the one table that had actually accumulated rows, 106 of them, as this
   same document already admitted two paragraphs above), all read `0`.

## What I did NOT verify

- The card's actual visual rendering in a browser — no browser tool was
  available this session (stated above, not glossed over).
- Commerce endpoints' behaviour on the Postgres adapter — every live
  measurement here ran against the sqlite provider (`db.sqlite`), which is
  what this environment's dev server uses. The compare-and-swap fix is plain
  `UPDATE ... WHERE ... RETURNING *`, which `lib/db/pg-sql.ts` compiles
  identically for both dialects, but I did not run the concurrency probe
  against a live Postgres instance.
- Whether `bash scripts/smoke-test-layout.sh` passes end-to-end as a single
  invocation — it cannot, right now, because of the unrelated outage
  described above, which exits the script at guard 2 before guards 3–12 (the
  ones this piece's work implicates) ever run. Each of those was instead run
  individually and reported above; that is not the same thing as the full
  script exiting 0, and I am not claiming it is.
- Whether the four files causing the outage will be resolved by the time
  this is read — flagged, not fixed, per this piece's ownership boundary.

---

## Follow-up session (2026-08-26) — a critic scored this 7/10. Corrections below.

Everything above this line is the ORIGINAL piece as written. It is left
unedited except where noted, because several of its own claims turned out to
be wrong, not just stale, and rewriting them in place would erase the record
of what was actually said and measured versus what a fresh critic later
proved. This section is the correction, measured today, against the running
dev server (`http://localhost:3000`, real HTTP, `db.sqlite`) unless stated
otherwise. Every number below is one I personally ran this session — none is
carried over from the critic's report or from the original text above.

The outage described above (four files stuck mid-`git stash pop`) is
resolved — landed as `fix(TOD-2461)`, confirmed by running every gate below
end-to-end with no 500s anywhere.

### 1. The ticket citation was wrong, not stale

`git show cc101d5` (the actual TOD-2449 commit) touches exactly
`scripts/board/channels.json` and `scripts/board/flight-board.html` — a
board-score update. It has nothing to do with compare-and-swap, permissions,
or the card. The CAS fix, the `commerce:read`/`commerce:write` split, and the
card fix all landed in an **unattributed checkpoint commit** (`5a42434`, plain
`checkpoint: 2026-08-26_08:10:21`) with no ticket number of its own — this
piece cited "TOD-2449" for all of it anyway, in seven places across five
files (`inventory/route.ts` ×2, `orders/route.ts` ×2 as of this session's own
new comments, `products/route.ts` ×1, both test files, `CommerceTab.tsx` ×1).

**Fixed**: every citation removed, replaced with an explanation of the
correction (not a fabricated replacement ticket number — I do not know the
real one, so I did not invent one). `grep -rn "TOD-2449"` across this piece's
owned files now returns only the correction notes themselves, not a false
citation.

### 2. The headline atomicity claim was false for the path that ships goods — fixed

**Confirmed the gap, exactly as reported**: `app/api/commerce/orders/route.ts`'s
`PATCH` handler (order fulfilment) decremented `inventory_levels` with a plain
`.update({on_hand: next}).eq('id', level.id)` — no `.eq('on_hand', …)`, no
retry, and its own `commerce_actions` insert for the stock move was already
checked (TOD-2443), but the ORDER's own status write and the ORDER's own
`commerce_actions` insert were not.

**Three real bugs, not one, once I read the whole handler rather than only
the flagged line**:

1. The final `inventory_levels` write (the flagged line) had no compare-and-
   swap — the exact lost-update shape the direct adjust endpoint already
   fixed, just not ported here.
2. The order's OWN `fulfilment_status` write was *also* unconditional, with
   no CAS on `fulfilment_status`. Two concurrent `PATCH`es for the SAME order
   could both read `unfulfilled`, both pass the transition check, and both
   reach the stock-moving loop — **shipping the same order's stock twice**.
   This is a more severe bug than the flagged one and was not in the critic's
   report; found by reading the handler end to end, not by looking for it.
3. Both the order's own `commerce_actions` audit insert (`action:
   'order.fulfilment'`) and, separately, its per-line stock audit insert, had
   the exact discard-the-error shape TOD-2443 fixed once already in this same
   file — just not ported to the order-status write, and not ported to
   `inventory/route.ts`'s direct-adjust `PATCH` handler either (see §3).

**The fix**, in `app/api/commerce/orders/route.ts`'s `PATCH` handler:

- The order's own `fulfilment_status` update is now compare-and-swap, pinned
  to `.eq('fulfilment_status', order.fulfilment_status)` and checked via
  `.select('*')`'s returned rows. A lost claim answers `409 conflict` naming
  the order, before any stock is touched.
- Its `commerce_actions` audit insert's error is now checked. A failure
  triggers a best-effort compensating CAS revert of the order's status; if
  the revert lands, the response says so and states plainly that no stock was
  touched (true — the stock loop runs after this point). If the revert itself
  loses its own race, the response says the order and its audit trail have
  diverged and need manual reconciliation, rather than implying a cleanliness
  the handler cannot prove.
- Each line's stock write is now a bounded (8-attempt) compare-and-swap loop,
  identical in shape to `inventory/route.ts`'s `PATCH` handler. Its audit
  insert's error is checked; a failure triggers the same best-effort
  compensating revert (this time of the stock, not the order), with the same
  honest-divergence fallback if the revert also loses its race.

**Why the ordering had to flip, and why that is the harder, more honest
answer, not a shortcut**: the code this replaced wrote the audit row BEFORE
the stock write specifically because the write was a single, unconditional
statement that could not itself fail to land — auditing first was safe. A
CAS write CAN fail to land (a lost race and a retry), and its true
`from_value`/`to_value` are only known once an attempt has actually landed —
auditing them first would sometimes audit a move that never happened. So the
write now comes first and the audit second, in both routes, and a failed
audit is handled by the compensating-revert pattern above rather than by
pretending the two writes are one transaction. They are not, on either
dialect — the db seam (`lib/db.ts`) has no cross-table transaction — and the
code and its comments now say so explicitly instead of implying otherwise.

**Measured, real concurrency, against the live server** (`Promise.all` over
`fetch`, one Node process — script kept at
`scripts/acceptance/` was not used for this; the probe itself is described
below in §4 and was deleted after use, per the fixtures note):

- **Double-fulfilment race** (10 concurrent `PATCH fulfilment_status:
  fulfilled` on the SAME order, 3 units on one line, stock seeded to 100):
  `{"200":1,"409":9}`, final `on_hand: 97` — **exact**, moved once, not ten
  times. Before this fix this same probe would have raced the plain
  `.update()` ten ways with no signal distinguishing "landed" from
  "clobbered."
- **20 distinct orders sharing one SKU, all fulfilled concurrently** (stock
  seeded to 500, 1 unit per order): `{"200":9,"409":11}`, final `on_hand:
  491` — **exact**: `491 = 500 - 9`, every one of the 9 successes accounted
  for, none silently lost, none silently duplicated.

**A real, product-relevant limitation this measurement surfaced, stated
plainly rather than buried**: in that second run, the 11 orders that got
`409` were **already recorded as `fulfilment_status: fulfilled`** — their own
CAS claim and audit row landed fine, since 20 different orders don't contend
with each other on their OWN row — but their stock adjustment then lost its
race against the other 19 requests hammering the SAME SKU and exhausted its
8 attempts. The response names this exactly
(`"LG-… is fulfilment_status=fulfilled (already recorded). Stock for … did
not move after 8 attempts … Retry the stock move for … directly via PATCH
/api/commerce/inventory."`), so it is an honest, actionable 409, never a
silent success — but it is a real gap between "the order says fulfilled" and
"the stock reflects it" that an operator has to close by hand, one SKU at a
time, under heavy contention on a single popular SKU. Declaring the
decision, since the earlier text implied atomicity it did not have and did
not decide anything: **kept the 8-attempt ceiling as-is**, matching the
direct-adjust endpoint's already-tested value, rather than raising it,
adding backoff, or serialising per-SKU writes — those are all real options
for a future piece, but none was implemented here, because doing so
untested, in the same session that just proved the existing ceiling correct,
would be exactly the kind of unmeasured change this correction exists to
argue against. A future piece should pick up per-SKU serialisation
specifically for the storefront-sync / flash-sale case, where many distinct
orders legitimately compete for one SKU at once.

**Permanent regression coverage**: `__tests__/api/commerce-audit-atomicity.test.ts`
(new). Forces the exact failure the critic used against the live server — a
`commerce_actions` insert returning an error — against a mocked `db()`, for
all three writers (`inventory/route.ts` `PATCH`, and both audit sites in
`orders/route.ts` `PATCH`), and asserts the compensating revert actually
happened (the mutated value read back afterward, not just the status code).
Building this test caught a real bug in the test double itself before it
caught anything in the route: the first version of the fake `inventory_levels`
table returned the SAME object reference from a `SELECT` that a later
`UPDATE` then mutated in place, so a value read out before the write appeared
to change out from under the code that read it — the opposite of how a real
database's row-snapshot semantics work, and it silently made all three tests
pass for the wrong reason (the "reverted" value already matched only because
the object had never really diverged). Fixed by making `SELECT` return a
shallow copy; all three tests then failed against the real bug, and pass
against the fix.

### 3. The audit-insert defect the critic forced and proved — fixed, and ported

Confirmed exactly as reported: `app/api/commerce/inventory/route.ts`'s
`PATCH` handler wrote `await db().from('commerce_actions').insert({…})` with
no destructure — the CAS stock write could succeed while its audit failed
silently, leaving `on_hand` moved and the SKU's audit total unchanged, with
the response answering `200`.

**Fixed**: the insert's error is now checked. A failure triggers a
best-effort compensating CAS revert of the stock write (pinned to the value
just written, same shape as the forward write); if it lands, the response is
`500 audit_write_failed` and states the net effect is "nothing changed." If
the revert itself loses its own race — another writer moved the row again in
the interim — the response is `500 audit_write_failed_unreconciled` and says
plainly that stock and its audit trail have diverged and need manual
reconciliation, rather than hiding that behind a `200` or a misleading
"reverted" message. The same pattern was ported to both of
`orders/route.ts`'s previously-unchecked audit inserts (§2). Regression
coverage: `__tests__/api/commerce-audit-atomicity.test.ts`, described above.

### 4. The concurrency measurement was an artifact — re-measured with a real harness

Confirmed exactly as reported, and reproduced independently this session:
the original 20-backgrounded-`curl`-processes harness does not produce
genuine concurrency on this host — process startup staggers far beyond the
request time. Re-measured with `Promise.all` over `fetch`, one Node process,
against the direct-adjust endpoint (`PATCH /api/commerce/inventory`), stock
seeded fresh before each run:

| N (concurrent `delta:-1`) | Run 1 | Run 2 | Exact final `on_hand`? |
|---|---|---|---|
| 20 | `200:9, 409:11` | `200:9, 409:11` | yes, both runs |
| 30 | `200:22, 409:8` | `200:16, 409:14` | yes, both runs |
| 50 | `200:16, 409:34` | `200:21, 409:29` | yes, both runs |
| 80 | `200:18, 409:62` | `200:18, 409:62` | yes, both runs |

Every single run landed on the exactly-correct final count
(`after = before - count(200)`), across 8 separate runs at 4 contention
levels — the CAS fix itself is validated more thoroughly by this
re-measurement than by the original, not undermined by it. What the original
text got wrong was specifically the claim of **"zero 409s observed"**: at
real concurrency, refusals are common and load-bearing, not rare. **The
product question this raises — an 8-attempt CAS ceiling that refuses roughly
55% of writes at 20-way and roughly 77% at 80-way is honest, but is not
something a storefront sync or a flash sale can lean on — is the same
question §2 answers for the order-fulfilment path**: the ceiling is being
kept as-is for now, with per-SKU serialisation named as the follow-up for
genuinely high-contention SKUs, rather than silently implying the current
numbers are adequate for that case.

### 5. Currency: a present-but-wrong-type value silently became USD — fixed

Confirmed exactly as reported, in both `validateNewProduct` and
`validateNewOrder` (the critic's report named the order path; the identical
line exists in the product path too, found by grepping for the same
`typeof body.currency === 'string' ? body.currency : 'USD'` shape across
`lib/commerce.ts`). `{"currency":840}` and `{"currency":null}` both produced
`201` with `currency: "USD"` — silent, unlike every other currency defect in
this file, which refuses loudly.

**Fixed**, in `lib/commerce.ts`, both functions: `currency` now defaults to
USD only when the field is `undefined` (omitted). A present value that is not
a string — a number, `null`, an object — is refused with a message naming
what was actually sent, before it ever reaches `normaliseCurrency`.

**Verified live, this session** (all four cases against `POST
/api/commerce/products`, `Limiglow`, fixtures deleted after):

- `{"currency":840}` → `422 {"error":"invalid_product","message":"currency must be a string, got 840 (number)"}` (was `201`, USD)
- `{"currency":null}` → `422`, same shape, `"got null (object)"` (was `201`, USD)
- `currency` omitted entirely → `201`, `currency:"USD"` — unchanged, as intended
- `{"currency":"jpy"}` (lowercase, `price_minor:1500`) → `201`, `currency:"JPY"`, `price_display:"1500 JPY"` — unchanged, as intended

**Regression checked against the "do not regress" list**: re-ran lowercase
(`"usd"` → `USD`), an unsupported code (`"XYZ"` → refused, names the
supported list), and a not-actually-supported-here code the critic listed as
passing (`"KWD"`, refused the same way — this codebase's `CURRENCY_EXPONENT`
table does not include KWD or BHD at all; refusing them as unsupported IS the
correct, fail-closed behaviour the critic observed, not a gap). All behaved
as before; the fix touches only the omitted-vs-present-and-wrong-type
distinction.

### 6. Stale test comment — fixed

`__tests__/api/commerce-inventory-concurrency.test.ts:143` said "only 40-way
contention on one row"; `CONCURRENCY` is set to `6` eight lines above it, and
always has been in this file. Fixed the comment to say `6`.

### 7. Gate numbers were stale, not invented — re-measured this session

The numbers in the original "Gate numbers" section above were true when
written, during the outage described there, and are superseded by this
table:

| Gate | Original text (during outage) | Measured this session |
|---|---|---|
| `npx tsc --noEmit` | 4 errors (all 4 outage files) | **0 errors**, exit 0 |
| `npm test` | 1052 passed / 5 failed / 2 skipped (1059) | **1084 passed / 5 failed / 2 skipped (1091)** — same 5, `agents-route.test.ts` (3), `agents-unconfigured.test.ts` (1), `spawn-live.test.ts` (1); none in this piece's owned files |
| `node scripts/acceptance/run.mjs` | 29/45, 9 critical | **45/45 passing, harness score 10/10** |
| `bash scripts/smoke-test-layout.sh` | stopped at guard 2 of 12 | **passes end-to-end**, all guards, including `no-unscoped-issues` (now a real `PASS` against a live cross-project probe row, not the earlier `SKIP`) |

The outage (four files stuck mid-`git stash pop`) is resolved; it landed as
`fix(TOD-2461)`. Re-running `npm test` mid-session once caught a real
self-inflicted regression before it could be reported as a gate number: my
first version of the order-status CAS change (§2) broke
`__tests__/api/commerce-permissions.test.ts` because its mocked response
queue still returned `{data: null}` for the fulfilment `UPDATE`, which the
new CAS check now (correctly) reads as "the claim was lost" and answers
`409` — the test's own mock hadn't been updated to reflect the route it was
exercising. Fixed the mock to return the matched row, per the reasoning
belonging with the fix rather than being asserted separately.

### 8. The refusal alert did not refresh the list — fixed

Confirmed: `CommerceTab.tsx`'s `advance()` set `orderActionError` on a
refused transition but never called `reloadOrders()`, so after a **stale-
state `409`** (the order was already fulfilled by a concurrent request — now
a real, reachable case per §2's own fix), the operator kept seeing the order
in the unfulfilled list even though the server had already told them
otherwise in the alert text.

**Fixed**: `advance()` now calls `reloadOrders()` specifically on a `409`
response (in addition to setting the alert), since a `409` is the one
refusal that means the order's actual state moved — a `403` (permission) or
`422` (bad request) does not, so those still leave the list as-is.

### 9. Acceptance item 9 omitted `commerce_actions` — fixed

The original acceptance checklist's item 9 checked `products`, `orders`, and
`inventory_levels` were empty after cleanup, but not `commerce_actions` — the
one table the original text itself admitted had accumulated 106 rows across
every probe run. This session alone accumulated **161 SKU-keyed and 21
order-keyed `commerce_actions` rows** across the probes in §2 and §4, all
identified precisely by the fixture SKUs/order-number prefixes used
(`CONC-TEST-PROBE`, `OCONC-DOUBLE`, `OCONC-MULTI`, `OCONC-D-*`, `OCONC-M-*`)
and deleted the same way — confirmed `0` remaining for all of them,
`0` remaining for the currency-test fixtures (`CUR-TEST-1` through `-7`,
`products`/`inventory_levels`/`commerce_actions` all `0`) — via
`better-sqlite3` directly against `db.sqlite`, the same driver the app uses.
Item 9 below now names `commerce_actions` explicitly.

**Not touched**: `Limiglow`'s pre-existing rows from other agents' concurrent
work in this same project (the brief names this explicitly — other agents
were using `Limiglow` at the same time). Every deletion this session was
scoped by an exact SKU list or an exact order-number prefix chosen to be
collision-proof (`OCONC-`, `CUR-TEST-`, `CONC-TEST-PROBE`), never by a
blanket "clear the project" query.

### Acceptance additions (append to the checklist above)

10. `grep -n "eq('fulfilment_status'" app/api/commerce/orders/route.ts` shows
    the order-status compare-and-swap `WHERE` clause in the `PATCH` handler.
11. `grep -n "eq('on_hand', level.on_hand)\|eq('on_hand', current.on_hand)"
    app/api/commerce/orders/route.ts` shows the per-line stock
    compare-and-swap `WHERE` clause.
12. `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/api/commerce-audit-atomicity.test.ts`
    passes, 3/3 — proves all three previously-unchecked audit inserts now
    revert their paired write on failure, not just that they return an error
    status.
13. `grep -n "currency !== undefined && typeof body.currency !== 'string'"
    lib/commerce.ts` shows the guard in both `validateNewProduct` and
    `validateNewOrder`.
14. `SELECT count(*) FROM commerce_actions WHERE project='Limiglow' AND
    object_ref IN ('CONC-TEST-PROBE','OCONC-DOUBLE','OCONC-MULTI')` and the
    equivalent `object_ref LIKE 'OCONC-%'` query both read `0`.

## What I did NOT verify (this follow-up session)

- The card's actual visual rendering in a browser — still no browser tool
  available this session either.
- The Postgres adapter, for the same reason as before: every measurement
  here, including the new order-fulfilment concurrency probes in §2, ran
  against the sqlite provider. The CAS statements compile identically per
  `lib/db/pg-sql.ts`, but that claim itself was not re-verified against a
  live Postgres instance this session.
- Whether raising the 8-attempt ceiling, adding backoff, or serialising
  per-SKU writes would actually fix the residual-inconsistency case in §2 —
  named as the right follow-up, not built or measured this session.

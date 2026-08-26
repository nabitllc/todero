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
9. `SELECT count(*) FROM products WHERE project='Limiglow'`,
   same for `orders` and `inventory_levels`, all read `0`.

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

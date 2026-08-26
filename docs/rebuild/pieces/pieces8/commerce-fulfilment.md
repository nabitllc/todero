# Piece: commerce-fulfilment — partial fulfilment, the missing object

**Channel:** Commerce Operations, 7/8.
**Benchmark:** Shopify admin — "orders, catalog and inventory as first-class
objects you can act on, not a dashboard that only reports what happened."
**Owner:** builder, this session, scoped to exactly:
`app/api/commerce/**`, `lib/commerce.ts`, `components/tabs/CommerceTab.tsx`,
`__tests__/api/commerce-*.test.ts`, `migrations/074_*` + `migrations/sqlite/074_*`,
and this doc. Nothing else was touched.

**Prior art read before touching anything:**
`docs/rebuild/pieces/pieces7/commerce-hardening.md` and
`.../one-discord-sender.md`. Both inventory writers were already
compare-and-swap, a double-ship was already found and fixed at the order level,
and `commerce:read`/`commerce:write` had already replaced borrowed
`projects:*` permissions. **None of that was rebuilt.** The order-level CAS,
the audit-error checking, the compensating reverts and the currency guards are
all still there; two of them changed *shape* (see "The one thing that moved",
below) and every such change is named.

---

## The gap, exactly as a critic named it

`orders.fulfilment_status` has been able to hold `'partially_fulfilled'` since
migration 064. Nothing could ever say **what** was partially fulfilled, because
`order_line_items` recorded how many units were ORDERED (`quantity`) and nothing
about how many had SHIPPED. The route said so itself, in a comment:

> `partially_fulfilled` cannot say WHICH lines went (order_line_items has no
> fulfilled-quantity column), so decrementing there would be inventing a number.

That refusal was honest. It was covering for a missing **object**, not a missing
report — which is why this piece is a schema change and not a query.

---

## MEASURED, before anything was changed

All measurements in this document were run **today, by me**, against the running
dev server at `http://localhost:3000` over real HTTP (`fetch`, one Node
process), backed by the live `db.sqlite`. Nothing here is carried over from a
previous session.

Fixtures (project `Limiglow`, all prefixed `PF8-` / `CUR8-`, all deleted — see
"Fixtures", below): product `PF8-A` at 100 on hand, `PF8-B` at 100 on hand,
order `PF8-ORD-1` carrying 10 × `PF8-A` and 4 × `PF8-B`.

```
PATCH /api/commerce/orders {"order_number":"PF8-ORD-1",
                            "fulfilment_status":"partially_fulfilled"}
-> 200
{"stock_moves":[],
 "stock_note":"stock was not moved: order_line_items records no fulfilled
               quantity, so which lines shipped is not known. Stock moves in
               full when this order reaches fulfilled.",
 "from":"unfulfilled","fulfilment_status":"partially_fulfilled"}

GET /api/commerce/inventory -> PF8-A on_hand 100, PF8-B on_hand 100
```

So: an order the operator has been told is partly shipped, **every unit still
counted as on the shelf**, and no record anywhere of which parcel left. The
live schema confirmed the cause directly (`PRAGMA table_info(order_line_items)`):

```
id, order_id, sku, title, quantity, unit_price_minor, currency
```

No fulfilled quantity, exactly as the comment said.

---

## What I changed

### 1. Migration 074, both dialects — `order_line_items.fulfilled_quantity`

- `migrations/074_order_line_fulfilled_quantity.sql` (Postgres)
- `migrations/sqlite/074_order_line_fulfilled_quantity.sql` (SQLite)

```sql
ALTER TABLE order_line_items
  ADD COLUMN [IF NOT EXISTS] fulfilled_quantity integer NOT NULL DEFAULT 0
    CHECK (fulfilled_quantity >= 0 AND fulfilled_quantity <= quantity);
```

Applied to the live database: `npm run db:migrate` →
`074_order_line_fulfilled_quantity.sql` is in `schema_migrations` (applied
`2026-08-26T17:43:23.189Z`), and `PRAGMA table_info(order_line_items)` now ends
`…, currency, fulfilled_quantity INTEGER NOT NULL DEFAULT 0`. This was done
*before* gating, because `no-phantom-columns` exits 2 rather than reporting a
verdict when the repo declares a column the live database lacks.

**The cross-column CHECK was verified to actually FIRE, on both dialects, rather
than being accepted and ignored.** SQLite's `ALTER TABLE ADD COLUMN` documents
that it will not add UNIQUE or PRIMARY KEY and that it does not validate
existing rows; it says nothing about whether a CHECK referencing a *different*
column of the same row is enforced on later writes. "Accepted and ignored" is
the shape of floor that reads as protection and is not, so it was run —
against a copy of `db.sqlite`, with `better-sqlite3`, the driver the app uses:

```
UPDATE ... SET fulfilled_quantity = 5   (quantity 5)  -> ACCEPTED
UPDATE ... SET fulfilled_quantity = 6                 -> REFUSED
   "CHECK constraint failed: fulfilled_quantity >= 0 AND fulfilled_quantity <= quantity"
UPDATE ... SET fulfilled_quantity = -1                -> REFUSED, same message
```

The Postgres half is a permanent test, not a one-off: the migration is applied
to a real in-process Postgres (PGlite) in
`__tests__/api/commerce-partial-fulfilment.test.ts`, which asserts the column's
default, its NOT NULL, and that both `= 6` and `= -1` are rejected by the
database itself.

**No backfill, deliberately.** `DEFAULT 0` is correct for every existing row
because no code path before 074 could move a per-line quantity. The one case
where 0 understates reality — an order already sitting at `fulfilled` — is
handled in the route (outstanding = `quantity − fulfilled_quantity`, and
`fulfilled` is terminal), not by an `UPDATE` inventing history this database
never recorded.

### 2. `lib/commerce.ts` — the pure layer (additive; nothing existing changed)

New: `LINE_FULFILMENT_FIELDS`, `validateLineFulfilments`, `OrderLineState`,
`PlannedLineFulfilment`, `lineRemaining`, `planLineFulfilments`,
`deriveFulfilmentStatus`, `checkStatedStatusAgainstLines`. The money functions,
the currency table, `canFulfilmentTransition` and the existing validators were
**not** modified — `lib/__tests__/commerce.test.ts` (which this piece does not
own) is untouched and green.

Design decisions worth arguing with:

- **The status is DERIVED from the lines, never asserted.** This is the stance
  `validateNewOrder` already takes about money — an order whose stated total
  disagrees with the sum of its lines is refused rather than stored. A caller
  may still send `fulfilment_status` alongside `line_fulfilments`; if it
  disagrees with what the quantities say, the whole request is refused naming
  both.
- **A line is addressed by `sku` OR by `line_id`, never both.** `order_line_items`
  has no unique constraint on `(order_id, sku)` and a real order can carry the
  same SKU twice. SKU is what an operator says out loud, so it is accepted — and
  it is REFUSED when it matches more than one line, with the matching line ids
  named so the caller can re-send by `line_id`. `GET ?order_number=` now returns
  `line_id` for exactly this reason: a caller cannot be told to use an
  identifier no read hands it.
- **`deriveFulfilmentStatus([])` is `'unfulfilled'`, not `'fulfilled'`.**
  `[].every(...)` is `true`, so the obvious implementation calls an order
  nothing is known about fully shipped. There is a test whose only job is that
  branch.

### 3. `app/api/commerce/orders/route.ts` — the writer

`PATCH` now accepts `line_fulfilments: [{ sku | line_id, quantity }]`:

```
PATCH {"order_number":"PF8-ORD-1","line_fulfilments":[{"sku":"PF8-A","quantity":4}]}
-> 200 {"from":"partially_fulfilled","fulfilment_status":"partially_fulfilled",
        "lines":[{"line_id":"0a425ad5-…","sku":"PF8-A","quantity":4,
                  "fulfilled_quantity":4,"remaining":6,"on_hand":96}],
        "stock_moves":[{"sku":"PF8-A","quantity":4,"on_hand":96}]}
```

**One writer, two entry points.** `{fulfilment_status: "fulfilled"}` with no
`line_fulfilments` is not a second implementation — it is compiled into the same
per-line plan ("ship everything still outstanding on every line") and run by the
same code. That is what makes the next section true by construction rather than
by two code paths somebody has to keep in step.

`GET ?order_number=` now returns, per line, `line_id`, `fulfilled_quantity` and
`remaining`, plus an order-level `fulfilment: {ordered, fulfilled, remaining}`.

`POST` (ingest) writes lines at `fulfilled_quantity = quantity` when the
storefront reports the order as already `fulfilled`, so `deriveFulfilmentStatus`
does not disagree with the order's own status from the moment of ingest.
Verified live: ingesting `PF8-F1` as `fulfilled` produced
`fulfilment: {ordered: 3, fulfilled: 3, remaining: 0}`.

### 4. The double-ship this feature would otherwise have created — MEASURED

The old handler decremented `line.quantity` **flat** on the transition into
`fulfilled`. Adding partial fulfilment on top of that, without unifying the two
paths, would have shipped every already-sent unit a second time.

Measured live, end to end, on the final code:

```
before: PF8-A on_hand 96, line 4/10 fulfilled
        PF8-B on_hand 100, line 0/4 fulfilled
PATCH {"order_number":"PF8-ORD-1","fulfilment_status":"fulfilled"} -> 200
  lines: PF8-A quantity 6 -> fulfilled_quantity 10, on_hand 90
         PF8-B quantity 4 -> fulfilled_quantity 4,  on_hand 96
GET /api/commerce/inventory -> PF8-A 90, PF8-B 96
```

`96 − 6 = 90`, **not** `96 − 10 = 86`. Six units moved, not ten.

### 5. `components/tabs/CommerceTab.tsx`

- The Orders card's question is "which orders are waiting to ship?", and
  **"waiting" is not the same set as "unfulfilled"**. It queried only
  `fulfilment_status=unfulfilled`, so the moment an operator shipped one line
  the order vanished from the only screen that lists orders and there was no
  way to ship the rest of it. It now runs a second query for
  `partially_fulfilled` and shows one queue, each row carrying its own status;
  the metric is the sum of the two routes' exact `total`s, never a page length.
- Each row gets a **Ship lines** toggle that reads that order's lines and shows
  `fulfilled/quantity` with a quantity box and a Ship button per incomplete
  line, addressed by `line_id`.
- "Mark fulfilled" is now labelled **"Ship the rest"**, which is what it does.
- A refused shipment renders the server's message verbatim in a `role="alert"`
  line (the pattern `adjustError`/`orderActionError` already used). A `409`
  re-reads the lines — it means a concurrent shipment took the units — while a
  `422`/`403` leaves the panel alone, since nothing moved. A failed line read
  renders the error, never an empty line list.

---

## The one thing that moved: the write order

The previous handler claimed the ORDER's status first and moved stock
afterwards. That ordering **cannot** protect a partial shipment: two concurrent
partial ships both read `partially_fulfilled` and both write
`partially_fulfilled`, so the order-level CAS matches for both and neither is
refused. The exclusive claim has to be taken where the contention is — on the
line:

```sql
UPDATE order_line_items
   SET fulfilled_quantity = <read + q>
 WHERE id = <line> AND fulfilled_quantity = <the value just read>
```

So the order now goes **last**: lines are claimed, stock moves, audit rows land,
and only then is `orders.fulfilment_status` reconciled to whatever the lines
actually say — in its own bounded CAS loop, since a concurrent shipment may have
moved it meanwhile. A loser of a line race re-reads and **re-checks its request
against the new value** (the units it wanted may have just been taken), bounded
at 8 attempts — the same ceiling `inventory/route.ts` already has measurements
for; no new, untested ceiling was introduced.

**This closes the residual inconsistency pieces7 §2 named as a follow-up.**
That document measured 20 orders on one SKU as `{200: 9, 409: 11}` where the 11
refusals were *already recorded as `fulfilled`* with their stock unmoved,
because the order's status had been claimed before the stock loop ran. A
shipment that cannot complete now reverts its own line claim and never touches
the order's status.

Two previously-documented failure outcomes therefore changed, and
`__tests__/api/commerce-audit-atomicity.test.ts` was updated to the new ones —
**not weakened**; each `describe` carries a comment saying what it used to
assert and why:

| Forced failure | Was | Is now |
|---|---|---|
| `order.fulfilment` audit insert fails | status reverted, **stock never reached** | the units DID ship and their movement IS audited; only the status change is reverted, and the message says so |
| per-line `inventory.adjust` audit insert fails | order left **`fulfilled`** with stock unmoved (an honest 500, but a real divergence) | line claim **and** stock both reverted, order's status never touched, net effect "nothing changed" |

---

## Deliberate BREAKING change

`PATCH {"fulfilment_status": "partially_fulfilled"}` with no `line_fulfilments`
used to answer 200 and produce exactly the incoherent state measured at the top
of this document. It is now **422 `needs_line_fulfilments`**:

```
"partially_fulfilled cannot be asserted on its own — say which lines shipped and
 how many, with line_fulfilments: [{ sku or line_id, quantity }]. The status is
 then derived from those quantities. Until migration 074 this request succeeded
 and moved no stock, which left the order claiming a shipment nothing recorded.
 GET /api/commerce/orders?order_number=PF8-ORD-1 lists each line with its
 line_id and how many remain."
```

Nothing in this repo sent that request (`grep -rn "partially_fulfilled"` over
`app/`, `lib/`, `components/` before the change: the route, the state machine,
and the state machine's own test — no caller). It is called out anyway because
an external importer could be sending it.

---

## Over-fulfilment is refused with real numbers — MEASURED

```
line at 4/10, ask to ship 7:
-> 422 "line "PF8-A" (0a425ad5-…) has 10 ordered and 4 already fulfilled, so 6
        remain — this asks to ship 7, which would take it to 11 of 10.
        Ship at most 6."
```

Every refusal measured, verbatim, against the live server:

| Request | Status | Message (abridged) |
|---|---|---|
| ship 7 where 6 remain | 422 | `10 ordered and 4 already fulfilled, so 6 remain … Ship at most 6.` |
| ship 2 but claim `fulfilled` | 422 | `these line quantities make this order partially_fulfilled, not fulfilled (PF8-A: 6/10, PF8-B: 0/4) …` |
| sku not on the order | 422 | `this order has no line for sku "NOT-ON-ORDER". It carries: PF8-A, PF8-B.` |
| `quantity: 0` | 422 | `quantity must be at least 1 — shipping 0 units of a line changes nothing` |
| both `sku` and `line_id` | 422 | `pass either sku or line_id, not both — they could name different lines` |
| same sku twice in one array | 422 | `sku "PF8-A" appears more than once. Send one entry per line …` |
| unknown field on an entry | 422 | `unknown field "note". Accepted: sku, line_id, quantity` |
| neither status nor quantities | 422 | `A PATCH that says neither would change nothing.` |
| ship against a `fulfilled` order | 409 | `PF8-ORD-1 is fulfilled, which is final … a parcel that left is a RETURN` |
| ship against a `cancelled` order | 409 | (same shape) `A cancelled order ships nothing.` |

---

## Concurrency — `Promise.all` over `fetch`, ONE Node process

Never backgrounded `curl`. Six runs at three contention levels, each against the
live server with stock re-read before and after:

| Probe | Result | on_hand moved | 200s | Exact? |
|---|---|---|---|---|
| 20 concurrent `ship 1` on one 20-unit line | `{200: 9, 409: 11}` | 9 | 9 | **yes** |
| 20 concurrent `ship 1`, run 2 | `{200: 8, 409: 12}` | 8 | 8 | **yes** |
| 20 concurrent `ship 1`, run 3 | `{200: 8, 409: 12}` | 8 | 8 | **yes** |
| 40 concurrent `ship 1` on one 40-unit line | `{200: 9, 409: 31}` | 9 | 9 | **yes** |
| 12 concurrent `ship 3` on one 20-unit line | `{200: 6, 409: 6}` | 18 | 6 (×3 = 18) | **yes** |
| **10 concurrent "mark fulfilled" on the SAME order** (7 units) | `{200: 1, 409: 9}` | **7** | 1 | **yes** |

Every run landed on exactly `moved = Σ(units of the 200s)`, and the line's
`fulfilled_quantity` matched. The last row is the double-ship probe: ten racing
requests, seven units moved once.

A sample refusal, so it is clear these are honest and actionable rather than
silent:

```
409 "line "PF8-C" (82a37fd2-…) on PF8-CONC-4 did not accept its claim after 8
     attempts — too many concurrent shipments against that line. Lines shipped
     this call: []. Nothing was changed for this line; retry it."
```

**Stated plainly, not buried:** at 20-way contention on a single line, roughly
55–60% of shipments are refused, and at 40-way roughly 77%. That is the same
8-attempt ceiling pieces7 §4 measured for the direct adjust endpoint, and the
same decision is being kept: no backoff, no raised ceiling, no per-SKU
serialisation. Those remain the right follow-up for a flash-sale / storefront-sync
workload and **were not built or measured here**. What is new is that a refusal
now leaves *nothing* half-done, which was not true before.

---

## Non-negotiables, re-checked

- **Money is still an INTEGER count of minor units.** No column added by 074
  holds money. `grep -n "parseFloat\|\* 100" lib/commerce.ts` → nothing. No
  NUMERIC/DECIMAL introduced on either dialect.
- **An unknown currency is still REFUSED, never assumed to have two decimals.**
  17 live assertions run this session against `POST /api/commerce/products` and
  `POST /api/commerce/orders`, all passing: USD by omission, lowercase `usd`,
  `jpy` at exponent 0, `15.00 JPY` refused, `XYZ` refused, `KWD` refused (not in
  `CURRENCY_EXPONENT`, so fail-closed is correct), numeric `840` refused,
  `null` refused, float `19.99` refused, `1e2` refused, `1,299.00` refused,
  `1.234` in USD refused, `0.10 EUR` accepted as 10, order in JPY with a
  matching total accepted, order total disagreeing with its lines refused,
  numeric `392` refused, `ZZZ` refused.
- **Commerce still has NO all-projects mode.** `app/api/commerce/scope.ts` was
  not touched. Measured: a forged `x-mc-all-projects: 1` with a `/fleet` referer
  → `400 unscoped_commerce_read`; `?all_projects=1` does not widen anything (the
  read stays scoped to the referer's project).

---

## Gate numbers, measured this session, after fixture cleanup

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **0 errors**, exit 0 |
| `npm test` | **1566 passed, 1 failed, 2 skipped (1569)** — the single failure is `__tests__/runtimes/spawn-live.test.ts`, one of the brief's three known suites. `agents-route` and `agents-unconfigured` now PASS: another lane fixed them during this session, so the known failure SET shrank from 3 suites / 5 tests to 1 suite / 1 test. Nothing in this piece's owned files fails. |
| `node scripts/acceptance/run.mjs` | **45/45 passing, harness score 10/10** |
| `bash scripts/smoke-test-layout.sh` | **exit 0**, 13 ✅ lines and no ❌. (The brief said "NINE guards". What the script actually printed today is 4 layout checks — sidebar, `lg:hidden` mobile nav, layout wrapper, header — plus **8** guards, plus a final "Smoke test complete", which is where the 13 comes from. Reporting what it printed rather than reconciling it to the brief's count.) The 8 guards are `no-invented-projects`, `no-dead-modules`, `no-phantom-columns` (run against the live schema *with* 074 applied), `no-cloud-provider`, `check-boolean-columns`, `check-no-secrets`, the honest-error guard (`no-silent-empty`) and the scope guard (`no-unscoped-issues`, a real PASS on 10 live probes) |

Commerce suites alone: **4 suites, 46 tests, all passing**
(`commerce-partial-fulfilment` 37, `commerce-permissions` 5,
`commerce-audit-atomicity` 3, `commerce-inventory-concurrency` 1).

**Mid-session, another lane's in-flight files were briefly visible to my gates
and are named rather than absorbed:** `app/api/agents/fleet-roster.ts:184`
(`Type 'string | DbError | null' is not assignable to type 'string | null'`)
failed `tsc` for part of the session and was fixed by its owner; and one
`npx tsc --noEmit` run aborted with `TS6053: File
'__tests__/zz-critic-probe.test.ts' not found` — a file that appeared and
vanished under the run. Neither is this piece's, neither was touched, and both
were gone by the final gate run above.

---

## The new tests are not vacuous — PROVEN, not asserted

`__tests__/api/commerce-partial-fulfilment.test.ts` (37 tests) drives the REAL
handler against an in-memory fake with genuine compare-and-swap semantics and
real event-loop turns between reads and writes.

I verified the double-ship gate can actually fail. I temporarily changed the
implicit plan builder from `quantity: lineRemaining(l)` to
`quantity: l.quantity` — i.e. back to shipping the ORDERED amount — and re-ran:

```
● THE DOUBLE-SHIP GATE: marking fulfilled moves the OUTSTANDING units,
  not the ordered ones            Expected: 200  Received: 422
● every unit of a partly-shipped line is accounted for across two shipments
                                  Expected: 200  Received: 422
Tests: 2 failed, 35 passed, 37 total
```

Then restored the line and re-ran: 37/37. (The failure surfaces as a `422`
rather than a wrong stock number because `planLineFulfilments`'s
over-fulfilment refusal catches the broken plan first — two independent layers,
which is the point.)

I also verified `no-phantom-columns` genuinely inspects this column rather than
skipping it as a dynamic expression: temporarily renaming
`'id,sku,quantity,fulfilled_quantity'` to `'id,sku,quantity,fulfilled_qty_typo'`
made the guard report it; restoring made it clean again. Its OK on
`fulfilled_quantity` is a real check against the live schema, not a blind spot.

---

## ACCEPTANCE — checkable without trusting this summary

1. `ls migrations/074_order_line_fulfilled_quantity.sql migrations/sqlite/074_order_line_fulfilled_quantity.sql`
   — both exist. `ls migrations/ | grep "^07"` lists exactly two files, `070_…`
   (another lane's, pre-existing) and `074_…` (this piece's); no `071`–`073`
   were claimed or created here.
2. `node -e "const D=require('better-sqlite3');console.log(new D('db.sqlite',{readonly:true}).prepare('PRAGMA table_info(order_line_items)').all().map(c=>c.name).join(','))"`
   ends with `fulfilled_quantity`, and `SELECT * FROM schema_migrations WHERE
   filename LIKE '074%'` returns a row. (074 is applied to the live database.)
3. `grep -n "fulfilled_quantity <= quantity" migrations/074_*.sql migrations/sqlite/074_*.sql`
   — the CHECK is in both dialects.
4. `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/api/commerce-partial-fulfilment.test.ts`
   passes **37/37**, including a real PGlite Postgres asserting the CHECK
   rejects `6` and `-1` on a 5-unit line. Changing
   `quantity: lineRemaining(l)` to `quantity: l.quantity` in
   `app/api/commerce/orders/route.ts` makes two of them fail — verified this
   session, not asserted.
5. `grep -n "eq('fulfilled_quantity', fresh.fulfilled_quantity)" app/api/commerce/orders/route.ts`
   — the per-line compare-and-swap WHERE clause.
6. `grep -n "deriveFulfilmentStatus\|checkStatedStatusAgainstLines\|planLineFulfilments" lib/commerce.ts app/api/commerce/orders/route.ts`
   — the status is computed from lines in both places it matters.
7. `grep -n "parseFloat\|\* 100" lib/commerce.ts` returns **4 hits, all inside
   comments** (lines 14–16 and 97 — the block that explains why neither is used,
   and the `1998.9999999999998` worked example). **There are zero in live code**:
   `grep -n "parseFloat\|\* 100" lib/commerce.ts | grep -vE ":\s*(\*|//)"` is
   empty. Stated this way because the count-based version of this check was
   written as "→ 0", run, and found to be wrong — the comments count.
   Separately, `grep -in "numeric\|decimal" migrations/074_*.sql
   migrations/sqlite/074_*.sql` finds no column declaration: 074 adds an
   `integer`, and money is untouched by it.
8. `grep -n "all_projects" app/api/commerce/scope.ts` → nothing but the comment
   explaining its absence; the file is byte-identical to before this piece
   (`git diff --stat app/api/commerce/scope.ts` → empty).
9. `node --experimental-vm-modules node_modules/jest/bin/jest.js __tests__/api/commerce`
   → 4 suites, 46 tests, all passing.
10. `grep -n "fulfilment_status=partially_fulfilled" components/tabs/CommerceTab.tsx`
    — the second orders query, so a part-shipped order is visible and actionable.
11. `SELECT count(*) FROM products WHERE sku LIKE 'PF8-%' OR sku LIKE 'CUR8-%'`,
    and the same for `orders.order_number`, `inventory_levels.sku`, and
    **`commerce_actions.object_ref`** — all read **0**. Confirmed after cleanup.
12. `SELECT task_key, project, status FROM issues WHERE task_key='TOD-1'` →
    `{"task_key":"TOD-1","project":"Todero","status":"backlog"}` — the permanent
    probe row, untouched.

---

## Fixtures

Created in `Limiglow`, all under two collision-proof prefixes chosen so that no
deletion could reach another lane's rows: `PF8-*` (products `PF8-A/B/C/F`,
orders `PF8-ORD-1`, `PF8-CONC-1…6`, `PF8-F1`, `PF8-F2`) and `CUR8-*` (products
`CUR8-1…13`, order `CUR8-O1`). Every deletion was scoped by those prefixes,
never by a blanket "clear the project" query.

Deleted, counted before and after, via `better-sqlite3` directly against
`db.sqlite` (the same driver the app uses; commerce exposes no DELETE endpoint):

```
BEFORE: orders 8, order_line_items 9, products 7, inventory_levels 7,
        commerce_actions 62      (this lane's rows only)
AFTER : 0, 0, 0, 0, 0
Anything matching PF8-% / CUR8-% anywhere in the four commerce tables: 0
```

**Not touched:** `Limiglow` carries 1 pre-existing `issues` row from another
lane; this piece does not own `issues` and did not touch it. `TOD-1` (archived,
project `Todero`) was never read or written.

---

## SEAM DIFF requested from the orchestrator

**None.** Nothing in this piece needs a change to `app/page.tsx` or
`components/nav/config.ts`. `CommerceTab` is reached through the existing
Commerce destination and its props are unchanged (`{ projectFilter }`).

---

## What I did NOT verify — explicitly

- **How any of this renders in a browser.** I had no browser tool. What I can
  say, and all I claim: `GET /p/limiglow/work/commerce` answers **200** with no
  `ModuleBuildError` / `Failed to compile` in the HTML, and the dev server's own
  compiled client chunk, fetched over HTTP from
  `/_next/static/chunks/app/page.js` (10,410,780 bytes, HTTP 200), contains
  `"Which orders are waiting to ship?"`, `"Ship the rest"`, `"Ship lines"`,
  `"part-shipped"`, `"line_fulfilments"` and `"fulfilled_quantity"`. **That is
  proof the component compiled and is being served. It is not proof it paints
  correctly**, and it says nothing about spacing, the expand/collapse
  interaction, whether the per-line quantity boxes are usable on a real screen,
  or whether the two-query metric reads sensibly. That needs the orchestrator's
  browser pass.
- **The Postgres adapter at runtime.** Every live measurement ran against the
  SQLite provider. Migration 074 itself IS proven on real Postgres (PGlite, in
  the test), and the CAS statements are plain `UPDATE … WHERE … RETURNING *`
  which `lib/db/pg-sql.ts` compiles for both dialects — but I did not run the
  concurrency probes against a live Postgres instance.
- **Whether raising the 8-attempt ceiling, adding backoff, or serialising
  per-SKU writes would fix the high-contention refusal rate.** Named as the
  follow-up, measured as a limitation, not built.
- **An order ingested as already `fulfilled` does not decrement stock.** Its
  lines are written fully fulfilled (so the derived status agrees), but no
  `inventory_levels` write happens — the parcel left before Todero saw the
  order, and decrementing would double-count against the storefront's own feed.
  This is unchanged from before this piece and is stated as a decision, not
  measured as a requirement; nobody has ruled on what an importer should do here.
- **`commerceActor()` records `"unknown"` for every API-driven action** — it
  reads the `mc-role` cookie, and an agent authenticating by header has none. I
  saw this in every audit row I created (`"actor":"unknown"`). It is
  pre-existing, outside this piece's gap, and not fixed here.
- **`?all_projects=1` on a commerce GET is silently ignored rather than
  refused.** It does NOT widen scope (measured), so the boundary holds, but a
  query parameter the endpoint does not implement is accepted without comment —
  a mild version of the "unknown field silently ignored" stance this codebase
  rules against for writes. Pre-existing; reported, not changed.
- **`npm run db:migrate` printed `up to date — 21 sqlite migration(s) already
  applied, 0 new` on the run that actually applied 074** (the ledger row's
  timestamp is that run). The migration applied correctly; the summary line
  appears to count post-application state. `scripts/db-migrate.mjs` is not this
  piece's file, so it is reported rather than fixed.


---

# ROUND 2 (2026-08-26) — the oversell, and three sentences that were not true

A fresh-context critic scored this piece 6/10, named one gap and three
fabrications, and was RIGHT ABOUT ALL FOUR. Every one was re-measured here
against the running dev server before anything was changed. Nothing above this
line has been rewritten; this section is what round 2 found, changed, and left
open.

## Each claim, measured myself

| Claim | Verdict | What I measured, today |
|---|---|---|
| **THE GAP.** `route.ts` returned after a landed line claim without reverting it, on two paths (`levelError`, `stockError`); an ordinary oversell detonates `CHECK (on_hand >= 0)` and reaches one | **CONFIRMED** | Seeded `W8C-OS` to `on_hand 2`, ordered 5, `PATCH line_fulfilments:[{quantity:5}]` → **`500 {"error":"CHECK constraint failed: on_hand >= 0"}`** — the raw driver string, no `message` field. `GET` then read `fulfilment {ordered:5, fulfilled:5, remaining:0}` with `on_hand` still 2 and **no `commerce_actions` row**. Five units recorded as shipped that nothing shipped. |
| The row is a **dead end** | **CONFIRMED** | On that same order: `{fulfilment_status:'fulfilled'}` → 409 `nothing_to_ship`; `{order_number}` alone → 422 `nothing_to_do`; `{fulfilment_status:'partially_fulfilled'}` → 422 `needs_line_fulfilments`; a zero-quantity line → 422. Four out of four. |
| **Fabrication 1** — "A shipment that cannot complete now reverts its own line claim…" | **CONFIRMED FALSE of the shipped code** | Same probe: the claim was NOT reverted. The sentence was true of the audit-failure and CAS-exhaustion paths only. |
| **Fabrication 2** — "The status is DERIVED from the lines, never asserted" | **CONFIRMED FALSE at the ingest door** | `POST {order_number:'W8C-ING-1', fulfilment_status:'partially_fulfilled', line_items:[{quantity:5,…}]}` → **201**, stored `partially_fulfilled`, `GET` → `{ordered:5, fulfilled:0, remaining:5}`. PATCH refuses exactly this state in so many words; POST created it. |
| **Fabrication 3** — the route's own "re-send this PATCH with no line_fulfilments" names a request that does not exist | **CONFIRMED** | Same four refusals as the dead-end row above. The advice was the fabrication; the missing settle path was the defect under it. |
| Smaller finding: `CommerceTab` waiting-metric undercount | **CONFIRMED in substance, the quoted line was stale** | The file already read `orders.total === null && partial.total === null ? null : …`. The `&&` is the bug: with ONE query failing, the other's number renders alone as a confident total beside the error banner. |
| Everything the critic verified as PASSING (double-ship gate, concurrency splits, the 10-row refusal table, scope) | **NOT REGRESSED** | The 46 pre-existing commerce tests still pass unchanged, plus 18 new ones. |

## What I changed

**1. Overselling is now a refusal with numbers, before anything is claimed.**
A pre-flight check reads every `inventory_levels` row for each SKU in the plan
— summed **per SKU**, so two lines carrying the same SKU cannot oversell
between them — and refuses the whole request with nothing written:

```
PATCH {"order_number":"W8C2-OS-1","line_fulfilments":[{"sku":"W8C2-OS","quantity":5}]}
-> 422 {"error":"insufficient_stock",
        "message":"W8C2-OS-1 was NOT shipped: shipping 5 of \"W8C2-OS\" needs 5 on hand,
                   and Limiglow has 2 at location \"default\". Ship at most 2, or add the
                   missing 3 first with PATCH /api/commerce/inventory
                   {\"sku\":\"W8C2-OS\",\"delta\":3,\"reason\":\"...\"}."}
```

Measured after the fix, on that order: line still `0/5`, `on_hand` still 2,
order still `unfulfilled`, no audit row. The same order then shipped 2 with
`200` and `"location":"default"` on the line.

**2. Every exit from the stock loop compensates.** The `levelError` and
`stockError` paths now revert the line claim and return a crafted
`stock_read_failed` / `stock_write_failed` naming the order, the line, the
shelf, the driver's message, and whether the revert landed — instead of the raw
driver string. The pre-flight check is not the safety net; this is. Both are
pinned by tests that force a driver error directly (`stockOutcome` in
`commerce-audit-atomicity.test.ts`, a hook that suite did not have — it could
only ever fail AUDIT inserts, which is why these two paths were invisible to all
46 tests).

**3. Which shelf a parcel comes off is now a decision.** The writer read levels
with `.limit(1).maybeSingle()` and no ORDER BY, so on a multi-location SKU it
decremented an arbitrary row. It now sorts by location and takes the first that
can cover the whole line; a line is never split across shelves, and when no
single shelf can cover it the refusal names each one. The chosen location is
reported on each shipped line and written into the `inventory.adjust` audit
reason.

**4. Ingest derives its status too** (`lib/commerce.ts`). `line_items[]` accepts
an optional `fulfilled_quantity` (`0 <= it <= quantity`); the order's status is
DERIVED from those quantities; a stated status that disagrees is refused naming
both. `fulfilment_status:'fulfilled'` with no per-line numbers stays the
"all of it" shorthand, unchanged. `cancelled` is the one exemption, deliberately
— it is a decision about an order, not a count of what left the warehouse, and
`deriveFulfilmentStatus` cannot return it by construction.

**5. The remediation now names a request that exists.** `PATCH {order_number,
fulfilment_status: <what the lines already say>}` with no `line_fulfilments`
SETTLES an order whose status has fallen behind its own lines: no units move,
one `order.fulfilment` audit row is written, and the answer still comes from the
lines. Both 500s that printed the old advice now print the exact body, with the
order number and target status interpolated. When the lines already agree with
the status, the same request is an assertion again and is refused as one.

**6. `CommerceTab` waiting metric.** `&&` → `||`: either half missing means
there is no count, not a smaller one.

## The new tests are not vacuous — 9 mutants, 9 killed by name

Each mutation was planted, the commerce suites run, the file restored, and the
md5 checked back to its pre-mutation value (`final md5 route True lib True`).

| Mutation | Killed by |
|---|---|
| stock WRITE failure returns without reverting the claim (**the old code**) | `gives the claim back when the stock WRITE fails after it landed` |
| stock READ failure returns without reverting the claim (**the old code**) | `gives the claim back when the stock READ fails after it landed` |
| pre-flight stock check deleted | `sums the requirement per SKU, so two lines of the same SKU cannot oversell between them` |
| `pickLevelFor` ignores `on_hand` (takes the first shelf, as `.limit(1)` did) | 3 tests, incl. `refuses with the real numbers, and writes NOTHING at all` |
| `sortLevels` no longer sorts | `picks the SAME shelf twice, by name, rather than whichever row came back first` |
| **POST ingest writes a flat `0`** — the mutant that SURVIVED last round | 3 tests, incl. `ingests an already-shipped order with every line fully fulfilled` |
| ingest stops checking the stated status against the lines | 2 tests, incl. `REFUSES partially_fulfilled asserted with no per-line quantities` |
| the settle path is unreachable again | 2 tests, incl. `the settle it names actually works: the same order, that exact body, 200 and settled` |
| ingest accepts `fulfilled_quantity` above the quantity ordered | `refuses a line that claims to have shipped more units than it sold` |

Note the third row honestly: with the pre-flight check deleted, a single-line
oversell is still caught — by the in-loop guard, which reverts. That is the
defence in depth working, not a redundant test; only the multi-line sum is
uniquely the pre-flight's.

`__tests__/api/commerce-order-ingest.test.ts` is new and exists because
`grep -n "route\.POST"` over all four commerce suites returned nothing: POST had
zero coverage, which is why fabrication 2 could ship.

## Gate numbers — run today, 2026-08-26, after fixture cleanup

| Gate | Result |
|---|---|
| `npx tsc --noEmit` | **exit 0**, 0 errors |
| `npm test` (whole repo) | **1964 passed, 4 failed, 2 skipped of 1970**; failing suites are `__tests__/runtimes/spawn-live.test.ts` (the brief's known failure) and `__tests__/nav/runs-permalink-seam.test.ts` (**another lane's** — its own describe reads "RED until the orchestrator applies it" and it needs `app/page.tsx`). `agents-route` and `agents-unconfigured` now PASS — another lane fixed them. Zero commerce failures. |
| `npm test -- __tests__/api/commerce` | **5 suites, 64 tests, all pass** (was 4 suites, 46) |
| `node scripts/acceptance/run.mjs` | **45/45 passing (7159ms), harness score 10/10** |
| `bash scripts/smoke-test-layout.sh` | **exit 1 — 9 guards pass, `check-no-secrets` FAILS, and NOT on my files.** It flags `docs/rebuild/pieces/pieces8/approval-surface.md:740`, `.../work-ui-cards.md:636` and `.../pipeline-fidelity.md:718` — three OTHER lanes' piece docs quoting a literal credential assignment in their own prose. This is the exact class commit `4db1390` fixed once ("the secret scanner flagged its own specifications"). Reported, not touched: they are not my files. With those three lines gone the run is 10/10. |

## Fixtures — round 2

`W8C-*` and `W8C2-*` in **Limiglow** only: 2 products, 2 inventory levels, 9
orders, 9 line items, 6 `commerce_actions` rows. All deleted; re-counted after
deletion across `orders`, `order_line_items`, `products`, `inventory_levels` and
`commerce_actions` (including a `reason LIKE '%W8C%'` sweep) — **0 residual, on
every table**. `TOD-1` read back
`{"task_key":"TOD-1","project":"Todero","status":"backlog"}`, unchanged. No git
command that mutates anything was run; `npm run build` was not run.

## Still open — honestly

- **The settle's 200 side is proven in tests, not live.** I could not reach the
  "lines shipped, status behind" state through the HTTP API, because after fix 4
  ingest refuses to store that disagreement and PATCH derives its way out of it
  — the state is now only reachable by a mid-flight audit failure, which I have
  no way to force against the running database without touching its schema. The
  unit test reconstructs that exact state and runs the exact body the 500
  prints. **The live refusal side WAS measured** (the "here they do not" branch).
- **Multi-location is proven in tests, not live.** `POST /api/commerce/products`
  only ever creates a `default` level and `PATCH /api/commerce/inventory` 404s
  on a location that does not exist, so no second location can be created
  through the API at all. That is itself a gap in the inventory endpoint, which
  is not this piece's file.
- **A line is still never split across shelves.** When no single location can
  cover a line, it is refused with each shelf's count. Splitting needs the
  operator to say which shelf, and the request shape has nowhere to say it.
- **Still not built, and still the honest Shopify gap:** a Fulfillment is a
  scalar counter, not an object — no id, carrier, tracking number, ship date, no
  cancel, no refund-with-restock, and `available = on_hand − committed` does not
  exist, so an unfulfilled order still reserves nothing. Two shipments of 4 and 6
  remain indistinguishable from one of 10.
- **No browser evidence.** I have no browser tool. Everything above is HTTP
  against the running dev server plus the test suites; the `CommerceTab` metric
  change is verified by reading and by `tsc`, not by looking at the card. That
  needs the orchestrator's pass.
- **Postgres at runtime.** All live measurement was SQLite, as before.
- **`validateWholeCount` still coerces `"2"`** (a JSON string) to 2 while
  refusing `1.5` and `-3`. Pre-existing, shared with the product and inventory
  validators, untouched — flagged again rather than changed under nine other
  lanes.

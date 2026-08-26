# Piece: commerce-operations (Wave 7, channel "Commerce Operations")

**Owner:** builder (this round)
**Channel:** Commerce Operations — **0/8**, never touched before this round.

> **Goal:** *"Shopify admin — orders, catalog and inventory as first-class
> objects you can act on, not a dashboard that only reports what happened."*
>
> **Now:** *"Operating a storefront means orders, catalog and inventory are
> objects an operator acts on. Todero has none of them — it models issues and
> agents only. This is the channel that decides whether Todero is a dev tool or
> a business console."*

## The problem this piece exists to fix

Limiglow is a real storefront, live today as amazoniico.com. Todero claims to
operate it. Before this piece Todero's entire vocabulary was `issues`,
`agents`, `sprints`, `runs` — there was no row anywhere in `migrations/` that
said *product*, *order* or *stock*. An operator could file a ticket about an
order; they could not look at the order.

Four things follow from that, and each is what this piece fixes:

1. **No objects.** No `products`, no `orders`, no `inventory_levels`. Nothing
   to act on.
2. **No actions.** The channel goal names the failure explicitly — *"not a
   dashboard that only reports what happened"*. A read-only orders table
   scores zero here. The difference between a console and a report is whether
   the operator can change something and have the change stick.
3. **No money type.** Todero has never stored an amount of money. The single
   most common defect in commerce schemas is storing money as a float; this
   piece decides the representation once, in the migration, with the reasoning
   in the file.
4. **No scope.** Commerce is per-storefront by nature. Wave 6 moved scope to
   the server seam (`middleware.ts` → `x-mc-project`); this piece is the first
   new API built on that seam from the start rather than retrofitted onto it.

## What this piece deliberately does NOT do

**No Shopify. No outbound call to any storefront API.** Shopify admin is the
BENCHMARK the channel names, not a dependency. The owner has made no decision
about a commerce provider, and inventing one would be exactly the class of
"an inference converted into a stated decision" that `HANDOFF.md` forbids.
This piece builds the objects, the actions and the surface; an importer for
whatever provider is eventually chosen writes into these tables.

**No seed data.** Not one product, not one order, not one stock level ships in
the migration. Limiglow's catalogue is empty and must READ as empty —
"Limiglow has no products yet — that is correct, not broken" — never as a
populated demo. This codebase has repeatedly shipped hardcoded arrays rendered
as live data; a commerce screen showing three imaginary orders would be the
worst instance of it yet, because an operator would act on them.

## What ships

- `migrations/064_commerce.sql` + `migrations/sqlite/064_commerce.sql` —
  `products`, `inventory_levels`, `orders`, `order_line_items`,
  `commerce_actions`. Project-scoped. Money in integer minor units.
- `lib/commerce.ts` — the pure half: money parsing/formatting with no float
  anywhere, the currency table, the fulfilment state machine, and the
  validators every write goes through.
- `lib/__tests__/commerce.test.ts` — weighted towards proving the validators
  REFUSE.
- `app/api/commerce/products/route.ts` — GET list, POST create, PATCH price
  and status.
- `app/api/commerce/inventory/route.ts` — GET levels, PATCH adjust (the
  inventory action).
- `app/api/commerce/orders/route.ts` — GET list/read, POST ingest, PATCH
  fulfilment state (the order action).
- `app/api/commerce/scope.ts` — the one place a commerce request's storefront
  is resolved, so three routes cannot drift into three answers.
- `components/tabs/CommerceTab.tsx` — three cards on `components/nav/Card.tsx`.

---

## ACCEPTANCE

Every item is observable by running a command or reading a rendered string.
`AUTH` below means `-H 'cookie: mc-auth=kaos2026; mc-role=owner'`;
`SCOPED` additionally means `-H 'referer: http://localhost:3000/p/limiglow/work/board'`.

### A. The objects exist, in both dialects

1. `migrations/064_commerce.sql` and `migrations/sqlite/064_commerce.sql` both
   exist and both create the same five tables: `products`,
   `inventory_levels`, `orders`, `order_line_items`, `commerce_actions`.

2. `npm test -- migrations-from-zero` passes: `migrations/064_commerce.sql`
   applies against a genuinely empty PGlite database, in filename order, with
   every earlier migration.

3. `npm run db:migrate` applies `sqlite/064_commerce.sql` and is idempotent —
   running it a second time changes nothing and exits 0.

4. Every commerce table carries a `project TEXT NOT NULL` column except
   `order_line_items` (scoped through its parent order via `order_id`) — and
   the project column is indexed on each of the four that have one.

5. **No seed rows.** `grep -icE '^\s*insert' migrations/064_commerce.sql
   migrations/sqlite/064_commerce.sql` reports `0` for both files. Immediately
   after `npm run db:migrate`, `SELECT count(*)` on all five tables is `0`.

### B. Money is not a float

6. Every money column in both dialects is declared `INTEGER` (SQLite) /
   `BIGINT` (Postgres) and is named with a `_minor` suffix —
   `products.price_minor`, `orders.total_minor`,
   `order_line_items.unit_price_minor`. No `REAL`, `FLOAT`, `DOUBLE`,
   `NUMERIC`, `DECIMAL` or `MONEY` appears in either file.

7. The migration comment states the decision and the reason in full: minor
   units of the row's own currency, stored as an exact integer, because
   (a) binary floating point cannot represent `0.10`, and a total is a sum of
   many such values; (b) SQLite has no exact decimal type at all — a `NUMERIC`
   column there is stored by affinity as `REAL`, so a Postgres host and a
   SQLite host would disagree about the same order; (c) integer minor units
   are stored bit-identically by both.

8. Every table holding an amount also holds the `currency` it is an amount OF,
   because the minor-unit exponent is a property of the currency (JPY has 0
   decimal places, USD has 2). An amount without its currency is not a
   quantity of money.

9. `lib/commerce.ts` exports `parseAmountToMinor(text, currency)` which parses
   a decimal string with **integer arithmetic on digit substrings only** — the
   file contains no `parseFloat`, no `Number(` on an amount, and no `* 100`
   applied to a fractional value. `commerce.test.ts` asserts
   `parseAmountToMinor('19.99','USD') === 1999`,
   `parseAmountToMinor('0.10','USD') === 10`,
   `parseAmountToMinor('1500','JPY') === 1500` (exponent 0).

10. `parseAmountToMinor` REFUSES, with a reason naming the currency's
    precision: `'19.999'` for USD (too many decimal places), `'1e2'`,
    `'12.34.5'`, `'-5'` on a price, `''`, `'  '`, `'NaN'`, `'Infinity'`, and
    a number-typed input that is not an integer.

11. `formatMinor(1999,'USD') === '19.99'` and `formatMinor(5,'USD') ===
    '0.05'` — the round trip `parseAmountToMinor(formatMinor(n,c),c) === n`
    holds for every value the test enumerates.

12. An unknown currency is REFUSED, not assumed to have two decimals:
    `parseAmountToMinor('10.00','XYZ')` fails with a reason naming the
    supported set. This is a fail-closed default, because guessing the
    exponent silently corrupts every amount in that currency by 100x.

### C. Scope fails closed

13. `GET /api/commerce/orders` with AUTH but **no** Referer and no `project=`
    answers **400** with `error: "unscoped_commerce_read"` and a message that
    says how to ask deliberately — naming both a `/p/<project>` screen and the
    `project=<name>` parameter. Same for `/api/commerce/products` and
    `/api/commerce/inventory`.

14. The same request WITH `referer: .../p/limiglow/...` answers **200** and its
    body reports `project: "Limiglow"`.

15. There is **no widening escape**. `?all_projects=1` on any commerce GET is
    not a scope: the request still 400s exactly as in item 13. A storefront
    read that spans every project is not a thing an operator asks for, and a
    client-controlled query string must never widen a server-resolved
    boundary (TOD-2420).

16. A `project=` parameter that DISAGREES with the resolved scope is refused
    with **409** `scope_mismatch`, not silently answered. A resolved scope
    narrows; it is never overridden.

17. Every WRITE (`POST /api/commerce/products`, `PATCH` on all three routes)
    applies the identical rule: no resolvable scope → 400
    `unscoped_commerce_write`, mismatch → 409.

18. A row belonging to another project is invisible AND unwritable from a
    Limiglow-scoped request: `PATCH /api/commerce/orders` naming an order
    whose `project` is not `Limiglow` answers **404**, deliberately — not 403,
    so a scoped caller cannot use the endpoint to discover what exists
    elsewhere. This is proven by inserting one foreign-project fixture row,
    observing the 404, and removing it again.

### D. Validation refuses on WRITE (the hub-settings stance)

19. `POST /api/commerce/products` refuses each of these with 4xx and a
    `why`-style message, and writes NOTHING:
    - missing `sku`; `sku` that is blank or longer than 64 chars; `sku`
      containing whitespace
    - missing `title`
    - a `price`/`price_minor` failing item 10
    - an unsupported `currency` (item 12)
    - a `status` outside `draft | active | archived`
    - a duplicate `(project, sku)` → **409**, naming the existing SKU
    - **an unknown field** in the body → **400**, naming the field and
      listing the accepted ones. Fail closed, exactly as
      `app/api/hub-settings/route.ts` refuses an unknown settings key: an
      endpoint that silently ignores a field the caller sent is an endpoint
      the caller believes did something it did not.

20. Each refusal is proven to have written nothing: the `products` count
    before and after the refused POST is identical.

21. The same body with the one unsafe thing FIXED is ACCEPTED (201). A
    validator that refuses everything must fail this suite as loudly as one
    that refuses nothing.

### E. The inventory action — an operator changes stock

22. `PATCH /api/commerce/inventory` with `{ sku, location, delta, reason }`
    changes `inventory_levels.on_hand` by exactly `delta` and answers with
    the new `on_hand`. A subsequent `GET` returns the new value — the change
    persisted, it did not live in React state.

23. `reason` is REQUIRED. A stock adjustment with no reason is refused (422).
    Stock that changed for no recorded reason is the defect this prevents.

24. An adjustment that would drive `on_hand` below zero is refused with 422
    naming the current level and the delta — and `on_hand` is unchanged
    afterwards. Negative stock is not a state a storefront can be in.

25. `delta` must be a non-zero integer. `0`, `1.5`, `"2"` (as a float string),
    `NaN` and a missing `delta` are each refused.

26. An unknown `sku` for the scoped project is refused **404** and creates no
    inventory row. An adjustment cannot conjure a product.

27. Every accepted adjustment appends one row to `commerce_actions` recording
    `action='inventory.adjust'`, the object, `from_value`, `to_value`, the
    reason and the actor. `GET /api/commerce/inventory?history=<sku>` returns
    it. A refused adjustment appends NOTHING.

### F. The order action — an operator moves fulfilment

28. `lib/commerce.ts` exports the fulfilment state machine:
    `unfulfilled → partially_fulfilled → fulfilled`, with `cancelled`
    reachable from `unfulfilled` and `partially_fulfilled` only.
    `canFulfilmentTransition(from,to)` is a pure function and is tested for
    every ordered pair of states, legal and illegal.

29. `PATCH /api/commerce/orders` with `{ order_number, fulfilment_status }`
    performs a legal transition, persists it, and answers with the new state.

30. An ILLEGAL transition is refused **409** with a message naming both
    states — specifically: `fulfilled → unfulfilled` (no un-shipping),
    `cancelled → anything` (terminal), and any transition to a state not in
    the enumerated set. The order's state is unchanged afterwards.

31. A transition to the state the order is ALREADY in is refused, not
    silently accepted as a no-op success. A green answer for an action that
    changed nothing is the "silent success" shape this repo already ruled
    against on the approvals path.

32. Every accepted transition appends one `commerce_actions` row with
    `action='order.fulfilment'`, `from_value` and `to_value`. A refused one
    appends nothing.

### G. The surface — the Card contract

33. `components/tabs/CommerceTab.tsx` renders on `components/nav/Card.tsx` and
    imports it; it does not reimplement card chrome.

34. Three cards, each satisfying the contract — **one question as the title,
    one number from a real query, that query printed as `source`**:
    | Card | Question | Number | Source printed |
    |---|---|---|---|
    | Orders | "Which orders are waiting to ship?" | exact count of unfulfilled orders | `/api/commerce/orders?project=<p>&fulfilment_status=unfulfilled&limit=10` |
    | Catalogue | "What is <project> selling?" | exact count of active products | `/api/commerce/products?project=<p>&status=active&limit=10` |
    | Inventory | "What is about to run out?" | exact count of levels at or under a reorder point that was actually SET | `/api/commerce/inventory?project=<p>&below_reorder=1&limit=1` and `...&limit=25` (two lines — the card merges two sources) |

    The `source` string printed on each card is the URL the card actually
    fetched, character for character — including its `limit`.

35. The number is an EXACT count from `count: 'exact'` returned as `total` by
    the route — never `rows.length` of a page. `limit` bounds only the rows
    returned; `total` is the count of everything matching, so a card showing
    ten rows can and does report a total of forty.

    The one number that is NOT a plain `count: 'exact'` is "below reorder
    point", because `on_hand <= reorder_point` compares two COLUMNS and the
    database seam's vocabulary is column-to-value only. That count is computed
    over EVERY level in the project, not over a page, and the route says so in
    a comment. It also excludes levels whose `reorder_point` is 0 ("never
    warn") — otherwise a freshly created catalogue, every SKU at 0/0, would
    report every product as critically low: a number derived from a query and
    still a lie.

36. No metric is rendered while the count is in flight. A card with no data
    yet omits `metric` entirely rather than showing a fabricated `0`.

37. Each empty state NAMES the project and reads as correct, not broken —
    e.g. `Limiglow has no products yet. That is the true state of the
    catalogue, not a failed load.`

38. An API error REPLACES the card body — `<ApiErrorBanner>` renders and the
    empty state does NOT. `node scripts/no-silent-empty.mjs` exits 0.

39. The Inventory card's action is real: it opens an inline adjust control
    that PATCHes `/api/commerce/inventory` and re-reads the level. No button
    that does nothing.

### H. An order can exist at all

45. `POST /api/commerce/orders` ingests one order with its line items, and the
    order total is COMPUTED from the lines by exact integer arithmetic
    (`quantity * unit_price_minor`, summed). This endpoint exists because
    without it `orders` could never hold a row from anywhere in this repo, the
    Orders card would be permanently empty, and the fulfilment action would be
    unreachable in the running app. An object nothing can create is an object
    nobody can prove works. It makes no outbound call to any storefront.

46. A caller-stated `total` that DISAGREES with the lines is refused (422)
    naming both amounts — an order whose total does not equal its lines is a
    reconciliation failure, not a rounding one — and the same order is accepted
    once the stated total matches.

47. Ten lines of `0.10` sum to exactly `1.00`. (Ten floats of `0.1` sum to
    `0.9999999999999999`; `commerce.test.ts` asserts both.)

### I. Nothing else regressed

40. `npx tsc --noEmit` reports nothing in any file this piece owns.
41. `node scripts/acceptance/run.mjs` is still **45/45**.
42. `node scripts/no-invented-projects.mjs` exits 0 — the only projects named
    anywhere in this piece are Limiglow, Todero, Mission Control,
    Infrastructure.
43. `npm test` shows no new failures beyond the 5 known pre-existing ones
    (`agents-route`, `agents-unconfigured`, `spawn-live`).
44. Limiglow still has **zero issues**. Every fixture row this piece inserted
    to prove a refusal is removed, and the removal is confirmed by a count.

---

## What a critic should attack first

- Try to make a commerce read answer without a scope. Item 15 says
  `all_projects=1` must not work; check it by request, not by reading the
  source, because two previous scope guards in this repo were satisfied by
  dead code that kept the right identifiers.
- Try to store `19.999` as a USD price, and check what came out.
- Try to adjust stock on a SKU that does not exist and see whether a row
  appeared.
- Check whether any number on the card can be traced to a query — and whether
  the empty catalogue reads as empty or as a demo.

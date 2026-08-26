-- 064: commerce objects — products, inventory levels, orders, order line items,
--      and the append-only record of what an operator did to them.
--      Postgres dialect; the SQLite copy is migrations/sqlite/064_commerce.sql.
--
-- WHY THIS EXISTS
--   Limiglow is a real storefront (live today as amazoniico.com, rebranding).
--   Todero claims to operate it, and until this file the whole schema could say
--   `issue`, `agent`, `sprint` and `run` — and could not say `product`, `order`
--   or `stock`. An operator could file a ticket ABOUT an order; they could not
--   look at the order.
--
--   The channel this belongs to says what the failure mode is: "orders, catalog
--   and inventory as first-class objects you can act on, NOT a dashboard that
--   only reports what happened". So these tables are shaped for writes an
--   operator makes — adjusting stock, moving a fulfilment state — not only for
--   rows an importer drops in.
--
-- WHAT THIS IS NOT
--   It is not a Shopify integration. Shopify admin is the benchmark named in
--   the channel goal, not a dependency, and the owner has made no decision
--   about a commerce provider. Nothing in this file, and no route built on it,
--   makes an outbound call to a storefront. When a provider IS chosen, its
--   importer writes into these tables; the tables do not change.
--
--   It also ships NO DATA. Not one product, not one order, not one stock level.
--   Limiglow's catalogue is empty, and empty is the true state — an operator
--   who opens Commerce must see "no products yet", never three plausible demo
--   rows they might act on. (`grep -icE '^\s*insert' ` on this file: 0.)
--
-- ─── MONEY IS AN INTEGER NUMBER OF MINOR UNITS. HERE IS WHY ────────────────
--
--   Every amount below is stored as `*_minor`: a BIGINT count of the minor
--   unit of that row's OWN currency. 19.99 USD is 1999. 1500 JPY is 1500.
--
--   Three reasons, in the order they bite:
--
--   1. FLOATS CANNOT HOLD MONEY. 0.10 has no exact binary representation, so
--      `0.1 + 0.2 = 0.30000000000000004`. An order total is a sum of many such
--      values plus tax plus shipping; the error is not theoretical, it is the
--      single most common defect in commerce schemas, and it surfaces as an
--      invoice that disagrees with the payout by a cent nobody can find.
--
--   2. THE TWO HOSTS MUST AGREE. Postgres has NUMERIC, which is exact. SQLite
--      does NOT have an exact decimal type at all — a column declared NUMERIC
--      there is stored by type AFFINITY, which for a value with a fractional
--      part means REAL, a float. Todero runs on both (lib/db.ts's seam, proven
--      by lib/__tests__/db-seam.test.ts). Choosing NUMERIC would mean the same
--      order is exact on one host and lossy on the other — the worst of the
--      options, because it would pass every test run on Postgres.
--      INTEGER/BIGINT is stored exactly, and identically, by both.
--
--   3. INTEGERS ARE WHAT THE ARITHMETIC WANTS. Line total = quantity ×
--      unit_price_minor is exact integer multiplication. No rounding decision
--      is taken by the database; rounding happens once, deliberately, in
--      lib/commerce.ts, where it is tested.
--
--   The cost of this choice, stated plainly: every read site must divide by the
--   currency's exponent to display, and every write site must parse a typed
--   amount into minor units. Both live in exactly one place — lib/commerce.ts's
--   `formatMinor()` and `parseAmountToMinor()`, which do it with integer
--   arithmetic on digit substrings and never call parseFloat.
--
--   CURRENCY TRAVELS WITH THE AMOUNT. Every table holding an amount also holds
--   the `currency` it is an amount OF, because the minor-unit exponent is a
--   property of the currency: USD has 2 decimal places, JPY has 0. `1500` is
--   fifteen dollars or fifteen hundred yen, and a bare integer cannot tell you
--   which. An amount without its currency is not a quantity of money.
--   `lib/commerce.ts` REFUSES a currency it does not know the exponent for
--   rather than assuming 2 — assuming is how every amount in that currency ends
--   up wrong by a factor of 100.
--
-- ─── PROJECT SCOPE ─────────────────────────────────────────────────────────
--
--   Every table except `order_line_items` carries `project TEXT NOT NULL`, and
--   it is indexed. Todero operates one project's storefront at a time, and
--   scope is resolved at the server seam (middleware.ts -> `x-mc-project`);
--   these columns are what that resolved scope filters ON. Line items are
--   scoped through their parent order via `order_id` — duplicating `project`
--   onto them would create a second place for it to be wrong.
--
--   `project` is a NAME (e.g. 'Limiglow'), matching `issues.project` and
--   `projects.id` as they exist today. No foreign key, for the same reason
--   `issues.project` has none: the projects table's key is a name, and a hard
--   reference here would make deleting a project fail in a commerce table
--   rather than where the operator is looking.
--
-- ─── IDEMPOTENCE ───────────────────────────────────────────────────────────
--
--   Every statement is IF NOT EXISTS. The runner also records what it applied
--   in `schema_migrations`, so this normally runs once; the guards mean a
--   re-run against a database that already has these tables is a no-op rather
--   than an error.

-- ── Catalogue ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project      text        NOT NULL,
  sku          text        NOT NULL,
  title        text        NOT NULL,
  -- draft: not for sale yet. active: sellable. archived: withdrawn but kept,
  -- because an archived product still appears on historical order line items.
  status       text        NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft', 'active', 'archived')),
  price_minor  bigint      NOT NULL CHECK (price_minor >= 0),
  currency     text        NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  created_at   timestamptz NOT NULL DEFAULT NOW(),
  updated_at   timestamptz NOT NULL DEFAULT NOW(),
  -- A SKU identifies a product WITHIN a storefront, never globally.
  UNIQUE (project, sku)
);

CREATE INDEX IF NOT EXISTS products_project_idx ON products (project);
CREATE INDEX IF NOT EXISTS products_project_status_idx ON products (project, status);

-- ── Inventory ──────────────────────────────────────────────────────────────
-- One row per (project, sku, location). Separate from `products` because stock
-- is per LOCATION and a product is not: a single product has a level in every
-- warehouse that holds it, and the operator adjusts one of them.
CREATE TABLE IF NOT EXISTS inventory_levels (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project       text        NOT NULL,
  sku           text        NOT NULL,
  location      text        NOT NULL DEFAULT 'default',
  -- Stock is a count of physical things. It cannot be negative, and the CHECK
  -- is the last line of defence behind lib/commerce.ts's own refusal: an
  -- adjustment that would drive it below zero is a mistake at the moment it is
  -- made, not a state to be reconciled later.
  on_hand       integer     NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  -- The level at or below which this SKU needs reordering. 0 means "never warn".
  reorder_point integer     NOT NULL DEFAULT 0 CHECK (reorder_point >= 0),
  updated_at    timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (project, sku, location)
);

CREATE INDEX IF NOT EXISTS inventory_levels_project_idx ON inventory_levels (project);

-- ── Orders ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project           text        NOT NULL,
  -- What the customer and the operator both call it. Unique per storefront.
  order_number      text        NOT NULL,
  placed_at         timestamptz NOT NULL DEFAULT NOW(),
  customer_email    text,
  currency          text        NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  total_minor       bigint      NOT NULL CHECK (total_minor >= 0),
  -- The state an operator MOVES. The transitions between these values are not
  -- expressible as a CHECK (a CHECK sees one row, not the change), so the state
  -- machine lives in lib/commerce.ts `canFulfilmentTransition()` and is applied
  -- on every write. The CHECK here bounds the vocabulary; the machine bounds
  -- the moves.
  fulfilment_status text        NOT NULL DEFAULT 'unfulfilled'
                      CHECK (fulfilment_status IN
                        ('unfulfilled', 'partially_fulfilled', 'fulfilled', 'cancelled')),
  created_at        timestamptz NOT NULL DEFAULT NOW(),
  updated_at        timestamptz NOT NULL DEFAULT NOW(),
  UNIQUE (project, order_number)
);

CREATE INDEX IF NOT EXISTS orders_project_idx ON orders (project);
-- The one query the Orders card runs: "which orders in this project are still
-- waiting to ship".
CREATE INDEX IF NOT EXISTS orders_project_fulfilment_idx ON orders (project, fulfilment_status);

-- ── Order line items ───────────────────────────────────────────────────────
-- `sku` and `title` are COPIED onto the line, not joined from `products`, and
-- that duplication is deliberate: a line item records what was sold at the
-- price it sold for. Re-pricing a product must never retroactively change what
-- a past order says it charged.
CREATE TABLE IF NOT EXISTS order_line_items (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid    NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  sku              text    NOT NULL,
  title            text    NOT NULL,
  quantity         integer NOT NULL CHECK (quantity > 0),
  unit_price_minor bigint  NOT NULL CHECK (unit_price_minor >= 0),
  currency         text    NOT NULL CHECK (currency ~ '^[A-Z]{3}$')
);

CREATE INDEX IF NOT EXISTS order_line_items_order_idx ON order_line_items (order_id);

-- ── What the operator did ──────────────────────────────────────────────────
-- Append-only. Every accepted commerce ACTION writes exactly one row; every
-- refused one writes none. This is the difference between a console and a
-- dashboard being auditable: "stock went from 12 to 4" with no record of who,
-- when or why is the same as no record at all.
--
-- from_value/to_value are TEXT rather than typed columns because one table
-- records changes to a stock count and to a fulfilment state. They are a
-- HUMAN-READABLE record of a change, never something the app parses back into
-- a decision — the authoritative value always lives on the object's own row.
CREATE TABLE IF NOT EXISTS commerce_actions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project     text        NOT NULL,
  -- 'inventory.adjust', 'order.fulfilment', 'product.create', 'product.update'
  action      text        NOT NULL,
  object_type text        NOT NULL CHECK (object_type IN ('product', 'inventory', 'order')),
  -- The SKU or order number the action was taken on — what the operator would
  -- type to find it again.
  object_ref  text        NOT NULL,
  from_value  text,
  to_value    text        NOT NULL,
  reason      text,
  actor       text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS commerce_actions_project_idx ON commerce_actions (project);
CREATE INDEX IF NOT EXISTS commerce_actions_object_idx ON commerce_actions (project, object_ref);

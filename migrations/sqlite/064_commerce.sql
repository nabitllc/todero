-- 064 (sqlite): commerce objects — products, inventory levels, orders, order
--               line items, and the append-only record of operator actions.
--
-- This is the SQLite dialect of migrations/064_commerce.sql. Read that file for
-- the decision on how money is stored and why, for what this piece deliberately
-- is NOT (no Shopify, no outbound call, no seed data), and for the project-scope
-- reasoning. This header covers only what DIFFERS.
--
-- MONEY, SHORT FORM — the long form is in the Postgres copy
--   Every amount is an INTEGER count of the minor unit of that row's own
--   currency (19.99 USD -> 1999; 1500 JPY -> 1500), and every table holding an
--   amount also holds the currency it is an amount OF.
--
--   This host is the REASON the choice could not be NUMERIC. SQLite has no
--   exact decimal type: a column declared NUMERIC or DECIMAL takes NUMERIC
--   affinity, and a value with a fractional part is then stored as an 8-byte
--   IEEE float. So `NUMERIC(12,2)` would be exact on Postgres and lossy here,
--   and every test run against Postgres would pass while the SQLite host — the
--   one a fresh clone actually gets (lib/db.ts) — quietly rounded. INTEGER is
--   stored bit-identically by both.
--
-- DIALECT NOTES
--   * `uuid ... DEFAULT gen_random_uuid()` has no SQLite equivalent. The id
--     expression below is the same randomblob() v4 generator migrations/sqlite
--     already uses (see sqlite/062_agent_memory_kv.sql), so ids look the same
--     on both hosts.
--   * `timestamptz DEFAULT NOW()` becomes TEXT with the ISO-8601 strftime the
--     rest of migrations/sqlite uses, so both hosts hand JavaScript a string
--     `new Date()` parses.
--   * Postgres' `currency ~ '^[A-Z]{3}$'` regex CHECK has no SQLite operator.
--     The equivalent here is GLOB, which is case-sensitive (unlike LIKE) and so
--     genuinely enforces uppercase: `currency GLOB '[A-Z][A-Z][A-Z]'`. The real
--     gate is lib/commerce.ts, which refuses any currency whose minor-unit
--     exponent it does not know — a well-formed three-letter code it has never
--     heard of is still refused there. This CHECK is the floor, not the fence.
--   * No `BIGINT` distinction: SQLite INTEGER is up to 8 bytes already, which
--     is the same range the Postgres copy asks for with `bigint`.
--
-- IDEMPOTENCE
--   Every statement is CREATE ... IF NOT EXISTS, and the runner records what it
--   applied in `schema_migrations`. A second `npm run db:migrate` is a no-op.
--
-- NO DATA. There is not one INSERT in this file, by design — see the Postgres
-- copy. An empty catalogue is Limiglow's true state.

-- ── Catalogue ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id          TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  project     TEXT    NOT NULL,
  sku         TEXT    NOT NULL,
  title       TEXT    NOT NULL,
  -- draft: not for sale yet. active: sellable. archived: withdrawn but kept,
  -- because an archived product still appears on historical order line items.
  status      TEXT    NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'active', 'archived')),
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
  currency    TEXT    NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  -- A SKU identifies a product WITHIN a storefront, never globally.
  UNIQUE (project, sku)
);

CREATE INDEX IF NOT EXISTS products_project_idx ON products (project);
CREATE INDEX IF NOT EXISTS products_project_status_idx ON products (project, status);

-- ── Inventory ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventory_levels (
  id            TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  project       TEXT    NOT NULL,
  sku           TEXT    NOT NULL,
  location      TEXT    NOT NULL DEFAULT 'default',
  -- Stock is a count of physical things and cannot be negative. This CHECK is
  -- the last line of defence behind lib/commerce.ts's own refusal.
  on_hand       INTEGER NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  -- The level at or below which this SKU needs reordering. 0 means "never warn".
  reorder_point INTEGER NOT NULL DEFAULT 0 CHECK (reorder_point >= 0),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (project, sku, location)
);

CREATE INDEX IF NOT EXISTS inventory_levels_project_idx ON inventory_levels (project);

-- ── Orders ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS orders (
  id                TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  project           TEXT    NOT NULL,
  order_number      TEXT    NOT NULL,
  placed_at         TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  customer_email    TEXT,
  currency          TEXT    NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]'),
  total_minor       INTEGER NOT NULL CHECK (total_minor >= 0),
  -- The state an operator MOVES. Which moves are legal is not expressible as a
  -- CHECK (a CHECK sees one row, not the change): the state machine lives in
  -- lib/commerce.ts `canFulfilmentTransition()`. This CHECK bounds the
  -- vocabulary; the machine bounds the moves.
  fulfilment_status TEXT    NOT NULL DEFAULT 'unfulfilled'
                      CHECK (fulfilment_status IN
                        ('unfulfilled', 'partially_fulfilled', 'fulfilled', 'cancelled')),
  created_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at        TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (project, order_number)
);

CREATE INDEX IF NOT EXISTS orders_project_idx ON orders (project);
CREATE INDEX IF NOT EXISTS orders_project_fulfilment_idx ON orders (project, fulfilment_status);

-- ── Order line items ───────────────────────────────────────────────────────
-- `sku` and `title` are COPIED onto the line rather than joined from
-- `products`: a line records what was sold at the price it sold for, and
-- re-pricing a product must never retroactively change a past order.
CREATE TABLE IF NOT EXISTS order_line_items (
  id               TEXT    PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  order_id         TEXT    NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  sku              TEXT    NOT NULL,
  title            TEXT    NOT NULL,
  quantity         INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor >= 0),
  currency         TEXT    NOT NULL CHECK (currency GLOB '[A-Z][A-Z][A-Z]')
);

CREATE INDEX IF NOT EXISTS order_line_items_order_idx ON order_line_items (order_id);

-- ── What the operator did ──────────────────────────────────────────────────
-- Append-only. Every accepted action writes exactly one row; every refused one
-- writes none. "Stock went from 12 to 4" with no record of who, when or why is
-- the same as no record at all.
CREATE TABLE IF NOT EXISTS commerce_actions (
  id          TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' || substr(hex(randomblob(2)),2) || '-' || substr('89ab', abs(random()) % 4 + 1, 1) || substr(hex(randomblob(2)),2) || '-' || hex(randomblob(6)))),
  project     TEXT NOT NULL,
  -- 'inventory.adjust', 'order.fulfilment', 'product.create', 'product.update'
  action      TEXT NOT NULL,
  object_type TEXT NOT NULL CHECK (object_type IN ('product', 'inventory', 'order')),
  object_ref  TEXT NOT NULL,
  from_value  TEXT,
  to_value    TEXT NOT NULL,
  reason      TEXT,
  actor       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS commerce_actions_project_idx ON commerce_actions (project);
CREATE INDEX IF NOT EXISTS commerce_actions_object_idx ON commerce_actions (project, object_ref);

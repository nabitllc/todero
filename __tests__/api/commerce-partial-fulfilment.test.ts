/**
 * Partial fulfilment — the object, its refusals, and the double-ship it prevents.
 *
 * WHAT THIS FILE IS FOR
 *   `orders.fulfilment_status` has been able to say 'partially_fulfilled' since
 *   migration 064. Nothing could say WHAT was partially fulfilled, because
 *   `order_line_items` recorded how many units were ORDERED and nothing about
 *   how many had SHIPPED. Migration 074 adds `fulfilled_quantity`; this file is
 *   the permanent gate on the three things that are easy to break about it:
 *
 *     1. The refusals carry REAL NUMBERS (ordered / already fulfilled /
 *        remaining), not the word "invalid".
 *     2. Marking an order fulfilled ships what is OUTSTANDING, never what was
 *        ORDERED. Getting this wrong double-ships every unit already sent —
 *        the single most damaging way to add partial fulfilment to a codebase
 *        whose fulfilment path used to decrement `line.quantity` flat.
 *     3. Migration 074 applies, and its cross-column CHECK actually FIRES, on
 *        BOTH dialects. A CHECK that is accepted and then ignored reads exactly
 *        like protection and is not — so the Postgres half is proven here
 *        against a real Postgres (PGlite, in-process), and the SQLite half is
 *        recorded in migrations/sqlite/074's own header.
 *
 * The route tests below drive the REAL handler
 * (`app/api/commerce/orders/route.ts`), not a re-implementation of it, against
 * an in-memory fake of the four tables it touches. The fake has genuine
 * compare-and-swap semantics — an UPDATE only mutates rows still matching every
 * WHERE clause, including the `fulfilled_quantity` / `on_hand` equality the
 * route pins — and every read and write is a real event-loop turn apart, so
 * concurrently-invoked handlers really do interleave.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { NextRequest } from 'next/server'
import { PGlite } from '@electric-sql/pglite'
import {
  deriveFulfilmentStatus,
  lineRemaining,
  planLineFulfilments,
  validateLineFulfilments,
  type OrderLineState,
} from '@/lib/commerce'

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'migrations')

// ─── The fake database ──────────────────────────────────────────────────────

type Row = Record<string, unknown>
const tables: Record<string, Row[]> = {}

/** A real turn of the event loop between read and write, so racing handlers
 *  genuinely interleave rather than running to completion one at a time. */
const turn = <T>(v: T) => new Promise<T>(r => setImmediate(() => r(v)))

let nextId = 1

function makeBuilder(name: string) {
  const wheres: Array<[string, unknown]> = []
  let verb: 'select' | 'update' | 'insert' = 'select'
  let patch: Row = {}
  let inserted: Row[] = []
  let wantsReturn = false
  let limit: number | null = null

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {
    eq(col: string, val: unknown) {
      wheres.push([col, val])
      return b
    },
    update(values: Row) {
      verb = 'update'
      patch = values
      return b
    },
    insert(values: Row | Row[]) {
      verb = 'insert'
      inserted = Array.isArray(values) ? values : [values]
      return b
    },
    select() {
      if (verb !== 'select') wantsReturn = true
      return b
    },
    limit(n: number) {
      limit = n
      return b
    },
    order() {
      return b
    },
    maybeSingle() {
      return b.then((r: { data: Row[] }) => ({ ...r, data: (r.data ?? [])[0] ?? null }))
    },
    then(resolve: (v: { data: Row[] | Row | null; error: unknown }) => unknown) {
      return turn(null).then(() => {
        const rows = (tables[name] ??= [])
        const matches = rows.filter(row => wheres.every(([c, v]) => row[c] === v))
        if (verb === 'select') {
          return resolve({ data: limit === null ? matches : matches.slice(0, limit), error: null })
        }
        if (verb === 'insert') {
          const added = inserted.map(v => ({ id: `gen-${nextId++}`, ...v }))
          rows.push(...added)
          return resolve({ data: wantsReturn ? added : null, error: null })
        }
        // update — compare-and-swap: only rows still matching every WHERE move.
        for (const row of matches) Object.assign(row, patch)
        return resolve({ data: wantsReturn ? matches : null, error: null })
      })
    },
  }
  return b
}

jest.mock('@/lib/db', () => {
  const actual = jest.requireActual('@/lib/db')
  return {
    ...actual,
    db: () => ({
      provider: 'test',
      missingEnv: () => [],
      from: (t: string) => makeBuilder(t),
      rpc: () => Promise.resolve({ data: null, error: null }),
    }),
  }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const route = require('@/app/api/commerce/orders/route') as typeof import('@/app/api/commerce/orders/route')

function patchRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/commerce/orders', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-mc-project': 'Limiglow', 'x-agent-role': 'member' },
    body: JSON.stringify(body),
  })
}

/** One order, one SKU, seeded into the fake tables. */
function seed(opts: { quantity: number; fulfilled: number; onHand: number; status?: string }) {
  tables.orders = [
    {
      id: 'order-1',
      project: 'Limiglow',
      order_number: 'PF-TEST-1',
      placed_at: '2026-01-01T00:00:00.000Z',
      customer_email: null,
      currency: 'USD',
      total_minor: 1000,
      fulfilment_status: opts.status ?? 'unfulfilled',
    },
  ]
  tables.order_line_items = [
    {
      id: 'line-1',
      order_id: 'order-1',
      sku: 'PF-SKU',
      title: 'Fixture',
      quantity: opts.quantity,
      fulfilled_quantity: opts.fulfilled,
      unit_price_minor: 100,
      currency: 'USD',
    },
  ]
  tables.inventory_levels = [
    { id: 'level-1', project: 'Limiglow', sku: 'PF-SKU', location: 'default', on_hand: opts.onHand, reorder_point: 0 },
  ]
  tables.commerce_actions = []
}

const line = () => tables.order_line_items[0] as unknown as OrderLineState
const stock = () => tables.inventory_levels[0].on_hand as number
const orderStatus = () => tables.orders[0].fulfilment_status as string

beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key]
  nextId = 1
})

// ─── 1. The pure layer: refusals with real numbers ──────────────────────────

describe('validateLineFulfilments — shape', () => {
  const cases: Array<[string, unknown, string]> = [
    ['not an array', { sku: 'A', quantity: 1 }, 'must be an array'],
    ['empty array', [], 'empty shipment moves nothing'],
    ['entry not an object', ['A'], 'is not an object'],
    ['unknown field', [{ sku: 'A', quantity: 1, note: 'x' }], 'unknown field "note"'],
    ['neither sku nor line_id', [{ quantity: 1 }], 'name the line with either sku or line_id'],
    ['both sku and line_id', [{ sku: 'A', line_id: 'l', quantity: 1 }], 'not both'],
    ['quantity 0', [{ sku: 'A', quantity: 0 }], 'shipping 0 units of a line changes nothing'],
    ['quantity negative', [{ sku: 'A', quantity: -3 }], 'whole number of units'],
    ['quantity fractional', [{ sku: 'A', quantity: 1.5 }], 'whole number of units'],
    ['duplicate sku', [{ sku: 'A', quantity: 1 }, { sku: 'A', quantity: 2 }], 'appears more than once'],
  ]
  it.each(cases)('refuses %s', (_label, input, fragment) => {
    const v = validateLineFulfilments(input)
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.why).toContain(fragment)
  })

  it('accepts a well-formed request addressed either way', () => {
    const v = validateLineFulfilments([{ sku: 'A', quantity: 2 }, { line_id: 'l-9', quantity: 1 }])
    expect(v.ok).toBe(true)
    if (v.ok) {
      expect(v.value).toEqual([
        { sku: 'A', line_id: null, quantity: 2 },
        { sku: null, line_id: 'l-9', quantity: 1 },
      ])
    }
  })
})

describe('planLineFulfilments — refusals name the actual numbers', () => {
  const lines: OrderLineState[] = [
    { id: 'l-a', sku: 'A', quantity: 10, fulfilled_quantity: 7 },
    { id: 'l-b', sku: 'B', quantity: 4, fulfilled_quantity: 4 },
  ]

  it('over-fulfilment says ordered, already fulfilled, remaining, and the ask', () => {
    const v = planLineFulfilments(lines, [{ sku: 'A', line_id: null, quantity: 5 }])
    expect(v.ok).toBe(false)
    if (!v.ok) {
      // Every number an operator needs in order to know what to type next.
      expect(v.why).toContain('10 ordered')
      expect(v.why).toContain('7 already')
      expect(v.why).toContain('3 remain')
      expect(v.why).toContain('ship 5')
      expect(v.why).toContain('Ship at most 3')
    }
  })

  it('a line with nothing left is refused as such, not as over-fulfilment', () => {
    const v = planLineFulfilments(lines, [{ sku: 'B', line_id: null, quantity: 1 }])
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.why).toContain('already fulfilled in full')
  })

  it('an sku the order does not carry is refused, listing the ones it does', () => {
    const v = planLineFulfilments(lines, [{ sku: 'ZZZ', line_id: null, quantity: 1 }])
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.why).toContain('It carries: A, B')
  })

  it('an ambiguous sku is refused with the line ids, not silently applied to one', () => {
    // Two lines, same SKU — a real order shape (`order_line_items` has no
    // unique constraint on (order_id, sku), deliberately).
    const dupes: OrderLineState[] = [
      { id: 'l-1', sku: 'A', quantity: 3, fulfilled_quantity: 0 },
      { id: 'l-2', sku: 'A', quantity: 5, fulfilled_quantity: 1 },
    ]
    const v = planLineFulfilments(dupes, [{ sku: 'A', line_id: null, quantity: 1 }])
    expect(v.ok).toBe(false)
    if (!v.ok) {
      expect(v.why).toContain('l-1')
      expect(v.why).toContain('l-2')
      expect(v.why).toContain('line_id')
    }
    // …and addressing one of them by line_id works.
    const byId = planLineFulfilments(dupes, [{ sku: null, line_id: 'l-2', quantity: 4 }])
    expect(byId.ok).toBe(true)
    if (byId.ok) expect(byId.value[0].next_fulfilled).toBe(5)
  })

  it('one line named twice — once by sku, once by line_id — is refused', () => {
    const v = planLineFulfilments(lines, [
      { sku: 'A', line_id: null, quantity: 1 },
      { sku: null, line_id: 'l-a', quantity: 1 },
    ])
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.why).toContain('named twice')
  })

  it('an order with no lines is refused rather than planned as a no-op', () => {
    const v = planLineFulfilments([], [{ sku: 'A', line_id: null, quantity: 1 }])
    expect(v.ok).toBe(false)
    if (!v.ok) expect(v.why).toContain('no line items')
  })
})

describe('deriveFulfilmentStatus', () => {
  it('nothing shipped -> unfulfilled', () => {
    expect(deriveFulfilmentStatus([{ quantity: 3, fulfilled_quantity: 0 }])).toBe('unfulfilled')
  })
  it('some shipped -> partially_fulfilled', () => {
    expect(
      deriveFulfilmentStatus([
        { quantity: 3, fulfilled_quantity: 3 },
        { quantity: 2, fulfilled_quantity: 0 },
      ]),
    ).toBe('partially_fulfilled')
  })
  it('every line complete -> fulfilled', () => {
    expect(
      deriveFulfilmentStatus([
        { quantity: 3, fulfilled_quantity: 3 },
        { quantity: 2, fulfilled_quantity: 2 },
      ]),
    ).toBe('fulfilled')
  })
  it('NO LINES is unfulfilled, not the vacuously-true "fulfilled"', () => {
    // `[].every(...)` is `true`, so the obvious implementation calls an order
    // nothing is known about FULLY SHIPPED — the most confident possible
    // answer about the least information. This assertion is the whole reason
    // that branch exists.
    expect(deriveFulfilmentStatus([])).toBe('unfulfilled')
  })
  it('never returns cancelled — no arrangement of quantities can express it', () => {
    const all: string[] = []
    for (const q of [0, 1, 2]) for (const f of [0, 1, 2]) {
      if (f <= q) all.push(deriveFulfilmentStatus([{ quantity: Math.max(q, 1), fulfilled_quantity: f }]))
    }
    expect(all).not.toContain('cancelled')
  })
})

describe('lineRemaining', () => {
  it('never goes negative even if the data somehow did', () => {
    expect(lineRemaining({ quantity: 3, fulfilled_quantity: 9 })).toBe(0)
    expect(lineRemaining({ quantity: 9, fulfilled_quantity: 3 })).toBe(6)
  })
})

// ─── 2. The route: outstanding, never ordered ───────────────────────────────

describe('PATCH /api/commerce/orders — partial fulfilment against the real handler', () => {
  it('ships exactly the requested units and derives partially_fulfilled', async () => {
    seed({ quantity: 10, fulfilled: 0, onHand: 100 })
    const res = await route.PATCH(patchRequest({
      order_number: 'PF-TEST-1',
      line_fulfilments: [{ sku: 'PF-SKU', quantity: 4 }],
    }))
    expect(res.status).toBe(200)
    expect(line().fulfilled_quantity).toBe(4)
    expect(stock()).toBe(96)
    expect(orderStatus()).toBe('partially_fulfilled')
  })

  it('THE DOUBLE-SHIP GATE: marking fulfilled moves the OUTSTANDING units, not the ordered ones', async () => {
    // 4 of 10 already shipped. The pre-074 handler decremented `line.quantity`
    // flat, so this same call would have moved TEN more units and left stock at
    // 86 — every already-shipped unit charged to the shelf twice.
    seed({ quantity: 10, fulfilled: 4, onHand: 96, status: 'partially_fulfilled' })
    const res = await route.PATCH(patchRequest({
      order_number: 'PF-TEST-1',
      fulfilment_status: 'fulfilled',
    }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { lines: { quantity: number; on_hand: number }[] }
    expect(body.lines[0].quantity).toBe(6)
    expect(stock()).toBe(90)
    expect(line().fulfilled_quantity).toBe(10)
    expect(orderStatus()).toBe('fulfilled')
  })

  it('refuses partially_fulfilled asserted with no line quantities', async () => {
    seed({ quantity: 10, fulfilled: 0, onHand: 100 })
    const res = await route.PATCH(patchRequest({
      order_number: 'PF-TEST-1',
      fulfilment_status: 'partially_fulfilled',
    }))
    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: string; message: string }
    expect(body.error).toBe('needs_line_fulfilments')
    expect(body.message).toContain('line_fulfilments')
    // Nothing moved: a refused request writes nothing at all.
    expect(stock()).toBe(100)
    expect(line().fulfilled_quantity).toBe(0)
    expect(orderStatus()).toBe('unfulfilled')
  })

  it('refuses a stated status that disagrees with the quantities, and writes nothing', async () => {
    seed({ quantity: 10, fulfilled: 0, onHand: 100 })
    const res = await route.PATCH(patchRequest({
      order_number: 'PF-TEST-1',
      fulfilment_status: 'fulfilled',
      line_fulfilments: [{ sku: 'PF-SKU', quantity: 3 }],
    }))
    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: string; message: string }
    expect(body.error).toBe('status_disagrees_with_lines')
    expect(body.message).toContain('partially_fulfilled')
    expect(stock()).toBe(100)
    expect(line().fulfilled_quantity).toBe(0)
  })

  it('refuses over-fulfilment with the real numbers, and writes nothing', async () => {
    seed({ quantity: 10, fulfilled: 7, onHand: 93, status: 'partially_fulfilled' })
    const res = await route.PATCH(patchRequest({
      order_number: 'PF-TEST-1',
      line_fulfilments: [{ sku: 'PF-SKU', quantity: 5 }],
    }))
    expect(res.status).toBe(422)
    const body = (await res.json()) as { message: string }
    expect(body.message).toContain('3 remain')
    expect(body.message).toContain('Ship at most 3')
    expect(stock()).toBe(93)
    expect(line().fulfilled_quantity).toBe(7)
  })

  it('refuses shipping against a fulfilled order — terminal, in the state machine words', async () => {
    seed({ quantity: 10, fulfilled: 10, onHand: 90, status: 'fulfilled' })
    const res = await route.PATCH(patchRequest({
      order_number: 'PF-TEST-1',
      line_fulfilments: [{ sku: 'PF-SKU', quantity: 1 }],
    }))
    expect(res.status).toBe(409)
    expect(stock()).toBe(90)
  })

  it('refuses shipping against a cancelled order', async () => {
    seed({ quantity: 10, fulfilled: 0, onHand: 100, status: 'cancelled' })
    const res = await route.PATCH(patchRequest({
      order_number: 'PF-TEST-1',
      line_fulfilments: [{ sku: 'PF-SKU', quantity: 1 }],
    }))
    expect(res.status).toBe(409)
    expect(stock()).toBe(100)
    expect(line().fulfilled_quantity).toBe(0)
  })

  it('refuses a PATCH that says neither a status nor any quantities', async () => {
    seed({ quantity: 10, fulfilled: 0, onHand: 100 })
    const res = await route.PATCH(patchRequest({ order_number: 'PF-TEST-1' }))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('nothing_to_do')
  })

  it('cancelling still works, moves no stock, and says why', async () => {
    seed({ quantity: 10, fulfilled: 3, onHand: 97, status: 'partially_fulfilled' })
    const res = await route.PATCH(patchRequest({
      order_number: 'PF-TEST-1',
      fulfilment_status: 'cancelled',
    }))
    expect(res.status).toBe(200)
    const body = (await res.json()) as { stock_note: string | null }
    expect(orderStatus()).toBe('cancelled')
    expect(stock()).toBe(97)
    expect(body.stock_note).toContain('does not return units to the shelf')
  })

  it('every unit of a partly-shipped line is accounted for across two shipments', async () => {
    seed({ quantity: 9, fulfilled: 0, onHand: 50 })
    await route.PATCH(patchRequest({ order_number: 'PF-TEST-1', line_fulfilments: [{ sku: 'PF-SKU', quantity: 2 }] }))
    await route.PATCH(patchRequest({ order_number: 'PF-TEST-1', line_fulfilments: [{ sku: 'PF-SKU', quantity: 3 }] }))
    const res = await route.PATCH(patchRequest({ order_number: 'PF-TEST-1', fulfilment_status: 'fulfilled' }))
    expect(res.status).toBe(200)
    expect(line().fulfilled_quantity).toBe(9)
    // 2 + 3 + 4 outstanding = 9 units off the shelf, exactly once each.
    expect(stock()).toBe(41)
    expect(orderStatus()).toBe('fulfilled')
  })
})

describe('PATCH /api/commerce/orders — concurrent shipments on one line', () => {
  it('N concurrent shipments of the same line never over-ship it, and stock matches exactly', async () => {
    // The fake table's scheduling is deliberately worse than a real database's
    // jitter (every retry round has every pending caller read the identical
    // stale value before any of them writes), so CONCURRENCY is kept under the
    // route's 8-attempt budget rather than asserting a retry ceiling this
    // harness itself inflates.
    const CONCURRENCY = 6
    seed({ quantity: 20, fulfilled: 0, onHand: 200 })

    const results = await Promise.all(
      Array.from({ length: CONCURRENCY }, () =>
        route.PATCH(patchRequest({ order_number: 'PF-TEST-1', line_fulfilments: [{ sku: 'PF-SKU', quantity: 1 }] })),
      ),
    )
    const statuses = results.map(r => r.status)
    // Every request is accounted for: it applied, or it was REFUSED with a
    // reason. None may report success while doing nothing.
    for (const s of statuses) expect([200, 409, 422]).toContain(s)

    const succeeded = statuses.filter(s => s === 200).length
    expect(line().fulfilled_quantity).toBe(succeeded)
    expect(stock()).toBe(200 - succeeded)
    expect(succeeded).toBe(CONCURRENCY)
  })

  it('concurrent "mark fulfilled" on one order ships its units exactly once', async () => {
    // The double-ship the order-level CAS was added for, now re-proved at the
    // line level — which is the only place it can be proved for a PARTIAL
    // shipment, since two concurrent partial ships both read and both write
    // `partially_fulfilled` and the order-level CAS matches for both.
    seed({ quantity: 7, fulfilled: 0, onHand: 100 })
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        route.PATCH(patchRequest({ order_number: 'PF-TEST-1', fulfilment_status: 'fulfilled' })),
      ),
    )
    const ok = results.filter(r => r.status === 200).length
    expect(ok).toBe(1)
    expect(line().fulfilled_quantity).toBe(7)
    expect(stock()).toBe(93)
    expect(orderStatus()).toBe('fulfilled')
  })
})

// ─── 3. Migration 074 on the OTHER dialect ─────────────────────────────────

describe('migration 074 on real Postgres', () => {
  it('applies, and its cross-column CHECK actually refuses over-fulfilment', async () => {
    const pg = await PGlite.create()
    // 064 creates the tables 074 alters. Applying only these two keeps the test
    // about THIS migration; lib/__tests__/migrations-from-zero.test.ts already
    // proves the whole directory applies in order from an empty database.
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, '064_commerce.sql'), 'utf8'))
    await pg.exec(readFileSync(join(MIGRATIONS_DIR, '074_order_line_fulfilled_quantity.sql'), 'utf8'))

    const { rows: cols } = await pg.query<{ column_name: string; column_default: string; is_nullable: string }>(
      `SELECT column_name, column_default, is_nullable FROM information_schema.columns
        WHERE table_name = 'order_line_items' AND column_name = 'fulfilled_quantity'`,
    )
    expect(cols).toHaveLength(1)
    expect(cols[0].is_nullable).toBe('NO')
    expect(cols[0].column_default).toContain('0')

    await pg.exec(`
      INSERT INTO orders (id, project, order_number, currency, total_minor)
        VALUES ('11111111-1111-4111-8111-111111111111', 'T', 'T-1', 'USD', 500);
      INSERT INTO order_line_items (order_id, sku, title, quantity, unit_price_minor, currency)
        VALUES ('11111111-1111-4111-8111-111111111111', 'S', 'T', 5, 100, 'USD');
    `)

    // Default is 0 for a row inserted without naming the column — the backfill
    // this migration deliberately does not write.
    const { rows: seeded } = await pg.query<{ fulfilled_quantity: number }>(
      `SELECT fulfilled_quantity FROM order_line_items`,
    )
    expect(seeded[0].fulfilled_quantity).toBe(0)

    // Exactly the ordered amount is allowed …
    await pg.exec(`UPDATE order_line_items SET fulfilled_quantity = 5`)

    // … one more is REFUSED by the database itself, not only by the validator.
    await expect(pg.exec(`UPDATE order_line_items SET fulfilled_quantity = 6`)).rejects.toThrow(
      /check constraint/i,
    )
    await expect(pg.exec(`UPDATE order_line_items SET fulfilled_quantity = -1`)).rejects.toThrow(
      /check constraint/i,
    )

    await pg.close()
  }, 60_000)

  it('both dialect files exist and agree on the column they add', () => {
    const pgSql = readFileSync(join(MIGRATIONS_DIR, '074_order_line_fulfilled_quantity.sql'), 'utf8')
    const liteSql = readFileSync(join(MIGRATIONS_DIR, 'sqlite', '074_order_line_fulfilled_quantity.sql'), 'utf8')
    for (const sql of [pgSql, liteSql]) {
      expect(sql).toMatch(/ALTER TABLE\s+order_line_items/i)
      expect(sql).toMatch(/fulfilled_quantity/)
      expect(sql).toMatch(/DEFAULT 0/i)
      expect(sql).toMatch(/fulfilled_quantity\s*<=\s*quantity/i)
      // 064's rule, inherited: these files ship schema, never data.
      expect(sql).not.toMatch(/^\s*INSERT/im)
    }
    // SQLite has no ADD COLUMN IF NOT EXISTS and rejects it at parse time; the
    // runner's schema_migrations ledger is what makes the bare form run once.
    // Checked against the STATEMENTS, not the file: both headers discuss the
    // phrase in prose, and an assertion that reads the prose would pass or fail
    // on how the comment is worded rather than on what the database is asked.
    const statements = (sql: string) =>
      sql.split(/\r?\n/).filter(l => !l.trim().startsWith('--')).join('\n')
    expect(statements(liteSql)).not.toMatch(/IF NOT EXISTS/i)
    expect(statements(pgSql)).toMatch(/IF NOT EXISTS/i)
  })
})

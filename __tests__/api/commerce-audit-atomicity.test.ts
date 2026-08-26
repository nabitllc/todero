/**
 * Both PATCH writers append a `commerce_actions` audit row alongside a real
 * stock/order-state change. Neither write is inside a database transaction
 * (this repo's db seam — lib/db.ts — has no cross-table transaction on
 * either dialect), so a failed audit insert AFTER the real change already
 * landed is a genuine, reachable failure mode, not a theoretical one — a
 * critic forced it once by making a `commerce_actions` insert violate its
 * `object_type` CHECK and got a 200 with a moved `on_hand` and an unchanged
 * audit total.
 *
 * This suite proves the fix for that class of bug in both places it now
 * exists, by forcing the SAME failure the critic did (an audit insert that
 * returns an error) and checking the response and the final state:
 *
 *   1. PATCH /api/commerce/inventory — the audit insert fails AFTER a
 *      successful compare-and-swap stock write. The handler must revert the
 *      stock (a compensating CAS write back to the original value), return
 *      500, and leave `on_hand` exactly where it started.
 *   2. PATCH /api/commerce/orders — the `order.fulfilment` audit insert
 *      fails AFTER the order's status CAS landed. Since migration 074 the
 *      status is written LAST (lines are claimed and stock moves first), so
 *      the honest outcome here is: the units DID ship and their movement IS
 *      audited, and only the status change is reverted. The response must say
 *      that, not imply nothing happened.
 *   3. PATCH /api/commerce/orders — the per-line `inventory.adjust` audit
 *      insert fails AFTER that line's stock CAS write landed. The handler must
 *      revert BOTH the stock write and the line's `fulfilled_quantity` claim,
 *      leave the order's status untouched, and return 500.
 *
 * Points 2 and 3 both changed when the write order was inverted for partial
 * fulfilment; each carries a comment at its own `describe` saying what it used
 * to assert and why the new expectation is the honest one rather than a
 * relaxed one.
 */

import { NextRequest } from 'next/server'

interface FakeLevel { id: string; project: string; sku: string; location: string; on_hand: number; updated_at?: string }
interface FakeOrder { id: string; project: string; order_number: string; fulfilment_status: string; currency: string; total_minor: number; placed_at: string; customer_email: string | null; updated_at?: string }
interface FakeLine { id: string; order_id: string; sku: string; quantity: number; fulfilled_quantity: number }

let levels: FakeLevel[]
let orders: FakeOrder[]
let lines: FakeLine[]
let actionsInserted: Record<string, unknown>[]
/** Set per-test: return a DbError to fail THIS insert, or null to let it land. */
let auditOutcome: (row: Record<string, unknown>) => { message: string } | null

function microtask<T>(value: T): Promise<T> {
  return new Promise(resolve => setImmediate(() => resolve(value)))
}

function matches(row: Record<string, unknown>, wheres: Array<[string, unknown]>): boolean {
  return wheres.every(([c, v]) => row[c] === v)
}

/**
 * Set per-test to make a stock READ or a stock WRITE fail the way a driver
 * does. Until this existed the suite could only fail AUDIT inserts, which is
 * why the two `dbQueryErrorResponse` returns in the stock loop — both of them
 * standing AFTER a line claim had landed, neither of them reverting it — were
 * invisible to every test in the repo. The commonest way to reach one of them
 * in production is not a driver fault at all: it is `CHECK (on_hand >= 0)`,
 * detonated by an ordinary oversell.
 */
let stockOutcome: (kind: 'read' | 'write') => { message: string } | null

function makeCasBuilder(table: () => Record<string, unknown>[], failable = false) {
  const wheres: Array<[string, unknown]> = []
  let verb: 'select' | 'update' = 'select'
  let patch: Record<string, unknown> = {}
  let wantsReturn = false

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    eq(col: string, val: unknown) { wheres.push([col, val]); return builder },
    update(values: Record<string, unknown>) { verb = 'update'; patch = values; return builder },
    select() { if (verb === 'update') wantsReturn = true; return builder },
    limit() { return builder },
    order() { return builder },
    maybeSingle() {
      return builder.then((r: { data: unknown[] }) => ({ ...r, data: (r.data as unknown[])[0] ?? null }))
    },
    then(resolve: (v: { data: unknown; error: null }) => unknown) {
      return microtask(null).then(() => {
        const rows = table()
        if (failable) {
          const err = stockOutcome(verb === 'select' ? 'read' : 'write')
          if (err) return resolve({ data: null, error: err as unknown as null })
        }
        const found = rows.filter(row => matches(row as Record<string, unknown>, wheres))
        if (verb === 'select') {
          // A SELECT must return a SNAPSHOT, not the live row: returning the
          // same object reference a later UPDATE mutates would make a
          // previously-read value change out from under the code that read
          // it, which no real database does and which silently hid the bug
          // this fake exists to catch.
          return resolve({ data: found.map(row => ({ ...row })), error: null })
        }
        for (const row of found) Object.assign(row, patch)
        return resolve({ data: wantsReturn ? found.map(row => ({ ...row })) : null, error: null })
      })
    },
  }
  return builder
}

function makeActionsBuilder() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    insert(row: Record<string, unknown>) {
      return {
        then(resolve: (v: { data: null; error: { message: string } | null }) => unknown) {
          return microtask(null).then(() => {
            const err = auditOutcome(row)
            if (!err) actionsInserted.push(row)
            return resolve({ data: null, error: err })
          })
        },
      }
    },
  }
  return builder
}

jest.mock('@/lib/db', () => {
  const actual = jest.requireActual('@/lib/db')
  return {
    ...actual,
    db: () => ({
      provider: 'test',
      missingEnv: () => [],
      from: (t: string) => {
        if (t === 'inventory_levels') return makeCasBuilder(() => levels as unknown as Record<string, unknown>[], true)
        if (t === 'orders') return makeCasBuilder(() => orders as unknown as Record<string, unknown>[])
        if (t === 'order_line_items') return makeCasBuilder(() => lines as unknown as Record<string, unknown>[])
        if (t === 'commerce_actions') return makeActionsBuilder()
        throw new Error(`unexpected table in test: ${t}`)
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
    }),
  }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const inventoryRoute = require('@/app/api/commerce/inventory/route') as typeof import('@/app/api/commerce/inventory/route')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ordersRoute = require('@/app/api/commerce/orders/route') as typeof import('@/app/api/commerce/orders/route')

function inventoryPatch(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/commerce/inventory', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-mc-project': 'Limiglow', 'x-agent-role': 'member' },
    body: JSON.stringify(body),
  })
}

function ordersPatch(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/commerce/orders', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-mc-project': 'Limiglow', 'x-agent-role': 'member' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  levels = []
  orders = []
  lines = []
  actionsInserted = []
  auditOutcome = () => null
  stockOutcome = () => null
})

describe('PATCH /api/commerce/inventory — audit insert failure after a successful CAS write', () => {
  it('reverts the stock write and answers 500, leaving on_hand exactly where it started', async () => {
    levels = [{ id: 'lvl-1', project: 'Limiglow', sku: 'ATOM-1', location: 'default', on_hand: 50 }]
    auditOutcome = () => ({ message: 'CHECK constraint failed: object_type' })

    const res = await inventoryRoute.PATCH(inventoryPatch({ sku: 'ATOM-1', delta: -7, reason: 'test' }))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toBe('audit_write_failed')
    // The stock write landed (50 -> 43) and then was reverted (43 -> 50) —
    // the observable end state is "nothing changed", stated in the message.
    expect(levels[0].on_hand).toBe(50)
    expect(actionsInserted).toHaveLength(0)
  })
})

describe('PATCH /api/commerce/orders — order.fulfilment audit insert failure after the status CAS lands', () => {
  // UPDATED WITH THE WRITE ORDER, NOT WEAKENED. This test used to assert that
  // stock was "never reached", because the order's status was claimed FIRST and
  // the stock loop ran after it. Migration 074's partial-fulfilment work
  // inverted that: lines are claimed, stock moves and is audited, and the
  // order's own status is reconciled LAST from what the lines actually say.
  //
  // So the residual state this failure leaves is now DIFFERENT, and the test
  // says which: the units really did ship and their movement really is
  // audited — reverting a shipped parcel is not something a status-audit
  // failure gets to do — while the order's own status change is rolled back
  // because it could not be recorded. The response has to say that, not imply
  // a cleanliness it does not have.
  it('reverts only the status, leaves the shipped units alone, and says so', async () => {
    orders = [{
      id: 'ord-1', project: 'Limiglow', order_number: 'LG-ATOM-1', fulfilment_status: 'unfulfilled',
      currency: 'USD', total_minor: 100, placed_at: new Date().toISOString(), customer_email: null,
    }]
    lines = [{ id: 'line-1', order_id: 'ord-1', sku: 'ATOM-2', quantity: 1, fulfilled_quantity: 0 }]
    levels = [{ id: 'lvl-2', project: 'Limiglow', sku: 'ATOM-2', location: 'default', on_hand: 10 }]
    auditOutcome = row => (row.action === 'order.fulfilment' ? { message: 'CHECK constraint failed: object_type' } : null)

    const res = await ordersRoute.PATCH(ordersPatch({ order_number: 'LG-ATOM-1', fulfilment_status: 'fulfilled' }))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toBe('audit_write_failed')
    // The status change could not be recorded, so it was reverted.
    expect(orders[0].fulfilment_status).toBe('unfulfilled')
    // The unit shipped, its stock moved, and its OWN audit row landed — that
    // insert was not the one made to fail.
    expect(levels[0].on_hand).toBe(9)
    expect(lines[0].fulfilled_quantity).toBe(1)
    expect(actionsInserted.map(a => a.action)).toEqual(['inventory.adjust'])
    // The message must not claim nothing happened.
    expect(body.message).toMatch(/DID ship/i)
    // ...and the way out it offers must be a request that EXISTS. This
    // assertion used to be `/reconcile/i`, which any hand-waving sentence
    // satisfies — and the sentence that satisfied it was a fabrication: the
    // route said "re-send this PATCH with no line_fulfilments", and measured
    // against the running server every form of that request was refused
    // (422 nothing_to_do / 409 nothing_to_ship / 422 needs_line_fulfilments /
    // 422 on a zero quantity), leaving the order wrong. The next test runs the
    // exact body this message names.
    expect(body.message).toContain('"order_number":"LG-ATOM-1"')
    expect(body.message).toContain('"fulfilment_status":"fulfilled"')
  })

  // THE ANTI-FABRICATION TEST: take the remediation the 500 above prints, send
  // exactly it, and require the order to end up settled. A remediation nobody
  // ever executes is a sentence, not a path.
  it('the settle it names actually works: the same order, that exact body, 200 and settled', async () => {
    orders = [{
      id: 'ord-1', project: 'Limiglow', order_number: 'LG-ATOM-1', fulfilment_status: 'unfulfilled',
      currency: 'USD', total_minor: 100, placed_at: new Date().toISOString(), customer_email: null,
    }]
    // The state the 500 above leaves behind: the line HAS shipped, the order's
    // status was rolled back because it could not be audited.
    lines = [{ id: 'line-1', order_id: 'ord-1', sku: 'ATOM-2', quantity: 1, fulfilled_quantity: 1 }]
    levels = [{ id: 'lvl-2', project: 'Limiglow', sku: 'ATOM-2', location: 'default', on_hand: 9 }]
    auditOutcome = () => null

    const res = await ordersRoute.PATCH(ordersPatch({ order_number: 'LG-ATOM-1', fulfilment_status: 'fulfilled' }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(orders[0].fulfilment_status).toBe('fulfilled')
    // It SETTLES, it does not ship: no unit moves a second time.
    expect(levels[0].on_hand).toBe(9)
    expect(lines[0].fulfilled_quantity).toBe(1)
    expect(body.lines).toEqual([])
    expect(body.stock_moves).toEqual([])
    expect(body.status_note).toMatch(/no units moved/i)
    // And it is audited as the status move it is, not as a shipment.
    expect(actionsInserted.map(a => a.action)).toEqual(['order.fulfilment'])
    expect(String(actionsInserted[0].reason)).toMatch(/no units moved/i)
  })

  // The same settle, for the status the OTHER remediation names. `{fulfilment_
  // status: 'partially_fulfilled'}` with no line_fulfilments is still refused
  // when it would be an assertion (there is a test for that in
  // commerce-partial-fulfilment); it settles only when the lines already say it.
  it('settles a partially_fulfilled order whose lines already say so, and refuses when they do not', async () => {
    orders = [{
      id: 'ord-2', project: 'Limiglow', order_number: 'LG-ATOM-2', fulfilment_status: 'unfulfilled',
      currency: 'USD', total_minor: 100, placed_at: new Date().toISOString(), customer_email: null,
    }]
    lines = [{ id: 'line-2', order_id: 'ord-2', sku: 'ATOM-3', quantity: 4, fulfilled_quantity: 3 }]
    levels = [{ id: 'lvl-3', project: 'Limiglow', sku: 'ATOM-3', location: 'default', on_hand: 20 }]

    const res = await ordersRoute.PATCH(
      ordersPatch({ order_number: 'LG-ATOM-2', fulfilment_status: 'partially_fulfilled' }),
    )
    expect(res.status).toBe(200)
    expect(orders[0].fulfilment_status).toBe('partially_fulfilled')
    expect(levels[0].on_hand).toBe(20)
    expect(lines[0].fulfilled_quantity).toBe(3)

    // Now that the order agrees with its lines, the same request is an
    // assertion again, and is refused as one.
    const again = await ordersRoute.PATCH(
      ordersPatch({ order_number: 'LG-ATOM-2', fulfilment_status: 'partially_fulfilled' }),
    )
    expect(again.status).toBe(422)
    expect((await again.json()).error).toBe('needs_line_fulfilments')
  })
})

// ─── The oversell: the failure this suite could not see ─────────────────────
//
// This file only ever forced AUDIT inserts to fail (`auditOutcome`). It never
// forced a STOCK write to fail, and no commerce test invoked POST at all — so
// the two paths that returned `dbQueryErrorResponse` after a line claim had
// landed, without reverting it, were invisible to all 46 tests. Overselling
// reaches one of them through an ordinary CHECK constraint.
describe('PATCH /api/commerce/orders — shipping more units than the shelf holds', () => {
  it('refuses with the real numbers, and writes NOTHING at all', async () => {
    orders = [{
      id: 'ord-3', project: 'Limiglow', order_number: 'LG-OVER-1', fulfilment_status: 'unfulfilled',
      currency: 'USD', total_minor: 500, placed_at: new Date().toISOString(), customer_email: null,
    }]
    lines = [{ id: 'line-3', order_id: 'ord-3', sku: 'OVER-1', quantity: 5, fulfilled_quantity: 0 }]
    levels = [{ id: 'lvl-4', project: 'Limiglow', sku: 'OVER-1', location: 'default', on_hand: 2 }]

    const res = await ordersRoute.PATCH(
      ordersPatch({ order_number: 'LG-OVER-1', line_fulfilments: [{ sku: 'OVER-1', quantity: 5 }] }),
    )
    const body = await res.json()

    // Measured before this fix, on the running server: 500 with the driver's
    // own string `{"error":"CHECK constraint failed: on_hand >= 0"}`, the line
    // left at 5/5 fulfilled, the stock untouched, the order still unfulfilled,
    // and no audit row anywhere.
    expect(res.status).toBe(422)
    expect(body.error).toBe('insufficient_stock')
    expect(body.message).toContain('5')
    expect(body.message).toContain('2')
    expect(body.message).toContain('Ship at most 2')
    // THE CLAIM MUST NOT HAVE LANDED. This is the assertion that fails against
    // the old code.
    expect(lines[0].fulfilled_quantity).toBe(0)
    expect(levels[0].on_hand).toBe(2)
    expect(orders[0].fulfilment_status).toBe('unfulfilled')
    expect(actionsInserted).toHaveLength(0)
  })

  it('ships what the shelf CAN cover, so the refusal is about the numbers and not the SKU', async () => {
    orders = [{
      id: 'ord-4', project: 'Limiglow', order_number: 'LG-OVER-2', fulfilment_status: 'unfulfilled',
      currency: 'USD', total_minor: 500, placed_at: new Date().toISOString(), customer_email: null,
    }]
    lines = [{ id: 'line-4', order_id: 'ord-4', sku: 'OVER-2', quantity: 5, fulfilled_quantity: 0 }]
    levels = [{ id: 'lvl-5', project: 'Limiglow', sku: 'OVER-2', location: 'default', on_hand: 2 }]

    const res = await ordersRoute.PATCH(
      ordersPatch({ order_number: 'LG-OVER-2', line_fulfilments: [{ sku: 'OVER-2', quantity: 2 }] }),
    )
    expect(res.status).toBe(200)
    expect(levels[0].on_hand).toBe(0)
    expect(lines[0].fulfilled_quantity).toBe(2)
    expect(orders[0].fulfilment_status).toBe('partially_fulfilled')
    const shipped = (await res.json()).lines as { location: string | null }[]
    expect(shipped[0].location).toBe('default')
  })

  it('sums the requirement per SKU, so two lines of the same SKU cannot oversell between them', async () => {
    // Each line is individually affordable (3 and 3, with 5 on hand); together
    // they are not. Per-line checking passes both and detonates on the second.
    orders = [{
      id: 'ord-5', project: 'Limiglow', order_number: 'LG-OVER-3', fulfilment_status: 'unfulfilled',
      currency: 'USD', total_minor: 600, placed_at: new Date().toISOString(), customer_email: null,
    }]
    lines = [
      { id: 'line-5a', order_id: 'ord-5', sku: 'OVER-3', quantity: 3, fulfilled_quantity: 0 },
      { id: 'line-5b', order_id: 'ord-5', sku: 'OVER-3', quantity: 3, fulfilled_quantity: 0 },
    ]
    levels = [{ id: 'lvl-6', project: 'Limiglow', sku: 'OVER-3', location: 'default', on_hand: 5 }]

    const res = await ordersRoute.PATCH(ordersPatch({
      order_number: 'LG-OVER-3',
      line_fulfilments: [
        { line_id: 'line-5a', quantity: 3 },
        { line_id: 'line-5b', quantity: 3 },
      ],
    }))
    expect(res.status).toBe(422)
    expect((await res.json()).error).toBe('insufficient_stock')
    expect(lines.map(l => l.fulfilled_quantity)).toEqual([0, 0])
    expect(levels[0].on_hand).toBe(5)
  })

  it('a SKU on two shelves is refused rather than split, and says what each shelf holds', async () => {
    orders = [{
      id: 'ord-6', project: 'Limiglow', order_number: 'LG-LOC-1', fulfilment_status: 'unfulfilled',
      currency: 'USD', total_minor: 500, placed_at: new Date().toISOString(), customer_email: null,
    }]
    lines = [{ id: 'line-6', order_id: 'ord-6', sku: 'LOC-1', quantity: 5, fulfilled_quantity: 0 }]
    levels = [
      { id: 'lvl-7', project: 'Limiglow', sku: 'LOC-1', location: 'warehouse', on_hand: 3 },
      { id: 'lvl-8', project: 'Limiglow', sku: 'LOC-1', location: 'front', on_hand: 3 },
    ]

    const res = await ordersRoute.PATCH(
      ordersPatch({ order_number: 'LG-LOC-1', line_fulfilments: [{ sku: 'LOC-1', quantity: 5 }] }),
    )
    const body = await res.json()
    expect(res.status).toBe(422)
    expect(body.message).toContain('front: 3')
    expect(body.message).toContain('warehouse: 3')
    expect(body.message).toContain('6 in total')
    expect(levels.map(l => l.on_hand)).toEqual([3, 3])
  })

  it('gives the claim back when the stock WRITE fails after it landed', async () => {
    // THE EXACT SHAPE OF THE BIGGEST GAP, forced directly rather than through
    // the oversell that reaches it: the line claim lands, and then the stock
    // UPDATE errors. The old code returned `dbQueryErrorResponse(...)` from
    // here — the driver's raw string, no `message` field — with the claim still
    // standing, leaving the line recording units that never shipped.
    orders = [{
      id: 'ord-8', project: 'Limiglow', order_number: 'LG-STOCKFAIL-1', fulfilment_status: 'unfulfilled',
      currency: 'USD', total_minor: 500, placed_at: new Date().toISOString(), customer_email: null,
    }]
    lines = [{ id: 'line-8', order_id: 'ord-8', sku: 'SF-1', quantity: 5, fulfilled_quantity: 0 }]
    levels = [{ id: 'lvl-11', project: 'Limiglow', sku: 'SF-1', location: 'default', on_hand: 50 }]
    stockOutcome = kind => (kind === 'write' ? { message: 'database is locked' } : null)

    const res = await ordersRoute.PATCH(
      ordersPatch({ order_number: 'LG-STOCKFAIL-1', line_fulfilments: [{ sku: 'SF-1', quantity: 2 }] }),
    )
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toBe('stock_write_failed')
    // A crafted refusal, not a driver string thrown at the operator: it names
    // the order, the line, the shelf, and what the revert did.
    expect(body.message).toMatch(/was NOT shipped/i)
    expect(body.message).toContain('database is locked')
    expect(body.message).toMatch(/claim \(0 -> 2\) was reverted/i)
    // THE ASSERTION THAT FAILS AGAINST THE OLD CODE.
    expect(lines[0].fulfilled_quantity).toBe(0)
    expect(levels[0].on_hand).toBe(50)
    expect(orders[0].fulfilment_status).toBe('unfulfilled')
    expect(actionsInserted).toHaveLength(0)
  })

  it('gives the claim back when the stock READ fails after it landed', async () => {
    orders = [{
      id: 'ord-9', project: 'Limiglow', order_number: 'LG-STOCKFAIL-2', fulfilment_status: 'unfulfilled',
      currency: 'USD', total_minor: 500, placed_at: new Date().toISOString(), customer_email: null,
    }]
    lines = [{ id: 'line-9', order_id: 'ord-9', sku: 'SF-2', quantity: 5, fulfilled_quantity: 0 }]
    levels = [{ id: 'lvl-12', project: 'Limiglow', sku: 'SF-2', location: 'default', on_hand: 50 }]
    // The pre-flight read is allowed through; the one INSIDE the writer loop,
    // after the claim, is the one that fails.
    let reads = 0
    stockOutcome = kind => (kind === 'read' && ++reads > 1 ? { message: 'no such table' } : null)

    const res = await ordersRoute.PATCH(
      ordersPatch({ order_number: 'LG-STOCKFAIL-2', line_fulfilments: [{ sku: 'SF-2', quantity: 2 }] }),
    )
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toBe('stock_read_failed')
    expect(body.message).toMatch(/claim \(0 -> 2\) was reverted/i)
    expect(lines[0].fulfilled_quantity).toBe(0)
    expect(orders[0].fulfilment_status).toBe('unfulfilled')
  })

  it('picks the SAME shelf twice, by name, rather than whichever row came back first', async () => {
    orders = [{
      id: 'ord-7', project: 'Limiglow', order_number: 'LG-LOC-2', fulfilment_status: 'unfulfilled',
      currency: 'USD', total_minor: 200, placed_at: new Date().toISOString(), customer_email: null,
    }]
    lines = [{ id: 'line-7', order_id: 'ord-7', sku: 'LOC-2', quantity: 2, fulfilled_quantity: 0 }]
    // 'warehouse' is listed FIRST and could cover it; 'front' sorts earlier and
    // is what the rule picks. Reading `.limit(1)` with no ORDER BY would take
    // the other one.
    levels = [
      { id: 'lvl-9', project: 'Limiglow', sku: 'LOC-2', location: 'warehouse', on_hand: 9 },
      { id: 'lvl-10', project: 'Limiglow', sku: 'LOC-2', location: 'front', on_hand: 9 },
    ]

    const res = await ordersRoute.PATCH(
      ordersPatch({ order_number: 'LG-LOC-2', line_fulfilments: [{ sku: 'LOC-2', quantity: 1 }] }),
    )
    expect(res.status).toBe(200)
    expect(levels.find(l => l.location === 'front')!.on_hand).toBe(8)
    expect(levels.find(l => l.location === 'warehouse')!.on_hand).toBe(9)
    expect(String(actionsInserted[0].reason)).toContain('location "front"')
  })
})

describe('PATCH /api/commerce/orders — inventory.adjust audit insert failure after a line CAS write lands', () => {
  // ALSO UPDATED, AND THE NEW OUTCOME IS STRICTLY BETTER. This used to end with
  // the order recorded `fulfilled` and its stock unmoved — an honest 500, but a
  // real divergence, because the order's status had already been claimed before
  // the stock loop ran. With the write order inverted there is nothing to
  // diverge from: the line claim and the stock write are both reverted, the
  // order's status is never touched, and the net effect is that nothing
  // happened at all.
  it('reverts both the line claim and the stock, and never moves the order', async () => {
    orders = [{
      id: 'ord-2', project: 'Limiglow', order_number: 'LG-ATOM-2', fulfilment_status: 'unfulfilled',
      currency: 'USD', total_minor: 100, placed_at: new Date().toISOString(), customer_email: null,
    }]
    lines = [{ id: 'line-2', order_id: 'ord-2', sku: 'ATOM-3', quantity: 4, fulfilled_quantity: 0 }]
    levels = [{ id: 'lvl-3', project: 'Limiglow', sku: 'ATOM-3', location: 'default', on_hand: 20 }]
    auditOutcome = row => (row.action === 'inventory.adjust' ? { message: 'CHECK constraint failed: object_type' } : null)

    const res = await ordersRoute.PATCH(ordersPatch({ order_number: 'LG-ATOM-2', fulfilment_status: 'fulfilled' }))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toBe('audit_write_failed')
    expect(levels[0].on_hand).toBe(20)
    expect(lines[0].fulfilled_quantity).toBe(0)
    expect(orders[0].fulfilment_status).toBe('unfulfilled')
    expect(actionsInserted).toHaveLength(0)
    expect(body.message).toMatch(/nothing changed/i)
  })
})

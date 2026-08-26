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
 *      fails AFTER the order's own CAS claim landed. The handler must revert
 *      the order's `fulfilment_status`, return 500, and touch no stock.
 *   3. PATCH /api/commerce/orders — the per-line `inventory.adjust` audit
 *      insert fails AFTER that line's stock CAS write landed (the order
 *      itself is already committed to `fulfilled` by this point). The
 *      handler must revert that line's stock and return 500 naming the
 *      residual state honestly (the order IS fulfilled; this line's stock
 *      is NOT moved).
 */

import { NextRequest } from 'next/server'

interface FakeLevel { id: string; project: string; sku: string; location: string; on_hand: number; updated_at?: string }
interface FakeOrder { id: string; project: string; order_number: string; fulfilment_status: string; currency: string; total_minor: number; placed_at: string; customer_email: string | null; updated_at?: string }
interface FakeLine { order_id: string; sku: string; quantity: number }

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

function makeCasBuilder(table: () => Record<string, unknown>[]) {
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

function makeLineItemsBuilder() {
  const wheres: Array<[string, unknown]> = []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    eq(col: string, val: unknown) { wheres.push([col, val]); return builder },
    select() { return builder },
    then(resolve: (v: { data: unknown; error: null }) => unknown) {
      return microtask(null).then(() => {
        const found = lines.filter(row => matches(row as unknown as Record<string, unknown>, wheres))
        return resolve({ data: found, error: null })
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
        if (t === 'inventory_levels') return makeCasBuilder(() => levels as unknown as Record<string, unknown>[])
        if (t === 'orders') return makeCasBuilder(() => orders as unknown as Record<string, unknown>[])
        if (t === 'order_line_items') return makeLineItemsBuilder()
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

describe('PATCH /api/commerce/orders — order.fulfilment audit insert failure after the order CAS claim lands', () => {
  it('reverts fulfilment_status and answers 500, touching no stock', async () => {
    orders = [{
      id: 'ord-1', project: 'Limiglow', order_number: 'LG-ATOM-1', fulfilment_status: 'unfulfilled',
      currency: 'USD', total_minor: 100, placed_at: new Date().toISOString(), customer_email: null,
    }]
    lines = [{ order_id: 'ord-1', sku: 'ATOM-2', quantity: 1 }]
    levels = [{ id: 'lvl-2', project: 'Limiglow', sku: 'ATOM-2', location: 'default', on_hand: 10 }]
    auditOutcome = row => (row.action === 'order.fulfilment' ? { message: 'CHECK constraint failed: object_type' } : null)

    const res = await ordersRoute.PATCH(ordersPatch({ order_number: 'LG-ATOM-1', fulfilment_status: 'fulfilled' }))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toBe('audit_write_failed')
    expect(orders[0].fulfilment_status).toBe('unfulfilled')
    // Stock was never reached — the audit failure happens before the
    // stock-moving loop runs.
    expect(levels[0].on_hand).toBe(10)
  })
})

describe('PATCH /api/commerce/orders — inventory.adjust audit insert failure after a line CAS write lands', () => {
  it('reverts that line\'s stock and answers 500 naming the order as already fulfilled', async () => {
    orders = [{
      id: 'ord-2', project: 'Limiglow', order_number: 'LG-ATOM-2', fulfilment_status: 'unfulfilled',
      currency: 'USD', total_minor: 100, placed_at: new Date().toISOString(), customer_email: null,
    }]
    lines = [{ order_id: 'ord-2', sku: 'ATOM-3', quantity: 4 }]
    levels = [{ id: 'lvl-3', project: 'Limiglow', sku: 'ATOM-3', location: 'default', on_hand: 20 }]
    auditOutcome = row => (row.action === 'inventory.adjust' ? { message: 'CHECK constraint failed: object_type' } : null)

    const res = await ordersRoute.PATCH(ordersPatch({ order_number: 'LG-ATOM-2', fulfilment_status: 'fulfilled' }))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toBe('audit_write_failed')
    // The order's own status DID commit (its audit insert was allowed to
    // land) — only the stock side failed and was reverted.
    expect(orders[0].fulfilment_status).toBe('fulfilled')
    expect(levels[0].on_hand).toBe(20)
    expect(body.message).toMatch(/fulfilled/i)
  })
})

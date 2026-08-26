/**
 * ORDER INGEST — the door POST, and the status it is not allowed to invent.
 *
 * WHY THIS FILE EXISTS
 *   A fresh-context critic mutation-tested the commerce suite and found that
 *   `POST /api/commerce/orders` had ZERO coverage: `grep -n "route\.POST"` over
 *   all four commerce test files returned nothing. It proved it by changing the
 *   handler's `fulfilled_quantity: ingestFulfilled ? line.quantity : 0` to a
 *   flat `0` — an order ingested as already shipped would have recorded every
 *   unit as still on the shelf — and all 46 tests stayed green.
 *
 *   Underneath the missing coverage was a real defect. The piece claimed "the
 *   status is DERIVED from the lines, never asserted", and that was true of
 *   PATCH and false here. Measured against the running server before the fix
 *   (2026-08-26):
 *
 *     POST {order_number:'W8C-ING-1', fulfilment_status:'partially_fulfilled',
 *           line_items:[{sku:'W8C-OS', quantity:5, ...}]}
 *     -> 201, stored `partially_fulfilled`, GET fulfilment
 *        {ordered:5, fulfilled:0, remaining:5}
 *
 *   — an order recorded as part-shipped with every unit still on the shelf and
 *   no record of which parcel left, which is the exact state PATCH refuses to
 *   create and which this whole piece exists to abolish. It came in the other
 *   door.
 *
 * WHAT IS GATED HERE
 *   1. `fulfilment_status: 'fulfilled'` still writes every line fully shipped
 *      (the mutant above dies here).
 *   2. A stated status that disagrees with the line quantities is REFUSED,
 *      naming both — the same stance the total already takes.
 *   3. A status not stated at all is DERIVED from the quantities.
 *   4. `cancelled` is the one exemption, and deliberately so.
 *   5. Ingest moves no stock, and that is a decision, not an oversight.
 */

import { NextRequest } from 'next/server'

type Row = Record<string, unknown>
const tables: Record<string, Row[]> = {}
let nextId = 1

/** A real event-loop turn between read and write, like the sibling suites. */
const turn = <T>(v: T) => new Promise<T>(r => setImmediate(() => r(v)))

function makeBuilder(name: string) {
  const wheres: Array<[string, unknown]> = []
  let verb: 'select' | 'update' | 'insert' = 'select'
  let patch: Row = {}
  let inserted: Row[] = []
  let wantsReturn = false

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const b: any = {
    eq(col: string, val: unknown) { wheres.push([col, val]); return b },
    update(values: Row) { verb = 'update'; patch = values; return b },
    insert(values: Row | Row[]) { verb = 'insert'; inserted = Array.isArray(values) ? values : [values]; return b },
    select() { if (verb !== 'select') wantsReturn = true; return b },
    limit() { return b },
    order() { return b },
    maybeSingle() {
      return b.then((r: { data: Row[] }) => ({ ...r, data: (r.data ?? [])[0] ?? null }))
    },
    then(resolve: (v: { data: Row[] | Row | null; error: unknown }) => unknown) {
      return turn(null).then(() => {
        const rows = (tables[name] ??= [])
        const found = rows.filter(row => wheres.every(([c, v]) => row[c] === v))
        if (verb === 'select') return resolve({ data: found.map(r => ({ ...r })), error: null })
        if (verb === 'insert') {
          const added = inserted.map(v => ({ id: `gen-${nextId++}`, ...v }))
          rows.push(...added)
          return resolve({ data: wantsReturn ? added.map(r => ({ ...r })) : null, error: null })
        }
        for (const row of found) Object.assign(row, patch)
        return resolve({ data: wantsReturn ? found.map(r => ({ ...r })) : null, error: null })
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

function postRequest(body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/commerce/orders', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-mc-project': 'Limiglow', 'x-agent-role': 'member' },
    body: JSON.stringify(body),
  })
}

const LINE = { sku: 'ING-A', title: 'Ingest fixture', quantity: 5, unit_price: '10.00' }
const ORDER = { order_number: 'ING-1', currency: 'USD', line_items: [LINE] }

const storedOrder = () => tables.orders[0]
const storedLines = () => (tables.order_line_items ?? []) as Array<Row & { fulfilled_quantity: number }>

beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key]
  nextId = 1
})

describe('POST /api/commerce/orders — the shorthand that still works', () => {
  it('ingests an already-shipped order with every line fully fulfilled', async () => {
    // THE MUTANT THIS KILLS: `fulfilled_quantity: 0` here would store an order
    // recorded as fulfilled whose every unit still counts as on the shelf, and
    // whose lines would then read 0/5 — the disagreement between a status and
    // its own lines that this piece refuses everywhere else.
    const res = await route.POST(postRequest({ ...ORDER, fulfilment_status: 'fulfilled' }))
    expect(res.status).toBe(201)
    expect(storedOrder().fulfilment_status).toBe('fulfilled')
    expect(storedLines()).toHaveLength(1)
    expect(storedLines()[0].fulfilled_quantity).toBe(5)
  })

  it('ingests an ordinary new order with nothing shipped', async () => {
    const res = await route.POST(postRequest(ORDER))
    expect(res.status).toBe(201)
    expect(storedOrder().fulfilment_status).toBe('unfulfilled')
    expect(storedLines()[0].fulfilled_quantity).toBe(0)
  })

  it('moves no stock — ingest records what a storefront reports, it does not ship', async () => {
    tables.inventory_levels = [
      { id: 'lvl-1', project: 'Limiglow', sku: 'ING-A', location: 'default', on_hand: 100 },
    ]
    await route.POST(postRequest({ ...ORDER, fulfilment_status: 'fulfilled' }))
    // The parcel left before Todero saw the order; decrementing here would
    // double-count against the storefront's own feed.
    expect(tables.inventory_levels[0].on_hand).toBe(100)
    expect(tables.commerce_actions ?? []).toHaveLength(0)
  })
})

describe('POST /api/commerce/orders — the status is derived at the door too', () => {
  it('REFUSES partially_fulfilled asserted with no per-line quantities, and stores nothing', async () => {
    // Measured as a 201 before this fix, storing exactly the incoherent state
    // PATCH refuses in so many words.
    const res = await route.POST(postRequest({ ...ORDER, fulfilment_status: 'partially_fulfilled' }))
    const body = await res.json()

    expect(res.status).toBe(422)
    expect(body.error).toBe('invalid_order')
    // The refusal carries both opinions and the numbers behind them.
    expect(body.message).toContain('partially_fulfilled')
    expect(body.message).toContain('unfulfilled')
    expect(body.message).toContain('ING-A: 0/5')
    expect(body.message).toContain('fulfilled_quantity')
    expect(tables.orders ?? []).toHaveLength(0)
    expect(tables.order_line_items ?? []).toHaveLength(0)
  })

  it('ACCEPTS a genuinely part-shipped order that says which units went', async () => {
    const res = await route.POST(postRequest({
      ...ORDER,
      order_number: 'ING-2',
      fulfilment_status: 'partially_fulfilled',
      line_items: [{ ...LINE, fulfilled_quantity: 3 }],
    }))
    expect(res.status).toBe(201)
    expect(storedOrder().fulfilment_status).toBe('partially_fulfilled')
    expect(storedLines()[0].fulfilled_quantity).toBe(3)
  })

  it('derives the status when the caller states none', async () => {
    await route.POST(postRequest({
      ...ORDER, order_number: 'ING-3', line_items: [{ ...LINE, fulfilled_quantity: 3 }],
    }))
    expect(storedOrder().fulfilment_status).toBe('partially_fulfilled')

    for (const key of Object.keys(tables)) delete tables[key]
    await route.POST(postRequest({
      ...ORDER, order_number: 'ING-4', line_items: [{ ...LINE, fulfilled_quantity: 5 }],
    }))
    expect(storedOrder().fulfilment_status).toBe('fulfilled')
  })

  it('refuses a stated status that disagrees with the quantities given', async () => {
    const res = await route.POST(postRequest({
      ...ORDER,
      order_number: 'ING-5',
      fulfilment_status: 'fulfilled',
      line_items: [{ ...LINE, fulfilled_quantity: 3 }],
    }))
    const body = await res.json()
    expect(res.status).toBe(422)
    expect(body.message).toContain('ING-A: 3/5')
    expect(tables.orders ?? []).toHaveLength(0)
  })

  it('refuses a line that claims to have shipped more units than it sold', async () => {
    const res = await route.POST(postRequest({
      ...ORDER, order_number: 'ING-6', line_items: [{ ...LINE, fulfilled_quantity: 9 }],
    }))
    const body = await res.json()
    expect(res.status).toBe(422)
    expect(body.message).toContain('9')
    expect(body.message).toContain('5')
    expect(tables.orders ?? []).toHaveLength(0)
  })

  it('keeps cancelled as the one exemption, with whatever shipped before it', async () => {
    // Cancellation is a decision about an order, not a count of what left the
    // warehouse — `deriveFulfilmentStatus` cannot return it by construction, so
    // a cancelled order is stored as stated and may carry a part shipment that
    // went out before somebody cancelled the rest.
    const res = await route.POST(postRequest({
      ...ORDER,
      order_number: 'ING-7',
      fulfilment_status: 'cancelled',
      line_items: [{ ...LINE, fulfilled_quantity: 2 }],
    }))
    expect(res.status).toBe(201)
    expect(storedOrder().fulfilment_status).toBe('cancelled')
    expect(storedLines()[0].fulfilled_quantity).toBe(2)
  })
})

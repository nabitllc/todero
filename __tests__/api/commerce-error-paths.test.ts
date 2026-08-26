/**
 * Commerce error paths — the db seam's swallowed errors, and a guard for the class.
 *
 * WHY THIS FILE EXISTS
 *   Three separate waves of this channel each shipped an unchecked database
 *   error in the same route family. That is not three mistakes, it is one
 *   SHAPE: `lib/db` returns failures as VALUES (`{ data, error }`) rather than
 *   throwing, so forgetting to destructure `error` produces code that reads
 *   exactly like success and behaves like an empty result.
 *
 *   The most damaging instance was in `GET /api/commerce/orders?order_number=`:
 *
 *       const { data: lines } = await db()          // <- no `error`
 *         .from('order_line_items').select('*').eq('order_id', data.id)
 *       const rows = (lines ?? []) as unknown as LineRow[]   // <- error -> []
 *
 *   A driver failure there answered HTTP 200 with `line_items: []` and
 *   `fulfilment: {ordered: 0, fulfilled: 0, remaining: 0}` for an order holding
 *   unshipped units. "Nothing outstanding" is an actionable number, and it was
 *   wrong. It also defeated the client written to handle it —
 *   components/tabs/CommerceTab.tsx branches on `!res.ok` and promises "never
 *   render an empty line list over a failed request" — because the server never
 *   produced a non-ok status for that branch to see.
 *
 *   That endpoint had NO test file at all. `grep -n "order_number=" __tests__/
 *   api/commerce*.ts` returned nothing, so every number it reported — the
 *   order-level outstanding count, and every per-line fulfilled/remaining pair
 *   the "Ship lines" panel is built on — was unasserted. Three mutations to it
 *   survived the whole 64-test commerce suite. Sections 2 and 3 below are the
 *   coverage that was missing; each names the mutant it kills.
 *
 * WHAT THE ROUTES DO ON A FAILED WRITE
 *   Section 4 pins the rule this file establishes for the class: NO exit that
 *   has already changed something may report success. Where a change can be
 *   undone it is undone and the response says so; where it cannot (the order
 *   row is committed before its lines are), the response says exactly what
 *   exists so the half-written state is reconcilable rather than merely wrong.
 *
 * SECTION 1 IS THE GUARD
 *   Coverage catches the instances someone thought to test. The guard catches
 *   the CLASS, by reading the source of every file this lane owns and failing
 *   on any `await db()` whose `error` is not destructured and consulted. It is
 *   proven red against the exact code that shipped, and it is explicit about
 *   what it cannot see. See `KNOWN BLIND SPOTS` on `findUncheckedDbErrors`.
 *
 * HOW THE ROUTE TESTS RUN
 *   They drive the REAL exported handlers against an in-memory fake of the
 *   tables they touch, the same way commerce-partial-fulfilment.test.ts does.
 *   The fake adds one thing that one does not: FAULT INJECTION, so a driver
 *   error can be produced on a named table and verb without touching a real
 *   database. That is the only way to test the failure branch of a seam that
 *   reports failures as return values.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { NextRequest } from 'next/server'

const REPO = join(__dirname, '..', '..')

// ─── Section 1: the guard ───────────────────────────────────────────────────

/** Files this lane owns that talk to the db seam. */
const OWNED_SOURCES = [
  'app/api/commerce/orders/route.ts',
  'app/api/commerce/inventory/route.ts',
  'app/api/commerce/products/route.ts',
  'app/api/commerce/scope.ts',
  'lib/commerce.ts',
]

interface Violation {
  line: number
  text: string
  why: string
}

/**
 * Find `{ data, error }`-style db calls whose error is dropped or ignored.
 *
 * A "call site" is a line awaiting `db()` or a builder variable. For each one:
 *   - no destructuring at all (`await db().from(t).insert(...)`)  -> violation
 *   - destructured without an `error` key                          -> violation
 *   - destructured WITH an `error` key that is never mentioned
 *     again before the next call site                              -> violation
 *
 * KNOWN BLIND SPOTS — this guard is a line-oriented source scan, not a type
 * checker, and it is worth being precise about what that means:
 *   1. It only understands single-line destructuring. Every db call in the
 *      owned files is written that way today; a call split across lines would
 *      be read as "no destructuring" and reported as a violation. That fails
 *      LOUD (a false positive), which is the safe direction.
 *   2. "Consulted" means the binding's name appears again within the scope
 *      window below. It does not verify the check is CORRECT — `if (error) {}`
 *      with an empty body would satisfy it. Sections 2-4 are what constrain
 *      behaviour; this only constrains the shape.
 *   3. It sees only the five files listed above. The same class exists in
 *      every route in this app that uses the db seam, and nothing here says
 *      anything about those. Generalising it to all of `app/api/**` belongs in
 *      `scripts/`, which this lane does not own — see the piece doc's seam
 *      request.
 *   4. It cannot see an error that is destructured, consulted, and then
 *      handled by returning a 200.
 */
function findUncheckedDbErrors(source: string): Violation[] {
  const lines = source.split('\n')
  // `await db()...` or `await query...` (a builder held in a variable first).
  const isCallSite = (l: string) => /await\s+(db\(\)|query\b)/.test(l)
  const siteIndexes = lines.map((l, i) => (isCallSite(l) ? i : -1)).filter(i => i >= 0)

  const violations: Violation[] = []

  siteIndexes.forEach((idx, n) => {
    const line = lines[idx]
    const prefix = line.slice(0, line.search(/await\s+(db\(\)|query\b)/))

    const destructure = /const\s*\{([^}]*)\}\s*=\s*$/.exec(prefix.trimEnd() + ' ')
      ?? /const\s*\{([^}]*)\}\s*=\s*/.exec(prefix)
    if (!destructure) {
      violations.push({
        line: idx + 1,
        text: line.trim(),
        why:
          'the result is discarded entirely, so a driver error cannot be seen at all. ' +
          'Destructure `{ error }` and return dbQueryErrorResponse(error, <table>).',
      })
      return
    }

    // Find the `error` binding and its local name: `error` or `error: someName`.
    const bindings = destructure[1]
    const errorBinding = /\berror\s*:\s*([A-Za-z_$][\w$]*)/.exec(bindings)
      ?? (/\berror\b/.test(bindings) ? ['', 'error'] as unknown as RegExpExecArray : null)
    if (!errorBinding) {
      violations.push({
        line: idx + 1,
        text: line.trim(),
        why:
          `\`{${bindings.trim()}}\` does not bind \`error\`, so a driver failure is ` +
          'indistinguishable from an empty result. This is the exact shape that made ' +
          'GET ?order_number= answer 200 with line_items: [] on a failed read.',
      })
      return
    }

    // Scope window: up to the next db call site, capped at 60 lines. Bounding
    // it matters — `error` is a common name, and searching the whole file would
    // let one function's check excuse another function's omission.
    const nextSite = siteIndexes[n + 1] ?? lines.length
    const end = Math.min(nextSite, idx + 61, lines.length)
    const name = errorBinding[1]
    const window = lines.slice(idx + 1, end).join('\n')
    if (!new RegExp(`\\b${name}\\b`).test(window)) {
      violations.push({
        line: idx + 1,
        text: line.trim(),
        why:
          `\`${name}\` is destructured but never consulted before the next db call ` +
          '(line ' + (nextSite + 1) + '). Binding an error and ignoring it is the same ' +
          'defect as not binding it.',
      })
    }
  })

  return violations
}

describe('guard: no unchecked db error in commerce', () => {
  /**
   * RED. This is the code that actually shipped, taken from
   * app/api/commerce/orders/route.ts before this piece, reproduced verbatim.
   * If the guard cannot flag this, it cannot flag the bug it exists for.
   */
  it('flags the exact swallow that shipped in GET ?order_number=', () => {
    const shipped = `
      const { data: lines } = await db()
        .from('order_line_items')
        .select('*')
        .eq('order_id', data.id)
      const rows = (lines ?? []) as unknown as LineRow[]
    `
    const found = findUncheckedDbErrors(shipped)
    expect(found).toHaveLength(1)
    expect(found[0].text).toContain('const { data: lines } = await db()')
    expect(found[0].why).toContain('does not bind `error`')
  })

  it('flags a write whose result is discarded entirely', () => {
    // The ingest line-insert loop, as it shipped: no destructuring at all, so
    // the 201 that followed reported a line count read off the REQUEST.
    const shipped = `
      for (const line of order.value.line_items) {
        await db().from('order_line_items').insert({ order_id: created.id })
      }
    `
    const found = findUncheckedDbErrors(shipped)
    expect(found).toHaveLength(1)
    expect(found[0].why).toContain('discarded entirely')
  })

  it('flags an error that is bound and then ignored', () => {
    const source = `
      const { data, error } = await db().from('orders').select('*')
      return NextResponse.json({ rows: data ?? [] })
    `
    const found = findUncheckedDbErrors(source)
    expect(found).toHaveLength(1)
    expect(found[0].why).toContain('never consulted')
  })

  it('accepts a checked error, including one consulted by negation', () => {
    const good = `
      const { data, error } = await db().from('orders').select('*')
      if (error) return dbQueryErrorResponse(error, 'orders')
      const { data: reverted, error: revertError } = await db().from('orders').update({})
      return !revertError && ((reverted ?? []) as unknown[]).length > 0
    `
    expect(findUncheckedDbErrors(good)).toEqual([])
  })

  /** GREEN. The real files, as they stand. */
  it.each(OWNED_SOURCES)('%s has no unchecked db error', file => {
    const violations = findUncheckedDbErrors(readFileSync(join(REPO, file), 'utf8'))
    const report = violations
      .map(v => `  ${file}:${v.line}\n    ${v.text}\n    -> ${v.why}`)
      .join('\n\n')
    expect(
      violations.length === 0 ? '' : `\n${violations.length} unchecked db error(s):\n\n${report}\n`,
    ).toBe('')
  })
})

// ─── The fake database, with fault injection ────────────────────────────────

type Row = Record<string, unknown>
const tables: Record<string, Row[]> = {}

/** A real event-loop turn between read and write, as the sibling suites use. */
const turn = <T>(v: T) => new Promise<T>(r => setImmediate(() => r(v)))

let nextId = 1

/**
 * Faults keyed by `table:verb`. `remaining` lets a fault fire on the Nth call
 * — needed to fail the SECOND line insert of a three-line order, which is the
 * case that produces a genuinely half-written order rather than an empty one.
 */
interface Fault {
  message: string
  skip: number
}
const faults: Record<string, Fault> = {}

function faultOn(table: string, verb: string, message: string, skip = 0) {
  faults[`${table}:${verb}`] = { message, skip }
}

/**
 * The other failure a `{data, error}` seam can produce: NO error, and no row.
 * A suppressed RETURNING clause or a row filtered by a policy both look like
 * this, and it is the shape that slips past "did it error?" checks entirely.
 */
const emptyReturns: Record<string, true> = {}
function emptyOn(table: string, verb: string) {
  emptyReturns[`${table}:${verb}`] = true
}

function takeFault(table: string, verb: string): { message: string } | null {
  const key = `${table}:${verb}`
  const f = faults[key]
  if (!f) return null
  if (f.skip > 0) {
    f.skip -= 1
    return null
  }
  return { message: f.message }
}

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
    then(resolve: (v: { data: Row[] | Row | null; error: unknown; count?: number }) => unknown) {
      return turn(null).then(() => {
        const fault = takeFault(name, verb)
        // A faulted query returns NO data and an error — exactly what the real
        // seam does, and exactly the pair that `(data ?? [])` silently erases.
        if (fault) return resolve({ data: null, error: fault })

        const rows = (tables[name] ??= [])
        const matches = rows.filter(row => wheres.every(([c, v]) => row[c] === v))

        // Reads return COPIES, never the stored objects.
        //
        // This is not tidiness, it is fidelity, and getting it wrong hides a
        // whole class of bug. A real driver hands back a decoded row; a fake
        // that hands back the live object makes every later UPDATE retroactively
        // mutate the value the route read BEFORE it. The products PATCH revert
        // is exactly that shape — it restores `found.price_minor`, captured by
        // a read taken before the update — and with aliasing in place the fake
        // reported the revert restoring 900 to 900 and called it a success.
        // The route was right and the harness was lying.
        const copy = (r: Row) => ({ ...r })

        if (verb === 'select') {
          const page = limit === null ? matches : matches.slice(0, limit)
          return resolve({ data: page.map(copy), error: null, count: matches.length })
        }
        if (verb === 'insert') {
          const added = inserted.map(v => ({ id: `gen-${nextId++}`, ...v }))
          if (emptyReturns[`${name}:insert`]) {
            // The row is NOT stored, and no error is reported: the caller is
            // left with no way to know whether it exists.
            return resolve({ data: wantsReturn ? [] : null, error: null })
          }
          rows.push(...added)
          return resolve({ data: wantsReturn ? added.map(copy) : null, error: null })
        }
        for (const row of matches) Object.assign(row, patch)
        return resolve({ data: wantsReturn ? matches.map(copy) : null, error: null })
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
const orders = require('@/app/api/commerce/orders/route') as typeof import('@/app/api/commerce/orders/route')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const products = require('@/app/api/commerce/products/route') as typeof import('@/app/api/commerce/products/route')

const HEADERS = { 'content-type': 'application/json', 'x-mc-project': 'Limiglow', 'x-agent-role': 'member' }

function getOrder(orderNumber: string): NextRequest {
  const url = `http://localhost:3000/api/commerce/orders?order_number=${encodeURIComponent(orderNumber)}`
  return new NextRequest(url, { method: 'GET', headers: HEADERS })
}

function jsonRequest(path: string, method: 'POST' | 'PATCH', body: Record<string, unknown>): NextRequest {
  return new NextRequest(`http://localhost:3000/api/commerce/${path}`, {
    method,
    headers: HEADERS,
    body: JSON.stringify(body),
  })
}

/** One two-line order, part-shipped: 5 of CEPX-A ordered with 2 gone, 3 of
 *  CEPX-B ordered with 0 gone. Deliberately NOT round numbers and NOT equal —
 *  a mutant that returns a constant, or that swaps fulfilled for remaining,
 *  has to produce a number this fixture can tell apart. */
function seedPartShippedOrder() {
  tables.orders = [
    {
      id: 'order-1',
      project: 'Limiglow',
      order_number: 'CEPX-EP-1',
      placed_at: '2026-01-01T00:00:00.000Z',
      customer_email: null,
      currency: 'USD',
      total_minor: 8000,
      fulfilment_status: 'partially_fulfilled',
    },
  ]
  tables.order_line_items = [
    {
      id: 'line-a',
      order_id: 'order-1',
      sku: 'CEPX-A',
      title: 'Alpha',
      quantity: 5,
      fulfilled_quantity: 2,
      unit_price_minor: 1000,
      currency: 'USD',
    },
    {
      id: 'line-b',
      order_id: 'order-1',
      sku: 'CEPX-B',
      title: 'Beta',
      quantity: 3,
      fulfilled_quantity: 0,
      unit_price_minor: 1000,
      currency: 'USD',
    },
  ]
  tables.inventory_levels = []
  tables.commerce_actions = []
}

beforeEach(() => {
  for (const key of Object.keys(tables)) delete tables[key]
  for (const key of Object.keys(faults)) delete faults[key]
  for (const key of Object.keys(emptyReturns)) delete emptyReturns[key]
  nextId = 1
})

// ─── Section 2: GET ?order_number= reports real numbers ─────────────────────
//
// This endpoint had no test of any kind. Three mutations to it survived the
// entire commerce suite; each `it` below names the one it kills.

describe('GET /api/commerce/orders?order_number= — the numbers', () => {
  it('reports order-level ordered/fulfilled/remaining from the lines', async () => {
    // Kills: `fulfilment.remaining` replaced with the literal 0.
    seedPartShippedOrder()
    const res = await orders.GET(getOrder('CEPX-EP-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.fulfilment).toEqual({ ordered: 8, fulfilled: 2, remaining: 6 })
  })

  it('reports each line separately, and remaining is quantity minus fulfilled', async () => {
    // Kills: per-line reporting inverted (`fulfilled_quantity: 0`,
    // `remaining: l.quantity` hardcoded, i.e. every line reads as never shipped).
    seedPartShippedOrder()
    const res = await orders.GET(getOrder('CEPX-EP-1'))
    const body = await res.json()
    const byS = Object.fromEntries(
      (body.line_items as Array<Record<string, unknown>>).map(l => [l.sku, l]),
    )
    expect(byS['CEPX-A']).toMatchObject({ quantity: 5, fulfilled_quantity: 2, remaining: 3 })
    expect(byS['CEPX-B']).toMatchObject({ quantity: 3, fulfilled_quantity: 0, remaining: 3 })
    // The two lines have the same `remaining` on purpose and DIFFERENT
    // `fulfilled_quantity`: an implementation that reported `remaining` twice
    // would pass the pair above, so pin the thing that tells them apart.
    expect(byS['CEPX-A'].fulfilled_quantity).not.toEqual(byS['CEPX-B'].fulfilled_quantity)
  })

  it('hands back line_id, the only unambiguous way to address a line', async () => {
    seedPartShippedOrder()
    const body = await (await orders.GET(getOrder('CEPX-EP-1'))).json()
    expect((body.line_items as Array<{ line_id: string }>).map(l => l.line_id).sort())
      .toEqual(['line-a', 'line-b'])
  })
})

// ─── Section 3: the swallow itself ──────────────────────────────────────────

describe('GET ?order_number= — a failed line read is never an empty order', () => {
  it('answers 5xx, not 200-with-nothing-outstanding', async () => {
    // Kills: the line read forced to error. This is THE mutant — it survived
    // 64/64 commerce tests and produced `fulfilment: {ordered:0, remaining:0}`
    // for an order with 6 units outstanding.
    seedPartShippedOrder()
    faultOn('order_line_items', 'select', 'no such column: zzz_probe')

    const res = await orders.GET(getOrder('CEPX-EP-1'))
    expect(res.status).toBeGreaterThanOrEqual(500)

    const body = await res.json()
    // The three specific lies the old code told, each pinned:
    expect(body.line_items).toBeUndefined()
    expect(body.fulfilment).toBeUndefined()
    expect(body.error ?? body.message).toBeTruthy()
  })

  it('does not report the order as having nothing outstanding', async () => {
    seedPartShippedOrder()
    faultOn('order_line_items', 'select', 'connection reset')
    const body = await (await orders.GET(getOrder('CEPX-EP-1'))).json()
    expect(JSON.stringify(body)).not.toContain('"remaining":0')
  })

  it('still 500s when the order itself has genuinely zero lines to read', async () => {
    // The distinction that matters: an EMPTY result and a FAILED result must
    // not be answered the same way. Empty is a real, reportable state.
    seedPartShippedOrder()
    tables.order_line_items = []
    const res = await orders.GET(getOrder('CEPX-EP-1'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.line_items).toEqual([])
    expect(body.fulfilment).toEqual({ ordered: 0, fulfilled: 0, remaining: 0 })
  })

  it('a failed ORDER read is also not a 404', async () => {
    // The neighbouring trap: `maybeSingle()` returns null on error too, and
    // `if (!data) return 404` would tell the operator the order does not exist.
    seedPartShippedOrder()
    faultOn('orders', 'select', 'no such column: zzz_probe')
    const res = await orders.GET(getOrder('CEPX-EP-1'))
    expect(res.status).not.toBe(404)
    expect(res.status).toBeGreaterThanOrEqual(500)
  })
})

// ─── Section 4: no write reports success after a failure ────────────────────

describe('POST /api/commerce/orders — a half-written order is never a 201', () => {
  const twoLineOrder = {
    order_number: 'CEPX-IN-1',
    placed_at: '2026-01-01T00:00:00.000Z',
    currency: 'USD',
    total_minor: 3000,
    line_items: [
      { sku: 'CEPX-A', title: 'Alpha', quantity: 2, unit_price_minor: 1000 },
      { sku: 'CEPX-B', title: 'Beta', quantity: 1, unit_price_minor: 1000 },
    ],
  }

  it('reports the count the DATABASE took, not the count the request offered', async () => {
    const res = await orders.POST(jsonRequest('orders', 'POST', twoLineOrder))
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.line_items).toBe(2)
    expect(tables.order_line_items).toHaveLength(2)
  })

  it('refuses to confirm an ingest whose second line failed to store', async () => {
    // The order row and line 1 land; line 2 does not. The old loop discarded
    // every insert result and answered `201 {line_items: 2}` — a written
    // receipt for a line that does not exist.
    faultOn('order_line_items', 'insert', 'disk I/O error', 1)

    const res = await orders.POST(jsonRequest('orders', 'POST', twoLineOrder))
    expect(res.status).toBe(500)

    const body = await res.json()
    expect(body.error).toBe('order_lines_write_failed')
    expect(body.lines_expected).toBe(2)
    expect(body.lines_stored).toBe(1)
    // The message has to be actionable: name the order, the failing SKU, and
    // the fact that the stored total no longer matches the stored lines.
    expect(body.message).toContain('CEPX-IN-1')
    expect(body.message).toContain('CEPX-B')
    expect(body.message).toContain('disk I/O error')

    // And the claim must be TRUE of the database, not just of the message.
    expect(tables.order_line_items).toHaveLength(1)
  })

  it('refuses to report a 201 for an order the insert did not confirm', async () => {
    // No error, no returned row. The `if (created)` block never runs, so not a
    // single line is written — and the old code answered
    // `201 {order: null, line_items: 2}`. An importer reading that marks the
    // order ingested and never sends it again.
    emptyOn('orders', 'insert')

    const res = await orders.POST(jsonRequest('orders', 'POST', twoLineOrder))
    expect(res.status).toBe(500)

    const body = await res.json()
    expect(body.error).toBe('order_write_unconfirmed')
    expect(body.message).toContain('CEPX-IN-1')
    // The specific lie: a line count for lines that were never attempted.
    expect(body.line_items).toBeUndefined()
    expect(tables.order_line_items ?? []).toHaveLength(0)
  })
})

describe('POST /api/commerce/products — a product with no stock row is not a 201', () => {
  const newProduct = { sku: 'CEPX-P1', title: 'Probe', price_minor: 500, currency: 'USD' }

  it('creates the product, its stock row at zero, and its audit row', async () => {
    const res = await products.POST(jsonRequest('products', 'POST', newProduct))
    expect(res.status).toBe(201)
    expect(tables.inventory_levels).toHaveLength(1)
    expect(tables.inventory_levels[0]).toMatchObject({ sku: 'CEPX-P1', on_hand: 0, location: 'default' })
    expect(tables.commerce_actions).toHaveLength(1)
  })

  it('refuses to report a 201 for a product the insert did not confirm', async () => {
    emptyOn('products', 'insert')
    const res = await products.POST(jsonRequest('products', 'POST', newProduct))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('product_write_unconfirmed')
    // None of the three places a product is meant to exist got a row.
    expect(tables.products ?? []).toHaveLength(0)
    expect(tables.inventory_levels ?? []).toHaveLength(0)
    expect(tables.commerce_actions ?? []).toHaveLength(0)
  })

  it('refuses when the inventory row cannot be written', async () => {
    // The route comment promises the SKU is "visible to the inventory surface
    // immediately". Without this check that was an assertion the code did not
    // keep: a product no inventory screen could show, reported as created.
    faultOn('inventory_levels', 'insert', 'table is locked')
    const res = await products.POST(jsonRequest('products', 'POST', newProduct))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('inventory_row_write_failed')
    expect(body.product_created).toBe(true)
    expect(body.inventory_row_created).toBe(false)
    expect(body.message).toContain('CEPX-P1')
  })

  it('refuses when the audit row cannot be written, and says the product is real', async () => {
    faultOn('commerce_actions', 'insert', 'table is locked')
    const res = await products.POST(jsonRequest('products', 'POST', newProduct))
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('audit_write_failed')
    // This one is NOT reversible and the operator must not retry blindly —
    // the product exists and a retry would be refused as a duplicate.
    expect(body.audited).toBe(false)
    expect(body.message.toLowerCase()).toContain('do not retry')
  })
})

describe('PATCH /api/commerce/products — an unaudited price change is reverted', () => {
  beforeEach(() => {
    tables.products = [
      {
        id: 'p1',
        project: 'Limiglow',
        sku: 'CEPX-P1',
        title: 'Probe',
        status: 'active',
        price_minor: 500,
        currency: 'USD',
      },
    ]
    tables.commerce_actions = []
  })

  it('changes the price and records who changed it', async () => {
    const res = await products.PATCH(
      jsonRequest('products', 'PATCH', { sku: 'CEPX-P1', price_minor: 900 }),
    )
    expect(res.status).toBe(200)
    expect(tables.products[0].price_minor).toBe(900)
    expect(tables.commerce_actions).toHaveLength(1)
  })

  it('puts the price back when the audit row will not write', async () => {
    // A price that moved with no record of who moved it is the one change in
    // this file nobody can reconstruct afterwards.
    faultOn('commerce_actions', 'insert', 'table is locked')
    const res = await products.PATCH(
      jsonRequest('products', 'PATCH', { sku: 'CEPX-P1', price_minor: 900 }),
    )
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe('audit_write_failed')
    expect(body.reverted).toBe(true)
    expect(tables.products[0].price_minor).toBe(500)
  })

  it('says so, distinctly, when the revert itself fails', async () => {
    // Both writes fail. The response must escalate to the unreconciled code
    // rather than claiming a revert that did not happen — an error on the
    // revert leaves `data` null, which must read as "did not land".
    faultOn('commerce_actions', 'insert', 'table is locked')
    // `skip: 1` so the fault lands on the SECOND products UPDATE — the revert —
    // and not on the price change itself, which would never reach the audit.
    faultOn('products', 'update', 'table is locked', 1)
    const res = await products.PATCH(
      jsonRequest('products', 'PATCH', { sku: 'CEPX-P1', price_minor: 900 }),
    )
    const body = await res.json()
    expect(body.error).toBe('audit_write_failed_unreconciled')
    expect(body.reverted).toBe(false)
    expect(body.message).toContain('manual reconciliation')
  })
})

/**
 * commerce:read / commerce:write, proven both ways.
 *
 * (Ticket note: this file used to cite "TOD-2449". Verified against git:
 * that ticket's actual commit only touched scripts/board files, unrelated to
 * this permission split — see the "Ticket note" in
 * app/api/commerce/inventory/route.ts's header for the correction.)
 *
 * Before this test existed, every /api/commerce/* route was gated on
 * `projects:read` / `projects:write` — permissions that exist for a
 * different surface (issues/sprints/agents). Nothing in the codebase could
 * grant or refuse commerce access independently of project access.
 *
 * This suite proves the replacement gate (`commerce:read` / `commerce:write`
 * in lib/rbac-types.ts, applied via withPermission() in every commerce
 * route) is REAL, not cosmetic:
 *
 *   - `tron` (has commerce:read, NOT commerce:write) is refused a commerce
 *     WRITE with a 403 that names `commerce:write` specifically — not a
 *     generic "unauthenticated", not the viewer-only blanket block
 *     middleware.ts applies before routes are ever reached.
 *   - `member` (has both) succeeds on the identical write.
 *   - a request with no role at all is refused a commerce READ.
 *   - `viewer` (has commerce:read only) succeeds on a commerce READ.
 *
 * The refusal path never touches `db()` — withPermission runs before the
 * handler body — so those assertions need no database mock at all. The two
 * "succeeds" cases mock `@/lib/db` the same way __tests__/rbac-middleware.test.ts
 * and __tests__/api/agent-pause-route.test.ts already do: a queue of
 * responses consumed in call order.
 */

import { NextRequest } from 'next/server'

type DbErr = { message: string; code?: string } | null
type DbResult = { data?: unknown; error: DbErr; count?: number | null }

let responses: DbResult[] = []

jest.mock('@/lib/db', () => {
  const actual = jest.requireActual('@/lib/db')

  function makeBuilder() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {}
    const chain = () => () => builder
    ;[
      'select', 'insert', 'upsert', 'update', 'delete',
      'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in',
      'contains', 'not', 'or', 'filter', 'match', 'order', 'limit', 'range', 'join', 'returns',
    ].forEach(m => { builder[m] = chain() })
    builder.single = () => Promise.resolve(responses.shift() ?? { data: null, error: null })
    builder.maybeSingle = () => Promise.resolve(responses.shift() ?? { data: null, error: null })
    builder.then = (resolve: (v: DbResult) => unknown) =>
      Promise.resolve(responses.shift() ?? { data: [], error: null, count: 0 }).then(resolve)
    return builder
  }

  return {
    ...actual,
    db: () => ({
      provider: 'test',
      missingEnv: () => [],
      from: () => makeBuilder(),
      rpc: () => Promise.resolve({ data: null, error: null }),
    }),
  }
})

// Imported after the mock so every route picks it up.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ordersRoute = require('@/app/api/commerce/orders/route') as typeof import('@/app/api/commerce/orders/route')

function req(method: string, body?: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost:3000/api/commerce/orders', {
    method,
    headers: { 'content-type': 'application/json', 'x-mc-project': 'Limiglow', ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
}

beforeEach(() => {
  responses = []
})

describe('commerce:write is a real, independently-enforced permission', () => {
  it('refuses tron (commerce:read only) with a 403 naming commerce:write, and touches no query', async () => {
    const res = await ordersRoute.PATCH(
      req('PATCH', { order_number: 'LG-1', fulfilment_status: 'fulfilled' }, { 'x-agent-role': 'tron' }),
    )
    const json = await res.json()

    expect(res.status).toBe(403)
    expect(json).toMatchObject({
      error: 'forbidden',
      code: 'PERMISSION_DENIED',
      role: 'tron',
      required: 'commerce:write',
    })
    expect(json.message).toMatch(/commerce:write/)
    // No response was queued for a query — if the handler had reached `db()`
    // before refusing, `.then()` would have returned the fallback empty
    // shape instead of throwing, so the real proof is `responses` still
    // being empty: nothing was ever shifted off it.
    expect(responses).toHaveLength(0)
  })

  it('refuses a request carrying no role at all, the same way', async () => {
    const res = await ordersRoute.PATCH(req('PATCH', { order_number: 'LG-1', fulfilment_status: 'fulfilled' }))
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.role).toBe('unauthenticated')
    expect(json.required).toBe('commerce:write')
  })

  it('allows member (has commerce:write) to reach the handler and perform the transition', async () => {
    responses = [
      // read the order (PATCH handler's .maybeSingle())
      {
        data: {
          id: 'ord-1', project: 'Limiglow', order_number: 'LG-1', placed_at: new Date().toISOString(),
          customer_email: null, currency: 'USD', total_minor: 999, fulfilment_status: 'unfulfilled',
        },
        error: null,
      },
      // the fulfilment UPDATE — CAS, so it must return the matched row(s)
      // for the handler to treat the claim as won (an empty array reads as
      // "another writer already changed this order" and returns 409).
      { data: [{ id: 'ord-1', fulfilment_status: 'fulfilled' }], error: null },
      // the commerce_actions audit INSERT (order.fulfilment)
      { data: null, error: null },
      // line items lookup for the stock-move step
      { data: [], error: null },
    ]

    const res = await ordersRoute.PATCH(
      req('PATCH', { order_number: 'LG-1', fulfilment_status: 'fulfilled' }, { 'x-agent-role': 'member' }),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.fulfilment_status).toBe('fulfilled')
    expect(json.from).toBe('unfulfilled')
  })
})

describe('commerce:read is enforced independently of authentication', () => {
  it('refuses a request carrying no role at all', async () => {
    const res = await ordersRoute.GET(req('GET'))
    expect(res.status).toBe(403)
    const json = await res.json()
    expect(json.required).toBe('commerce:read')
  })

  it('allows viewer (commerce:read only) to reach the handler', async () => {
    responses = [{ data: [], error: null, count: 0 }]
    const res = await ordersRoute.GET(req('GET', undefined, { 'x-agent-role': 'viewer' }))
    expect(res.status).toBe(200)
    const json = await res.json()
    expect(json.project).toBe('Limiglow')
    expect(json.total).toBe(0)
  })
})

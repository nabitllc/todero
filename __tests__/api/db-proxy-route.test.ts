/**
 * The browser proxy is the last place a vendor URL could hide. These tests pin
 * the two properties that matter: it executes through `db()` (never forwards a
 * query string anywhere), and an unconfigured environment produces a 503 that
 * names the missing variables instead of an opaque failure or an empty array.
 */

import { NextRequest } from 'next/server'
import { DbConfigurationError } from '@/lib/db/errors'

type Call = [string, ...unknown[]]

const calls: Call[] = []
let result: { data: unknown; error: { message: string } | null; count: null } = {
  data: [],
  error: null,
  count: null,
}
let throwOnFrom: Error | null = null

jest.mock('@/lib/db', () => {
  const actual = jest.requireActual('@/lib/db')
  const builder: Record<string, unknown> = {}
  const proxy: unknown = new Proxy(builder, {
    get(_t, prop: string) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
      }
      return (...args: unknown[]) => {
        calls.push([prop, ...args])
        return proxy
      }
    },
  })
  return {
    ...actual,
    db: () => ({
      provider: 'test',
      missingEnv: () => [],
      from: (table: string) => {
        if (throwOnFrom) throw throwOnFrom
        calls.push(['from', table])
        return proxy
      },
      rpc: () => Promise.resolve(result),
    }),
  }
})

// Imported after the mock so the route picks it up.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const route = require('@/app/api/db/[...path]/route') as typeof import('@/app/api/db/[...path]/route')

/** `NextRequest`'s init type is narrower than the DOM's; take its own. */
type NextRequestInit = ConstructorParameters<typeof NextRequest>[1]

function request(url: string, init: NextRequestInit = {}): NextRequest {
  const req = new NextRequest(`http://localhost:3000${url}`, init)
  req.cookies.set('mc-auth', process.env.MC_PASSWORD ?? 'kaos2026')
  req.cookies.set('mc-role', 'owner')
  return req
}

beforeEach(() => {
  calls.length = 0
  throwOnFrom = null
  result = { data: [], error: null, count: null }
})

describe('/api/db proxy', () => {
  it('executes a read as seam calls, not as a forwarded query string', async () => {
    result = { data: [{ id: '1' }], error: null, count: null }
    const res = await route.GET(
      request('/api/db/issues?status=in.(open,in_progress)&sprint=not.is.null&select=id&limit=5'),
      { params: { path: ['issues'] } },
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([{ id: '1' }])
    expect(calls).toEqual([
      ['from', 'issues'],
      ['select', 'id'],
      ['in', 'status', ['open', 'in_progress']],
      ['not', 'sprint', 'is', null],
      ['limit', 5],
    ])
  })

  it('still answers the older /rest/v1/<table> path shape', async () => {
    await route.GET(request('/api/db/rest/v1/issues?select=id'), {
      params: { path: ['rest', 'v1', 'issues'] },
    })
    expect(calls[0]).toEqual(['from', 'issues'])
  })

  it('turns a PATCH into update() plus filters', async () => {
    const res = await route.PATCH(
      request('/api/db/issues?id=eq.abc', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'open' }),
        headers: { 'content-type': 'application/json' },
      }),
      { params: { path: ['issues'] } },
    )
    expect(res.status).toBe(200)
    expect(calls).toEqual([
      ['from', 'issues'],
      ['update', { status: 'open' }],
      ['eq', 'id', 'abc'],
      ['select', '*'],
    ])
  })

  // The variable name is deliberately not a real one: which vars the active
  // adapter needs is the adapter's business (lib/__tests__/db-seam.test.ts
  // covers that). What this pins is that the route relays them verbatim.
  it('answers 503 naming the missing variables when the database is unconfigured', async () => {
    const MISSING = 'EXAMPLE_DB_URL'
    throwOnFrom = new DbConfigurationError(
      `Database is not configured. Missing environment variable: ${MISSING}.`,
      [MISSING],
    )
    const res = await route.GET(request('/api/db/issues?select=id'), {
      params: { path: ['issues'] },
    })
    expect(res.status).toBe(503)
    const body = await res.json()
    expect(body.error).toContain(MISSING)
    expect(body.missingEnv).toEqual([MISSING])
  })

  it('answers 400 rather than guessing at a filter it cannot express', async () => {
    const res = await route.GET(request('/api/db/issues?status=bogus.open'), {
      params: { path: ['issues'] },
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/Unsupported filter operator/)
  })

  it('refuses a table that is not on the allowlist', async () => {
    const res = await route.GET(request('/api/db/workspace_members?select=*'), {
      params: { path: ['workspace_members'] },
    })
    expect(res.status).toBe(404)
    expect(calls).toEqual([])
  })
})

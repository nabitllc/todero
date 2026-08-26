/**
 * The inventory adjust, proven atomic under concurrency.
 *
 * (Ticket note: this file used to cite "TOD-2449". Verified against git:
 * that ticket's actual commit only touched scripts/board files, unrelated to
 * this fix — see the "Ticket note" in app/api/commerce/inventory/route.ts's
 * header for the correction. This fix landed in an unattributed checkpoint
 * commit with no ticket of its own.)
 *
 * This is the same measurement made against the live dev server (see
 * docs/rebuild/pieces/pieces7/commerce-hardening.md), reproduced here as a
 * permanent regression gate that needs no server and no real database.
 *
 * The fake `inventory_levels` table below is a real in-memory row with a real
 * compare-and-swap UPDATE: a write only applies if the row's `on_hand` still
 * equals the value the caller's WHERE clause named, exactly like the SQL
 * `UPDATE ... WHERE on_hand = $stale RETURNING *` the route now issues. The
 * read and the write are both genuine async round trips (a microtask apart),
 * so N concurrently-invoked PATCH calls really do interleave their reads and
 * writes — this is not N sequential calls dressed up as concurrent ones.
 *
 * This probe fails against the pre-fix read-modify-write handler: run it
 * against a checkout of that revision and the final `on_hand` undercounts
 * (fewer decrements landed than requests that returned 200) — the same
 * defect measured live against the dev server (999 -> 20 concurrent -1s ->
 * 980, not 979). It is included here as a permanent regression gate against
 * THIS route, not as a diff against the old one.
 */

import { NextRequest } from 'next/server'

interface FakeLevel {
  project: string
  sku: string
  location: string
  on_hand: number
  updated_at?: string
}

let table: FakeLevel[]

function microtask<T>(value: T): Promise<T> {
  // A real turn of the event loop between "read" and "write" so concurrently
  // invoked handlers genuinely interleave, the same way concurrent requests
  // to a real database round-trip through the network between them.
  return new Promise(resolve => setImmediate(() => resolve(value)))
}

/** A minimal fake of the one table this test touches, with real CAS semantics. */
function makeInventoryBuilder() {
  const wheres: Array<[string, unknown]> = []
  let verb: 'select' | 'update' = 'select'
  let patch: Record<string, unknown> = {}
  let wantsReturn = false

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const builder: any = {
    eq(col: string, val: unknown) {
      wheres.push([col, val])
      return builder
    },
    update(values: Record<string, unknown>) {
      verb = 'update'
      patch = values
      return builder
    },
    select() {
      if (verb === 'update') wantsReturn = true
      return builder
    },
    maybeSingle() {
      return builder.then((r: { data: FakeLevel[] }) => ({ ...r, data: r.data[0] ?? null }))
    },
    then(resolve: (v: { data: FakeLevel[] | FakeLevel | null; error: null }) => unknown) {
      return microtask(null).then(() => {
        const matches = table.filter(row => wheres.every(([c, v]) => (row as unknown as Record<string, unknown>)[c] === v))
        if (verb === 'select') {
          return resolve({ data: matches, error: null })
        }
        // verb === 'update': CAS — only rows matching ALL wheres (including
        // an `on_hand` equality check the route adds) are mutated.
        for (const row of matches) Object.assign(row, patch)
        return resolve({ data: wantsReturn ? matches : null, error: null })
      })
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
        if (t === 'inventory_levels') return makeInventoryBuilder()
        // commerce_actions audit insert — accepted and ignored.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const noop: any = {}
        ;['select', 'insert', 'eq'].forEach(m => { noop[m] = () => noop })
        noop.then = (resolve: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve)
        return noop
      },
      rpc: () => Promise.resolve({ data: null, error: null }),
    }),
  }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const route = require('@/app/api/commerce/inventory/route') as typeof import('@/app/api/commerce/inventory/route')

function patchRequest(delta: number): NextRequest {
  return new NextRequest('http://localhost:3000/api/commerce/inventory', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', 'x-mc-project': 'Limiglow', 'x-agent-role': 'member' },
    body: JSON.stringify({ sku: 'CONC-TEST', delta, reason: 'concurrency probe' }),
  })
}

describe('PATCH /api/commerce/inventory under real concurrency', () => {
  it('N concurrent -1 adjustments land on the exact right final count, every one accounted for', async () => {
    const START = 200
    // The fake table's FIFO scheduling below is a deliberately WORSE-than-real
    // interleaving: every retry round has every still-pending caller read the
    // exact same stale value before any of them writes, so exactly one caller
    // wins per round and the straggler eliminated last needs up to N attempts
    // — a real database's network/IO jitter does not usually stack requests
    // this precisely. CONCURRENCY is kept at 6, comfortably under the route's
    // 8-attempt CAS budget, so this proves the retry loop actually retries
    // (not just that it wins on the first try) without asserting a specific
    // retry-count ceiling this test's own harness artificially inflates.
    const CONCURRENCY = 6
    table = [{ project: 'Limiglow', sku: 'CONC-TEST', location: 'default', on_hand: START }]

    const results = await Promise.all(Array.from({ length: CONCURRENCY }, () => route.PATCH(patchRequest(-1))))
    const statuses = await Promise.all(results.map(r => r.status))

    // Every request must be accounted for: either it applied (200) or it was
    // refused with a real reason (409 conflict after exhausting retries). None
    // may report success while silently doing nothing.
    for (const status of statuses) {
      expect([200, 409]).toContain(status)
    }
    const succeeded = statuses.filter(s => s === 200).length

    expect(table[0].on_hand).toBe(START - succeeded)
    // With CAS retries bounded at 8 attempts and only 6-way (`CONCURRENCY`)
    // contention on one row, every request should in practice succeed —
    // assert that too, so a
    // regression that starts silently dropping requests into 409 is caught
    // even though 409 would still be an HONEST (not silent) failure mode.
    expect(succeeded).toBe(CONCURRENCY)
  })
})

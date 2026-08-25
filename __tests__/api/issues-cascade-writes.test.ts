/**
 * Regression test for piece "silent-write-failures", round 4.
 *
 * The critic's finding, verbatim: "The class was fixed only where the word
 * 'upsert' appears. app/api/issues/route.ts — the MC API itself — still
 * prints and returns success over writes whose errors are never read,
 * including the very same `is_blocked=false, blocked_by=null` clear this
 * piece made honest elsewhere ... [the] downstream-unblock update".
 *
 * This exercises PATCH /api/issues end to end (mocked db): when the
 * downstream-unblock cascade write (clearing is_blocked/blocked_by on
 * issues that were waiting on the one just completed) returns an error,
 * the PATCH response must carry `cascade_failures` naming the still-blocked
 * issue, and must NOT log or imply that it was unblocked.
 */

import { NextRequest } from 'next/server'

type DbErr = { message: string; code?: string } | null
type DbResult = { data?: unknown; error: DbErr; count?: number }

/** One queued response per `.from(table)` call, consumed in call order. */
let responses: DbResult[] = []
type LoggedCall = { table: string; verb: string; args: unknown[][] }
let callLog: LoggedCall[] = []

jest.mock('@/lib/db', () => {
  const actual = jest.requireActual('@/lib/db')

  function makeBuilder(table: string) {
    let verb = 'unknown'
    const args: unknown[][] = []
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {}
    const chain = (name: string) => (...callArgs: unknown[]) => {
      if (['select', 'upsert', 'update', 'insert', 'delete'].includes(name)) verb = name
      args.push(callArgs)
      return builder
    }
    ;[
      'select', 'eq', 'neq', 'limit', 'order', 'upsert', 'update', 'insert',
      'delete', 'single', 'maybeSingle', 'not', 'like', 'in',
    ].forEach(m => {
      builder[m] = chain(m)
    })
    builder.then = (resolve: (v: DbResult) => unknown) => {
      callLog.push({ table, verb, args })
      const next = responses.shift() ?? { data: null, error: null }
      return Promise.resolve(next).then(resolve)
    }
    return builder
  }

  return {
    ...actual,
    db: () => ({
      provider: 'test',
      missingEnv: () => [],
      from: (table: string) => makeBuilder(table),
      rpc: () => Promise.resolve({ data: null, error: null }),
    }),
  }
})

// Imported after the mock so the route picks it up.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const route = require('@/app/api/issues/route') as typeof import('@/app/api/issues/route')

function patchRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/issues', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

const ISSUE_ID = 'issue-999'
const BEFORE_ROW = {
  id: ISSUE_ID,
  task_key: 'TOD-999',
  status: 'approved',
  type: 'task',
  assignee: 'builder',
  is_blocked: false,
  blocked_by: null,
  parent_id: null,
  resolution_type: 'code_change',
}
const UPDATED_ROW = { ...BEFORE_ROW, status: 'completed' }

let fetchSpy: jest.SpyInstance

beforeEach(() => {
  responses = []
  callLog = []
  // Guard against any incidental network call (e.g. selfChain/activate agent
  // dispatch) reaching out for real during the test.
  fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }))
})

afterEach(() => {
  fetchSpy.mockRestore()
})

describe('PATCH /api/issues — downstream-unblock cascade write failure is honest', () => {
  it('reports cascade_failures naming the still-blocked issue instead of a clean 200', async () => {
    responses = [
      // 1. beforeQ — fetch the issue being transitioned
      { data: BEFORE_ROW, error: null },
      // 2. workflow_transitions lookup — no row on file; accepted via owner override (transitioned_by=michael)
      { data: null, error: null },
      // 3. main update — the issue actually transitions to 'completed'
      { data: UPDATED_ROW, error: null },
      // 4. close running agent_runs for this task — succeeds
      { error: null },
      // 5. downstream unblock: find issues blocked_by this one, is_blocked=true
      { data: [{ id: 'issue-1000', task_key: 'TOD-1000' }], error: null },
      // 6. downstream unblock: the actual clear — THIS is the write that fails
      { error: { message: 'connection reset by peer' } },
      // 7. in-app notification insert on status transition — succeeds
      { data: null, error: null },
      // 8. activity_events insert for status_changed — succeeds
      { data: null, error: null },
    ]

    const res = await route.PATCH(patchRequest({
      id: ISSUE_ID,
      status: 'completed',
      transitioned_by: 'michael',
    }))
    const json = await res.json()

    expect(res.status).toBe(200)

    // The honesty check: a downstream issue that was NOT unblocked must be
    // named in cascade_failures, not silently dropped behind a bare 200.
    // eslint-disable-next-line no-console
    console.log('DEBUG json:', JSON.stringify(json))
    // eslint-disable-next-line no-console
    console.log('DEBUG callLog:', JSON.stringify(callLog.map(c => ({ table: c.table, verb: c.verb }))))
    expect(Array.isArray(json.cascade_failures)).toBe(true)
    const failure = (json.cascade_failures as string[]).find((f: string) => f.includes('TOD-1000'))
    expect(failure).toBeDefined()
    expect(failure).toMatch(/NOT unblocked/)
    expect(failure).toMatch(/connection reset by peer/)

    // Must never claim the unblock happened.
    expect(JSON.stringify(json)).not.toMatch(/unblocked and re-dispatchable/)

    // The failing write must have actually been attempted with the right
    // predicate — not skipped outright.
    const unblockUpdate = callLog.find(c => c.table === 'issues' && c.verb === 'update' &&
      c.args.some(a => a[0] && typeof a[0] === 'object' && (a[0] as Record<string, unknown>).is_blocked === false))
    expect(unblockUpdate).toBeDefined()
  })

  it('reports success with no cascade_failures when the same write succeeds', async () => {
    responses = [
      { data: BEFORE_ROW, error: null },
      { data: null, error: null },
      { data: UPDATED_ROW, error: null },
      { error: null }, // agent_runs close
      { data: [{ id: 'issue-1000', task_key: 'TOD-1000' }], error: null },
      { error: null }, // downstream unblock succeeds this time
      { data: null, error: null }, // notification insert
      { data: null, error: null }, // activity event insert
    ]

    const res = await route.PATCH(patchRequest({
      id: ISSUE_ID,
      status: 'completed',
      transitioned_by: 'michael',
    }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.cascade_failures).toBeUndefined()
  })
})

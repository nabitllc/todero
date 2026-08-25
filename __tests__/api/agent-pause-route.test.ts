/**
 * Regression test for piece "silent-write-failures" (TOD-766 follow-up).
 *
 * The critic's finding, verbatim: "Approving a loop_breaker_pause un-pauses
 * the agent but never clears the issues.is_blocked / blocked_by=
 * 'system:loop_breaker' that the same loop breaker set — and then reports
 * {ok:true, un-paused, failure counter reset}, so the operator is shown a
 * full recovery when the agent still cannot run." This exercises that path
 * through the direct PATCH /api/agent-pause toggle (components/crew/
 * AgentDetailView.tsx togglePause()) — a second route reaching the same
 * agent_memory rows the inbox loop_breaker_pause effect handler touches, so
 * fixing only the inbox route would leave this one lying the same way.
 *
 * Also pins: every agent_memory upsert here declares onConflict:
 * 'agent_id,key' (agent_memory's real uniqueness — it predates the
 * migrations directory, see migrations/016_agent_documents.sql), and a
 * failed upsert is never reported as ok:true.
 */

import { NextRequest } from 'next/server'

type DbErr = { message: string; code?: string } | null
type DbResult = { data?: unknown; error: DbErr }

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
    ;['select', 'eq', 'limit', 'order', 'upsert', 'update', 'insert', 'delete'].forEach(m => {
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
const route = require('@/app/api/agent-pause/route') as typeof import('@/app/api/agent-pause/route')

function patchRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/agent-pause', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  responses = []
  callLog = []
})

describe('PATCH /api/agent-pause — un-pausing a loop-breaker-paused agent', () => {
  it('clears the issue block the loop breaker set, and reports it honestly', async () => {
    responses = [
      // readMemory('is_paused') — carries the issue the loop breaker blocked
      { data: [{ value: { paused: true, last_issue_id: 'issue-1' } }], error: null },
      // upsert is_paused=false
      { error: null },
      // upsert loop_breaker reset
      { error: null },
      // select issues by id
      { data: [{ id: 'issue-1', task_key: 'TOD-999', blocked_by: 'system:loop_breaker' }], error: null },
      // update issues clearing the block
      { error: null },
    ]

    const res = await route.PATCH(patchRequest({ agent: 'builder', paused: false }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(json.is_paused).toBe(false)
    expect(json.issue_unblocked).toBe(true)
    expect(json.still_blocked_by).toBeNull()
    expect(json.message).toMatch(/TOD-999 unblocked and re-dispatchable/)

    // Both agent_memory upserts must declare the real conflict target —
    // never the seam's primary-key default.
    const memoryUpserts = callLog.filter(c => c.table === 'agent_memory' && c.verb === 'upsert')
    expect(memoryUpserts).toHaveLength(2)
    for (const call of memoryUpserts) {
      const upsertCall = call.args.find(a => a.length === 2) // [payload, options]
      expect(upsertCall?.[1]).toEqual({ onConflict: 'agent_id,key' })
    }

    // The issue update must actually clear is_blocked/blocked_by, guarded to
    // the block this route owns.
    const issueUpdate = callLog.find(c => c.table === 'issues' && c.verb === 'update')
    expect(issueUpdate).toBeDefined()
    const [patch] = issueUpdate!.args[0] as [Record<string, unknown>]
    expect(patch.is_blocked).toBe(false)
    expect(patch.blocked_by).toBeNull()
  })

  it('reports the agent as un-paused but still blocked when something else owns the block', async () => {
    responses = [
      { data: [{ value: { paused: true, last_issue_id: 'issue-1' } }], error: null },
      { error: null }, // is_paused upsert
      { error: null }, // loop_breaker upsert
      // A ceiling stop blocked the same issue after the loop breaker did.
      { data: [{ id: 'issue-1', task_key: 'TOD-999', blocked_by: 'system:ceiling_stop:daily_cost' }], error: null },
    ]

    const res = await route.PATCH(patchRequest({ agent: 'builder', paused: false }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true) // the un-pause write itself succeeded
    expect(json.is_paused).toBe(false)
    expect(json.issue_unblocked).toBe(false)
    expect(json.still_blocked_by).toBe('system:ceiling_stop:daily_cost')
    expect(json.message).toMatch(/still blocked by system:ceiling_stop:daily_cost/)
    expect(json.message).not.toMatch(/unblocked and re-dispatchable/)

    // Never clear a block this route doesn't own.
    const issueUpdate = callLog.find(c => c.table === 'issues' && c.verb === 'update')
    expect(issueUpdate).toBeUndefined()
  })

  it('never reports ok:true when the write that carries the pause state fails', async () => {
    responses = [
      // upsert is_paused fails outright
      { error: { message: 'connection reset' } },
    ]

    const res = await route.PATCH(patchRequest({ agent: 'builder', paused: true }))
    const json = await res.json()

    expect(json.ok).not.toBe(true)
    expect(JSON.stringify(json)).toMatch(/connection reset/)
  })

  it('reports the failure counter reset failing instead of a blanket ok:true', async () => {
    responses = [
      { data: [{ value: { paused: true } }], error: null }, // readMemory, no last_issue_id
      { error: null }, // is_paused upsert succeeds
      { error: { message: 'unique_violation' } }, // loop_breaker reset upsert fails
    ]

    const res = await route.PATCH(patchRequest({ agent: 'builder', paused: false }))
    const json = await res.json()

    expect(json.ok).toBe(false)
    expect(json.error).toMatch(/unique_violation/)
  })
})

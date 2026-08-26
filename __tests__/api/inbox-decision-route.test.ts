/**
 * __tests__/api/inbox-decision-route.test.ts — the WIRING, not the policy.
 *
 * WHY THIS FILE EXISTS. A fresh-context critic mutation-tested Wave 8's
 * approval gate and found one surviving mutant. With
 *
 *     if (false && !authorized.ok) {          // app/api/inbox/route.ts
 *
 * — the entire actor gate disabled — every approval and inbox suite still
 * passed (5 suites, 79 tests) and `node scripts/acceptance/run.mjs` stayed
 * 45/45. The critic then proved by HTTP that the gate WAS load-bearing:
 * with the mutant live, a read-only `mc-auth=view2026` session approved a
 * request and released the agent with a 200. So the gate mattered, and
 * nothing in the suite noticed when it was removed.
 *
 * The reason is that every existing test aimed at the pure functions in
 * `lib/approvals.ts`, and the one acceptance item that mentioned the route
 * was a `grep`. A grep proves a string is present; it cannot prove the
 * branch runs. This suite calls `PATCH` itself and asserts on the response
 * AND on the queries the route did or did not issue.
 *
 * FOUR THINGS IT PINS, each one a mutant it would catch:
 *   1. The actor gate is CALLED (delete or disable it → cases 1–3 fail).
 *   2. The role comes from the CREDENTIAL, not the `mc-role` cookie
 *      (restore the old `resolveRole` → case 2 fails).
 *   3. A refusal writes NOTHING to `inbox` and ONE row to
 *      `approval_decisions` (a refusal that silently updates, or that leaves
 *      no evidence, fails case 4).
 *   4. The gate is not simply refusing everything (case 5).
 *
 * The db mock follows __tests__/api/commerce-permissions.test.ts and
 * __tests__/api/agent-pause-route.test.ts — a queue of responses, with the
 * table/method/payload of every call recorded, because "what did NOT get
 * written" is half of what is asserted here.
 *
 * ONE DELIBERATE DIFFERENCE: the queue is keyed by `table.method` rather than
 * being one flat list. With a flat list, a mutant that SKIPS a query shifts
 * every later response onto the wrong call, and the suite fails with a
 * serialization error from deep inside the route instead of the assertion
 * that was actually violated. Verified: the "reads only context.last_issue_id"
 * mutant failed this suite either way, but only the keyed queue said why.
 */

import { NextRequest } from 'next/server'

type DbErr = { message: string; code?: string } | null
type DbResult = { data?: unknown; error: DbErr; count?: number | null }

/** `table.method` -> responses for that call, in order. */
let responses: Record<string, DbResult[]> = {}
let calls: Array<{ table: string; method: string; payload?: unknown }> = []

/** Queue one response for the Nth `<table>.<method>` call of the request. */
function expectQuery(key: string, result: DbResult) {
  ;(responses[key] ??= []).push(result)
}

jest.mock('@/lib/db', () => {
  const actual = jest.requireActual('@/lib/db')

  function makeBuilder(table: string) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const builder: any = {}
    // The FIRST of the five, not the last: the write chain is
    // `.update(...).eq(...).select().single()`, so keying on the last call
    // would file every update's response under `<table>.select`.
    let method: string | null = null
    const passthrough = () => () => builder
    ;[
      'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in',
      'contains', 'not', 'or', 'filter', 'match', 'order', 'limit', 'range', 'join', 'returns',
    ].forEach(m => { builder[m] = passthrough() })
    // The five that mean something was READ or WRITTEN get recorded.
    ;['select', 'insert', 'upsert', 'update', 'delete'].forEach(m => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      builder[m] = (...args: any[]) => {
        method ??= m
        calls.push({ table, method: m, payload: args[0] })
        return builder
      }
    })
    const next = (fallback: DbResult) => responses[`${table}.${method ?? 'select'}`]?.shift() ?? fallback
    builder.single = () => Promise.resolve(next({ data: null, error: null }))
    builder.maybeSingle = () => Promise.resolve(next({ data: null, error: null }))
    builder.then = (resolve: (v: DbResult) => unknown) =>
      Promise.resolve(next({ data: [], error: null, count: 0 })).then(resolve)
    return builder
  }

  return {
    ...actual,
    // The route's first line is `dbUnavailableResponse()`, which reads this.
    // Left real it answers 503 in a test env with no database configured,
    // and every assertion below would be about the wrong thing.
    dbMissingEnv: () => [],
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
const inboxRoute = require('@/app/api/inbox/route') as typeof import('@/app/api/inbox/route')

const INBOX_ID = '11111111-2222-3333-4444-555555555555'

/** A pending request that points at NO issue, so the route's issue lookup and
 *  project lookup both short-circuit and the mock queue stays readable. */
function pendingRow() {
  return {
    id: INBOX_ID,
    agent: 'fixture-agent',
    type: 'loop_breaker_pause',
    context: { agent_id: 'fixture-agent', project: 'Limiglow' },
    status: 'pending',
    issue_id: null,
    resolved_by: null,
    resolved_at: null,
  }
}

function patch(cookie: string, body: Record<string, unknown>): NextRequest {
  return new NextRequest('http://localhost:3000/api/inbox', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  })
}

const OWNER = 'mc-auth=kaos2026; mc-role=owner'
/** The escalation: the READ-ONLY viewer password, with the cookie typed up. */
const VIEWER_CLAIMING_ADMIN = 'mc-auth=view2026; mc-role=admin'
const VIEWER = 'mc-auth=view2026; mc-role=viewer'

beforeEach(() => {
  responses = {}
  calls = []
})

/** Every table+method the route touched, as `table.method` strings. */
function touched(): string[] {
  return calls.map(c => `${c.table}.${c.method}`)
}

describe('PATCH /api/inbox — the actor gate is wired into the route', () => {
  it('refuses a viewer session outright, and the refusal comes from the ROUTE', async () => {
    expectQuery('inbox.select', { data: pendingRow(), error: null })
    const res = await inboxRoute.PATCH(
      patch(VIEWER, { id: INBOX_ID, status: 'approved', resolved_by: 'michael' }),
    )
    const body = await res.json()
    expect(res.status).toBe(403)
    expect(body.code).toBe('PERMISSION_DENIED')
    expect(body.role).toBe('viewer')
    expect(body.required).toBe('issues:write')
    expect(body.request_status).toBe('pending')
  })

  it('THE ESCALATION: the same read-only credential with mc-role=admin is still refused', async () => {
    // Measured live on 2026-08-26 BEFORE this was fixed: this exact request
    // returned HTTP 200, un-paused the agent, and filed itself in the
    // append-only trail as `"michael (admin)"`. The one variable between it
    // and the refused request above is a cookie the client types.
    expectQuery('inbox.select', { data: pendingRow(), error: null })
    const res = await inboxRoute.PATCH(
      patch(VIEWER_CLAIMING_ADMIN, { id: INBOX_ID, status: 'approved', resolved_by: 'michael' }),
    )
    const body = await res.json()
    expect(res.status).toBe(403)
    expect(body.code).toBe('PERMISSION_DENIED')
    // The role is the one the CREDENTIAL proves, not the one asked for.
    expect(body.role).toBe('viewer')
    // And the attempt to claim more is reported rather than silently dropped.
    expect(body.ignored_role_claim).toBe('admin')
    expect(body.error).toContain('mc-role')
  })

  it('refuses an approval signed in the requesting agent\'s own name', async () => {
    expectQuery('inbox.select', { data: pendingRow(), error: null })
    const res = await inboxRoute.PATCH(
      patch(OWNER, { id: INBOX_ID, status: 'approved', resolved_by: 'fixture-agent' }),
    )
    const body = await res.json()
    expect(res.status).toBe(403)
    expect(body.code).toBe('SELF_APPROVAL')
  })

  it('a refusal writes NOTHING to inbox and exactly one approval_decisions row', async () => {
    expectQuery('inbox.select', { data: pendingRow(), error: null })
    await inboxRoute.PATCH(
      patch(VIEWER_CLAIMING_ADMIN, { id: INBOX_ID, status: 'approved', resolved_by: 'michael' }),
    )
    // The request must be exactly as pending as it was: no update, no upsert,
    // no delete against `inbox` anywhere in the refusal path.
    expect(touched()).not.toContain('inbox.update')
    expect(touched()).not.toContain('inbox.upsert')
    expect(touched()).not.toContain('inbox.delete')
    // A permission that refuses silently leaves no evidence it was exercised.
    expect(touched().filter(t => t === 'approval_decisions.insert')).toHaveLength(1)
  })

  it('is not simply refusing everything: an owner approval reaches the write', async () => {
    expectQuery('inbox.select', { data: pendingRow(), error: null })
    expectQuery('inbox.update', { data: { ...pendingRow(), status: 'approved' }, error: null })
    const res = await inboxRoute.PATCH(
      patch(OWNER, { id: INBOX_ID, status: 'approved', resolved_by: 'michael' }),
    )
    expect(res.status).toBe(200)
    expect(touched()).toContain('inbox.update')
  })

  it('records the decision as "<claim> (<role>)" with the role the CREDENTIAL proved', async () => {
    expectQuery('inbox.select', { data: pendingRow(), error: null })
    expectQuery('inbox.update', { data: { ...pendingRow(), status: 'approved' }, error: null })
    await inboxRoute.PATCH(
      patch(OWNER, { id: INBOX_ID, status: 'approved', resolved_by: 'michael' }),
    )
    // The suffix is the whole point: no caller sent it, and it names what the
    // login actually grants (app/api/auth/route.ts maps MC_PASSWORD -> owner).
    const update = calls.find(c => c.table === 'inbox' && c.method === 'update')
    expect((update?.payload as { resolved_by?: string } | undefined)?.resolved_by)
      .toBe('michael (owner)')
    // And the same string reaches the append-only trail, not a different one.
    const audit = calls.find(c => c.table === 'approval_decisions' && c.method === 'insert')
    expect((audit?.payload as { decided_by?: string } | undefined)?.decided_by)
      .toBe('michael (owner)')
  })

  it('a refusal is filed against the role the credential proved, never the claimed one', async () => {
    expectQuery('inbox.select', { data: pendingRow(), error: null })
    await inboxRoute.PATCH(
      patch(VIEWER_CLAIMING_ADMIN, { id: INBOX_ID, status: 'approved', resolved_by: 'michael' }),
    )
    const audit = calls.find(c => c.table === 'approval_decisions' && c.method === 'insert')
    const row = audit?.payload as { decided_by?: string; outcome?: string; effect?: string } | undefined
    // Before the fix this row read "michael (admin)" — an audit trail
    // recording the escalation as the thing it was escalating to.
    expect(row?.decided_by).toBe('michael (viewer)')
    expect(row?.outcome).toBe('refused')
    expect(row?.effect).toBe('PERMISSION_DENIED')
  })
})

describe('PATCH /api/inbox — the effect acts on the issue the LABEL promised', () => {
  const ISSUE_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'

  /** A request linked through the `inbox.issue_id` COLUMN and NOT through
   *  `context.last_issue_id`. `POST /api/inbox` accepts `issue_id` as
   *  first-class and has a PGRST204 retry to persist it, so this is a row
   *  shape the API itself produces. */
  function columnLinkedRow() {
    return {
      id: INBOX_ID,
      agent: 'fixture-agent',
      type: 'loop_breaker_pause',
      context: { agent_id: 'fixture-agent' },
      status: 'pending',
      issue_id: ISSUE_ID,
      resolved_by: null,
      resolved_at: null,
    }
  }

  it('unblocks the issue named on the row, instead of reporting a green no-op', async () => {
    // MEASURED LIVE BEFORE THE FIX, 2026-08-26, on exactly this row shape:
    // HTTP 200, `response_data.ok: true`, detail "un-paused (request carried
    // no issue — nothing to unblock)", audit row filed `applied` — while
    // `describeApproval()` had labelled the button "Approve — un-pause
    // fixture-agent and unblock <issue>" and `preflightDecision()` had
    // checked that same issue exists. The label, the preflight and the effect
    // disagreed about what the decision acts on; only the effect was wrong.
    const row = columnLinkedRow()
    expectQuery('inbox.select', { data: row, error: null })
    // Two `issues.select`s, in order: placing the row in a project, then the
    // preflight's "does the issue still exist".
    expectQuery('issues.select', { data: [{ id: ISSUE_ID, task_key: 'TOD-298', project: 'Limiglow' }], error: null })
    expectQuery('issues.select', { data: [{ id: ISSUE_ID }], error: null })
    // Two `inbox.update`s: the decision, then the response_data payload.
    expectQuery('inbox.update', { data: { ...row, status: 'approved' }, error: null })
    expectQuery('inbox.update', { data: { ...row, status: 'approved' }, error: null })
    // The effect's own reads: what the block currently is.
    expectQuery('issues.select', { data: [{ id: ISSUE_ID, task_key: 'TOD-298', blocked_by: 'system:loop_breaker' }], error: null })

    const res = await inboxRoute.PATCH(
      patch(OWNER, { id: INBOX_ID, status: 'approved', resolved_by: 'michael' }),
    )
    expect(res.status).toBe(200)

    // The load-bearing assertion: the block on the issue was actually cleared.
    // Reading only `context.last_issue_id` makes this update never happen.
    const clear = calls.find(c => c.table === 'issues' && c.method === 'update')
    expect(clear).toBeDefined()
    expect(clear?.payload).toMatchObject({ is_blocked: false, blocked_by: null })

    // And the audit row says an unblock happened, not a no-op.
    const audit = calls.find(c => c.table === 'approval_decisions' && c.method === 'insert')
    const auditRow = audit?.payload as { outcome?: string; detail?: string } | undefined
    expect(auditRow?.outcome).toBe('applied')
    expect(auditRow?.detail).toContain('unblocked')
    expect(auditRow?.detail).not.toContain('nothing to unblock')
  })
})

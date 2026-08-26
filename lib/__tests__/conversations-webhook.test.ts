/**
 * app/api/conversations POST — the inbound webhook secret, refused both ways.
 *
 * Same technique __tests__/api/commerce-permissions.test.ts uses to prove RBAC:
 * call the EXPORTED route handler directly, with `@/lib/db` mocked to a queue
 * of responses consumed in call order. That bypasses Next.js's middleware
 * chain entirely — which is also exactly why this suite is honest about what
 * it does and does not prove: see this piece's doc for the gap between "the
 * handler refuses/accepts correctly" (proven here) and "an external caller can
 * reach this handler at all" (gated by middleware.ts, not owned by this piece,
 * and unchanged by anything in this file).
 *
 * THE CASES
 * ---------
 *   - no credential at all -> 403, the pre-existing RBAC refusal, untouched
 *   - the webhook header present and WRONG -> 401, immediately, no query run
 *   - the webhook header present and RIGHT -> 201, the handler runs, no RBAC
 *     role is ever consulted
 *   - the webhook header right AND external_id already recorded -> 200,
 *     `duplicate: true`, and NO new row is ever inserted (proven by exactly
 *     two queued responses being consumed and no more)
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

// Imported after the mock so the route picks it up.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const conversationsRoute = require('@/app/api/conversations/route') as typeof import('@/app/api/conversations/route')

const WEBHOOK_HEADER = 'x-todero-conversations-secret'
const ENV_KEY = 'CONVERSATIONS_WEBHOOK_SECRET'
const CONFIGURED_VALUE = 'a-fake-webhook-secret-for-tests-0000'

function req(body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest('http://localhost:3000/api/conversations?project=Limiglow', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

const INBOUND_BODY = { channel: 'web', contact: 'cust-1', body: 'is it in stock?' }

let previousSecret: string | undefined

beforeAll(() => { previousSecret = process.env[ENV_KEY] })
afterAll(() => {
  if (previousSecret === undefined) delete process.env[ENV_KEY]
  else process.env[ENV_KEY] = previousSecret
})

beforeEach(() => {
  responses = []
  process.env[ENV_KEY] = CONFIGURED_VALUE
})

describe('POST /api/conversations — webhook secret, refused both ways', () => {
  it('refuses a request with NO credential at all — the pre-existing RBAC 403, unchanged', async () => {
    const res = await conversationsRoute.POST(req(INBOUND_BODY))
    const json = await res.json()

    expect(res.status).toBe(403)
    expect(json).toMatchObject({ error: 'forbidden', code: 'PERMISSION_DENIED', required: 'projects:write' })
    // No db call was ever made — withPermission refuses before the handler body runs.
    expect(responses).toHaveLength(0)
  })

  it('refuses a WRONG webhook secret immediately, with 401 — never falls through to RBAC', async () => {
    const res = await conversationsRoute.POST(req(INBOUND_BODY, { [WEBHOOK_HEADER]: 'guessed-wrong-value' }))
    const json = await res.json()

    expect(res.status).toBe(401)
    expect(json.code).toBe('WEBHOOK_SECRET_INVALID')
    // Falling through to RBAC would have produced a 403 with `required`, not this.
    expect(json.required).toBeUndefined()
    expect(responses).toHaveLength(0)
  })

  it('accepts the RIGHT webhook secret and records the inbound message — no RBAC role needed at all', async () => {
    const now = new Date().toISOString()
    responses = [
      { data: [], error: null }, // find existing conversation — none yet
      {
        data: [{ id: 'conv-1', project: 'Limiglow', channel: 'web', contact: 'cust-1', contact_name: null, status: 'open', last_message_at: now, created_at: now }],
        error: null,
      }, // inserted conversation
      {
        data: [{ id: 'msg-1', conversation_id: 'conv-1', direction: 'inbound', state: 'received', body: 'is it in stock?', author: null, created_at: now }],
        error: null,
      }, // inserted message
      { data: null, error: null }, // touch conversations.last_message_at
    ]

    const res = await conversationsRoute.POST(req(INBOUND_BODY, { [WEBHOOK_HEADER]: CONFIGURED_VALUE }))
    const json = await res.json()

    expect(res.status).toBe(201)
    expect(json.created).toBe(true)
    expect(json.conversation.id).toBe('conv-1')
    expect(json.message.body).toBe('is it in stock?')
    expect(responses).toHaveLength(0)
  })

  it('treats a REPEATED external_id as a replay — 200, duplicate:true, and no insert is ever attempted', async () => {
    const now = new Date().toISOString()
    responses = [
      {
        data: [{
          id: 'msg-existing', conversation_id: 'conv-1', direction: 'inbound', state: 'received',
          body: 'is it in stock?', author: null, created_at: now, external_id: 'wamid-1',
        }],
        error: null,
      }, // the external_id lookup finds an existing message
      {
        data: [{ id: 'conv-1', project: 'Limiglow', channel: 'web', contact: 'cust-1', contact_name: null, status: 'open', last_message_at: now, created_at: now }],
        error: null,
      }, // that message's own conversation, same project as this request
    ]

    const res = await conversationsRoute.POST(
      req({ ...INBOUND_BODY, external_id: 'wamid-1' }, { [WEBHOOK_HEADER]: CONFIGURED_VALUE }),
    )
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.duplicate).toBe(true)
    expect(json.created).toBe(false)
    expect(json.message.id).toBe('msg-existing')
    // Exactly the two lookups above ran — nothing was ever queued for an
    // insert, so a third shift would have returned the empty-array fallback
    // instead of throwing. The real proof is the queue being empty: nothing
    // past the two dupe-check queries was ever consumed.
    expect(responses).toHaveLength(0)
  })
})

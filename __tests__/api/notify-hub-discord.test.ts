/**
 * connections-discord, wave 7 — POST /api/notify wired to resolveHubDiscord().
 *
 * Before this piece, resolveHubDiscord() (lib/connections.ts) had zero
 * callers anywhere in the tree, so a Discord connection added per-hub through
 * Settings -> Connections was never consulted by anything that actually sent
 * a message: every real send path read process.env.DISCORD_BOT_TOKEN
 * directly. This is the regression test for the one send path this piece
 * wires — /api/notify, the endpoint TOD-801 built as "one place to rotate
 * tokens" and that circuit-breaker, cron/queue-refill, cron/watchdog and
 * run-sprint already call for real.
 *
 * `@/lib/db` is mocked the same way lib/__tests__/connections.test.ts mocks
 * it, so this exercises the real resolveHubDiscord() query shape rather than
 * a stub of it. `global.fetch` is mocked so nothing here reaches a real
 * network — see the piece doc for where transport is proven separately,
 * against a local listener.
 */

import { NextRequest } from 'next/server'

type DbErr = { message: string } | null
type DbResult = { data?: unknown; error: DbErr }
let queuedResponses: DbResult[] = []

jest.mock('@/lib/db', () => ({
  db: () => ({
    from: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const builder: any = {}
      ;['select', 'eq', 'order', 'in'].forEach((m) => {
        builder[m] = () => builder
      })
      builder.maybeSingle = () => Promise.resolve(queuedResponses.shift() ?? { data: null, error: null })
      return builder
    },
  }),
}))

// eslint-disable-next-line @typescript-eslint/no-var-requires
const route = require('@/app/api/notify/route') as typeof import('@/app/api/notify/route')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { encrypt } = require('@/lib/encryption') as typeof import('@/lib/encryption')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ENCRYPTION_KEY_VAR } = require('@/lib/connections') as typeof import('@/lib/connections')

const FAKE_TOKEN = ['M'.repeat(25), 'G' + 'a'.repeat(5), 'z'.repeat(38)].join('.')
const HUB_TOKEN = ['H'.repeat(25), 'H' + 'a'.repeat(5), 'h'.repeat(38)].join('.')
const TEST_KEY = Buffer.alloc(32, 7).toString('hex')

const ORIGINAL_FETCH = global.fetch
let fetchCalls: Array<{ url: string; init: RequestInit }> = []

function fetchMock(url: string, init: RequestInit = {}) {
  fetchCalls.push({ url, init })
  return Promise.resolve({
    ok: true,
    status: 200,
    text: async () => '',
  } as Response)
}

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/notify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  queuedResponses = []
  fetchCalls = []
  global.fetch = fetchMock as unknown as typeof fetch
  delete process.env.DISCORD_BOT_TOKEN
  delete process.env[ENCRYPTION_KEY_VAR]
})

afterAll(() => {
  global.fetch = ORIGINAL_FETCH
})

describe('POST /api/notify — business_id resolves through the hub connection, not a blanket env var', () => {
  it('a hub with a stored connection sends with THAT connection\'s token, not DISCORD_BOT_TOKEN', async () => {
    process.env.DISCORD_BOT_TOKEN = FAKE_TOKEN // must never be used when a hub connection resolves
    process.env[ENCRYPTION_KEY_VAR] = TEST_KEY
    queuedResponses = [
      { data: { id: 'conn-1', business_id: 'hub-1', provider: 'discord', config: '{}', custody: 'stored', credential_env_var: null }, error: null },
      { data: { ciphertext: encrypt(HUB_TOKEN) }, error: null },
    ]

    const res = await route.POST(postRequest({ text: 'hello', channels: ['discord-alerts'], business_id: 'hub-1' }))
    const json = await res.json()

    expect(res.status).toBe(200)
    expect(json.ok).toBe(true)
    expect(fetchCalls).toHaveLength(1)
    const auth = (fetchCalls[0].init.headers as Record<string, string>).Authorization
    expect(auth).toBe(`Bot ${HUB_TOKEN}`)
    expect(auth).not.toContain(FAKE_TOKEN)
    // The credential never appears anywhere in the response body.
    expect(JSON.stringify(json)).not.toContain(HUB_TOKEN)
    expect(JSON.stringify(json)).not.toContain(FAKE_TOKEN)
  })

  it('a hub with no connection and no env fallback is REFUSED, naming the hub — no silent post, no silent env fallback', async () => {
    queuedResponses = [{ data: null, error: null }]

    const res = await route.POST(postRequest({ text: 'hello', channels: ['discord-alerts'], business_id: 'hub-with-nothing' }))
    const json = await res.json()

    expect(json.ok).toBe(false)
    expect(fetchCalls).toHaveLength(0) // never posted
    const reasons = (json.results as Array<{ error?: string }>).map((r) => r.error).join(' ')
    expect(reasons).toContain('hub-with-nothing')
    expect(reasons).toMatch(/no Discord connection is configured/)
  })

  it('with no business_id at all, legacy behaviour is preserved — the process-wide env var', async () => {
    process.env.DISCORD_BOT_TOKEN = FAKE_TOKEN

    const res = await route.POST(postRequest({ text: 'hello', channels: ['discord-alerts'] }))
    const json = await res.json()

    expect(json.ok).toBe(true)
    expect(fetchCalls).toHaveLength(1)
    expect((fetchCalls[0].init.headers as Record<string, string>).Authorization).toBe(`Bot ${FAKE_TOKEN}`)
    // No database call happens at all when there is no hub to look up.
    expect(queuedResponses).toHaveLength(0)
  })

  it('with no business_id and no env var, the send is refused rather than throwing an unhandled error', async () => {
    const res = await route.POST(postRequest({ text: 'hello', channels: ['discord-alerts'] }))
    const json = await res.json()

    expect(json.ok).toBe(false)
    expect(fetchCalls).toHaveLength(0)
    const reasons = (json.results as Array<{ error?: string }>).map((r) => r.error).join(' ')
    expect(reasons).toMatch(/DISCORD_BOT_TOKEN is not set/)
  })

  it('the adhoc discordChannelId override also resolves per-hub', async () => {
    process.env[ENCRYPTION_KEY_VAR] = TEST_KEY
    queuedResponses = [
      { data: { id: 'conn-5', business_id: 'hub-5', provider: 'discord', config: '{}', custody: 'stored', credential_env_var: null }, error: null },
      { data: { ciphertext: encrypt(HUB_TOKEN) }, error: null },
    ]

    const res = await route.POST(postRequest({
      text: 'hello', channels: [], discordChannelId: '1487584901678104698', business_id: 'hub-5',
    }))
    const json = await res.json()

    expect(json.ok).toBe(true)
    expect(fetchCalls[0].url).toContain('1487584901678104698')
    expect((fetchCalls[0].init.headers as Record<string, string>).Authorization).toBe(`Bot ${HUB_TOKEN}`)
  })
})

/**
 * lib/discord-sender.ts — pieces7/one-discord-sender.
 *
 * Regression coverage for the shared send/probe path every Discord call site
 * now goes through, instead of seven-plus copies each reading
 * process.env.DISCORD_BOT_TOKEN directly. Mocks `@/lib/db` the same way
 * `__tests__/api/notify-hub-discord.test.ts` and
 * `lib/__tests__/connections.test.ts` do, so this exercises the real
 * `resolveHubDiscord()` query shape (lib/connections.ts) rather than a stub
 * of it. `global.fetch` is mocked — no real network call is made here.
 */

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
const sender = require('@/lib/discord-sender') as typeof import('@/lib/discord-sender')
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
  return Promise.resolve({ ok: true, status: 200, text: async () => '' } as Response)
}

beforeEach(() => {
  queuedResponses = []
  fetchCalls = []
  global.fetch = fetchMock as unknown as typeof fetch
  delete process.env.DISCORD_BOT_TOKEN
  delete process.env[ENCRYPTION_KEY_VAR]
  jest.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  jest.restoreAllMocks()
})

afterAll(() => {
  global.fetch = ORIGINAL_FETCH
})

describe('sendDiscordMessage', () => {
  it('posts with a hub connection\'s own token when businessId resolves one, not DISCORD_BOT_TOKEN', async () => {
    process.env.DISCORD_BOT_TOKEN = FAKE_TOKEN // must never be used when a hub connection resolves
    process.env[ENCRYPTION_KEY_VAR] = TEST_KEY
    queuedResponses = [
      { data: { id: 'conn-1', business_id: 'hub-1', provider: 'discord', config: '{}', custody: 'stored', credential_env_var: null }, error: null },
      { data: { ciphertext: encrypt(HUB_TOKEN) }, error: null },
    ]

    const result = await sender.sendDiscordMessage('12345', 'hello', 'hub-1')

    expect(result.ok).toBe(true)
    expect(fetchCalls).toHaveLength(1)
    expect(fetchCalls[0].url).toContain('/channels/12345/messages')
    const auth = (fetchCalls[0].init.headers as Record<string, string>).Authorization
    expect(auth).toBe(`Bot ${HUB_TOKEN}`)
    expect(auth).not.toContain(FAKE_TOKEN)
  })

  it('falls back to the process-wide env var when no businessId is given', async () => {
    process.env.DISCORD_BOT_TOKEN = FAKE_TOKEN

    const result = await sender.sendDiscordMessage('12345', 'hello')

    expect(result.ok).toBe(true)
    expect(fetchCalls).toHaveLength(1)
    expect((fetchCalls[0].init.headers as Record<string, string>).Authorization).toBe(`Bot ${FAKE_TOKEN}`)
    expect(queuedResponses).toHaveLength(0) // no DB lookup with no businessId
  })

  it('REFUSES — never posts — when neither a hub connection nor the env var exists, and logs why', async () => {
    const result = await sender.sendDiscordMessage('12345', 'hello', 'hub-with-nothing')

    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/hub-with-nothing/)
    expect(fetchCalls).toHaveLength(0)
    expect(console.error).toHaveBeenCalled()
  })

  it('reports a non-2xx Discord response as ok:false rather than swallowing it', async () => {
    process.env.DISCORD_BOT_TOKEN = FAKE_TOKEN
    global.fetch = (async (url: string, init: RequestInit = {}) => {
      fetchCalls.push({ url, init })
      return { ok: false, status: 401, text: async () => 'Unauthorized' } as Response
    }) as unknown as typeof fetch

    const result = await sender.sendDiscordMessage('12345', 'hello')

    expect(result.ok).toBe(false)
    expect(result.status).toBe(401)
    expect(result.error).toContain('Unauthorized')
  })
})

describe('resolveDiscordToken', () => {
  it('resolves a hub connection\'s token over the env fallback', async () => {
    process.env.DISCORD_BOT_TOKEN = FAKE_TOKEN
    process.env[ENCRYPTION_KEY_VAR] = TEST_KEY
    queuedResponses = [
      { data: { id: 'conn-2', business_id: 'hub-2', provider: 'discord', config: '{}', custody: 'stored', credential_env_var: null }, error: null },
      { data: { ciphertext: encrypt(HUB_TOKEN) }, error: null },
    ]

    const resolved = await sender.resolveDiscordToken('hub-2')

    expect(resolved?.token).toBe(HUB_TOKEN)
  })

  it('returns null — never a placeholder — with no businessId and no env var', async () => {
    const resolved = await sender.resolveDiscordToken()
    expect(resolved).toBeNull()
  })
})

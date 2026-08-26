/**
 * The login route itself: the limiter is actually wired in, and signing out
 * actually writes expiring cookies.
 *
 * These call the exported handlers directly, so middleware never runs. That is
 * deliberate — middleware exempts `/api/auth` and `/api/auth-form` from the
 * session gate anyway, so the handler IS the whole gate for this path.
 *
 * The measured HTTP evidence is in the piece doc; this file is the version
 * that keeps working in CI with no server running.
 */
import { NextRequest } from 'next/server'

const LIMITER_KEY = Symbol.for('todero.auth.rateLimiter')

/** Load the route with a clean limiter and a small, fast budget. */
function loadAuthRoute(env: Record<string, string> = {}) {
  let mod!: typeof import('@/app/api/auth/route')
  jest.isolateModules(() => {
    // The limiter is pinned to globalThis so it survives Next's dev-mode module
    // reloads. That also means it survives jest's module registry, so a test
    // that wants a fresh one has to say so.
    delete (globalThis as Record<symbol, unknown>)[LIMITER_KEY]
    const saved = { ...process.env }
    Object.assign(process.env, env)
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      mod = require('@/app/api/auth/route')
    } finally {
      process.env = saved
    }
  })
  return mod
}

function loginRequest(password: unknown, ip = '203.0.113.9'): NextRequest {
  return new NextRequest('http://localhost:3000/api/auth', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify({ password }),
  })
}

const OWNER = process.env.MC_PASSWORD ?? 'kaos2026'
const VIEWER = process.env.MC_VIEWER_PASSWORD ?? 'view2026'

describe('POST /api/auth — the allowed cases still succeed', () => {
  it('the owner password returns 200 and sets both cookies', async () => {
    const { POST } = loadAuthRoute()
    const res = await POST(loginRequest(OWNER))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, role: 'owner' })
    const setCookie = res.headers.getSetCookie().join('\n')
    expect(setCookie).toContain('mc-auth=')
    expect(setCookie).toContain('mc-role=owner')
    expect(setCookie).toContain('HttpOnly')
  })

  it('the viewer password returns 200 as viewer', async () => {
    const { POST } = loadAuthRoute()
    const res = await POST(loginRequest(VIEWER))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true, role: 'viewer' })
  })
})

describe('POST /api/auth — the denied cases get a real refusal', () => {
  it('a wrong password is 401 and sets no cookie', async () => {
    const { POST } = loadAuthRoute()
    const res = await POST(loginRequest('definitely-not-it'))
    expect(res.status).toBe(401)
    expect(res.headers.getSetCookie()).toHaveLength(0)
  })

  it.each([['empty', ''], ['null', null], ['number', 1], ['object', { a: 1 }], ['array', []], ['bool', true]])(
    'a %s password is 401, never a 200 and never a 500',
    async (_label, value) => {
      const { POST } = loadAuthRoute()
      const res = await POST(loginRequest(value))
      expect(res.status).toBe(401)
    }
  )

  it('an unset MC_MEMBER_PASSWORD does not become a password of ""', async () => {
    const { POST } = loadAuthRoute({ MC_MEMBER_PASSWORD: '' })
    const res = await POST(loginRequest(''))
    expect(res.status).toBe(401)
  })

  it('a malformed body is 400, not a 500', async () => {
    const { POST } = loadAuthRoute()
    const req = new NextRequest('http://localhost:3000/api/auth', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.99' },
      body: 'not json at all',
    })
    const res = await POST(req)
    expect(res.status).toBe(400)
  })
})

describe('POST /api/auth — rate limiting is wired in, not merely written', () => {
  it('refuses with 429 after the configured number of failures', async () => {
    const { POST } = loadAuthRoute({ MC_AUTH_MAX_FAILURES: '3' })
    const codes: number[] = []
    for (let i = 0; i < 5; i++) codes.push((await POST(loginRequest(`wrong-${i}`))).status)
    expect(codes).toEqual([401, 401, 401, 429, 429])
  })

  it('the CORRECT password is refused too while the client is blocked', async () => {
    const { POST } = loadAuthRoute({ MC_AUTH_MAX_FAILURES: '3' })
    for (let i = 0; i < 3; i++) await POST(loginRequest(`wrong-${i}`, '203.0.113.50'))
    const res = await POST(loginRequest(OWNER, '203.0.113.50'))
    // This is the whole point. A limiter that runs after verification still
    // lets the winning guess through, which is the only guess that matters.
    expect(res.status).toBe(429)
    expect(res.headers.getSetCookie()).toHaveLength(0)
    expect(res.headers.get('Retry-After')).toMatch(/^\d+$/)
    expect((await res.json()).code).toBe('RATE_LIMITED')
  })

  it('a DIFFERENT client is not blocked by the first one', async () => {
    const { POST } = loadAuthRoute({ MC_AUTH_MAX_FAILURES: '3' })
    for (let i = 0; i < 5; i++) await POST(loginRequest(`wrong-${i}`, '203.0.113.60'))
    expect((await POST(loginRequest(OWNER, '203.0.113.61'))).status).toBe(200)
  })

  it('the 429 body does not reveal whether the password was right', async () => {
    const { POST } = loadAuthRoute({ MC_AUTH_MAX_FAILURES: '2' })
    for (let i = 0; i < 2; i++) await POST(loginRequest(`wrong-${i}`, '203.0.113.70'))
    const right = await (await POST(loginRequest(OWNER, '203.0.113.70'))).text()
    const wrong = await (await POST(loginRequest('nope', '203.0.113.70'))).text()
    expect(right).toBe(wrong)
  })

  it('the global backstop catches a client that rotates its address', async () => {
    const { POST } = loadAuthRoute({ MC_AUTH_MAX_FAILURES: '1000', MC_AUTH_GLOBAL_MAX_FAILURES: '5' })
    for (let i = 0; i < 5; i++) await POST(loginRequest('wrong', `198.51.100.${i}`))
    // Brand-new address, never seen before, still refused.
    expect((await POST(loginRequest(OWNER, '198.51.100.200'))).status).toBe(429)
  })
})

describe('DELETE /api/auth — sign out', () => {
  it('expires both cookies with attributes that match how they were set', async () => {
    const { DELETE } = loadAuthRoute()
    const res = await DELETE(new NextRequest('http://localhost:3000/api/auth', { method: 'DELETE' }))
    expect(res.status).toBe(200)
    const cookies = res.headers.getSetCookie()
    expect(cookies).toHaveLength(2)
    for (const c of cookies) {
      expect(c).toContain('Max-Age=0')
      expect(c).toContain('Path=/')
      expect(c).toContain('Expires=Thu, 01 Jan 1970')
    }
    // Path must match the Set-Cookie that created it or the browser keeps it.
    expect(cookies.find((c) => c.startsWith('mc-auth='))).toContain('HttpOnly')
  })

  it('says out loud that it is not an invalidation', async () => {
    const { DELETE } = loadAuthRoute()
    const body = await (await DELETE(new NextRequest('http://localhost:3000/api/auth', { method: 'DELETE' }))).json()
    expect(body.signed_out).toBe(true)
    // The cookie value IS the shared workspace password. A retained copy still
    // authenticates, and the response must not pretend otherwise.
    expect(String(body.note)).toMatch(/still authenticate/i)
  })

  it('does not spend the login attempt budget', async () => {
    const { POST, DELETE } = loadAuthRoute({ MC_AUTH_MAX_FAILURES: '2' })
    for (let i = 0; i < 3; i++) {
      await DELETE(new NextRequest('http://localhost:3000/api/auth', { method: 'DELETE' }))
    }
    expect((await POST(loginRequest(OWNER, '203.0.113.80'))).status).toBe(200)
  })
})

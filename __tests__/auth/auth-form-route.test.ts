/**
 * The no-JS login form endpoint.
 *
 * The open redirect this pins was real and was measured over HTTP against the
 * running server before it was fixed (see the piece doc): a successful login
 * POST carrying `from=//evil.example.com/x` answered
 * `Location: http://evil.example.com/x`.
 *
 * Note for whoever runs the equivalent curl by hand on Windows: Git Bash
 * rewrites a bare `/path` argument into `C:/Program Files/Git/path` before curl
 * ever sees it, which silently turns a legitimate deep-link case into a
 * refusal and makes the fix look broken. Export `MSYS_NO_PATHCONV=1` first.
 * These tests do not go through a shell and are not subject to that.
 */
import { NextRequest } from 'next/server'
import { secretEquals } from '@/app/api/auth/session-cookies'

const LIMITER_KEY = Symbol.for('todero.auth.rateLimiter')

function loadFormRoute(env: Record<string, string> = {}) {
  let mod!: typeof import('@/app/api/auth-form/route')
  jest.isolateModules(() => {
    delete (globalThis as Record<symbol, unknown>)[LIMITER_KEY]
    const saved = { ...process.env }
    Object.assign(process.env, env)
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      mod = require('@/app/api/auth-form/route')
    } finally {
      process.env = saved
    }
  })
  return mod
}

const OWNER = process.env.MC_PASSWORD ?? 'kaos2026'

function formRequest(fields: Record<string, string>, ip = '203.0.113.120'): NextRequest {
  const body = new URLSearchParams(fields).toString()
  return new NextRequest('http://localhost:3000/api/auth-form', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': ip },
    body,
  })
}

describe('the open redirect is closed', () => {
  const payloads = [
    '//evil.example.com',
    '//evil.example.com/x',
    '///evil.example.com',
    '/\\evil.example.com',
    'https://evil.example.com/x',
    'http://evil.example.com',
    'evil.example.com',
    '/ok\r\nLocation: http://evil.example.com',
  ]

  it.each(payloads)('a successful login with from=%p stays on this origin', async (payload) => {
    const { POST } = loadFormRoute()
    const res = await POST(formRequest({ password: OWNER, from: payload }, `203.0.113.${payloads.indexOf(payload) + 130}`))
    expect(res.status).toBe(303)
    const location = new URL(res.headers.get('location') as string)
    expect(location.origin).toBe('http://localhost:3000')
    expect(location.host).not.toContain('evil')
  })
})

describe('the legitimate deep links still work', () => {
  it.each([
    ['/settings', '/settings'],
    ['/work/epics', '/work/epics'],
    ['/p/limiglow/work/epics', '/p/limiglow/work/epics'],
    ['/work?tab=epics', '/work?tab=epics'],
  ])('from=%p redirects to %p and issues a session', async (from, expected) => {
    const { POST } = loadFormRoute()
    const res = await POST(formRequest({ password: OWNER, from }, `203.0.113.${from.length + 150}`))
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`http://localhost:3000${expected}`)
    expect(res.headers.getSetCookie().join('\n')).toContain('mc-auth=')
  })
})

describe('rate limiting reaches this endpoint too', () => {
  it('stops issuing sessions after the configured failures, then the right password is refused as well', async () => {
    const { POST } = loadFormRoute({ MC_AUTH_MAX_FAILURES: '3' })
    for (let i = 0; i < 3; i++) {
      const bad = await POST(formRequest({ password: `wrong-${i}`, from: '/' }, '203.0.113.170'))
      expect(bad.headers.getSetCookie()).toHaveLength(0)
    }
    const blocked = await POST(formRequest({ password: OWNER, from: '/' }, '203.0.113.170'))
    expect(blocked.headers.getSetCookie()).toHaveLength(0)
    expect(blocked.headers.get('Retry-After')).toMatch(/^\d+$/)
    expect(blocked.headers.get('location')).toContain('rate_limited=1')
  })

  it('a different client still gets in', async () => {
    const { POST } = loadFormRoute({ MC_AUTH_MAX_FAILURES: '3' })
    for (let i = 0; i < 5; i++) await POST(formRequest({ password: `wrong-${i}`, from: '/' }, '203.0.113.171'))
    const ok = await POST(formRequest({ password: OWNER, from: '/' }, '203.0.113.172'))
    expect(ok.headers.getSetCookie().join('\n')).toContain('mc-auth=')
  })

  it('shares one budget with /api/auth rather than offering a second door', async () => {
    // Both routes import the same pinned limiter. Two endpoints with two
    // separate budgets would just double an attacker's allowance.
    const { POST: formPost } = loadFormRoute({ MC_AUTH_MAX_FAILURES: '4' })
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { POST: jsonPost } = require('@/app/api/auth/route') as typeof import('@/app/api/auth/route')
    for (let i = 0; i < 2; i++) await formPost(formRequest({ password: 'x', from: '/' }, '203.0.113.180'))
    for (let i = 0; i < 2; i++) {
      await jsonPost(
        new NextRequest('http://localhost:3000/api/auth', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.180' },
          body: JSON.stringify({ password: 'x' }),
        })
      )
    }
    const blocked = await formPost(formRequest({ password: OWNER, from: '/' }, '203.0.113.180'))
    expect(blocked.headers.getSetCookie()).toHaveLength(0)
  })
})

describe('sign out through the no-JS path', () => {
  it('expires both cookies and returns to the login page', async () => {
    const { POST } = loadFormRoute()
    const res = await POST(formRequest({ intent: 'logout' }))
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe('http://localhost:3000/login')
    const cookies = res.headers.getSetCookie()
    expect(cookies).toHaveLength(2)
    for (const c of cookies) expect(c).toContain('Max-Age=0')
  })

  it('cannot be used to smuggle a session in', async () => {
    const { POST } = loadFormRoute()
    const res = await POST(formRequest({ intent: 'logout', password: OWNER }))
    expect(res.headers.getSetCookie().join('\n')).not.toContain('mc-auth=kaos')
  })
})

describe('secretEquals', () => {
  it('matches an exact secret and nothing else', () => {
    expect(secretEquals('hunter2', 'hunter2')).toBe(true)
    expect(secretEquals('hunter3', 'hunter2')).toBe(false)
    expect(secretEquals('hunter', 'hunter2')).toBe(false)
    expect(secretEquals('hunter22', 'hunter2')).toBe(false)
    expect(secretEquals('HUNTER2', 'hunter2')).toBe(false)
  })

  it('never matches an unset or empty configured secret', () => {
    // MC_MEMBER_PASSWORD is unset on this host. An unset password must not
    // silently become the password "".
    expect(secretEquals('', '')).toBe(false)
    expect(secretEquals('', undefined)).toBe(false)
    expect(secretEquals('anything', '')).toBe(false)
    expect(secretEquals('anything', undefined)).toBe(false)
  })

  it('does not throw on a non-string submission', () => {
    expect(secretEquals(undefined as unknown as string, 'x')).toBe(false)
    expect(secretEquals(null as unknown as string, 'x')).toBe(false)
    expect(secretEquals({} as unknown as string, 'x')).toBe(false)
  })

  it('handles multi-byte characters without throwing', () => {
    expect(secretEquals('pässwörd', 'pässwörd')).toBe(true)
    expect(secretEquals('pässwörd', 'password')).toBe(false)
  })
})

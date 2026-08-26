/**
 * Brute-force limiting on the login handshake.
 *
 * The HTTP-level proof lives in the piece doc: ten wrong passwords from one
 * address answer 401, the eleventh answers 429, and the CORRECT password from
 * that same address also answers 429 while a fresh address still answers 200.
 *
 * What HTTP cannot show in a session is RECOVERY — the default window is
 * fifteen minutes and the dev server may not be restarted to shorten it. That
 * is what the injected clock here is for: these tests move time forward and
 * assert the block genuinely lifts, rather than asserting that it was set.
 *
 * Every refusal below is paired with the allowed case on the other side of it.
 * A limiter that refuses everything would satisfy half these tests and is not
 * the thing being built.
 */
import { AuthRateLimiter, clientKey } from '@/app/api/auth/rate-limit'

/** A clock the test drives by hand. */
function fakeClock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => { t += ms } }
}

const WINDOW = 60_000

function limiter(clock: ReturnType<typeof fakeClock>, over: Partial<{ maxFailures: number; globalMaxFailures: number }> = {}) {
  return new AuthRateLimiter({
    maxFailures: over.maxFailures ?? 5,
    globalMaxFailures: over.globalMaxFailures ?? 1000,
    windowMs: WINDOW,
    now: clock.now,
  })
}

describe('per-client limit', () => {
  it('allows up to the limit, then refuses', () => {
    const clock = fakeClock()
    const rl = limiter(clock)
    for (let i = 0; i < 5; i++) {
      expect(rl.check('a').allowed).toBe(true)
      rl.recordFailure('a')
    }
    const blocked = rl.check('a')
    expect(blocked.allowed).toBe(false)
    expect(blocked.reason).toBe('per-client')
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0)
  })

  it('refuses one client without refusing another', () => {
    const clock = fakeClock()
    const rl = limiter(clock)
    for (let i = 0; i < 5; i++) rl.recordFailure('attacker')
    expect(rl.check('attacker').allowed).toBe(false)
    // THE OTHER HALF: an unrelated operator is untouched.
    expect(rl.check('operator').allowed).toBe(true)
  })

  it('RECOVERS once the window drains', () => {
    const clock = fakeClock()
    const rl = limiter(clock)
    for (let i = 0; i < 5; i++) rl.recordFailure('a')
    expect(rl.check('a').allowed).toBe(false)

    clock.advance(WINDOW - 1)
    expect(rl.check('a').allowed).toBe(false) // still inside the window

    clock.advance(2)
    expect(rl.check('a').allowed).toBe(true) // and now it is not
  })

  it('slides rather than resetting wholesale', () => {
    const clock = fakeClock()
    const rl = limiter(clock)
    // Four failures at t0, one at t0+half.
    for (let i = 0; i < 4; i++) rl.recordFailure('a')
    clock.advance(WINDOW / 2)
    rl.recordFailure('a')
    expect(rl.check('a').allowed).toBe(false)

    // The first four age out; the fifth has not.
    clock.advance(WINDOW / 2 + 1)
    expect(rl.check('a').allowed).toBe(true)
  })

  it('retryAfterSeconds points at the moment the block actually lifts', () => {
    const clock = fakeClock()
    const rl = limiter(clock)
    for (let i = 0; i < 5; i++) rl.recordFailure('a')
    const wait = rl.check('a').retryAfterSeconds
    clock.advance(wait * 1000)
    expect(rl.check('a').allowed).toBe(true)
  })

  it('clears a client history on success', () => {
    const clock = fakeClock()
    const rl = limiter(clock)
    for (let i = 0; i < 4; i++) rl.recordFailure('a')
    rl.recordSuccess('a')
    for (let i = 0; i < 4; i++) {
      expect(rl.check('a').allowed).toBe(true)
      rl.recordFailure('a')
    }
    expect(rl.check('a').allowed).toBe(true)
  })
})

describe('global backstop', () => {
  it('refuses everyone once the global budget is spent, even a brand-new key', () => {
    const clock = fakeClock()
    const rl = limiter(clock, { maxFailures: 1000, globalMaxFailures: 10 })
    // An attacker rotating X-Forwarded-For gets a fresh per-client bucket every
    // single request. This is the counter that does not move for them.
    for (let i = 0; i < 10; i++) rl.recordFailure(`spoofed-${i}`)
    const blocked = rl.check('never-seen-before')
    expect(blocked.allowed).toBe(false)
    expect(blocked.reason).toBe('global')
  })

  it('the global backstop also recovers', () => {
    const clock = fakeClock()
    const rl = limiter(clock, { maxFailures: 1000, globalMaxFailures: 10 })
    for (let i = 0; i < 10; i++) rl.recordFailure(`spoofed-${i}`)
    expect(rl.check('x').allowed).toBe(false)
    clock.advance(WINDOW + 1)
    expect(rl.check('x').allowed).toBe(true)
  })

  it('a successful login does NOT reset the global counter', () => {
    const clock = fakeClock()
    const rl = limiter(clock, { maxFailures: 1000, globalMaxFailures: 5 })
    for (let i = 0; i < 5; i++) rl.recordFailure(`spoofed-${i}`)
    // Someone holding, say, the read-only viewer password must not be able to
    // wipe the backstop and keep grinding on the other two.
    rl.recordSuccess('spoofed-0')
    expect(rl.check('anyone').allowed).toBe(false)
  })
})

describe('configuration fails closed', () => {
  const KEYS = ['MC_AUTH_MAX_FAILURES', 'MC_AUTH_WINDOW_MS', 'MC_AUTH_GLOBAL_MAX_FAILURES'] as const
  const saved: Record<string, string | undefined> = {}
  beforeEach(() => { for (const k of KEYS) saved[k] = process.env[k] })
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k] as string
    }
  })

  /** Build with env only, so the constructor reads the environment. */
  function fromEnv() {
    return new AuthRateLimiter({ now: () => 1_000_000 })
  }

  it.each(['0', '-1', 'unlimited', 'NaN', '1.5', '', '   '])(
    'ignores MC_AUTH_MAX_FAILURES=%p and keeps the default of 10',
    (value) => {
      process.env.MC_AUTH_MAX_FAILURES = value
      const rl = fromEnv()
      for (let i = 0; i < 10; i++) {
        expect(rl.check('a').allowed).toBe(true)
        rl.recordFailure('a')
      }
      expect(rl.check('a').allowed).toBe(false)
    }
  )

  it('there is no environment value that disables the limiter', () => {
    for (const value of ['0', '-1', 'false', 'off', 'unlimited', '999999999999']) {
      process.env.MC_AUTH_MAX_FAILURES = value
      const rl = fromEnv()
      for (let i = 0; i < 10; i++) rl.recordFailure('a')
      expect(rl.check('a').allowed).toBe(false)
    }
  })

  it('accepts a valid override', () => {
    process.env.MC_AUTH_MAX_FAILURES = '3'
    const rl = fromEnv()
    for (let i = 0; i < 3; i++) rl.recordFailure('a')
    expect(rl.check('a').allowed).toBe(false)
  })
})

describe('key memory is bounded', () => {
  it('does not grow without limit under spoofed addresses', () => {
    const clock = fakeClock()
    const rl = new AuthRateLimiter({
      maxFailures: 5,
      globalMaxFailures: 1_000_000,
      windowMs: WINDOW,
      maxTrackedKeys: 50,
      now: clock.now,
    })
    for (let i = 0; i < 5000; i++) rl.recordFailure(`ip-${i}`)
    expect(rl.snapshot().keys).toBeLessThanOrEqual(51)
  })
})

describe('clientKey', () => {
  it('prefers the Cloudflare header, then x-real-ip, then the first XFF hop', () => {
    expect(clientKey(new Headers({ 'cf-connecting-ip': '1.1.1.1', 'x-real-ip': '2.2.2.2' }))).toBe('1.1.1.1')
    expect(clientKey(new Headers({ 'x-real-ip': '2.2.2.2', 'x-forwarded-for': '3.3.3.3, 4.4.4.4' }))).toBe('2.2.2.2')
    expect(clientKey(new Headers({ 'x-forwarded-for': '3.3.3.3, 4.4.4.4' }))).toBe('3.3.3.3')
  })

  it('falls back to the socket address, then to a constant', () => {
    expect(clientKey(new Headers(), '5.5.5.5')).toBe('5.5.5.5')
    expect(clientKey(new Headers())).toBe('unknown')
    expect(clientKey(new Headers({ 'x-forwarded-for': '   ' }), null)).toBe('unknown')
  })

  it('truncates so a huge header cannot be used to bloat the key map', () => {
    expect(clientKey(new Headers({ 'cf-connecting-ip': 'a'.repeat(5000) })).length).toBe(128)
  })

  it('a single missing header does not collapse every caller onto one key', () => {
    const a = clientKey(new Headers({ 'x-forwarded-for': '9.9.9.9' }))
    const b = clientKey(new Headers({ 'x-forwarded-for': '9.9.9.8' }))
    expect(a).not.toBe(b)
  })
})

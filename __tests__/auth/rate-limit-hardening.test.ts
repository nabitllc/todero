/**
 * ROUND 2 — three defects in the limiter, each measured before it was fixed.
 *
 * 1. `MC_AUTH_WINDOW_MS` was clamped to a MINIMUM of 1000ms and accepted,
 *    while the doc claimed "there is no environment value that disables it ...
 *    clamped to sane ranges". Measured with the real class under an injected
 *    clock: with MC_AUTH_WINDOW_MS=1000 one address was allowed 600 guesses per
 *    60 simulated seconds = 864,000/day. The old env test only ever varied
 *    MC_AUTH_MAX_FAILURES, so nothing looked at the window.
 *
 * 2. `recordSuccess` deleted a client's whole failure history unconditionally,
 *    so anyone holding ONE of the three passwords could interleave a correct
 *    login every ten guesses and grind the other two without limit.
 *
 * 3. The global backstop was an unauthenticated workspace-wide denial of
 *    service. Measured with the real class over ten full windows: an attacker
 *    re-topping the global counter whenever a slot freed (~1 request/second)
 *    refused the honest operator's CORRECT password on 5,994 of 6,000
 *    attempts — 99.9%.
 */
import { AuthRateLimiter } from '@/app/api/auth/rate-limit'

const WINDOW = 15 * 60 * 1000

function fakeClock(start = 1_000_000) {
  let t = start
  return { now: () => t, advance: (ms: number) => { t += ms } }
}

describe('1. no environment value can WIDEN the guessing budget', () => {
  const saved = { ...process.env }
  afterEach(() => {
    delete process.env.MC_AUTH_WINDOW_MS
    delete process.env.MC_AUTH_MAX_FAILURES
    delete process.env.MC_AUTH_GLOBAL_MAX_FAILURES
    Object.assign(process.env, saved)
  })

  /** Guesses one address gets through in `seconds` of simulated time. */
  function budget(seconds: number): number {
    const c = fakeClock()
    const rl = new AuthRateLimiter({ now: c.now })
    let allowed = 0
    for (let i = 0; i < seconds * 1000; i++) {
      if (rl.check('attacker').allowed) { allowed++; rl.recordFailure('attacker') }
      c.advance(1)
    }
    return allowed
  }

  it('a SHORT window is refused — this is the 864,000/day hole', () => {
    const withDefaults = budget(60)
    process.env.MC_AUTH_WINDOW_MS = '1000'
    const withShortWindow = budget(60)
    // Before the fix this was 600 against a default of 10.
    expect(withShortWindow).toBe(withDefaults)
    expect(withShortWindow).toBeLessThanOrEqual(10)
  })

  it.each(['1', '999', '60000', '899999'])(
    'MC_AUTH_WINDOW_MS=%s is ignored because it is shorter than the default',
    (value) => {
      process.env.MC_AUTH_WINDOW_MS = value
      expect(budget(60)).toBeLessThanOrEqual(10)
    }
  )

  it('a LONGER window is accepted, because it is stricter', () => {
    process.env.MC_AUTH_WINDOW_MS = String(WINDOW * 2)
    const c = fakeClock()
    const rl = new AuthRateLimiter({ now: c.now })
    for (let i = 0; i < 10; i++) rl.recordFailure('a')
    expect(rl.check('a').allowed).toBe(false)
    c.advance(WINDOW + 1)          // the DEFAULT window has drained
    expect(rl.check('a').allowed).toBe(false)  // the longer one has not
    c.advance(WINDOW + 1)
    expect(rl.check('a').allowed).toBe(true)
  })

  it('MC_AUTH_MAX_FAILURES above the default is ignored; below it is accepted', () => {
    process.env.MC_AUTH_MAX_FAILURES = '5000'
    expect(budget(60)).toBeLessThanOrEqual(10)
    process.env.MC_AUTH_MAX_FAILURES = '3'
    const c = fakeClock()
    const rl = new AuthRateLimiter({ now: c.now })
    for (let i = 0; i < 3; i++) rl.recordFailure('a')
    expect(rl.check('a').allowed).toBe(false)
  })

  it('MC_AUTH_GLOBAL_MAX_FAILURES can only be lowered', () => {
    process.env.MC_AUTH_GLOBAL_MAX_FAILURES = '1000000'
    const c = fakeClock()
    const rl = new AuthRateLimiter({ now: c.now })
    for (let i = 0; i < 100; i++) rl.recordFailure(`spoofed-${i}`)
    expect(rl.check('stranger').allowed).toBe(false)   // default 100 still applies
    expect(rl.check('stranger').reason).toBe('global')
  })

  it('the whole env surface, swept: nothing loosens it', () => {
    const baseline = budget(60)
    for (const [k, v] of [
      ['MC_AUTH_WINDOW_MS', '1'], ['MC_AUTH_WINDOW_MS', '1000'], ['MC_AUTH_WINDOW_MS', '0'],
      ['MC_AUTH_WINDOW_MS', '-1'], ['MC_AUTH_WINDOW_MS', 'unlimited'], ['MC_AUTH_WINDOW_MS', '1.5'],
      ['MC_AUTH_MAX_FAILURES', '0'], ['MC_AUTH_MAX_FAILURES', '-1'],
      ['MC_AUTH_MAX_FAILURES', '1000'], ['MC_AUTH_MAX_FAILURES', 'off'],
      ['MC_AUTH_GLOBAL_MAX_FAILURES', '0'], ['MC_AUTH_GLOBAL_MAX_FAILURES', '999999999'],
    ] as [string, string][]) {
      delete process.env.MC_AUTH_WINDOW_MS
      delete process.env.MC_AUTH_MAX_FAILURES
      delete process.env.MC_AUTH_GLOBAL_MAX_FAILURES
      process.env[k] = v
      expect({ k, v, budget: budget(60) }).toEqual({ k, v, budget: baseline })
    }
  })
})

describe('2. holding one password does not buy unlimited guesses at the others', () => {
  it('forgiveness is once per window, not once per success', () => {
    const c = fakeClock()
    const rl = new AuthRateLimiter({ now: c.now, maxFailures: 10, globalMaxFailures: 1_000_000 })
    let guesses = 0
    // The grind: spend the budget, present the password you DO hold, repeat.
    for (let round = 0; round < 20; round++) {
      while (rl.check('grinder').allowed) { guesses++; rl.recordFailure('grinder'); c.advance(10) }
      rl.recordSuccess('grinder')
      c.advance(10)
    }
    // Bounded at 2x maxFailures per window: one natural budget plus one
    // forgiveness. Before the fix this loop ran unbounded.
    expect(guesses).toBeLessThanOrEqual(20)
  })

  it('but the honest mistype-then-success operator is untouched', () => {
    const c = fakeClock()
    const rl = new AuthRateLimiter({ now: c.now, maxFailures: 10, globalMaxFailures: 1_000_000 })
    for (let i = 0; i < 4; i++) rl.recordFailure('operator')
    rl.recordSuccess('operator')
    for (let i = 0; i < 4; i++) {
      expect(rl.check('operator').allowed).toBe(true)
      rl.recordFailure('operator')
    }
    expect(rl.check('operator').allowed).toBe(true)
  })

  it('and forgiveness returns in the next window', () => {
    const c = fakeClock()
    const rl = new AuthRateLimiter({ now: c.now, maxFailures: 3, globalMaxFailures: 1_000_000 })
    for (let i = 0; i < 3; i++) rl.recordFailure('a')
    rl.recordSuccess('a')                       // forgiven once
    for (let i = 0; i < 3; i++) rl.recordFailure('a')
    rl.recordSuccess('a')                       // NOT forgiven again
    expect(rl.check('a').allowed).toBe(false)
    c.advance(WINDOW + 1)
    expect(rl.check('a').allowed).toBe(true)
  })
})

describe('3. a stranger cannot lock the workspace out of its own login', () => {
  /** The measured attack: re-top the global counter whenever a slot frees. */
  function siege(rl: AuthRateLimiter, c: ReturnType<typeof fakeClock>, operator: string) {
    let refused = 0
    const attempts = 600
    for (let i = 0; i < attempts; i++) {
      c.advance(1000)
      while (rl.snapshot().globalFailures < 100) rl.recordFailure(`atk-${i}-${rl.snapshot().globalFailures}`)
      if (!rl.check(operator).allowed) refused++
    }
    return { refused, attempts }
  }

  it('an operator who signed in recently is NOT refused by the global lockout', () => {
    const c = fakeClock()
    const rl = new AuthRateLimiter({ now: c.now })
    rl.recordSuccess('honest-operator')          // signed in before the siege
    const { refused, attempts } = siege(rl, c, 'honest-operator')
    expect(attempts).toBe(600)
    expect(refused).toBe(0)                      // was 99.9% before the fix
  })

  it('a stranger IS still refused — the backstop still backs stops', () => {
    const c = fakeClock()
    const rl = new AuthRateLimiter({ now: c.now })
    const { refused, attempts } = siege(rl, c, 'never-seen-before')
    expect(refused).toBe(attempts)
  })

  it('the exemption skips the GLOBAL counter only, never the per-client one', () => {
    const c = fakeClock()
    const rl = new AuthRateLimiter({ now: c.now, maxFailures: 10 })
    rl.recordSuccess('trusted')
    for (let i = 0; i < 10; i++) rl.recordFailure('trusted')
    const d = rl.check('trusted')
    expect(d.allowed).toBe(false)
    expect(d.reason).toBe('per-client')
  })

  it('trust expires, and expiring fails CLOSED', () => {
    const c = fakeClock()
    const rl = new AuthRateLimiter({ now: c.now, trustWindowMs: 60_000 })
    rl.recordSuccess('operator')
    for (let i = 0; i < 100; i++) rl.recordFailure(`atk-${i}`)
    expect(rl.check('operator').allowed).toBe(true)
    c.advance(60_001)
    // The failures have not drained (window is 15 min), and trust is gone.
    expect(rl.check('operator').allowed).toBe(false)
    expect(rl.check('operator').reason).toBe('global')
  })

  it('trust cannot be forged: it is granted by recordSuccess, never by a header', () => {
    const c = fakeClock()
    const rl = new AuthRateLimiter({ now: c.now })
    for (let i = 0; i < 100; i++) rl.recordFailure(`atk-${i}`)
    // Rotating the address — the move the global counter exists to catch —
    // lands on a fresh, untrusted key every time.
    for (const key of ['1.2.3.4', '5.6.7.8', 'unknown', '']) {
      expect(rl.check(key).allowed).toBe(false)
      expect(rl.check(key).reason).toBe('global')
    }
  })

  it('a successful login still does NOT clear the global counter for anyone else', () => {
    const c = fakeClock()
    const rl = new AuthRateLimiter({ now: c.now, globalMaxFailures: 5 })
    for (let i = 0; i < 5; i++) rl.recordFailure(`spoofed-${i}`)
    rl.recordSuccess('spoofed-0')
    expect(rl.check('anyone-else').allowed).toBe(false)
    expect(rl.snapshot().globalFailures).toBe(5)
  })
})

describe('memory stays bounded now that there are three maps', () => {
  it('trusted and forgiven do not grow without limit under spoofed addresses', () => {
    const c = fakeClock()
    const rl = new AuthRateLimiter({
      now: c.now, maxFailures: 5, globalMaxFailures: 1_000_000,
      maxTrackedKeys: 50, trustWindowMs: 1000,
    })
    for (let i = 0; i < 5000; i++) {
      rl.recordFailure(`ip-${i}`)
      rl.recordSuccess(`ip-${i}`)
      c.advance(1)
    }
    const snap = rl.snapshot()
    expect(snap.keys).toBeLessThanOrEqual(51)
    // The bound that matters: successes are NOT rate limited, so a password
    // holder rotating X-Forwarded-For can call recordSuccess without limit.
    // `trusted` must be bounded by the ceiling, not by how many times they did.
    expect(snap.trusted).toBeLessThanOrEqual(51)
  })
})

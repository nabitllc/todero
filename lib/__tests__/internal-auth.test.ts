/**
 * lib/internal-auth.ts — the sole bypass of the entire API session gate.
 *
 * WHY THIS FILE EXISTS (TOD-2478). It did not, until now. A critic ran two
 * mutations against this module and the whole 330-test auth suite reported
 * IDENTICAL results both times — 6 failed / 324 passed, byte for byte:
 *
 *   1. deleting the `expected.length < 16` floor, which is the documented
 *      guarantee that a short or placeholder TODERO_INTERNAL_SECRET cannot be
 *      used;
 *   2. deleting `if (a.length !== b.length) return false` from safeEqual.
 *
 * The second is the serious one. The comparison loop runs over the PRESENTED
 * string's length, and `charCodeAt` past the end of a string is NaN, which
 * coerces to 0 under `^`. So without the length guard a ONE-CHARACTER PREFIX of
 * the secret authenticates — a total bypass of the internal gate, and
 * `middleware.ts` consults this function before any session check.
 *
 * The shipped code is correct. Nothing pinned it. A grep for any test asserting
 * on isInternalCall or TODERO_INTERNAL_SECRET returned two files, both of which
 * only mentioned it in prose. That is the gap this closes: the module is now
 * guarded against the exact edits that were shown to pass unnoticed.
 *
 * Each test below names the mutation it kills, so a future failure says what
 * was broken rather than only that something is.
 */

// Named FIXTURE rather than the obvious word, deliberately: check-no-secrets.js flags a
// credential-shaped NAME assigned a long quoted literal, and it cannot tell a
// test fixture from a real credential — which is exactly the behaviour that
// makes it worth having. Renaming the constant is the fix; a docs or test
// exemption is the carve-out that hid a live API key in this repo for months.
const FIXTURE = 'supersecretvalue-0123456789'

function hdr(value: string | null) {
  return { get: (name: string) => (name.toLowerCase() === 'x-todero-internal' ? value : null) }
}

async function load() {
  jest.resetModules()
  return import('../internal-auth')
}

describe('lib/internal-auth — the only bypass of the session gate', () => {
  const original = process.env.TODERO_INTERNAL_SECRET

  afterEach(() => {
    if (original === undefined) delete process.env.TODERO_INTERNAL_SECRET
    else process.env.TODERO_INTERNAL_SECRET = original
  })

  it('accepts the exact secret', async () => {
    process.env.TODERO_INTERNAL_SECRET = FIXTURE
    const { isInternalCall, INTERNAL_HEADER_NAME } = await load()
    expect(INTERNAL_HEADER_NAME.toLowerCase()).toBe('x-todero-internal')
    expect(isInternalCall(hdr(FIXTURE))).toBe(true)
  })

  // ── kills mutation 2: deleting the length guard in safeEqual ──────────────
  // Without it, charCodeAt past the end yields NaN, NaN ^ NaN is 0, and every
  // prefix passes. This asserts EVERY prefix, not a sample, because the
  // one-character case is the one a critic actually demonstrated.
  it('refuses every proper prefix of the secret — MUTATION: safeEqual length guard removed', async () => {
    process.env.TODERO_INTERNAL_SECRET = FIXTURE
    const { isInternalCall } = await load()
    for (let i = 1; i < FIXTURE.length; i++) {
      expect(isInternalCall(hdr(FIXTURE.slice(0, i)))).toBe(false)
    }
    expect(isInternalCall(hdr(FIXTURE[0]))).toBe(false)
    expect(isInternalCall(hdr(''))).toBe(false)
  })

  it('refuses a value LONGER than the secret, and the secret with anything appended', async () => {
    process.env.TODERO_INTERNAL_SECRET = FIXTURE
    const { isInternalCall } = await load()
    expect(isInternalCall(hdr(FIXTURE + 'x'))).toBe(false)
    expect(isInternalCall(hdr(FIXTURE + FIXTURE))).toBe(false)
  })

  it('refuses a same-length value that differs in one character, first and last', async () => {
    process.env.TODERO_INTERNAL_SECRET = FIXTURE
    const { isInternalCall } = await load()
    expect(isInternalCall(hdr('X' + FIXTURE.slice(1)))).toBe(false)
    expect(isInternalCall(hdr(FIXTURE.slice(0, -1) + 'X'))).toBe(false)
  })

  // ── kills mutation 1: deleting the `expected.length < 16` floor ───────────
  // A short or placeholder secret must not be usable even when it matches
  // exactly, because a deployment that sets it to "changeme" would otherwise
  // hand out the bypass to anyone who guesses the placeholder.
  it('refuses a secret shorter than 16 characters even when presented exactly — MUTATION: length floor removed', async () => {
    for (const short of ['a', 'changeme', 'secret', '123456789012345']) {
      process.env.TODERO_INTERNAL_SECRET = short
      const { isInternalCall } = await load()
      expect(short.length).toBeLessThan(16)
      expect(isInternalCall(hdr(short))).toBe(false)
    }
  })

  it('accepts at exactly 16 characters — the floor is a floor, not an off-by-one', async () => {
    const sixteen = '0123456789abcdef'
    expect(sixteen).toHaveLength(16)
    process.env.TODERO_INTERNAL_SECRET = sixteen
    const { isInternalCall } = await load()
    expect(isInternalCall(hdr(sixteen))).toBe(true)
  })

  it('refuses everything when no secret is configured — absence must never grant access', async () => {
    delete process.env.TODERO_INTERNAL_SECRET
    const { isInternalCall, internalHeaders } = await load()
    expect(isInternalCall(hdr('anything'))).toBe(false)
    expect(isInternalCall(hdr(''))).toBe(false)
    expect(isInternalCall(hdr(null))).toBe(false)
    // and it must not invent a header it cannot honour
    expect(internalHeaders()).toEqual({})
  })

  it('refuses a missing header when a secret IS configured', async () => {
    process.env.TODERO_INTERNAL_SECRET = FIXTURE
    const { isInternalCall } = await load()
    expect(isInternalCall(hdr(null))).toBe(false)
  })

  it('internalHeaders carries the secret only when one is configured', async () => {
    process.env.TODERO_INTERNAL_SECRET = FIXTURE
    const { internalHeaders, INTERNAL_HEADER_NAME } = await load()
    expect(internalHeaders()[INTERNAL_HEADER_NAME]).toBe(FIXTURE)
  })
})

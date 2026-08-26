/**
 * ROUND 2 — the open redirect was NOT closed by its first fix.
 *
 * `__tests__/auth/return-path.test.ts` passed a 14-row table of payloads, and
 * its one general-looking test ("never returns a value that resolves
 * off-origin") iterated THAT SAME TABLE — so it explored nothing and could not
 * have caught anything the table did not already name. A critic mutation-tested
 * it and found each of the three input guards could be deleted individually
 * with the suite fully green.
 *
 * The bug the table missed: `safeReturnPath` checked its INPUT and returned
 * `resolved.pathname` unchecked. `..` normalisation makes that pathname
 * protocol-relative, and the caller re-resolved it with `new URL(from, origin)`.
 * Measured LIVE against the running dev server on 2026-08-26, on the SUCCESS
 * path of a real login (both Set-Cookie headers present on every one):
 *
 *   from=/..//evil.example.com/steal?x=1  ->  location: http://evil.example.com/steal?x=1
 *   from=/a/..//evil.example.com          ->  location: http://evil.example.com/
 *   from=/./..//evil.example.com          ->  location: http://evil.example.com/
 *   from=/../..//evil.example.com         ->  location: http://evil.example.com/
 *   from=/..///evil.example.com           ->  location: http://evil.example.com/
 *   from=/..//evil.example.com:8080/x     ->  location: http://evil.example.com:8080/x
 *
 * This file replaces the fake property with a real one: it GENERATES the input
 * space rather than restating a list, so the next shape nobody thought of is
 * caught by the same test rather than by the next critic.
 */
import { safeRedirectUrl, safeReturnPath } from '@/app/api/auth-form/return-path'

const ORIGIN = 'http://localhost:3000'
const EVIL = 'evil.example.com'

describe('the six payloads that escaped the first fix', () => {
  const measured = [
    '/..//evil.example.com/steal?x=1',
    '/a/..//evil.example.com',
    '/./..//evil.example.com',
    '/../..//evil.example.com',
    '/..///evil.example.com',
    '/..//evil.example.com:8080/x',
  ]

  it.each(measured)('%s no longer produces an off-origin destination', (payload) => {
    const path = safeReturnPath(payload, ORIGIN)
    // The assertion is on what the CALLER does with the value, because that is
    // where the escape happened — not on the value looking tidy.
    expect(new URL(path, ORIGIN).origin).toBe(ORIGIN)
    expect(new URL(path, ORIGIN).hostname).not.toBe(EVIL)
    expect(safeRedirectUrl(path, ORIGIN).origin).toBe(ORIGIN)
  })
})

/**
 * A real generator over the shapes that produce path traversal and authority
 * confusion. Every candidate is a plausible `from` value; the invariant is the
 * same one the route depends on.
 */
function generateCandidates(): string[] {
  const tokens = ['..', '.', 'a', '', EVIL, `${EVIL}:8080`, '%2e%2e', '..%2f', 'x']
  const joiners = ['/', '//', '///']
  const out = new Set<string>()
  for (const a of tokens) {
    for (const j1 of joiners) {
      for (const b of tokens) {
        out.add(`/${a}${j1}${b}`)
        for (const j2 of joiners) {
          for (const c of ['', EVIL, '..', 'x']) out.add(`/${a}${j1}${b}${j2}${c}`)
        }
      }
    }
  }
  // Query/fragment variants: a `#` or `?` can end the path early and change
  // what the parser treats as authority.
  for (const base of [...out]) {
    out.add(`${base}?next=/x`)
    out.add(`${base}#frag`)
  }
  return [...out]
}

describe('generated property: nothing safeReturnPath returns can leave this origin', () => {
  const candidates = generateCandidates()

  it(`explores ${candidates.length} generated inputs, not a restated list`, () => {
    expect(candidates.length).toBeGreaterThan(2000)
    const escapes: { input: string; output: string; landsOn: string }[] = []
    for (const input of candidates) {
      const output = safeReturnPath(input, ORIGIN)
      let landsOn: string
      try {
        landsOn = new URL(output, ORIGIN).origin
      } catch {
        landsOn = 'THREW'
      }
      if (landsOn !== ORIGIN) escapes.push({ input, output, landsOn })
      // safeRedirectUrl is the caller-side belt and must hold independently.
      expect(safeRedirectUrl(output, ORIGIN).origin).toBe(ORIGIN)
    }
    expect(escapes).toEqual([])
  })

  it('the generator actually contains inputs that the OLD code let through', () => {
    // Guards the guard: if the generator stopped producing traversal shapes,
    // the property above would pass vacuously and nobody would notice.
    const oldBehaviour = (raw: string): string => {
      // The first fix, verbatim in its load-bearing half.
      if (raw[0] !== '/' || raw[1] === '/' || raw.includes('\\')) return '/'
      const u = new URL(raw, ORIGIN)
      if (u.origin !== ORIGIN) return '/'
      return `${u.pathname}${u.search}${u.hash}`
    }
    const wouldHaveEscaped = generateCandidates().filter((input) => {
      try {
        return new URL(oldBehaviour(input), ORIGIN).origin !== ORIGIN
      } catch {
        return false
      }
    })
    expect(wouldHaveEscaped.length).toBeGreaterThan(0)
  })
})

describe('each input guard is pinned by a payload only IT rejects', () => {
  // The critic deleted each of these individually with the old suite green,
  // because the old table caught every row three times over. One case each.

  it('the control-character guard: a CR that no other guard sees', () => {
    // Single leading slash, no backslash, and `new URL` would keep it on-origin.
    expect(safeReturnPath('/ok\rmore', ORIGIN)).toBe('/')
  })

  it('the backslash guard: a backslash mid-path that stays on-origin', () => {
    // `/a\b` resolves on this origin, so only the backslash guard refuses it.
    expect(safeReturnPath('/a\\b', ORIGIN)).toBe('/')
  })

  it('the leading-slash guard: a bare relative segment', () => {
    expect(safeReturnPath('settings', ORIGIN)).toBe('/')
  })

  it('the double-slash guard: a protocol-relative input', () => {
    expect(safeReturnPath('//evil.example.com', ORIGIN)).toBe('/')
  })

  it('the OUTPUT guard: the one the first fix did not have', () => {
    // Passes every input guard above, and resolves on-origin — the output is
    // the only place this can be caught.
    expect(safeReturnPath('/..//evil.example.com', ORIGIN)).toBe('/')
  })
})

describe('safeRedirectUrl — the caller-side belt', () => {
  it('refuses a protocol-relative path even if handed one directly', () => {
    // This is the exact value the old safeReturnPath returned.
    expect(safeRedirectUrl('//evil.example.com/steal', ORIGIN).origin).toBe(ORIGIN)
    expect(safeRedirectUrl('//evil.example.com/steal', ORIGIN).href).toBe(`${ORIGIN}/`)
  })

  it('preserves a legitimate deep link exactly', () => {
    expect(safeRedirectUrl('/p/limiglow/work?tab=1', ORIGIN).href)
      .toBe(`${ORIGIN}/p/limiglow/work?tab=1`)
  })
})

describe('deep links are not collateral damage', () => {
  const allowed = ['/settings', '/work/epics', '/p/limiglow/work?tab=1', '/work#top', '/p/some%20project']
  it.each(allowed)('keeps %s', (payload) => {
    expect(safeReturnPath(payload, ORIGIN)).toBe(payload)
  })
})

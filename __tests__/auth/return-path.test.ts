/**
 * The `from` field on the no-JS login form was an open redirect.
 *
 * Confirmed against the running dev server on 2026-08-26, BEFORE the fix, on
 * the success path of a login POST to /api/auth-form:
 *
 *   from=//evil.example.com/x   ->  Location: http://evil.example.com/x
 *   from=/\evil.example.com     ->  Location: http://evil.example.com/
 *
 * The old check was `from.startsWith('/')`. Both payloads pass it.
 *
 * These cases are written as a table so a critic can read the refusals and the
 * ALLOWED cases side by side: a fix that simply always returns '/' would close
 * the hole and break every deep link, so the allowed rows matter as much.
 */
import { safeReturnPath } from '@/app/api/auth-form/return-path'

const ORIGIN = 'http://localhost:3000'

describe('safeReturnPath — refusals', () => {
  const offOrigin: [string, string][] = [
    ['protocol-relative', '//evil.example.com'],
    ['protocol-relative with path', '//evil.example.com/x'],
    ['backslash, normalised to / by the URL parser', '/\\evil.example.com'],
    ['backslash with path', '/\\evil.example.com/x'],
    ['absolute https', 'https://evil.example.com'],
    ['absolute http', 'http://evil.example.com/x'],
    ['scheme-ish', 'javascript:alert(1)'],
    ['data url', 'data:text/html,<script>1</script>'],
    ['no leading slash', 'evil.example.com'],
    ['empty', ''],
    ['triple slash', '///evil.example.com'],
    ['tab-obfuscated protocol-relative', '/\t/evil.example.com'],
    ['CR/LF header split', '/ok\r\nLocation: http://evil.example.com'],
    ['newline', '/ok\nx'],
  ]

  it.each(offOrigin)('refuses %s', (_label, payload) => {
    expect(safeReturnPath(payload, ORIGIN)).toBe('/')
  })

  it('refuses anything that is not a string', () => {
    expect(safeReturnPath(undefined, ORIGIN)).toBe('/')
    expect(safeReturnPath(null, ORIGIN)).toBe('/')
    expect(safeReturnPath(42, ORIGIN)).toBe('/')
    expect(safeReturnPath({}, ORIGIN)).toBe('/')
  })

  it('refuses an absurdly long path rather than reflecting it', () => {
    expect(safeReturnPath('/' + 'a'.repeat(5000), ORIGIN)).toBe('/')
  })

  it('never returns a value that resolves off-origin', () => {
    for (const [, payload] of offOrigin) {
      const out = safeReturnPath(payload, ORIGIN)
      expect(new URL(out, ORIGIN).origin).toBe(ORIGIN)
    }
  })
})

describe('safeReturnPath — the allowed cases still work', () => {
  const allowed: [string, string][] = [
    ['root', '/'],
    ['one segment', '/settings'],
    ['nested segments', '/work/epics'],
    ['deep nesting', '/p/limiglow/work/epics'],
    ['query string', '/work?tab=epics'],
    ['fragment', '/work#top'],
    ['query and fragment', '/work?tab=epics#top'],
    ['trailing slash', '/work/'],
    ['percent-encoded segment', '/p/some%20project'],
  ]

  it.each(allowed)('keeps %s', (_label, payload) => {
    const out = safeReturnPath(payload, ORIGIN)
    expect(new URL(out, ORIGIN).origin).toBe(ORIGIN)
    expect(out.startsWith('/')).toBe(true)
    // The point of the allowed table: these must NOT collapse to '/'.
    if (payload !== '/') expect(out).not.toBe('/')
  })

  it('preserves the exact path for a plain nested link', () => {
    expect(safeReturnPath('/work/epics', ORIGIN)).toBe('/work/epics')
  })
})

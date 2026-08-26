// ─── The `from` field on the no-JS login form ────────────────────────────────
//
// This lived inside ./route.ts as `from.startsWith('/')`, and that check was an
// OPEN REDIRECT. Confirmed against the running server on 2026-08-26, on the
// SUCCESS path of a login POST:
//
//   from=//evil.example.com/x   ->  Location: http://evil.example.com/x
//   from=/\evil.example.com     ->  Location: http://evil.example.com/
//
// `//host` is a protocol-relative URL, and the WHATWG URL parser normalises a
// backslash to a slash for http(s) — so both resolve to a different origin
// while still passing `startsWith('/')`.
//
// ─── ROUND 2, 2026-08-26: THE FIRST FIX DID NOT CLOSE IT ─────────────────────
//
// The first version of this module checked the INPUT and returned
// `resolved.pathname` without ever checking that value. `..` normalisation
// turns an input that passes every input guard into an OUTPUT that is itself
// protocol-relative, and the caller in ./route.ts re-resolves the output with
// `new URL(from, origin)`. Measured live, on the SUCCESS path of a real login,
// with both Set-Cookie headers present:
//
//   from=/..//evil.example.com/steal?x=1  ->  location: http://evil.example.com/steal?x=1
//   from=/a/..//evil.example.com          ->  location: http://evil.example.com/
//   from=/./..//evil.example.com          ->  location: http://evil.example.com/
//   from=/../..//evil.example.com         ->  location: http://evil.example.com/
//   from=/..///evil.example.com           ->  location: http://evil.example.com/
//   from=/..//evil.example.com:8080/x     ->  location: http://evil.example.com:8080/x
//
// `/..//evil.example.com` starts with exactly one `/`, contains no backslash
// and no control character, and `new URL()` resolves it ON this origin — so all
// three input guards pass — and then `pathname` comes back as
// `//evil.example.com`, because `/..` at the root pops nothing and the parser
// keeps the doubled slash that follows.
//
// THE LESSON, written down because the first fix's own comment asserted the
// opposite: the guard has to inspect the value this function RETURNS, because
// that is the value the caller feeds back into `new URL(..., origin)`. Guards on
// the input can only ever be defence in depth. `assertRelative()` below is the
// load-bearing one and it is applied to the output.
//
// It lives in its own module because App Router `route.ts` files may only
// export HTTP method handlers, so the check could not be exported from there
// to be tested directly.

/**
 * The one invariant that matters: `path` must be something that, re-resolved
 * against `origin` by the caller, cannot land anywhere but `origin`.
 *
 * A relative reference beginning with two slashes is protocol-relative and
 * names an authority, so `//host` and `///host` are both refused. Everything
 * else that begins with a single `/` is an absolute-path reference and cannot
 * name an authority at all.
 */
function isSameOriginRelative(path: string, origin: string): boolean {
  if (path[0] !== '/') return false
  if (path[1] === '/') return false
  let recheck: URL
  try {
    recheck = new URL(path, origin)
  } catch {
    return false
  }
  return recheck.origin === origin
}

/**
 * Reduce a submitted `from` to a same-origin PATH, or to `/`.
 *
 * The return value is re-resolved against `origin` before it is returned and
 * refused unless it lands back on `origin` — so the caller's own
 * `new URL(value, origin)` cannot produce another host. Anything not obviously
 * safe becomes `/`: this fails closed by design; a login that lands on the
 * dashboard instead of a deep link is a nuisance, a login that lands on
 * someone else's site is a phishing hand-off.
 */
export function safeReturnPath(raw: unknown, origin: string): string {
  if (typeof raw !== 'string' || raw === '') return '/'
  if (raw.length > 2048) return '/'

  // ── Input guards: defence in depth, and deliberately redundant. ──
  // A critic mutation-tested the first version and found each of these could
  // be deleted individually with the whole suite still green, because the
  // payload table caught every row three times over. They are kept because
  // they refuse hostile input EARLY and cheaply, and each is now pinned by a
  // test using a payload only that guard rejects — but none of them is what
  // makes this function correct. The output check below is.
  for (const ch of raw) {
    // Control characters, including the CR/LF used for header splitting.
    const code = ch.charCodeAt(0)
    if (code < 0x20 || code === 0x7f) return '/'
  }
  if (raw.includes('\\')) return '/'
  if (raw[0] !== '/') return '/'
  if (raw[1] === '/') return '/'

  let resolved: URL
  try {
    resolved = new URL(raw, origin)
  } catch {
    return '/'
  }
  if (resolved.origin !== origin) return '/'

  // ── The load-bearing check: the OUTPUT, not the input. ──
  // `resolved.pathname` can be protocol-relative even when `raw` was not and
  // even when `resolved.origin` was this origin — see this file's header for
  // the six measured payloads that did exactly that.
  const path = `${resolved.pathname}${resolved.search}${resolved.hash}`
  if (!isSameOriginRelative(path, origin)) return '/'
  return path
}

/**
 * Belt for the caller: turn an already-sanitised path into the URL to redirect
 * to, refusing anything that still resolves off-origin.
 *
 * This exists because the open redirect survived its first fix at the caller's
 * `new URL(from, origin)` line, not inside `safeReturnPath`. Doing the final
 * resolution here means the route cannot reintroduce the bug by re-resolving a
 * value itself, and the refusal is testable without a server.
 */
export function safeRedirectUrl(path: string, origin: string): URL {
  if (!isSameOriginRelative(path, origin)) return new URL('/', origin)
  return new URL(path, origin)
}

// Handles native HTML form POST (no-JS / hydration fallback) for app/login.
//
// pieces8/identity-sessions changed three things here and deliberately did not
// change a fourth:
//   1. The same brute-force limiter as POST /api/auth now guards this path.
//      Without it this endpoint was the unlimited way in: measured on
//      2026-08-26, twenty consecutive wrong passwords all answered 303 back to
//      /login?error=1 with no throttle at all.
//   2. The `from` field is validated. It was an OPEN REDIRECT — measured, over
//      real HTTP: `from=//evil.example.com/x` answered
//      `Location: http://evil.example.com/x`, and `from=/\evil.example.com`
//      answered `Location: http://evil.example.com/`. Both sent the operator
//      off-origin on the SUCCESS path of a login form.
//   3. Passwords are compared in near-constant time.
//   4. NOT CHANGED: this route maps the owner password to the role `admin`
//      while POST /api/auth maps the same password to `owner`, and it does not
//      accept MC_MEMBER_PASSWORD at all.
//
// ─── ROUND 2, 2026-08-26: two corrections to the notes above ────────────────
//
// (2) WAS NOT ACTUALLY CLOSED. `safeReturnPath` checked its input and returned
//     an unchecked `pathname`, and `..` normalisation makes that pathname
//     protocol-relative. Measured live on the SUCCESS path of a real login,
//     after the first fix:
//         from=/..//evil.example.com/steal?x=1 -> location: http://evil.example.com/steal?x=1
//     plus five more shapes; see ./return-path.ts's header for the full list.
//     The escape happened at THIS file's `new URL(from, origin)` line, which
//     re-resolved a value that had already passed the check. It now goes
//     through `safeRedirectUrl`, which refuses anything that does not land back
//     on this origin.
//
// (4) THE REASON GIVEN WAS VOID, even though the fact it rested on is true.
//     `admin` really does hold fewer permissions than `owner` in
//     lib/rbac-types.ts. But `mc-role` is a client-typed cookie, so a no-JS
//     login that receives `mc-role=admin` can simply rewrite it — issuing the
//     weaker word bought nothing, and "changing it would WIDEN what a no-JS
//     login can do" was therefore not a reason to leave it. Measured before
//     the fix, with the READ-ONLY viewer password:
//         Cookie: mc-auth=view2026; mc-role=viewer -> 403
//         Cookie: mc-auth=view2026; mc-role=admin  -> reaches the handler
//     What actually closes that is deriving the role from the CREDENTIAL and
//     letting `mc-role` only ever narrow it, which now happens in
//     lib/with-permission.ts and lib/session-actor.ts. With the cookie no
//     longer authoritative, which word this route writes into it is a display
//     detail rather than a privilege decision — so it is still left alone, but
//     for a reason that survives reading the code.

import { NextRequest, NextResponse } from 'next/server'
import { authRateLimiter, clientKey } from '../auth/rate-limit'
import { clearSessionCookies, secretEquals, setSessionCookies } from '../auth/session-cookies'
import { safeRedirectUrl, safeReturnPath } from './return-path'

const ADMIN_PASSWORD = process.env.MC_PASSWORD ?? 'kaos2026'
const VIEWER_PASSWORD = process.env.MC_VIEWER_PASSWORD ?? 'view2026'

function backToLogin(origin: string, from: string, params: Record<string, string>): NextResponse {
  const loginUrl = new URL('/login', origin)
  for (const [k, v] of Object.entries(params)) loginUrl.searchParams.set(k, v)
  if (from && from !== '/') loginUrl.searchParams.set('from', from)
  return NextResponse.redirect(loginUrl, { status: 303 })
}

export async function POST(req: NextRequest) {
  const origin = req.nextUrl.origin

  let data: FormData
  try {
    data = await req.formData()
  } catch {
    return backToLogin(origin, '/', { error: '1' })
  }

  const from = safeReturnPath(data.get('from'), origin)

  // Sign-out through the no-JS path. Costs no attempt budget and needs no
  // password; it only expires cookies. See clearSessionCookies for why this is
  // a clear and not an invalidation.
  if (data.get('intent') === 'logout') {
    const res = NextResponse.redirect(new URL('/login', origin), { status: 303 })
    clearSessionCookies(res)
    return res
  }

  const key = clientKey(req.headers, req.ip)
  const decision = authRateLimiter.check(key)
  if (!decision.allowed) {
    const res = backToLogin(origin, from, {
      error: '1',
      rate_limited: '1',
      retry_after: String(decision.retryAfterSeconds),
    })
    res.headers.set('Retry-After', String(decision.retryAfterSeconds))
    return res
  }

  const password = (data.get('password') as string) ?? ''

  let role: 'admin' | 'viewer' | null = null
  let cookieValue = ''
  if (secretEquals(password, ADMIN_PASSWORD)) {
    role = 'admin'
    cookieValue = ADMIN_PASSWORD
  } else if (secretEquals(password, VIEWER_PASSWORD)) {
    role = 'viewer'
    cookieValue = VIEWER_PASSWORD
  }

  if (!role) {
    authRateLimiter.recordFailure(key)
    return backToLogin(origin, from, { error: '1' })
  }

  authRateLimiter.recordSuccess(key)
  // NOT `new URL(from, origin)`. That line is where the open redirect actually
  // escaped: it re-resolved a value that had already passed safeReturnPath, and
  // a protocol-relative pathname re-resolves to another host. safeRedirectUrl
  // refuses anything that does not land back on this origin.
  const res = NextResponse.redirect(safeRedirectUrl(from, origin), { status: 303 })
  setSessionCookies(res, cookieValue, role)
  return res
}

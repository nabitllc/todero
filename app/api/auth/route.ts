// TOD-906: Auth route — maps passwords to workspace roles
// Roles: owner (MC_PASSWORD), member (MC_MEMBER_PASSWORD), viewer (MC_VIEWER_PASSWORD)
// Legacy: admin cookie value is treated as owner throughout the app
//
// pieces8/identity-sessions: this endpoint is now rate limited (POST) and can
// end a session (DELETE). The password→role→cookie contract is UNCHANGED — the
// same three passwords map to the same three roles and write the same two
// cookie values as before. Nothing here grants access that was not granted
// yesterday; the additions only refuse more.
//
// ROUND 2 CAVEAT, because rate-limiting this route reads as more protection
// than it is: an attacker does not need this endpoint to guess a password.
// `mc-auth` IS the password, so every `/api/` request is an unthrottled
// 401/200 oracle in `middleware.ts`. Measured. See ./rate-limit.ts's header
// for the numbers and the piece doc's §10 for the seam that closes it.

import { NextRequest, NextResponse } from 'next/server'
import { authRateLimiter, clientKey } from './rate-limit'
import { clearSessionCookies, secretEquals, setSessionCookies } from './session-cookies'

const OWNER_PASSWORD = process.env.MC_PASSWORD ?? 'kaos2026'
const VIEWER_PASSWORD = process.env.MC_VIEWER_PASSWORD ?? 'view2026'
const MEMBER_PASSWORD = process.env.MC_MEMBER_PASSWORD ?? ''

/** 429 body/headers. Says nothing about whether the password was right. */
function tooManyAttempts(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    {
      error: 'Too many login attempts. Try again later.',
      code: 'RATE_LIMITED',
      retry_after_seconds: retryAfterSeconds,
    },
    { status: 429, headers: { 'Retry-After': String(retryAfterSeconds) } }
  )
}

export async function POST(req: NextRequest) {
  const key = clientKey(req.headers, req.ip)

  // Checked BEFORE the password is read or compared. A limiter that runs after
  // verification still lets the winning guess through, which is the only guess
  // that matters.
  const decision = authRateLimiter.check(key)
  if (!decision.allowed) return tooManyAttempts(decision.retryAfterSeconds)

  // A malformed body used to throw out of the handler and surface as a 500.
  // It is a failed attempt, so it is counted as one.
  let password: unknown
  try {
    password = (await req.json())?.password
  } catch {
    authRateLimiter.recordFailure(key)
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  let role: 'owner' | 'member' | 'viewer' | null = null
  let cookieValue = ''

  if (typeof password === 'string') {
    if (secretEquals(password, OWNER_PASSWORD)) {
      role = 'owner'
      cookieValue = OWNER_PASSWORD
    } else if (MEMBER_PASSWORD && secretEquals(password, MEMBER_PASSWORD)) {
      role = 'member'
      cookieValue = MEMBER_PASSWORD
    } else if (secretEquals(password, VIEWER_PASSWORD)) {
      role = 'viewer'
      cookieValue = VIEWER_PASSWORD
    }
  }

  if (!role) {
    authRateLimiter.recordFailure(key)
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 })
  }

  authRateLimiter.recordSuccess(key)
  const res = NextResponse.json({ ok: true, role })
  setSessionCookies(res, cookieValue, role)
  return res
}

/**
 * DELETE /api/auth — sign out.
 *
 * WHY DELETE ON THIS PATH RATHER THAN POST /api/auth/logout: middleware.ts
 * exempts exactly the two literal paths `/api/auth` and `/api/auth-form` from
 * the session gate, and separately refuses every write method from a `viewer`
 * on any other `/api/` path. A logout at its own path would therefore have
 * answered 403 for the one role most likely to be sharing a machine, and
 * fixing that needs an edit to middleware.ts, which this piece does not own.
 * `DELETE /api/auth` needs no seam and works for every role today. A seam diff
 * that adds the friendlier path is written up in the piece doc.
 *
 * This clears the browser's copy of both cookies. It does NOT invalidate the
 * credential — see clearSessionCookies' comment. The response says so.
 */
export async function DELETE(_req: NextRequest) {
  const res = NextResponse.json({
    ok: true,
    signed_out: true,
    note: 'Session cookies cleared. The shared workspace password itself is unchanged and a retained copy of the cookie would still authenticate.',
  })
  clearSessionCookies(res)
  return res
}

// ─── The two session cookies, written and cleared in exactly one place ───────
//
// `mc-auth` holds a workspace password verbatim and `mc-role` holds the role
// that password maps to. Six other modules read this pair — middleware.ts,
// lib/rbac-middleware.ts, lib/with-permission.ts, lib/session-actor.ts,
// lib/permission-check.ts and app/api/db/[...path]/route.ts — and every one of
// them compares `mc-auth` against a password. That contract is NOT changed
// here; this file only makes sure the two routes that issue the pair agree on
// the attributes, so that a clear actually clears.
//
// A CONSEQUENCE OF THAT CONTRACT, worth naming where it is written down: since
// `mc-auth` holds the password itself, every one of those six comparisons is
// also a password oracle. `middleware.ts`'s runs on every `/api/` request and
// is not rate limited by anything — measured, 30 wrong cookie values gave 30
// unthrottled 401s and the right one gave 200. See ./rate-limit.ts's header.
//
// A cookie is only removed when the expiring Set-Cookie carries the SAME path
// and (where applicable) domain as the one that created it. `mc-auth` is
// httpOnly, so browser JavaScript cannot clear it at all — before the logout
// added in ./route.ts there was no way for a signed-in operator to sign out.

import type { NextResponse } from 'next/server'
import { timingSafeEqual } from 'crypto'

export const AUTH_COOKIE = 'mc-auth'
export const ROLE_COOKIE = 'mc-role'

const THIRTY_DAYS_SECONDS = 60 * 60 * 24 * 30

/** Attributes shared by both cookies. Must match between set and clear. */
function baseOptions() {
  return {
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    sameSite: 'strict' as const,
  }
}

/**
 * Compare a submitted password against a configured one in time that does not
 * depend on how many leading characters matched.
 *
 * An unequal LENGTH is still observable — `timingSafeEqual` requires equal-size
 * buffers — so this narrows the side channel rather than closing it. Closing it
 * needs the stored credential to be a fixed-width hash, which is part of the
 * plan, not of this change. An empty or unset configured secret never matches:
 * `MC_MEMBER_PASSWORD` is unset on this host, and an unset password must not
 * become a password of "".
 */
export function secretEquals(submitted: string, configured: string | undefined): boolean {
  if (typeof submitted !== 'string' || !configured) return false
  const a = Buffer.from(submitted, 'utf8')
  const b = Buffer.from(configured, 'utf8')
  if (a.length !== b.length) {
    // Burn a comparison of equal size so the unequal-length path is not the
    // conspicuously fast one.
    timingSafeEqual(b, b)
    return false
  }
  return timingSafeEqual(a, b)
}

/** Issue a signed-in session: the password cookie plus the role cookie. */
export function setSessionCookies(res: NextResponse, cookieValue: string, role: string): void {
  res.cookies.set(AUTH_COOKIE, cookieValue, {
    ...baseOptions(),
    httpOnly: true,
    maxAge: THIRTY_DAYS_SECONDS,
  })
  res.cookies.set(ROLE_COOKIE, role, {
    ...baseOptions(),
    // Readable by client JS on purpose: app/page.tsx:419-421 reads it out of
    // document.cookie to disable actions the signed-in role cannot perform.
    //
    // READ THIS BEFORE "FIXING" IT. A critic named this flag as the enabler of
    // the role-forgery escalation. It is not, and flipping it would break that
    // UI while closing nothing: the attack is a request the attacker composes
    // themselves, so `Cookie: mc-auth=view2026; mc-role=owner` from curl is
    // unaffected by a flag that only governs document.cookie. Measured, both
    // ways, 2026-08-26.
    //
    // What makes the cookie safe is that the SERVER no longer treats it as
    // authoritative: lib/with-permission.ts and lib/session-actor.ts derive the
    // role from the CREDENTIAL and let this value only ever narrow it. The one
    // place that still trusts it directly is middleware.ts, which this lane
    // does not own — filed as a seam request in the piece doc's §10.
    httpOnly: false,
    maxAge: THIRTY_DAYS_SECONDS,
  })
}

/**
 * Expire both session cookies.
 *
 * READ THIS BEFORE CALLING IT "INVALIDATION". It is not. The value inside
 * `mc-auth` is a shared workspace password, so anyone who kept a copy of the
 * cookie can replay it and will still be authenticated. This clears the
 * browser's copy — which is the part that was previously IMPOSSIBLE, because
 * `mc-auth` is httpOnly — and nothing more. Server-side revocation is
 * impossible while the credential is a shared constant; see
 * docs/rebuild/pieces/pieces8/identity-sessions.md.
 */
export function clearSessionCookies(res: NextResponse): void {
  for (const [name, httpOnly] of [
    [AUTH_COOKIE, true],
    [ROLE_COOKIE, false],
  ] as const) {
    res.cookies.set(name, '', {
      ...baseOptions(),
      httpOnly,
      maxAge: 0,
      expires: new Date(0),
    })
  }
}

// ─── Server-side resolution of the acting human ──────────────────────────────
//
// Server only. Reads the session cookies and answers "which workflow actor is
// this request?" so a route never has to trust a browser-supplied identity.
//
// The cookie contract matches `app/api/auth/route.ts`: `mc-auth` holds one of
// the workspace passwords and `mc-role` holds the role that password maps to.

import type { NextRequest } from 'next/server'
import { operatorForRole } from './operator-identity'

/** Passwords that constitute a signed-in Mission Control session. */
function sessionPasswords(): string[] {
  return [
    process.env.MC_PASSWORD ?? 'kaos2026',
    process.env.MC_VIEWER_PASSWORD ?? 'view2026',
    process.env.MC_MEMBER_PASSWORD ?? '',
  ].filter(Boolean)
}

/** True when the request carries a valid `mc-auth` session cookie. */
export function hasSession(req: NextRequest): boolean {
  const auth = req.cookies.get('mc-auth')?.value
  if (!auth) return false
  return sessionPasswords().includes(auth)
}

/**
 * The workflow actor for this request's signed-in human, or `undefined`.
 *
 * Only an authenticated owner session resolves to a name — viewers and members
 * stay unset so the transition guard rejects them exactly as before. Agent
 * callers (no session cookie) also stay unset: they must keep sending their own
 * `transitioned_by`, so this widens nothing for machine callers.
 */
export function resolveSessionActor(req: NextRequest): string | undefined {
  if (!hasSession(req)) return undefined
  return operatorForRole(req.cookies.get('mc-role')?.value)
}

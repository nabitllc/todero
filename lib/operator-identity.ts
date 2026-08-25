// ─── Who "the operator" is ───────────────────────────────────────────────────
//
// Mission Control has no user table for humans: a person signs in with a
// workspace password and gets an `mc-role` cookie. But the issue workflow
// engine attributes every transition to a NAMED actor (`transitioned_by`) —
// agents send their own agent id, and until now the browser sent nothing at
// all, so every human drag on the Board was rejected by the transition guard.
//
// This module is the one place that maps a signed-in ROLE onto that name, so
// the client and the server derive it the same way and neither hardcodes it at
// a call site. It is deliberately isomorphic: the identity is a username, not a
// secret, so it is safe to read in the browser bundle.
//
// The server derives the same answer from the session cookies in
// `lib/session-actor.ts` and uses it whenever the request body omits an actor,
// so a client that forgets to send one still works. The client-side copy here
// is a UI convenience; the server's copy is the one that has to be right.

/**
 * The workflow identity the workspace owner acts as.
 *
 * `michael` is the historical literal baked into the workflow engine's admin
 * bypass; overriding this makes a fresh install attribute owner actions to
 * whoever runs it. Public on purpose — see the note above.
 */
export const OWNER_IDENTITY: string =
  process.env.NEXT_PUBLIC_TODERO_OWNER_IDENTITY?.trim() || 'michael'

/**
 * Role values that mean "the workspace owner". `admin` is the legacy cookie
 * value written by the no-JS login form and is treated as owner throughout the
 * app.
 */
const OWNER_ROLES = new Set(['owner', 'admin'])

/**
 * Workflow actor name for a signed-in role, or `undefined` when the role is not
 * entitled to act as a person (viewer, member, unknown, signed out). Returning
 * `undefined` keeps the transition guard's existing "no actor" behaviour.
 */
export function operatorForRole(role: string | null | undefined): string | undefined {
  if (!role) return undefined
  return OWNER_ROLES.has(role) ? OWNER_IDENTITY : undefined
}

/** True when `actor` is the owner — accepts the legacy literal and the configured name. */
export function isOwnerActor(actor: string | null | undefined): boolean {
  return actor === 'michael' || (!!actor && actor === OWNER_IDENTITY)
}

/** The `mc-role` cookie, read from the browser. `null` on the server. */
export function readRoleCookie(): string | null {
  if (typeof document === 'undefined') return null
  const match = document.cookie.match(/(?:^|;\s*)mc-role=([^;]+)/)
  return match ? decodeURIComponent(match[1]) : null
}

/**
 * Workflow actor for the browser's current session, or `undefined` when the
 * signed-in role does not act as a person. Send this as `transitioned_by` on
 * writes the human initiated.
 */
export function sessionOperator(): string | undefined {
  return operatorForRole(readRoleCookie())
}

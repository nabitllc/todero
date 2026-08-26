// ─── Server-side resolution of the acting human ──────────────────────────────
//
// Server only. Reads the session cookies and answers "which workflow actor is
// this request?" so a route never has to trust a browser-supplied identity.
//
// The cookie contract matches `app/api/auth/route.ts`: `mc-auth` holds one of
// the workspace passwords and `mc-role` holds the role that password maps to.
//
// ─── ROUND 2, 2026-08-26: THIS FILE FORGED PROVENANCE ───────────────────────
//
// The previous version resolved the actor as `operatorForRole(mc-role)` — the
// client-typed cookie, read directly, with the credential checked only for
// being *a* valid password rather than for being *the owner's*. So a holder of
// the READ-ONLY viewer password who edited one cookie was attributed as the
// workspace owner in `issues.transitioned_by`. Measured with the real module
// on 2026-08-26, before the fix:
//
//     mc-auth=view2026; mc-role=owner  ->  "michael"
//     mc-auth=view2026; mc-role=admin  ->  "michael"
//
// That is worse than an access-control bug: `transitioned_by` is the workflow
// audit trail, so the escalation was writing a false name into the record of
// who moved the issue, and `lib/operator-identity.ts`'s `isOwnerActor()` then
// treats that name as the owner's admin bypass downstream.
//
// The fix derives the role from the CREDENTIAL and lets `mc-role` only ever
// narrow it, using the same `resolveDecisionRole()` that lib/approvals.ts
// already provides and app/api/inbox/actor.ts already uses. One rule, one
// implementation, three call sites.
//
// WHAT IS STILL NOT PROVEN, and it is the important half: Todero authenticates
// a PASSWORD, not a person. Every session on the owner password is the same
// session, so `michael` names a ROLE that has an owner's rights, not a human
// being who can be held to it. Two people sharing that password are
// indistinguishable in this trail, and nothing here changes that — only real
// per-principal credentials would. See
// docs/rebuild/pieces/pieces8/identity-sessions.md §7.

import type { NextRequest } from 'next/server'
import { resolveDecisionRole, type SessionCredentials } from './approvals'
import { operatorForRole } from './operator-identity'

/**
 * The passwords this install recognises and the role each grants.
 *
 * Read at call time rather than captured at module load, so a test can vary
 * the environment without module isolation, and so the answer cannot depend on
 * when this module happened to be evaluated.
 */
function sessionCredentials(): SessionCredentials {
  return {
    ownerPassword: process.env.MC_PASSWORD ?? 'kaos2026',
    viewerPassword: process.env.MC_VIEWER_PASSWORD ?? 'view2026',
    memberPassword: process.env.MC_MEMBER_PASSWORD || null,
  }
}

/** Passwords that constitute a signed-in Mission Control session. */
function sessionPasswords(): string[] {
  const c = sessionCredentials()
  return [c.ownerPassword, c.viewerPassword, c.memberPassword ?? ''].filter(Boolean)
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
 * Only a credential that actually PROVES owner rights resolves to a name.
 * Viewers and members stay unset so the transition guard rejects them exactly
 * as before, and — the part that was broken — a viewer credential carrying
 * `mc-role=owner` now also stays unset, because the cookie can only narrow the
 * role its password proves. Agent callers (no session cookie) also stay unset:
 * they must keep sending their own `transitioned_by`, so this widens nothing
 * for machine callers.
 *
 * `X-Agent-Role` is deliberately NOT consulted here. `resolveDecisionRole()`
 * would honour it when no session is present, and honouring it would hand a
 * machine caller the human owner's name — the exact thing the last paragraph
 * says must not happen. Only the cookie credential is passed in.
 */
export function resolveSessionActor(req: NextRequest): string | undefined {
  const { role } = resolveDecisionRole(
    {
      sessionPassword: req.cookies.get('mc-auth')?.value ?? null,
      claimedRole: req.cookies.get('mc-role')?.value ?? null,
      agentRoleHeader: null,
    },
    sessionCredentials(),
  )
  return operatorForRole(role)
}

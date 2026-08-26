// app/api/inbox/actor.ts — who the inbox believes is deciding.
//
// WHY THIS FILE EXISTS RATHER THAN A CALL TO lib/with-permission.ts.
//
// The decision route used to resolve its actor with `resolveRole()` from
// `lib/with-permission.ts`. That function accepts ANY valid session password
// and then reads the role straight out of the client-typed `mc-role` cookie:
//
//     const cookieRole = req.cookies.get('mc-role')?.value
//     if (cookieRole && cookieRole in COOKIE_ROLE_MAP) return COOKIE_ROLE_MAP[cookieRole]
//
// so a session holding only the READ-ONLY viewer password could name itself
// `admin` and be believed. Measured live against this route on 2026-08-26,
// on one fixture, in one shell, with the cookie as the only variable:
//
//     mc-auth=view2026; mc-role=viewer  ->  403
//     mc-auth=view2026; mc-role=admin   ->  200, agent un-paused,
//                                            resolved_by "michael (admin)"
//
// That made the whole actor gate — and the append-only trail that records its
// refusals — bypassable by editing one cookie value from a read-only account.
//
// `lib/with-permission.ts` is not in this piece's ownership, so the fix lands
// here, as the brief's second option: the inbox gate calls a role source that
// derives the role from the CREDENTIAL and lets `mc-role` only narrow it.
// `resolveDecisionRole()` in lib/approvals.ts is that source, and it is pure
// so the escalation can be proven closed without a server.
//
// WHAT IS STILL OPEN — corrected 2026-08-26 (round 3). This header used to
// say "every other caller of `resolveRole()` still trusts `mc-role`". That
// sentence is now wrong in both directions and it pointed away from the live
// hole, so it is replaced rather than kept:
//
//   * `lib/with-permission.ts:121` now calls `resolveDecisionRole()` itself,
//     so those routes are already on the fixed source.
//   * The door that is actually open is `app/api/db/[...path]/route.ts`,
//     which never called `resolveRole()`. `inbox` is in its WRITABLE_TABLES
//     and its only write gate is `req.cookies.get('mc-role')?.value ===
//     'viewer'`. MEASURED 2026-08-26, same read-only credential, same row,
//     same shell: PATCH /api/inbox -> 403; PATCH /api/db/inbox?id=eq.<id>
//     {"status":"approved","resolved_by":"definitely-not-a-human-bot"} -> 200,
//     with zero rows written to `approval_decisions`. DELETE on a second row
//     -> 200, request destroyed.
//
// So the gate below is one of TWO writers to `inbox.status`/`resolved_by`,
// and only this one is gated. The closing diff is SEAM-1 in
// docs/rebuild/pieces/pieces9/approval-surface.md, and it is enforced as a
// failing test — `__tests__/api/inbox-db-proxy-seam.test.ts` — rather than as
// a paragraph, because the previous round's paragraph is what went stale.

import type { NextRequest } from 'next/server'
import {
  resolveDecisionRole,
  type DecisionActor,
  type ResolvedDecisionRole,
  type SessionCredentials,
} from '@/lib/approvals'

/**
 * The passwords this install actually recognises.
 *
 * The env vars and defaults are `app/api/auth/route.ts`'s, character for
 * character — that route is what issues the session, so it is the authority
 * on which password means which role. Diverging would make this route
 * disagree with the login about who is signed in, which is the class of bug
 * being fixed, not a detail.
 *
 * `MC_MEMBER_PASSWORD` is read but is unset on this install (verified: the
 * key does not appear in `.env.local`), which is why the `member` refusal is
 * unit-tested rather than measured; see the piece doc's §8.
 */
export function sessionCredentials(): SessionCredentials {
  return {
    ownerPassword: process.env.MC_PASSWORD ?? 'kaos2026',
    viewerPassword: process.env.MC_VIEWER_PASSWORD ?? 'view2026',
    memberPassword: process.env.MC_MEMBER_PASSWORD || null,
  }
}

export interface InboxDecisionActor extends DecisionActor {
  /** The role the presented credential proves, before narrowing. */
  granted: ResolvedDecisionRole['granted']
  /** An `mc-role` value that asked for more than the credential proves. */
  ignoredClaim: string | null
}

/**
 * Read the acting role off the request, and the name the caller claimed.
 *
 * `claimedBy` stays exactly what it was — a label the caller typed, recorded
 * as a claim. What changed is that the role beside it is now derived from the
 * password, so the parenthesised half of `"michael (admin)"` is something the
 * client genuinely cannot set.
 */
export function inboxDecisionActor(
  req: NextRequest,
  claimedBy: string | null,
): InboxDecisionActor {
  const resolved = resolveDecisionRole(
    {
      sessionPassword: req.cookies.get('mc-auth')?.value ?? null,
      claimedRole: req.cookies.get('mc-role')?.value ?? null,
      agentRoleHeader: req.headers.get('x-agent-role'),
    },
    sessionCredentials(),
  )
  return {
    role: resolved.role,
    claimedBy,
    granted: resolved.granted,
    ignoredClaim: resolved.ignoredClaim,
  }
}

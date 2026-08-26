/**
 * Permission middleware for Todero API routes (TOD-1496)
 *
 * Resolves the caller's role from:
 *   - Human: the `mc-auth` session cookie — the CREDENTIAL, not the `mc-role`
 *     cookie beside it. `mc-role` may narrow that role, never widen it.
 *   - Agent: `X-Agent-Role`, honoured only when no valid session is presented.
 *
 * ─── ROUND 2, 2026-08-26: THIS FILE SHIPPED A PRIVILEGE ESCALATION ───────────
 *
 * The previous version read the role straight out of the client-typed `mc-role`
 * cookie whenever ANY valid session password was present:
 *
 *     const cookieRole = req.cookies.get('mc-role')?.value
 *     if (cookieRole && cookieRole in COOKIE_ROLE_MAP) return COOKIE_ROLE_MAP[cookieRole]
 *
 * so a session holding only the READ-ONLY viewer password could name itself
 * `admin` and be believed by every route that calls `withPermission`. Measured
 * live against the running dev server on 2026-08-26, one variable changed
 * between the two requests, against a route this file guards:
 *
 *     PATCH /api/commerce/products
 *       Cookie: mc-auth=view2026; mc-role=viewer
 *         -> 403  "Read-only access: viewer role cannot modify data"
 *       Cookie: mc-auth=view2026; mc-role=admin
 *         -> reaches the handler body with commerce:write granted
 *
 * The header's old "Spoof protection: X-Agent-Role is ignored when mc-auth
 * matches a valid password" was true and was also beside the point: the header
 * was never the cheap way up. The cookie was.
 *
 * THE FIX IS NOT A NEW ONE. `resolveDecisionRole()` in lib/approvals.ts already
 * implements exactly this — derive from the credential, let `mc-role` only
 * narrow — and the piece that added it filed a seam request asking this file to
 * adopt it (see app/api/inbox/actor.ts's header, "THIS DOES NOT FIX THE OTHER
 * ROUTES"). This file now calls it, which closes that seam rather than shipping
 * a second, subtly different copy of the same rule.
 *
 * ─── ONE DELIBERATE BEHAVIOUR CHANGE, stated rather than buried ──────────────
 *
 * The owner password now resolves to `owner`, where this file previously called
 * it `admin`. `app/api/auth/route.ts` — the thing that issues the session — has
 * always called that credential `owner`; `admin` was this file's own word for
 * it, and the disagreement is part of why the two layers could be played off
 * against each other. No route loses access: `ROLE_PERMISSIONS.owner` is a
 * strict superset of `ROLE_PERMISSIONS.admin`, and no caller compares this
 * function's result against the literal `'admin'` (checked:
 * `grep -rn "role === 'admin'" app/ lib/` finds only lib/rbac-middleware.ts,
 * which uses its own separate `resolveRole`). One VISIBLE consequence:
 * `app/api/agent-responsibilities/route.ts` stores `resolveRole(req)` in
 * `assigned_by`, so new rows written by an owner session say `owner` where they
 * used to say `admin`.
 *
 * ─── WHAT THIS STILL DOES NOT DO ────────────────────────────────────────────
 *
 * 1. It does not fix `middleware.ts`, which is the PRIMARY gate and is not in
 *    this lane's ownership. Middleware still reads `mc-role` directly and still
 *    decides `DELETE /api/issues` and `/api/roles` from it, so the same forged
 *    cookie still escalates on every route that middleware alone guards. That
 *    is filed as a seam request with an exact diff in
 *    docs/rebuild/pieces/pieces8/identity-sessions.md §10.
 * 2. `X-Agent-Role` is still a claim with no per-principal secret behind it.
 *    Measured: with no cookie at all, middleware.ts answers 401 before this
 *    file runs, so it is NOT an anonymous front door — but a caller holding the
 *    single shared `TODERO_INTERNAL_SECRET` may claim any role. Per-agent keys
 *    are the benchmark's answer and are planned, not shipped.
 * 3. The credential comparison in `roleFromPassword` is `===`, not constant
 *    time. That is lib/approvals.ts's code and not this lane's to change, and
 *    narrowing it here alone would buy nothing measurable while `middleware.ts`
 *    and `lib/rbac-middleware.ts` compare the same cookie with `===` on every
 *    single request.
 */

import { NextRequest, NextResponse } from 'next/server'
import { resolveDecisionRole, type SessionCredentials } from '@/lib/approvals'
import { ROLE_PERMISSIONS, Role, Permission } from '@/lib/rbac-types'

/**
 * The passwords this install recognises and the role each grants.
 *
 * Read at call time, not at module load: the previous version captured
 * `process.env.MC_PASSWORD` into a module constant, which makes the resolved
 * role depend on when the module happened to be evaluated and makes the
 * behaviour untestable without module isolation.
 *
 * The env vars and defaults are `app/api/auth/route.ts`'s, character for
 * character — that route issues the session, so it is the authority on which
 * password means which role.
 */
function sessionCredentials(): SessionCredentials {
  return {
    ownerPassword: process.env.MC_PASSWORD ?? 'kaos2026',
    viewerPassword: process.env.MC_VIEWER_PASSWORD ?? 'view2026',
    memberPassword: process.env.MC_MEMBER_PASSWORD || null,
  }
}

/** What the request proved, what it asked for, and what it got. */
export interface ResolvedCallerRole {
  /** The role the request may act with. Null when it proved nothing. */
  role: Role | null
  /** The role the presented CREDENTIAL proves, before any narrowing. */
  granted: Role | null
  /**
   * An `mc-role` value that asked for more than the credential proves, and was
   * therefore ignored. Null when the cookie was absent, unreadable, or a
   * legitimate narrowing. Surfaced so a route can report an attempted
   * escalation instead of silently downgrading it.
   */
  ignoredClaim: string | null
}

/**
 * Resolve the caller's role, with the full detail of what was refused.
 *
 * Prefer this over `resolveRole` when the route wants to tell the caller that
 * its cookie asked for more than its password proves — see
 * `components/tabs/InboxTab.tsx` for the shape of that message.
 */
export function resolveRoleDetail(req: NextRequest): ResolvedCallerRole {
  return resolveDecisionRole(
    {
      sessionPassword: req.cookies.get('mc-auth')?.value ?? null,
      claimedRole: req.cookies.get('mc-role')?.value ?? null,
      agentRoleHeader: req.headers.get('x-agent-role'),
    },
    sessionCredentials(),
  )
}

/**
 * Resolves the caller's Role from the request.
 *
 * Priority:
 * 1. Valid session (`mc-auth`) → the role that password grants, narrowed (never
 *    widened) by `mc-role`
 * 2. No valid session → `X-Agent-Role` (see caveat 2 in this file's header)
 * 3. Neither → null (unauthenticated)
 */
export function resolveRole(req: NextRequest): Role | null {
  return resolveRoleDetail(req).role
}

/** 403 response body shape */
export interface ForbiddenBody {
  error: 'forbidden'
  code: 'PERMISSION_DENIED'
  role: string
  required: Permission
  /** Human-readable reason — "invalid role" or "missing permission" */
  message: string
}

/** Build a machine-readable 403 response */
function forbidden(role: string, required: Permission, message: string): NextResponse<ForbiddenBody> {
  return NextResponse.json<ForbiddenBody>(
    { error: 'forbidden', code: 'PERMISSION_DENIED', role, required, message },
    { status: 403 }
  )
}

type RouteContext = { params?: Record<string, string> }
type RouteHandler = (
  req: NextRequest,
  ctx?: RouteContext
) => Promise<NextResponse | Response>

/**
 * Wraps a Next.js App Router route handler with permission enforcement.
 *
 * Usage:
 *   export const POST = withPermission('issues:write', async (req) => { ... })
 *
 * Resolution order:
 *   1. Resolve role (credential → narrowed by mc-role → X-Agent-Role → null)
 *   2. Unrecognized or missing role → 403
 *   3. Role lacks required permission → 403
 *   4. Permission granted → call the wrapped handler
 */
export function withPermission(
  permission: Permission,
  handler: RouteHandler
): RouteHandler {
  return async (req: NextRequest, ctx?: RouteContext) => {
    const { role, ignoredClaim } = resolveRoleDetail(req)

    if (!role) {
      return forbidden('unauthenticated', permission, 'invalid role: no valid session or recognized agent role')
    }

    const perms = ROLE_PERMISSIONS[role]
    if (!perms || !perms.includes(permission)) {
      // When the refusal is the direct result of ignoring a forged cookie, say
      // so. A caller who edits `mc-role` and then gets a bare "not granted to
      // role viewer" has no way to tell the check from a bug.
      const claimNote = ignoredClaim
        ? ` The mc-role cookie asked to act as "${ignoredClaim}", which this credential does not grant; that cookie can only narrow the role its password proves, never widen it, so it was ignored.`
        : ''
      return forbidden(
        role,
        permission,
        `missing permission: ${permission} is not granted to role "${role}".${claimNote}`
      )
    }

    return handler(req, ctx)
  }
}

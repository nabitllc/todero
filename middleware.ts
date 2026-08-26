// TOD-906: Role-based access control middleware
// Roles: owner (full access + roles:admin), member (write access), viewer (read-only)
// Legacy roles admin/god are treated as owner; tron/defaultbot as member.

import { NextRequest, NextResponse } from 'next/server'
import { hasPermission } from '@/lib/rbac-types'
import type { Role } from '@/lib/rbac-types'
import { isInternalCall } from '@/lib/internal-auth'

const ADMIN_PASSWORD = process.env.MC_PASSWORD ?? 'kaos2026'
const VIEWER_PASSWORD = process.env.MC_VIEWER_PASSWORD ?? 'view2026'

// ─── scope-reaches-the-server ────────────────────────────────────────────────
//
// A fresh critic un-archived one issue and watched it reappear on nine
// surfaces: "Scope stops at the React tree; it never reaches the server."
// app/page.tsx renders the selected project as a `/p/<slug>` PATH segment
// (see its parseURL/buildPath), but that is only ever visible to the SERVER
// on the one request that actually navigated there. Every read the SPA makes
// afterwards is a same-origin fetch to a FIXED endpoint path
// (`/api/db/issues`, `/api/issues`, …) that never itself contains `/p/<slug>`
// — so a caller cannot be scoped by looking at ITS OWN path alone.
//
// The signal that DOES carry the live scope on every one of those fetches is
// the `Referer` header: browsers compute it from the requesting Document's
// CURRENT url, which `history.pushState`/`replaceState` update in place (see
// app/page.tsx's mount-time effect that keeps the address bar's `/p/<slug>`
// in sync with `selectedProject`) — with no new request to the server. So a
// same-origin fetch issued the instant after a client-side project switch
// still carries a Referer reflecting the NEW url, even though the switch
// itself was invisible to this middleware.
//
// This is the ONE place scope is resolved, for every downstream route: the
// header below is intentionally deleted from whatever the client sent before
// being recomputed, so a request cannot assert its own scope by forging it.
const SCOPE_HEADER = 'x-mc-project'
/**
 * Set to '1' when the destination is deliberately cross-project.
 *
 * The scope header alone cannot carry this. Its absence is ambiguous: it means
 * either "this screen legitimately spans every project" or "no scope could be
 * resolved at all" — and those two must not behave the same way. Treating them
 * alike is precisely how an unscoped read used to fall open. The proxy refuses
 * the ambiguous case and honours only this explicit one.
 */
const CROSS_PROJECT_HEADER = 'x-mc-all-projects'

const PROJECT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/** `slug-with-dashes` -> `Slug With Dashes`. Matches app/page.tsx's
 *  `slugToProjectName` exactly — project names are a plain title-case codec,
 *  never a registry (see that function's own comment: the real names always
 *  come from `/api/projects`). Duplicated here in the two-line form rather
 *  than imported, since app/page.tsx is a 'use client' file outside this
 *  piece's ownership (see the piece's DO NOT TOUCH list) and importing FROM
 *  it would create exactly the coupling this piece is not allowed to create. */
function slugToProjectName(slug: string): string {
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/** Pull `/p/<slug>` out of a pathname, tolerating an optional `/b/<biz>/`
 *  prefix ahead of it (see app/page.tsx's parseURL for the same shape).
 *  Returns the resolved project name plus whatever path segments follow the
 *  project segment, so the caller can tell a project-scoped destination
 *  (`work/epics`) from a deliberately cross-project one (`settings/projects`). */
function projectFromPathname(pathname: string): { project: string; rest: string[] } | null {
  const parts = pathname.split('/').filter(Boolean)
  let rest = parts
  if (rest[0] === 'b' && rest[1]) rest = rest.slice(2)
  if (rest[0] !== 'p' || !rest[1] || !PROJECT_SLUG.test(rest[1])) return null
  return { project: slugToProjectName(rest[1]), rest: rest.slice(2) }
}

/**
 * Destinations that are cross-project by design (build instruction 4: "name
 * each one you exempt and why"). `selectedProject` in app/page.tsx is global
 * UI state — its `/p/<slug>` segment stays in the URL even while the operator
 * is looking at a page that was never meant to be filtered to one project, so
 * "the URL has a `/p/<slug>` in it" is NOT by itself proof that a request
 * should be scoped. Each exemption below is one sentence:
 *   - settings/projects (ProjectsTab): the inventory of every project across
 *     every business — the one view that cannot, by its own purpose, be
 *     filtered down to "the" project.
 *   - fleet/* (Roster, Office) and runs/* (agent run history + cost): agent-
 *     level aggregates that span every project an agent has ever touched;
 *     scoping them would hide the cross-project picture they exist to show.
 */
function isCrossProjectDestination(rest: string[]): boolean {
  if (rest[0] === 'fleet' || rest[0] === 'runs') return true
  if (rest[0] === 'settings' && rest[1] === 'projects') return true
  return false
}

/**
 * Resolve the project this request is scoped to, or null when there is
 * genuinely none to resolve. Never trusts anything the client asserted
 * directly (see SCOPE_HEADER above) — only the request's own path and its
 * Referer, both of which are the browser's doing, not a value a caller typed
 * into a header.
 */
function resolveProjectScope(req: NextRequest): string | null {
  // A real page navigation: the request's OWN path carries `/p/<slug>`.
  const own = projectFromPathname(req.nextUrl.pathname)
  if (own) return isCrossProjectDestination(own.rest) ? null : own.project

  // Every same-origin fetch the SPA makes to its own API: the endpoint path
  // itself is fixed and never carries `/p/<slug>` — the live scope instead
  // lives in Referer (see the block comment above).
  const referer = req.headers.get('referer')
  if (!referer) return null
  let refUrl: URL
  try {
    refUrl = new URL(referer)
  } catch {
    return null
  }
  if (refUrl.origin !== req.nextUrl.origin) return null
  const fromRef = projectFromPathname(refUrl.pathname)
  if (!fromRef) return null
  return isCrossProjectDestination(fromRef.rest) ? null : fromRef.project
}

/**
 * Headers to forward downstream, with the resolved scope stamped on — and any
 * client-supplied value for the same header removed first, so nothing
 * downstream can be fed a forged scope directly.
 */
function withResolvedScope(req: NextRequest): Headers {
  const headers = new Headers(req.headers)
  // Both stripped first: a caller must never be able to assert either of these
  // for itself, or the boundary is decided by the thing it constrains.
  headers.delete(SCOPE_HEADER)
  headers.delete(CROSS_PROJECT_HEADER)
  const project = resolveProjectScope(req)
  if (project) {
    headers.set(SCOPE_HEADER, project)
  } else if (isCrossProjectRequest(req)) {
    headers.set(CROSS_PROJECT_HEADER, '1')
  }
  return headers
}

/** True when the originating screen is one of the deliberately global destinations. */
function isCrossProjectRequest(req: NextRequest): boolean {
  const own = projectFromPathname(req.nextUrl.pathname)
  if (own) return isCrossProjectDestination(own.rest)
  const referer = req.headers.get('referer')
  if (!referer) return false
  try {
    const refUrl = new URL(referer)
    if (refUrl.origin !== req.nextUrl.origin) return false
    const fromRef = projectFromPathname(refUrl.pathname)
    return fromRef ? isCrossProjectDestination(fromRef.rest) : false
  } catch {
    return false
  }
}

// Methods that modify data — viewers are blocked from these on API routes
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/** Read and validate the mc-role cookie. Returns null if missing/unrecognised. */
function getRoleFromCookie(req: NextRequest): Role | null {
  const raw = req.cookies.get('mc-role')?.value
  if (!raw) return null
  const known: Role[] = ['owner', 'member', 'viewer', 'god', 'admin', 'tron', 'defaultbot']
  return known.includes(raw as Role) ? (raw as Role) : null
}

/** True when the request carries a password cookie matching a configured role password. */
function hasValidSession(req: NextRequest): boolean {
  const auth = req.cookies.get('mc-auth')?.value
  if (!auth) return false
  const memberPassword = process.env.MC_MEMBER_PASSWORD
  return auth === ADMIN_PASSWORD || auth === VIEWER_PASSWORD ||
    (!!memberPassword && auth === memberPassword)
}

/** Returns true if the role can perform write operations on issues/board. */
function canWrite(role: Role): boolean {
  return hasPermission(role, 'issues:write')
}

/** Returns true if the role can manage workspace roles. */
function canManageRoles(role: Role): boolean {
  return hasPermission(role, 'roles:admin')
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  // Computed once, reused at every point below that continues the request
  // (never at a point that answers with an error response itself).
  const scopedHeaders = withResolvedScope(req)

  // /api/health is public — monitoring probes don't carry cookies
  if (pathname === '/api/health') {
    return NextResponse.next()
  }

  // Unauthenticated endpoints: the login handshake itself.
  if (pathname === '/api/auth' || pathname === '/api/auth-form') {
    return NextResponse.next()
  }

  // TOD-2469: the conversations inbound webhook proves itself with its OWN
  // dedicated secret (lib/conversations.ts's verifyWebhookSecret, header
  // X-Todero-Conversations-Secret) — not a session, not the general internal
  // secret. Without this, an external provider would ALSO have to know
  // Todero's general internal secret to reach the endpoint, which defeats the
  // point of giving the webhook a credential of its own.
  //
  // WHY THIS IS NOT A HOLE, and it was verified before it was applied rather
  // than argued: letting a request past THIS gate when the header is merely
  // PRESENT does not skip authentication. The route still runs the real
  // constant-time comparison and answers 401 when the value is wrong. And
  // verifyWebhookSecret FAILS CLOSED on an unconfigured or too-short secret —
  // a presented header against an unset env var is `valid: false`, never a
  // bypass. Measured against the running server, all three ways.
  //
  // Exactly one path and one method. Widening either is a security change and
  // should be argued on its own.
  if (
    pathname === '/api/conversations' &&
    req.method === 'POST' &&
    req.headers.get('x-todero-conversations-secret')
  ) {
    return NextResponse.next({ request: { headers: scopedHeaders } })
  }

  // For API routes: every request must prove who it is BEFORE any role logic.
  //
  // This used to gate only WRITE_METHODS and treated a missing cookie as a
  // server-side call to pass through. The result was that anonymous callers got
  // 200 on GET /api/issues and on DELETE /api/issues. Absence of a session is no
  // longer evidence of anything: internal calls present a shared secret
  // (lib/internal-auth.ts), everyone else presents a session.
  if (pathname.startsWith('/api/')) {
    if (!isInternalCall(req.headers) && !hasValidSession(req)) {
      return NextResponse.json(
        { error: 'Unauthenticated: sign in to use the Todero API.', code: 'UNAUTHENTICATED' },
        { status: 401 }
      )
    }

    if (WRITE_METHODS.has(req.method)) {
      const role = getRoleFromCookie(req)

      // Roles management endpoints require roles:admin (owner only)
      if (pathname.startsWith('/api/roles')) {
        if (!role || !canManageRoles(role)) {
          return NextResponse.json(
            { error: 'Forbidden: owner role required to manage workspace roles' },
            { status: 403 }
          )
        }
        return NextResponse.next({ request: { headers: scopedHeaders } })
      }

      // All other write endpoints: viewer is blocked; owner/member/admin/god pass through
      if (role === 'viewer') {
        return NextResponse.json(
          { error: 'Read-only access: viewer role cannot modify data' },
          { status: 403 }
        )
      }
      // No cookie = server-side call (e.g. agent → API) — pass through
    }
    return NextResponse.next({ request: { headers: scopedHeaders } })
  }

  // Skip auth for login page itself
  if (pathname === '/login') {
    return NextResponse.next()
  }

  // Check auth cookie
  const auth = req.cookies.get('mc-auth')?.value
  if (auth !== ADMIN_PASSWORD && auth !== VIEWER_PASSWORD) {
    // Check for member password too
    const memberPassword = process.env.MC_MEMBER_PASSWORD
    if (!memberPassword || auth !== memberPassword) {
      const loginUrl = new URL('/login', req.url)
      loginUrl.searchParams.set('from', pathname)
      return NextResponse.redirect(loginUrl)
    }
  }

  // Real App Router pages that must NOT be swallowed by the SPA rewrite below.
  // /crew/<id> is server-rendered and decides agent-vs-human from the host's
  // AGENTS.md; rewriting it to / meant the deep link silently served the
  // dashboard instead, so the page could never be reached — or checked.
  const SERVER_ROUTED_PREFIXES = ['/crew/']
  if (SERVER_ROUTED_PREFIXES.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  // SPA routing: rewrite all client paths to / so page.tsx handles routing via pushState
  if (pathname !== '/' && !pathname.includes('.')) {
    return NextResponse.rewrite(new URL('/', req.url), { request: { headers: scopedHeaders } })
  }

  return NextResponse.next({ request: { headers: scopedHeaders } })
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}

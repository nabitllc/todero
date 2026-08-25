// TOD-906: Role-based access control middleware
// Roles: owner (full access + roles:admin), member (write access), viewer (read-only)
// Legacy roles admin/god are treated as owner; tron/defaultbot as member.

import { NextRequest, NextResponse } from 'next/server'
import { hasPermission } from '@/lib/rbac-types'
import type { Role } from '@/lib/rbac-types'
import { isInternalCall } from '@/lib/internal-auth'

const ADMIN_PASSWORD = process.env.MC_PASSWORD ?? 'kaos2026'
const VIEWER_PASSWORD = process.env.MC_VIEWER_PASSWORD ?? 'view2026'

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

  // /api/health is public — monitoring probes don't carry cookies
  if (pathname === '/api/health') {
    return NextResponse.next()
  }

  // Unauthenticated endpoints: the login handshake itself.
  if (pathname === '/api/auth' || pathname === '/api/auth-form') {
    return NextResponse.next()
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
        return NextResponse.next()
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
    return NextResponse.next()
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
    return NextResponse.rewrite(new URL('/', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
}

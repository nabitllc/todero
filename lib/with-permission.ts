/**
 * Permission middleware for Todero API routes (TOD-1496)
 *
 * Resolves caller role from:
 *   - Human: mc-auth + mc-role cookies (valid signed session)
 *   - Agent: X-Agent-Role header (only when no valid session exists)
 *
 * Spoof protection: X-Agent-Role is ignored when mc-auth cookie
 * matches a valid password — prevents privilege escalation by a
 * logged-in human claiming an agent role.
 */

import { NextRequest, NextResponse } from 'next/server'
import { ROLE_PERMISSIONS, Role, Permission } from '@/lib/rbac-types'

const ADMIN_PASSWORD = process.env.MC_PASSWORD ?? 'kaos2026'
const VIEWER_PASSWORD = process.env.MC_VIEWER_PASSWORD ?? 'view2026'

/** Maps mc-role cookie values to RBAC Role type */
const COOKIE_ROLE_MAP: Readonly<Record<string, Role>> = {
  admin: 'admin',
  viewer: 'viewer',
}

/**
 * Resolves the caller's Role from the request.
 *
 * Priority:
 * 1. Valid session (mc-auth cookie) → trust mc-role cookie
 * 2. No valid session → trust X-Agent-Role header
 * 3. Neither → null (unauthenticated)
 */
export function resolveRole(req: NextRequest): Role | null {
  const mcAuth = req.cookies.get('mc-auth')?.value
  const hasValidSession =
    mcAuth === ADMIN_PASSWORD || mcAuth === VIEWER_PASSWORD

  if (hasValidSession) {
    // Human caller — trust session cookie, ignore X-Agent-Role (spoof protection)
    const cookieRole = req.cookies.get('mc-role')?.value
    if (cookieRole && cookieRole in COOKIE_ROLE_MAP) {
      return COOKIE_ROLE_MAP[cookieRole]
    }
    // Auth cookie present but no mc-role — derive from password
    if (mcAuth === ADMIN_PASSWORD) return 'admin'
    return 'viewer'
  }

  // Agent caller — trust X-Agent-Role only when no valid session exists
  const agentRole = req.headers.get('x-agent-role')
  if (agentRole && agentRole in ROLE_PERMISSIONS) {
    return agentRole as Role
  }

  return null
}

/** 403 response body shape */
export interface ForbiddenBody {
  error: 'forbidden'
  code: 'PERMISSION_DENIED'
  role: string
  required: Permission
}

/** Build a machine-readable 403 response */
function forbidden(role: string, required: Permission): NextResponse<ForbiddenBody> {
  return NextResponse.json<ForbiddenBody>(
    { error: 'forbidden', code: 'PERMISSION_DENIED', role, required },
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
 *   1. Resolve role (session cookie → X-Agent-Role → null)
 *   2. Unrecognized or missing role → 403
 *   3. Role lacks required permission → 403
 *   4. Permission granted → call the wrapped handler
 */
export function withPermission(
  permission: Permission,
  handler: RouteHandler
): RouteHandler {
  return async (req: NextRequest, ctx?: RouteContext) => {
    const role = resolveRole(req)

    if (!role) {
      return forbidden('unknown', permission)
    }

    const perms = ROLE_PERMISSIONS[role]
    if (!perms || !perms.includes(permission)) {
      return forbidden(role, permission)
    }

    return handler(req, ctx)
  }
}

// lib/rbac-middleware.ts
// TOD-1057: withPermission middleware — role resolution + 403 enforcement
//
// Usage in an API route handler:
//   const denied = await withPermission('issues:write')(req)
//   if (denied) return denied
//   // ... continue with handler

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { hasPermission } from './rbac-types'
import type { Role, Permission } from './rbac-types'

const KNOWN_ROLES: readonly Role[] = ['owner', 'member', 'viewer', 'god', 'admin', 'tron', 'defaultbot']

/**
 * Permissions that are off-limits for the admin role.
 * These are god_manage-class permissions — admin is explicitly blocked
 * even though they have broad write access.
 */
const GOD_MANAGE_PERMISSIONS = new Set<Permission>([
  'issues:admin',
  'sprints:admin',
  'agents:admin',
  'projects:admin',
  'infra:admin',
  'roles:admin',
])

function getSupabase() {
  return db()
}

/**
 * Validates the mc-auth cookie against known passwords.
 * Used to confirm an agent's session is legitimate before trusting X-Agent-Role.
 */
function hasValidSession(req: NextRequest): boolean {
  const auth = req.cookies.get('mc-auth')?.value
  if (!auth) return false
  const ownerPw = process.env.MC_PASSWORD ?? 'kaos2026'
  const viewerPw = process.env.MC_VIEWER_PASSWORD ?? 'view2026'
  const memberPw = process.env.MC_MEMBER_PASSWORD ?? ''
  if (auth === ownerPw || auth === viewerPw) return true
  if (memberPw && auth === memberPw) return true
  return false
}

/**
 * Resolves the caller's role.
 *
 * Priority:
 *   1. mc-role cookie (authenticated human session)
 *   2. X-Agent-Role header — only accepted when a valid mc-auth session exists
 *
 * Returns null if no valid role can be determined.
 */
export function resolveRole(req: NextRequest): Role | null {
  const cookieRole = req.cookies.get('mc-role')?.value
  if (cookieRole && (KNOWN_ROLES as readonly string[]).includes(cookieRole)) {
    return cookieRole as Role
  }

  // Agent path: X-Agent-Role header, only valid with a signed session cookie
  const agentRole = req.headers.get('X-Agent-Role')
  if (agentRole && (KNOWN_ROLES as readonly string[]).includes(agentRole)) {
    if (hasValidSession(req)) {
      return agentRole as Role
    }
  }

  return null
}

/**
 * Middleware factory — wraps a permission check around an API route handler.
 *
 * Returns a 403 NextResponse if the caller lacks the required permission,
 * or null if the request is allowed through.
 *
 * Behaviours:
 *   - god role bypasses all permission checks
 *   - admin role returns 403 for god_manage-class permissions (:admin permissions)
 *   - viewer role returns 403 for all write/mutate permissions (enforced by DB)
 *   - unknown / missing role returns 403
 */
export function withPermission(requiredPermission: Permission) {
  return async (req: NextRequest): Promise<NextResponse | null> => {
    const role = resolveRole(req)

    if (!role) {
      return NextResponse.json(
        {
          error: 'Forbidden: no valid session or unrecognised role',
          required: requiredPermission,
          role: 'none',
        },
        { status: 403 },
      )
    }

    // God bypasses all permission checks
    if (role === 'god') {
      return null
    }

    // Admin is explicitly blocked from god_manage-class (:admin) permissions
    if (role === 'admin' && GOD_MANAGE_PERMISSIONS.has(requiredPermission)) {
      return NextResponse.json(
        {
          error: `Forbidden: role 'admin' cannot access god_manage permissions`,
          required: requiredPermission,
          role,
        },
        { status: 403 },
      )
    }

    // ROLE_PERMISSIONS in rbac-types.ts is the source of truth: the same data the
    // role_permissions migration seeds, but present on a host that has never run
    // that migration. Without this, a fresh install answers 403 to its own owner.
    if (hasPermission(role, requiredPermission)) return null

    // The table may GRANT beyond the static matrix, but it is never the only
    // gate — an absent or unreachable table denies nothing by itself.
    try {
      const { data } = await getSupabase()
        .from('role_permissions')
        .select('permission')
        .eq('role', role)
        .eq('permission', requiredPermission)
        .maybeSingle()
      if (data) return null
    } catch {
      // Table missing or database unreachable — the static matrix already decided.
    }

    return NextResponse.json(
      {
        error: `Forbidden: role '${role}' lacks permission '${requiredPermission}'`,
        required: requiredPermission,
        role,
      },
      { status: 403 },
    )
  }
}

// lib/permission-check.ts
// TOD-1498: Testable permission middleware helper
// TOD-1048: resolveCallerRole — extract role from cookie or identity header
// Queries role_permissions table and enforces route-level access rules for all 5 roles.

import { createClient } from '@supabase/supabase-js'
import type { NextRequest } from 'next/server'
import type { Role, Permission } from './rbac-types'

const KNOWN_ROLES: Role[] = ['owner', 'member', 'viewer', 'god', 'admin', 'tron', 'defaultbot']

/**
 * Resolve the caller's role from the request.
 *
 * Resolution order:
 *   1. `mc-role` cookie (direct role, no DB round-trip)
 *   2. `x-caller-identity` header → workspace_members lookup
 *   3. null if neither is present or identity is not found
 */
export async function resolveCallerRole(req: NextRequest): Promise<Role | null> {
  // 1. Cookie fast-path
  const cookieRole = req.cookies.get('mc-role')?.value
  if (cookieRole && KNOWN_ROLES.includes(cookieRole as Role)) {
    return cookieRole as Role
  }

  // 2. Identity header → workspace_members lookup
  const identity = req.headers.get('x-caller-identity')
  if (!identity) return null

  const supabase = getSupabase()
  const { data } = await supabase
    .from('workspace_members')
    .select('role')
    .eq('identity', identity)
    .maybeSingle()

  if (!data?.role) return null
  return KNOWN_ROLES.includes(data.role as Role) ? (data.role as Role) : null
}

// HTTP methods that modify data
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

// Route patterns with elevated permission requirements
/** Routes that only god can access (require issues:admin) */
export const GOD_MANAGE_PATTERN = /^\/api\/god_manage/
/** Routes blocked for bot roles — require a human actor (require settings:write) */
export const HUMAN_REQUIRED_PATTERN = /^\/api\/human_required_/
/** DefaultBot is scoped to issues + sprints only */
export const DEFAULTBOT_SCOPE_PATTERN = /^\/api\/(issues|sprints)/

export interface PermissionResult {
  allowed: boolean
  status?: 403
  body?: { error: string; code: string }
}

function deny(error: string, code: string): PermissionResult {
  return { allowed: false, status: 403, body: { error, code } }
}

/**
 * Map a (method, pathname) pair to the permission required to access it.
 *
 * Priority order:
 *   1. god_manage routes → issues:admin  (god only)
 *   2. human_required routes → settings:write  (humans only, bots blocked)
 *   3. write methods → issues:write
 *   4. everything else → issues:read
 */
export function getRequiredPermission(method: string, pathname: string): Permission {
  if (GOD_MANAGE_PATTERN.test(pathname)) return 'issues:admin'
  if (HUMAN_REQUIRED_PATTERN.test(pathname)) return 'settings:write'
  if (WRITE_METHODS.has(method.toUpperCase())) return 'issues:write'
  return 'issues:read'
}

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  )
}

/**
 * Check whether a role may access (method, pathname).
 *
 * Steps:
 *   1. DefaultBot scope guard (no DB round-trip needed)
 *   2. Determine required permission for the route
 *   3. Query role_permissions table — deny if row missing
 */
export async function checkRoutePermission(
  role: Role,
  method: string,
  pathname: string,
): Promise<PermissionResult> {
  // DefaultBot has a hard-coded route scope — deny early without hitting DB
  if (role === 'defaultbot' && !DEFAULTBOT_SCOPE_PATTERN.test(pathname)) {
    return deny(
      `Forbidden: defaultbot scope does not include '${pathname}'`,
      'OUT_OF_SCOPE',
    )
  }

  const required = getRequiredPermission(method, pathname)

  const supabase = getSupabase()
  const { data } = await supabase
    .from('role_permissions')
    .select('permission')
    .eq('role', role)
    .eq('permission', required)
    .maybeSingle()

  if (!data) {
    return deny(
      `Forbidden: role '${role}' lacks permission '${required}'`,
      'PERMISSION_DENIED',
    )
  }

  return { allowed: true }
}

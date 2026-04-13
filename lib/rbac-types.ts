// RBAC types — mirrors DB enums for roles and permissions
// TOD-1056: Shared type definitions used by middleware and API routes
// TOD-906: Added owner/member workspace roles as the foundational access-control layer

/**
 * Workspace roles (TOD-906):
 *   owner  — full access including role management
 *   member — full board and issue access; cannot manage roles or workspace settings
 *   viewer — read-only access to board and issues
 *
 * Internal/legacy roles (pre-TOD-906):
 *   god, admin, tron, defaultbot — retained for backward compatibility
 */
export type Role = 'owner' | 'member' | 'viewer' | 'god' | 'admin' | 'tron' | 'defaultbot'

/** Permission type union — covers all granular permission values */
export type Permission =
  | 'issues:read'
  | 'issues:write'
  | 'issues:delete'
  | 'issues:admin'
  | 'sprints:read'
  | 'sprints:write'
  | 'sprints:admin'
  | 'agents:read'
  | 'agents:write'
  | 'agents:spawn'
  | 'agents:admin'
  | 'projects:read'
  | 'projects:write'
  | 'projects:admin'
  | 'settings:read'
  | 'settings:write'
  | 'calendar:read'
  | 'calendar:write'
  | 'memory:read'
  | 'memory:write'
  | 'infra:read'
  | 'infra:admin'
  | 'roles:read'
  | 'roles:admin'

/** Row shape for the role_permissions join table */
export interface RolePermission {
  role: Role
  permission: Permission
}

/**
 * Default permission sets per role.
 *
 * TOD-906 workspace roles:
 *   owner  — all permissions, including roles:admin (assign/change roles)
 *   member — full issue/sprint/calendar/memory access; no admin or role ops
 *   viewer — read-only across all resources
 */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  // ── Workspace roles (TOD-906) ─────────────────────────────────────────────
  owner: [
    'issues:read', 'issues:write', 'issues:delete', 'issues:admin',
    'sprints:read', 'sprints:write', 'sprints:admin',
    'agents:read', 'agents:write', 'agents:spawn', 'agents:admin',
    'projects:read', 'projects:write', 'projects:admin',
    'settings:read', 'settings:write',
    'calendar:read', 'calendar:write',
    'memory:read', 'memory:write',
    'infra:read', 'infra:admin',
    'roles:read', 'roles:admin',
  ],
  member: [
    'issues:read', 'issues:write',
    'sprints:read', 'sprints:write',
    'agents:read',
    'projects:read',
    'settings:read',
    'calendar:read', 'calendar:write',
    'memory:read', 'memory:write',
    'infra:read',
    'roles:read',
  ],
  viewer: [
    'issues:read',
    'sprints:read',
    'agents:read',
    'projects:read',
    'settings:read',
    'calendar:read',
    'memory:read',
    'infra:read',
    'roles:read',
  ],
  // ── Legacy/internal roles (pre-TOD-906) ───────────────────────────────────
  god: [
    'issues:read', 'issues:write', 'issues:delete', 'issues:admin',
    'sprints:read', 'sprints:write', 'sprints:admin',
    'agents:read', 'agents:write', 'agents:spawn', 'agents:admin',
    'projects:read', 'projects:write', 'projects:admin',
    'settings:read', 'settings:write',
    'calendar:read', 'calendar:write',
    'memory:read', 'memory:write',
    'infra:read', 'infra:admin',
    'roles:read', 'roles:admin',
  ],
  admin: [
    'issues:read', 'issues:write', 'issues:delete',
    'sprints:read', 'sprints:write',
    'agents:read', 'agents:write', 'agents:spawn',
    'projects:read', 'projects:write',
    'settings:read', 'settings:write',
    'calendar:read', 'calendar:write',
    'memory:read', 'memory:write',
    'infra:read',
    'roles:read',
  ],
  tron: [
    'issues:read', 'issues:write',
    'sprints:read',
    'agents:read', 'agents:spawn',
    'projects:read',
    'calendar:read',
    'memory:read', 'memory:write',
    'roles:read',
  ],
  defaultbot: [
    'issues:read', 'issues:write',
    'sprints:read',
    'agents:read',
    'projects:read',
    'memory:read',
    'roles:read',
  ],
} as const

/** Check if a role has a specific permission */
export function hasPermission(role: Role, permission: Permission): boolean {
  return (ROLE_PERMISSIONS[role] as readonly string[]).includes(permission)
}

/**
 * Workspace member record — stored in workspace_members table.
 * identity may be a username, email, or agent ID.
 */
export interface WorkspaceMember {
  id: string
  identity: string
  role: 'owner' | 'member' | 'viewer'
  assigned_by: string | null
  created_at: string
  updated_at: string
}

// RBAC types — mirrors DB enums for roles and permissions
// TOD-1056: Shared type definitions used by middleware and API routes

/** Role type union — matches the DB role enum exactly */
export type Role = 'owner' | 'member' | 'god' | 'admin' | 'viewer' | 'tron' | 'defaultbot'

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

/** Alias for AC compliance — join table rows type */
export type RolePermissions = RolePermission

/** Workspace member row shape */
export interface WorkspaceMember {
  id: string
  identity: string
  role: Role
  assigned_by?: string | null
  created_at?: string
  updated_at?: string
}

/** Default permission sets per role — used for seed data and runtime checks */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
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
    'agents:read', 'agents:write', 'agents:spawn',
    'projects:read', 'projects:write',
    'settings:read',
    'calendar:read', 'calendar:write',
    'memory:read', 'memory:write',
    'infra:read',
    'roles:read',
  ],
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
  ],
  tron: [
    'issues:read', 'issues:write',
    'sprints:read',
    'agents:read', 'agents:spawn',
    'projects:read',
    'calendar:read',
    'memory:read', 'memory:write',
  ],
  defaultbot: [
    'issues:read', 'issues:write',
    'sprints:read',
    'agents:read',
    'projects:read',
    'memory:read',
  ],
} as const

/** Check if a role has a specific permission */
export function hasPermission(role: Role, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission)
}

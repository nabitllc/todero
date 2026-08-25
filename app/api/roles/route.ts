// TOD-906: Workspace roles management API
// GET  /api/roles           — list all workspace members (requires roles:read)
// POST /api/roles           — add a member (requires roles:admin / owner only)
// PATCH /api/roles          — change a member's role (requires roles:admin / owner only)
// DELETE /api/roles?id=...  — remove a member (requires roles:admin / owner only)

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/hub-client'
import { hasPermission } from '@/lib/rbac-types'
import type { Role } from '@/lib/rbac-types'
import { dbUnavailableResponse } from '@/lib/db-http'

function getSupabase() {
  return createAdminClient()
}

const VALID_WORKSPACE_ROLES = ['owner', 'member', 'viewer'] as const
type WorkspaceRole = typeof VALID_WORKSPACE_ROLES[number]

/** Read role from request cookie. Returns null if missing or unrecognised. */
function getRoleFromCookie(req: NextRequest): Role | null {
  const raw = req.cookies.get('mc-role')?.value
  if (!raw) return null
  const known: Role[] = ['owner', 'member', 'viewer', 'god', 'admin', 'tron', 'defaultbot']
  return known.includes(raw as Role) ? (raw as Role) : null
}

// ── GET — list members ────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  // Name the missing credential in the body rather than letting a
  // DbConfigurationError escape as a bare 500 with nothing in it.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const role = getRoleFromCookie(req)
  if (!role || !hasPermission(role, 'roles:read')) {
    return NextResponse.json({ error: 'Forbidden: roles:read permission required' }, { status: 403 })
  }

  const { data, error } = await getSupabase()
    .from('workspace_members')
    .select('id, identity, role, assigned_by, created_at, updated_at')
    .order('created_at', { ascending: true })

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

// ── POST — add member ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Name the missing credential in the body rather than letting a
  // DbConfigurationError escape as a bare 500 with nothing in it.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const role = getRoleFromCookie(req)
  if (!role || !hasPermission(role, 'roles:admin')) {
    return NextResponse.json({ error: 'Forbidden: owner role required to manage workspace members' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const { identity, role: newRole, assigned_by } = body

  if (!identity || typeof identity !== 'string' || identity.trim() === '') {
    return NextResponse.json({ error: 'identity is required' }, { status: 400 })
  }
  if (!newRole || !(VALID_WORKSPACE_ROLES as readonly string[]).includes(newRole)) {
    return NextResponse.json({ error: `role must be one of: ${VALID_WORKSPACE_ROLES.join(', ')}` }, { status: 400 })
  }

  const { data, error } = await getSupabase()
    .from('workspace_members')
    .insert({
      identity: identity.trim(),
      role: newRole as WorkspaceRole,
      assigned_by: assigned_by ?? null,
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: `Member '${identity}' already exists. Use PATCH to change their role.` }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

// ── PATCH — change role ───────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  // Name the missing credential in the body rather than letting a
  // DbConfigurationError escape as a bare 500 with nothing in it.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const role = getRoleFromCookie(req)
  if (!role || !hasPermission(role, 'roles:admin')) {
    return NextResponse.json({ error: 'Forbidden: owner role required to manage workspace members' }, { status: 403 })
  }

  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })

  const { id, identity, role: newRole, assigned_by } = body

  if (!id && !identity) {
    return NextResponse.json({ error: 'id or identity is required' }, { status: 400 })
  }
  if (!newRole || !(VALID_WORKSPACE_ROLES as readonly string[]).includes(newRole)) {
    return NextResponse.json({ error: `role must be one of: ${VALID_WORKSPACE_ROLES.join(', ')}` }, { status: 400 })
  }

  const filter = id ? { id } : { identity: (identity as string).trim() }

  const { data, error } = await getSupabase()
    .from('workspace_members')
    .update({
      role: newRole as WorkspaceRole,
      ...(assigned_by ? { assigned_by } : {}),
    })
    .match(filter)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  return NextResponse.json(data)
}

// ── DELETE — remove member ────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  // Name the missing credential in the body rather than letting a
  // DbConfigurationError escape as a bare 500 with nothing in it.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const role = getRoleFromCookie(req)
  if (!role || !hasPermission(role, 'roles:admin')) {
    return NextResponse.json({ error: 'Forbidden: owner role required to manage workspace members' }, { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  const identity = searchParams.get('identity')

  if (!id && !identity) {
    return NextResponse.json({ error: 'id or identity query param required' }, { status: 400 })
  }

  const filter = id ? { id } : { identity: identity! }

  const { data, error } = await getSupabase()
    .from('workspace_members')
    .delete()
    .match(filter)
    .select()
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  }

  return NextResponse.json({ ok: true, removed: data })
}

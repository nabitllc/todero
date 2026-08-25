/**
 * PATCH /api/workspace-settings — Update workspace settings (TOD-1603)
 *
 * Accepts partial updates to: name, slug, logo_url, billing_contact.
 * Validates slug uniqueness, requires admin role.
 */

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dbUnavailableResponse } from '@/lib/db-http'
import { withPermission } from '@/lib/with-permission'

// Workspace field shape as stored. Reached through the db seam, so this route
// works on whichever provider TODERO_DB_PROVIDER selects — the table is created
// by migration 043 and exists locally; the hosted database never received it,
// which is why this route could only ever 500 there.
interface Workspace {
  id: string
  name: string
  slug: string
  logo_url: string | null
  billing_contact: string | null
  created_at: string
  updated_at: string
}

// Valid slug: lowercase letters, digits, hyphens (no leading/trailing hyphens)
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export const PATCH = withPermission(
  'settings:write',
  async (req: NextRequest): Promise<NextResponse> => {
    const dbGate = dbUnavailableResponse()
    if (dbGate) return dbGate

    let body: Record<string, unknown>
    try {
      body = await req.json()
    } catch {
      return NextResponse.json(
        { error: 'invalid_body', message: 'Request body must be valid JSON' },
        { status: 422 }
      )
    }

    const { name, slug, logo_url, billing_contact } = body

    // Must supply at least one field
    const hasAny = name !== undefined || slug !== undefined || logo_url !== undefined || billing_contact !== undefined
    if (!hasAny) {
      return NextResponse.json(
        { error: 'missing_fields', message: 'Provide at least one of: name, slug, logo_url, billing_contact' },
        { status: 422 }
      )
    }

    // Type checks for supplied fields
    if (name !== undefined && (typeof name !== 'string' || name.trim() === '')) {
      return NextResponse.json(
        { error: 'invalid_field', message: 'name must be a non-empty string' },
        { status: 422 }
      )
    }
    if (slug !== undefined) {
      if (typeof slug !== 'string' || slug.trim() === '') {
        return NextResponse.json(
          { error: 'invalid_field', message: 'slug must be a non-empty string' },
          { status: 422 }
        )
      }
      if (!SLUG_RE.test(slug as string)) {
        return NextResponse.json(
          {
            error: 'invalid_field',
            message: 'slug must contain only lowercase letters, digits, and hyphens (no leading/trailing hyphens)',
          },
          { status: 422 }
        )
      }
    }
    if (logo_url !== undefined && logo_url !== null && typeof logo_url !== 'string') {
      return NextResponse.json(
        { error: 'invalid_field', message: 'logo_url must be a string or null' },
        { status: 422 }
      )
    }
    if (billing_contact !== undefined && billing_contact !== null && typeof billing_contact !== 'string') {
      return NextResponse.json(
        { error: 'invalid_field', message: 'billing_contact must be a string or null' },
        { status: 422 }
      )
    }

    const conn = db()

    // Fetch the current (single) workspace record
    const { data: rows, error: fetchErr } = await conn
      .from('workspaces')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(1)

    if (fetchErr) {
      return NextResponse.json(
        { error: 'db_error', message: fetchErr.message },
        { status: 500 }
      )
    }

    // If no workspace exists yet, seed one so we have an ID to update
    let workspace: Workspace
    if (!rows || rows.length === 0) {
      const { data: newRow, error: insertErr } = await conn
        .from('workspaces')
        .insert({ name: 'Todero', slug: 'todero' })
        .select()
        .single()

      if (insertErr || !newRow) {
        return NextResponse.json(
          { error: 'db_error', message: insertErr?.message ?? 'Failed to create workspace' },
          { status: 500 }
        )
      }
      workspace = newRow as Workspace
    } else {
      workspace = rows[0] as Workspace
    }

    // Slug uniqueness check — only needed when slug is changing
    if (slug !== undefined && (slug as string) !== workspace.slug) {
      const { data: conflict, error: slugErr } = await conn
        .from('workspaces')
        .select('id')
        .eq('slug', slug as string)
        .neq('id', workspace.id)
        .limit(1)

      if (slugErr) {
        return NextResponse.json(
          { error: 'db_error', message: slugErr.message },
          { status: 500 }
        )
      }

      if (conflict && conflict.length > 0) {
        return NextResponse.json(
          {
            error: 'slug_conflict',
            message: `The slug "${slug}" is already taken by another workspace`,
          },
          { status: 400 }
        )
      }
    }

    // Build the update patch — only include supplied fields
    const patch: Partial<Workspace> & { updated_at: string } = {
      updated_at: new Date().toISOString(),
    }
    if (name !== undefined) patch.name = (name as string).trim()
    if (slug !== undefined) patch.slug = slug as string
    if (logo_url !== undefined) patch.logo_url = logo_url as string | null
    if (billing_contact !== undefined) patch.billing_contact = billing_contact as string | null

    const { data: updated, error: updateErr } = await conn
      .from('workspaces')
      .update(patch)
      .eq('id', workspace.id)
      .select()
      .single()

    if (updateErr || !updated) {
      return NextResponse.json(
        { error: 'db_error', message: updateErr?.message ?? 'Update failed' },
        { status: 500 }
      )
    }

    return NextResponse.json(updated, { status: 200 })
  }
)

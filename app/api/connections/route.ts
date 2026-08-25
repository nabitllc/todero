import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { encrypt } from '@/lib/encryption'
import { dbUnavailableResponse, isMissingTableError, missingTableResponse } from '@/lib/db-http'

const TABLE = 'connections'

const VALID_TYPES = ['github', 'openai', 'anthropic', 'openrouter', 'webhook'] as const
type ConnectionType = typeof VALID_TYPES[number]

function supabaseAdmin() {
  return db()
}

// ── GET /api/connections ──────────────────────────────────────────────────────
// Returns all connections for a workspace. Never returns encrypted_value.
export async function GET(req: NextRequest) {
  const dbGate = dbUnavailableResponse()
  if (dbGate) return dbGate

  const { searchParams } = new URL(req.url)
  const workspace_id = searchParams.get('workspace_id')

  const sb = supabaseAdmin()
  let query = sb
    .from('connections')
    .select('id, workspace_id, type, metadata, status, created_at')

  if (workspace_id) {
    query = query.eq('workspace_id', workspace_id)
  }

  const { data, error } = await query.order('created_at', { ascending: false })
  if (error) {
    if (isMissingTableError(error)) return missingTableResponse(TABLE)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

// ── POST /api/connections ─────────────────────────────────────────────────────
// Creates a new connection. Encrypts value before storing.
export async function POST(req: NextRequest) {
  const dbGate = dbUnavailableResponse()
  if (dbGate) return dbGate

  let body: {
    workspace_id?: string
    type?: string
    value?: string
    metadata?: Record<string, unknown>
    status?: string
  }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const { workspace_id, type, value, metadata = {}, status = 'active' } = body

  if (!workspace_id) {
    return NextResponse.json({ error: 'workspace_id is required' }, { status: 400 })
  }
  if (!type || !(VALID_TYPES as readonly string[]).includes(type)) {
    return NextResponse.json(
      { error: `type must be one of: ${VALID_TYPES.join(', ')}` },
      { status: 400 }
    )
  }
  if (!value) {
    return NextResponse.json({ error: 'value is required' }, { status: 400 })
  }

  let encrypted_value: string
  try {
    encrypted_value = encrypt(value)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'encryption failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  const sb = supabaseAdmin()
  const { data, error } = await sb
    .from('connections')
    .insert({ workspace_id, type: type as ConnectionType, encrypted_value, metadata, status })
    .select('id, workspace_id, type, metadata, status, created_at')
    .single()

  if (error) {
    if (isMissingTableError(error)) return missingTableResponse(TABLE)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data, { status: 201 })
}

// ── DELETE /api/connections ───────────────────────────────────────────────────
// Removes a connection row entirely.
export async function DELETE(req: NextRequest) {
  const dbGate = dbUnavailableResponse()
  if (dbGate) return dbGate

  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  if (!id) {
    return NextResponse.json({ error: 'id query param is required' }, { status: 400 })
  }

  const sb = supabaseAdmin()
  const { error } = await sb.from('connections').delete().eq('id', id)

  if (error) {
    if (isMissingTableError(error)) return missingTableResponse(TABLE)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

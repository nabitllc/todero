import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

function getSupabase() {
  return createClient(SUPA_URL, SUPA_KEY)
}

const VALID_STATUSES = ['pending', 'approved', 'denied', 'timeout'] as const
type InboxStatus = (typeof VALID_STATUSES)[number] | 'all'

const INBOX_FIELDS = 'id,agent,type,context,status,created_at,expires_at,resolved_at,resolved_by,response_data'

// ── GET /api/inbox ────────────────────────────────────────────────────────────
// Query params:
//   ?status=pending|approved|denied|timeout|all  (default: all)
export async function GET(req: NextRequest) {
  const statusParam = (req.nextUrl.searchParams.get('status') ?? 'all') as InboxStatus

  if (statusParam !== 'all' && !VALID_STATUSES.includes(statusParam as (typeof VALID_STATUSES)[number])) {
    return NextResponse.json(
      { error: `Invalid status filter. Must be one of: all, ${VALID_STATUSES.join(', ')}` },
      { status: 400 }
    )
  }

  const supabase = getSupabase()
  let query = supabase
    .from('inbox')
    .select(INBOX_FIELDS)
    .order('created_at', { ascending: false })

  if (statusParam !== 'all') {
    query = query.eq('status', statusParam)
  }

  const { data, error } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data ?? [])
}

// ── PATCH /api/inbox ──────────────────────────────────────────────────────────
// Body: { id, action: 'approve'|'deny'|'explain', reason?: string, response_data?: object }
//
// approve → status=approved, resolved_at=now, resolved_by=michael
// deny    → status=denied,   resolved_at=now, resolved_by=michael  (reason required)
// explain → status stays pending, response_data updated
export async function PATCH(req: NextRequest) {
  let body: {
    id?: string
    action?: string
    reason?: string
    response_data?: Record<string, unknown>
  }

  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { id, action, reason, response_data } = body

  if (!id) {
    return NextResponse.json({ error: 'id is required' }, { status: 400 })
  }

  if (!action || !['approve', 'deny', 'explain'].includes(action)) {
    return NextResponse.json(
      { error: 'action must be one of: approve, deny, explain' },
      { status: 400 }
    )
  }

  if (action === 'deny' && !reason) {
    return NextResponse.json({ error: 'reason is required when action=deny' }, { status: 400 })
  }

  const supabase = getSupabase()

  // Verify the record exists and is pending
  const { data: existing, error: fetchError } = await supabase
    .from('inbox')
    .select('id,status')
    .eq('id', id)
    .single()

  if (fetchError || !existing) {
    return NextResponse.json({ error: 'Inbox record not found' }, { status: 404 })
  }

  if (existing.status !== 'pending' && action !== 'explain') {
    return NextResponse.json(
      { error: `Cannot ${action} an inbox record with status=${existing.status}` },
      { status: 409 }
    )
  }

  const now = new Date().toISOString()
  let update: Record<string, unknown>

  if (action === 'approve') {
    update = {
      status: 'approved',
      resolved_at: now,
      resolved_by: 'michael',
      ...(response_data !== undefined && { response_data }),
    }
  } else if (action === 'deny') {
    update = {
      status: 'denied',
      resolved_at: now,
      resolved_by: 'michael',
      response_data: { reason, ...(response_data ?? {}) },
    }
  } else {
    // explain — stays pending, just updates response_data
    update = {
      response_data: { ...(response_data ?? {}), ...(reason !== undefined && { reason }) },
    }
  }

  const { data: updated, error: updateError } = await supabase
    .from('inbox')
    .update(update)
    .eq('id', id)
    .select(INBOX_FIELDS)
    .single()

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json(updated)
}

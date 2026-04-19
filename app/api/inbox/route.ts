// TOD-762: inbox_requests API route — GET list, POST create, PATCH resolve
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/hub-client'

/** GET /api/inbox?status=pending — list inbox requests */
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const status = url.searchParams.get('status')
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 200)

  const db = createAdminClient()
  let query = db
    .from('inbox')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** POST /api/inbox — create approval request */
export async function POST(req: NextRequest) {
  const body = await req.json() as {
    agent?: string
    type?: string
    context?: unknown
    expires_at?: string
    issue_id?: string
  }

  if (!body.agent || !body.type) {
    return NextResponse.json({ error: 'agent and type are required' }, { status: 400 })
  }

  const db = createAdminClient()
  const { data, error } = await db
    .from('inbox')
    .insert({
      agent: body.agent,
      type: body.type,
      context: body.context ?? null,
      expires_at: body.expires_at ?? null,
      issue_id: body.issue_id ?? null,
    })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

/** PATCH /api/inbox — resolve a request (approve / deny / explain) */
export async function PATCH(req: NextRequest) {
  const body = await req.json() as {
    id?: string
    status?: string
    resolved_by?: string
    response_data?: unknown
  }

  if (!body.id || !body.status) {
    return NextResponse.json({ error: 'id and status are required' }, { status: 400 })
  }

  const allowed = ['approved', 'denied', 'explained', 'timeout']
  if (!allowed.includes(body.status)) {
    return NextResponse.json(
      { error: `status must be one of: ${allowed.join(', ')}` },
      { status: 400 }
    )
  }

  const db = createAdminClient()
  const { data, error } = await db
    .from('inbox')
    .update({
      status: body.status,
      resolved_by: body.resolved_by ?? 'user',
      resolved_at: new Date().toISOString(),
      response_data: body.response_data ?? null,
    })
    .eq('id', body.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

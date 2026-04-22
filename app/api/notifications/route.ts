import { NextRequest, NextResponse } from 'next/server'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

let _supabase: SupabaseClient | null = null
function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(
      'https://twthgapiouiqhavrcnry.supabase.co',
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _supabase
}

// GET /api/notifications — list recent notifications (newest first)
export async function GET(req: NextRequest) {
  const url = new URL(req.url)
  const unreadOnly = url.searchParams.get('unread') === 'true'
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 100)

  let query = getSupabase()
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (unreadOnly) query = query.eq('read', false)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/notifications — create a notification
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { type, title, body: notifBody, issue_key, issue_id, actor } = body

  if (!type || !title) {
    return NextResponse.json({ error: 'type and title are required' }, { status: 400 })
  }

  const { data, error } = await getSupabase()
    .from('notifications')
    .insert({ type, title, body: notifBody, issue_key, issue_id, actor })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data, { status: 201 })
}

// PATCH /api/notifications — mark notifications as read
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { ids, mark_all_read } = body

  if (mark_all_read) {
    const { error } = await getSupabase()
      .from('notifications')
      .update({ read: true })
      .eq('read', false)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (!ids || !Array.isArray(ids) || ids.length === 0) {
    return NextResponse.json({ error: 'ids array or mark_all_read required' }, { status: 400 })
  }

  const { error } = await getSupabase()
    .from('notifications')
    .update({ read: true })
    .in('id', ids)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

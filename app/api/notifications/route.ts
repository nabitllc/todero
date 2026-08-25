import { NextRequest, NextResponse } from 'next/server'
import { db, type DbAdapter } from '@/lib/db'
import { dbUnavailableResponse } from '@/lib/db-http'

let _supabase: DbAdapter | null = null
function getSupabase(): DbAdapter {
  if (!_supabase) {
    _supabase = db()
  }
  return _supabase
}

// GET /api/notifications — list recent notifications (newest first)
export async function GET(req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

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
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

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
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

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

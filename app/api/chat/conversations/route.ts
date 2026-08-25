import { NextRequest, NextResponse } from 'next/server'
import { db, type DbAdapter } from '@/lib/db'
import { dbUnavailableResponse, dbQueryErrorResponse } from '@/lib/db-http'

let _supabase: DbAdapter | null = null
function getSupabase(): DbAdapter {
  if (!_supabase) {
    _supabase = db()
  }
  return _supabase
}

// GET /api/chat/conversations — list all conversations with their messages
export async function GET() {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const supabase = getSupabase()
  const { data: convs, error: convErr } = await supabase
    .from('chat_conversations')
    .select('*')
    .order('updated_at', { ascending: false })

  if (convErr) return dbQueryErrorResponse(convErr, 'chat_conversations')

  const { data: msgs, error: msgErr } = await supabase
    .from('chat_messages')
    .select('*')
    .order('created_at', { ascending: true })

  if (msgErr) return dbQueryErrorResponse(msgErr, 'chat_messages')

  const result = (convs || []).map(conv => ({
    ...conv,
    messages: (msgs || []).filter(m => m.conversation_id === conv.id)
  }))

  return NextResponse.json(result)
}

// POST /api/chat/conversations — create a conversation
export async function POST(req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const { id, title, model } = await req.json()
  const { data, error } = await getSupabase()
    .from('chat_conversations')
    .insert({ id, title, model })
    .select()
    .single()
  if (error) return dbQueryErrorResponse(error, 'chat_conversations')
  return NextResponse.json(data)
}

// PATCH /api/chat/conversations — update title or model
export async function PATCH(req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const { id, ...fields } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { data, error } = await getSupabase()
    .from('chat_conversations')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) return dbQueryErrorResponse(error, 'chat_conversations')
  return NextResponse.json(data)
}

// DELETE /api/chat/conversations?id=xxx — delete a conversation (cascades messages)
export async function DELETE(req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await getSupabase().from('chat_conversations').delete().eq('id', id)
  if (error) return dbQueryErrorResponse(error, 'chat_conversations')
  return NextResponse.json({ ok: true })
}

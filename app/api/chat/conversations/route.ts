import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://twthgapiouiqhavrcnry.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
)

// GET /api/chat/conversations — list all conversations with their messages
export async function GET() {
  const { data: convs, error: convErr } = await supabase
    .from('chat_conversations')
    .select('*')
    .order('updated_at', { ascending: false })

  if (convErr) return NextResponse.json({ error: convErr.message }, { status: 500 })

  const { data: msgs, error: msgErr } = await supabase
    .from('chat_messages')
    .select('*')
    .order('created_at', { ascending: true })

  if (msgErr) return NextResponse.json({ error: msgErr.message }, { status: 500 })

  const result = (convs || []).map(conv => ({
    ...conv,
    messages: (msgs || []).filter(m => m.conversation_id === conv.id)
  }))

  return NextResponse.json(result)
}

// POST /api/chat/conversations — create a conversation
export async function POST(req: NextRequest) {
  const { id, title, model } = await req.json()
  const { data, error } = await supabase
    .from('chat_conversations')
    .insert({ id, title, model })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH /api/chat/conversations — update title or model
export async function PATCH(req: NextRequest) {
  const { id, ...fields } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { data, error } = await supabase
    .from('chat_conversations')
    .update({ ...fields, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE /api/chat/conversations?id=xxx — delete a conversation (cascades messages)
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await supabase.from('chat_conversations').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

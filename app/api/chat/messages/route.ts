import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  'https://twthgapiouiqhavrcnry.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
)

// POST /api/chat/messages — insert a message and return assistant reply
export async function POST(req: NextRequest) {
  const { conversation_id, role, content, model, id, image_url } = await req.json()

  const { error } = await supabase
    .from('chat_messages')
    .insert({ id, conversation_id, role, content, model, image_url: image_url || null })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Update conversation updated_at
  await supabase
    .from('chat_conversations')
    .update({ updated_at: new Date().toISOString() })
    .eq('id', conversation_id)

  return NextResponse.json({ ok: true })
}

// PATCH /api/chat/messages — update a message field (e.g. bookmarked)
export async function PATCH(req: NextRequest) {
  const { id, bookmarked } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const updates: Record<string, unknown> = {}
  if (bookmarked !== undefined) updates.bookmarked = bookmarked
  const { error } = await supabase
    .from('chat_messages')
    .update(updates)
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE /api/chat/messages?conversation_id=X&after_ts=Y — delete messages with created_at >= Y
// DELETE /api/chat/messages?conversation_id=X&clear=true — delete ALL messages in conversation
export async function DELETE(req: NextRequest) {
  const url = new URL(req.url)
  const conversation_id = url.searchParams.get('conversation_id')
  const clear = url.searchParams.get('clear')
  const after_ts = url.searchParams.get('after_ts')

  if (!conversation_id) {
    return NextResponse.json({ error: 'conversation_id required' }, { status: 400 })
  }

  if (clear === 'true') {
    // Delete ALL messages in the conversation
    const { error } = await supabase
      .from('chat_messages')
      .delete()
      .eq('conversation_id', conversation_id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (!after_ts) {
    return NextResponse.json({ error: 'after_ts or clear=true required' }, { status: 400 })
  }
  const { error } = await supabase
    .from('chat_messages')
    .delete()
    .eq('conversation_id', conversation_id)
    .gte('created_at', new Date(parseInt(after_ts)).toISOString())
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

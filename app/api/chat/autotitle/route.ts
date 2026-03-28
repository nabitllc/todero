import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

const OPENCLAW_GATEWAY = 'http://127.0.0.1:18789'
const OPENCLAW_TOKEN = 'eb4ac84aeab1b0f85f9b9697ee3dc707170bf0bf46a735f0'

const supabase = createClient(
  'https://twthgapiouiqhavrcnry.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
)

export async function POST(req: NextRequest) {
  const { conversationId, firstUserMessage } = await req.json()
  if (!conversationId || !firstUserMessage) {
    return NextResponse.json({ error: 'conversationId and firstUserMessage required' }, { status: 400 })
  }

  try {
    const res = await fetch(`${OPENCLAW_GATEWAY}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENCLAW_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'openclaw',
        messages: [{
          role: 'user',
          content: `Generate a 3-5 word title for a conversation that starts with: "${firstUserMessage.slice(0, 200)}". Reply with ONLY the title, no quotes, no punctuation.`
        }],
        stream: false,
      }),
    })

    if (!res.ok) {
      return NextResponse.json({ error: 'Gateway error' }, { status: 502 })
    }

    const data = await res.json()
    const title = data?.choices?.[0]?.message?.content?.trim()
    if (!title) return NextResponse.json({ error: 'No title generated' }, { status: 500 })

    await supabase
      .from('chat_conversations')
      .update({ title })
      .eq('id', conversationId)

    return NextResponse.json({ title })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

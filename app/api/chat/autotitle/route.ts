// Auto-title via OpenRouter.
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/hub-client'
import { dbUnavailableResponse } from '@/lib/db-http'

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? ''
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

export async function POST(req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const { conversationId, firstUserMessage } = await req.json().catch(() => ({}))
  if (!conversationId || !firstUserMessage) {
    return NextResponse.json({ error: 'conversationId and firstUserMessage required' }, { status: 400 })
  }

  try {
    const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://kaos.nabit.work',
        'X-Title': 'KAOS Mission Control',
      },
      body: JSON.stringify({
        model: 'anthropic/claude-haiku-4-5',
        messages: [{
          role: 'user',
          content: `Generate a 3-5 word title for a conversation that starts with: "${firstUserMessage.slice(0, 200)}". Reply with ONLY the title, no quotes, no punctuation.`,
        }],
        stream: false,
        max_tokens: 20,
      }),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => '')
      return NextResponse.json({ error: `OpenRouter error: ${res.status}`, detail: errText }, { status: 502 })
    }

    const data = await res.json()
    const title = data?.choices?.[0]?.message?.content?.trim()
    if (!title) return NextResponse.json({ error: 'No title generated' }, { status: 500 })

    const db = createAdminClient()
    await db
      .from('chat_conversations')
      .update({ title, updated_at: new Date().toISOString() })
      .eq('id', conversationId)

    return NextResponse.json({ title })
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}

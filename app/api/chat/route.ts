import { NextRequest, NextResponse } from 'next/server'

const OPENCLAW_GATEWAY = 'http://127.0.0.1:18789'
const OPENCLAW_TOKEN = 'eb4ac84aeab1b0f85f9b9697ee3dc707170bf0bf46a735f0'

export async function POST(req: NextRequest) {
  try {
    const { messages, conversationId } = await req.json()

    // Use a stable session key per conversation so KAOS remembers context within it
    const sessionKey = conversationId ? `mc-chat-${conversationId}` : undefined

    const response = await fetch(`${OPENCLAW_GATEWAY}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENCLAW_TOKEN}`,
        'Content-Type': 'application/json',
        'x-openclaw-agent-id': 'main',
        ...(sessionKey ? { 'x-openclaw-session-key': sessionKey } : {}),
      },
      body: JSON.stringify({
        model: 'openclaw',
        messages,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      return NextResponse.json({ error: `Gateway error: ${err}` }, { status: 500 })
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || 'No response.'

    return NextResponse.json({
      id: data.id || 'msg-' + Date.now(),
      role: 'assistant',
      content,
      model: 'KAOS (Claude Max)',
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to reach OpenClaw gateway' },
      { status: 500 }
    )
  }
}

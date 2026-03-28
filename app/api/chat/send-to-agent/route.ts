import { NextRequest, NextResponse } from 'next/server'

const OPENCLAW_GATEWAY = 'http://127.0.0.1:18789'
const OPENCLAW_TOKEN = 'eb4ac84aeab1b0f85f9b9697ee3dc707170bf0bf46a735f0'

export async function POST(req: NextRequest) {
  const { agentId, message, sessionKey } = await req.json()
  if (!agentId || !message) {
    return NextResponse.json({ error: 'agentId and message required' }, { status: 400 })
  }

  const targetSession = sessionKey || `mc-send-to-${agentId}`

  try {
    // Use the gateway's chat completions endpoint to send a one-shot message to the target agent
    const res = await fetch(`${OPENCLAW_GATEWAY}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENCLAW_TOKEN}`,
        'Content-Type': 'application/json',
        'x-openclaw-agent-id': agentId,
        'x-openclaw-session-key': targetSession,
      },
      body: JSON.stringify({
        model: 'openclaw',
        messages: [{ role: 'user', content: message }],
        stream: false,
      }),
    })

    if (!res.ok) {
      const err = await res.text().catch(() => 'unknown')
      return NextResponse.json({ error: `Gateway error: ${err}` }, { status: 500 })
    }

    const data = await res.json()
    const reply = data.choices?.[0]?.message?.content || data.content || '(no response)'
    return NextResponse.json({ ok: true, reply, agentId, sessionKey: targetSession })
  } catch (err: any) {
    return NextResponse.json({ error: err.message || 'Failed to reach gateway' }, { status: 500 })
  }
}

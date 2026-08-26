// Auto-title via the local LLM seam (LLM_BASE_URL — Ollama by default).
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/hub-client'
import { dbUnavailableResponse } from '@/lib/db-http'
import { LLM_API_KEY, LLM_BASE_URL, LLM_DEFAULT_MODEL, fetchLiveModels, noModelsError, resolveModelId } from '@/lib/llm-provider'

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

  const live = await fetchLiveModels()
  if (!live.ok) {
    // `kind` distinguishes "the endpoint is down" from "LLM_BASE_URL points
    // at something that is not an OpenAI-compatible server at all" — the
    // latter used to arrive here as a 200 with an empty roster.
    return NextResponse.json({ error: live.error, kind: live.kind }, { status: 502 })
  }
  if (live.models.length === 0) {
    return NextResponse.json({ error: noModelsError(), kind: 'empty-roster' }, { status: 502 })
  }
  // A configured LLM_MODEL that the endpoint does not report is a
  // misconfiguration worth saying out loud — quietly titling with a different
  // model is the same silent-substitution lie the chat route rejects.
  const ids = live.models.map(m => m.id)
  const model = LLM_DEFAULT_MODEL ? resolveModelId(LLM_DEFAULT_MODEL, ids) : ids[0]
  if (!model) {
    return NextResponse.json(
      { error: `unknown model "${LLM_DEFAULT_MODEL}" — not present in ${LLM_BASE_URL}/models`, id: LLM_DEFAULT_MODEL },
      { status: 400 },
    )
  }

  try {
    const res = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LLM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
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
      return NextResponse.json({ error: `${LLM_BASE_URL} error: ${res.status}`, detail: errText }, { status: 502 })
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
    return NextResponse.json({ error: `${LLM_BASE_URL} is unreachable — ${err.message}` }, { status: 502 })
  }
}

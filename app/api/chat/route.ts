// Chat streaming backend — routes through the LLM_BASE_URL seam (Ollama by
// default on this machine). No OpenRouter, no other vendor SDK, no cloud
// fallback: whatever answers at LLM_BASE_URL is the only place this route
// ever sends a prompt. See lib/llm-provider.ts.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/hub-client'
import { dbUnavailableResponse } from '@/lib/db-http'
import { LLM_API_KEY, LLM_BASE_URL, LLM_DEFAULT_MODEL, fetchLiveModels } from '@/lib/llm-provider'

export const runtime = 'nodejs'

function sseError(encoder: TextEncoder, message: string) {
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(encoder.encode(`data: ${JSON.stringify({ error: message })}\n\n`))
      c.close()
    },
  })
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } })
}

export async function POST(req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const encoder = new TextEncoder()

  const body = await req.json().catch(() => ({}))
  const { conversationId, messages, modelOverride } = body as {
    conversationId?: string
    messages?: Array<{ role: string; content: string }>
    agentId?: string
    modelOverride?: string
  }

  if (!messages?.length) {
    return sseError(encoder, 'messages array is required')
  }

  // Model resolution has exactly one source of truth: a live GET against
  // LLM_BASE_URL/models. There is no vendor map to fall back into — an
  // unreachable endpoint or an unrecognized id is reported by name, never
  // silently substituted for a different model.
  const live = await fetchLiveModels()
  if (!live.ok) {
    return sseError(encoder, live.error)
  }
  if (live.models.length === 0) {
    return sseError(encoder, `${LLM_BASE_URL}/models returned no models — pull one first (e.g. \`ollama pull qwen2.5-coder:7b\`)`)
  }

  const requestedModel = modelOverride && modelOverride !== 'default' ? modelOverride : (LLM_DEFAULT_MODEL || live.models[0].id)
  const knownIds = new Set(live.models.map(m => m.id))
  if (!knownIds.has(requestedModel)) {
    return NextResponse.json(
      { error: `unknown model "${requestedModel}" — not present in ${LLM_BASE_URL}/models`, id: requestedModel },
      { status: 400 },
    )
  }
  const model = requestedModel

  let upstream: Response
  try {
    upstream = await fetch(`${LLM_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LLM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        messages,
        stream: true,
        max_tokens: 4096,
      }),
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return sseError(encoder, `${LLM_BASE_URL} is unreachable — ${detail}`)
  }

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => 'Unknown error')
    return sseError(encoder, `${LLM_BASE_URL} error: ${upstream.status} — ${errText.slice(0, 200)}`)
  }

  // Transform the upstream SSE → ChatTab SSE format, then save to DB
  const readableStream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader()
      const decoder = new TextDecoder()
      let fullContent = ''

      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ')) continue
            const raw = line.slice(6).trim()
            if (raw === '[DONE]') continue

            try {
              const parsed = JSON.parse(raw)
              const delta = parsed?.choices?.[0]?.delta?.content
              if (delta) {
                fullContent += delta
                controller.enqueue(encoder.encode(`data: ${JSON.stringify({ delta })}\n\n`))
              }
            } catch { /* skip malformed lines */ }
          }
        }
      } catch (err: any) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: err.message || 'Stream error' })}\n\n`))
        controller.close()
        return
      }

      // Save assistant message to Supabase
      let savedId: string | undefined
      if (conversationId && fullContent) {
        try {
          const db = createAdminClient()
          const { data } = await db
            .from('chat_messages')
            .insert({
              conversation_id: conversationId,
              role: 'assistant',
              content: fullContent,
              model,
              created_at: new Date().toISOString(),
            })
            .select('id')
            .single()
          savedId = data?.id

          // Update conversation updated_at
          await db
            .from('chat_conversations')
            .update({ updated_at: new Date().toISOString() })
            .eq('id', conversationId)
        } catch { /* non-fatal — message still streamed */ }
      }

      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ done: true, id: savedId })}\n\n`))
      controller.close()
    },
  })

  return new Response(readableStream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}

// Chat streaming backend — OpenRouter API (anthropic/openai models).

import { NextRequest } from 'next/server'
import { createAdminClient } from '@/lib/hub-client'
import { dbUnavailableResponse } from '@/lib/db-http'

export const runtime = 'nodejs'

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? ''
const OPENROUTER_BASE = 'https://openrouter.ai/api/v1'

// Map alias/agentId to OpenRouter model string
function resolveModel(modelOverride?: string): string {
  if (!modelOverride || modelOverride === 'default') return 'anthropic/claude-sonnet-4-5'
  const map: Record<string, string> = {
    sonnet: 'anthropic/claude-sonnet-4-5',
    haiku:  'anthropic/claude-haiku-4-5',
    opus:   'anthropic/claude-opus-4-5',
    'gpt-4o':        'openai/gpt-4o',
    'gpt-4o-mini':   'openai/gpt-4o-mini',
    'claude-sonnet': 'anthropic/claude-sonnet-4-5',
    'claude-haiku':  'anthropic/claude-haiku-4-5',
    kaos:   'anthropic/claude-sonnet-4-5',
  }
  return map[modelOverride] ?? 'anthropic/claude-sonnet-4-5'
}

export async function POST(req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const encoder = new TextEncoder()

  const body = await req.json().catch(() => ({}))
  const { conversationId, messages, agentId, modelOverride } = body as {
    conversationId?: string
    messages?: Array<{ role: string; content: string }>
    agentId?: string
    modelOverride?: string
  }

  if (!messages?.length) {
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(encoder.encode(`data: ${JSON.stringify({ error: 'messages array is required' })}\n\n`))
        c.close()
      },
    })
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } })
  }

  const model = resolveModel(modelOverride || agentId)

  const orRes = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://kaos.nabit.work',
      'X-Title': 'KAOS Mission Control',
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
      max_tokens: 4096,
    }),
  })

  if (!orRes.ok || !orRes.body) {
    const errText = await orRes.text().catch(() => 'Unknown error')
    const stream = new ReadableStream({
      start(c) {
        c.enqueue(encoder.encode(`data: ${JSON.stringify({ error: `OpenRouter error: ${orRes.status} — ${errText.slice(0, 200)}` })}\n\n`))
        c.close()
      },
    })
    return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } })
  }

  // Transform OpenRouter SSE → ChatTab SSE format, then save to DB
  const readableStream = new ReadableStream({
    async start(controller) {
      const reader = orRes.body!.getReader()
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

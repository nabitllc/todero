// Chat streaming backend — routes through the LLM_BASE_URL seam (Ollama by
// default on this machine). No hosted gateway, no other vendor SDK, no cloud
// fallback: whatever answers at LLM_BASE_URL is the only place this route
// ever sends a prompt. See lib/llm-provider.ts.
//
// TOMBSTONE (pieces `chat-route-local-model` and the gateway-removal follow-up
// in pieces3, kept by `provider-is-a-base-url`). The piece ids are given this
// way for the same reason the paragraph below explains: one of them contains
// the banned name verbatim, and naming it here would fail the raw-text
// acceptance check that scans this file.
// What used to be at line 9 of this file was a
// hardcoded base URL constant for a hosted routing gateway, plus a read of that
// gateway's `*_API_KEY`. Every prompt went there — including the one the UI
// labelled "Private, free, offline". Both were DELETED on the owner's standing
// decision, recorded in docs/rebuild/HANDOFF.md under "Owner decisions already
// made": that gateway is never to be used, and this install is local-only for
// now. Do not reintroduce a second endpoint here: the provider is meant to be a
// base URL, so pointing somewhere else is an .env.local edit, not a branch.
//
// The gateway's NAME is deliberately not written out in this comment. An
// acceptance check greps these four source roots for it as raw text, so
// spelling it here would fail the build and the only "fix" would be deleting
// this record — which is exactly how a removal gets quietly reinvented.
// scripts/no-cloud-provider.mjs strips comments before scanning for that
// reason, and derives the banned name from HANDOFF.md so it never has to be
// repeated in code either.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/hub-client'
import { dbUnavailableResponse } from '@/lib/db-http'
import { LLM_API_KEY, LLM_BASE_URL, LLM_DEFAULT_MODEL, fetchLiveModels, resolveModelId } from '@/lib/llm-provider'

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
  // `ollama/qwen2.5-coder:7b` and `qwen2.5-coder:7b` both resolve; a prefix
  // naming a provider that is not the configured one does not.
  const model = resolveModelId(requestedModel, live.models.map(m => m.id))
  if (!model) {
    return NextResponse.json(
      { error: `unknown model "${requestedModel}" — not present in ${LLM_BASE_URL}/models`, id: requestedModel },
      { status: 400 },
    )
  }

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

      // ── Persist the assistant reply ───────────────────────────────────────
      // `chat_messages.id` is a TEXT PRIMARY KEY with no default
      // (migrations/000_baseline_schema.sql:191), so the id has to be supplied
      // here exactly as /api/chat/messages requires it from the client. It was
      // omitted, and the failure was swallowed by a bare `catch {}`, so every
      // assistant reply streamed fine and then vanished on reload with nothing
      // said. A write that did not happen is not allowed to look like one that
      // did: the stream still finishes (the user keeps the text on screen) but
      // it carries a `persistError` frame naming what was lost and why, which
      // ChatTab renders under the message.
      let savedId: string | undefined
      let persistError: string | undefined
      if (conversationId && fullContent) {
        const assistantId = `msg-${Date.now()}`
        try {
          const db = createAdminClient()
          const { error } = await db
            .from('chat_messages')
            .insert({
              id: assistantId,
              conversation_id: conversationId,
              role: 'assistant',
              content: fullContent,
              model,
              created_at: new Date().toISOString(),
            })
          if (error) {
            persistError = `assistant reply was not saved to chat_messages: ${error.message}`
          } else {
            savedId = assistantId

            // Update conversation updated_at
            const { error: convError } = await db
              .from('chat_conversations')
              .update({ updated_at: new Date().toISOString() })
              .eq('id', conversationId)
            if (convError) {
              persistError = `assistant reply was saved, but chat_conversations.updated_at was not: ${convError.message}`
            }
          }
        } catch (err) {
          const detail = err instanceof Error ? err.message : String(err)
          persistError = `assistant reply was not saved to chat_messages: ${detail}`
        }
      }

      if (persistError) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ persistError })}\n\n`))
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

import { NextRequest } from 'next/server'
import { createClient } from '@supabase/supabase-js'

function detectIssueDraft(userMessage: string): { title: string; type: string; priority: string; assignee: string; acceptance_criteria: string } | null {
  const lower = userMessage.toLowerCase()
  const isFeature = /\b(add|build|create|make|implement|i want|we need|let's build)\b/.test(lower)
  const isBug = /\b(fix|bug|broken|error|not working|issue with)\b/.test(lower)
  if (!isFeature && !isBug) return null

  const type = isBug ? 'bug' : 'feature'
  const title = userMessage.length > 60 ? userMessage.slice(0, 57) + '...' : userMessage

  return {
    title,
    type,
    priority: isBug ? 'high' : 'medium',
    assignee: 'builder',
    acceptance_criteria: `${title} works as expected and passes review.`
  }
}

const OPENCLAW_GATEWAY = 'http://127.0.0.1:18789'
const OPENCLAW_TOKEN = 'eb4ac84aeab1b0f85f9b9697ee3dc707170bf0bf46a735f0'

const supabase = createClient(
  'https://twthgapiouiqhavrcnry.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
)

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  const encoder = new TextEncoder()

  const errorStream = (msg: string) => {
    return new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(encoder.encode(`data: ${JSON.stringify({ error: msg })}\n\n`))
          c.close()
        }
      }),
      { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } }
    )
  }

  let body: any
  try { body = await req.json() } catch { return errorStream('Invalid request body') }

  const { messages, conversationId, assistantMsgId, agentId, modelOverride } = body
  // Detect issue draft from last user message
  const lastUserMsg = [...(messages || [])].reverse().find((m: any) => m.role === 'user')
  const issueDraft = lastUserMsg ? detectIssueDraft(lastUserMsg.content) : null
  if (!messages || !conversationId) return errorStream('messages and conversationId required')

  const resolvedAgent = agentId || 'main'
  const sessionKey = `mc-chat-${conversationId}`
  const msgId = assistantMsgId || ('msg-server-' + Date.now())
  // Model override: if set, pass as x-openclaw-model header so gateway uses that model
  const resolvedModel = modelOverride || 'openclaw'

  let upstream: Response
  try {
    const upstreamHeaders: Record<string, string> = {
      'Authorization': `Bearer ${OPENCLAW_TOKEN}`,
      'Content-Type': 'application/json',
      'x-openclaw-agent-id': resolvedAgent,
      'x-openclaw-session-key': sessionKey,
    }
    if (modelOverride) upstreamHeaders['x-openclaw-model'] = modelOverride
    upstream = await fetch(`${OPENCLAW_GATEWAY}/v1/chat/completions`, {
      method: 'POST',
      headers: upstreamHeaders,
      body: JSON.stringify({ model: resolvedModel, messages, stream: true }),
    })
  } catch {
    return errorStream('Failed to reach OpenClaw gateway')
  }

  if (!upstream.ok || !upstream.body) {
    const err = await upstream.text().catch(() => 'unknown')
    return errorStream(`Gateway error: ${err}`)
  }

  const upstreamReader = upstream.body.getReader()
  const decoder = new TextDecoder()

  // Accumulate full content server-side, stream tokens to client simultaneously
  let fullContent = ''
  let finalId = msgId

  const stream = new ReadableStream({
    async start(controller) {
      try {
        while (true) {
          const { done, value } = await upstreamReader.read()
          if (done) break

          const chunk = decoder.decode(value, { stream: true })
          for (const line of chunk.split('\n')) {
            if (!line.startsWith('data: ')) continue
            const raw = line.slice(6).trim()
            if (raw === '[DONE]') {
              // Stream closed — write full message to Supabase
              try {
                await supabase.from('chat_messages').insert({
                  id: finalId,
                  conversation_id: conversationId,
                  role: 'assistant',
                  content: fullContent,
                  model: 'kaos',
                })
                // Update conversation updated_at
                await supabase
                  .from('chat_conversations')
                  .update({ updated_at: new Date().toISOString() })
                  .eq('id', conversationId)
              } catch { /* non-fatal — client will poll */ }

              controller.enqueue(encoder.encode(
                `data: ${JSON.stringify({ done: true, id: finalId, issue_draft: issueDraft })}\n\n`
              ))
              continue
            }

            try {
              const parsed = JSON.parse(raw)
              if (parsed.id) finalId = parsed.id
              const delta = parsed.choices?.[0]?.delta?.content
              if (delta != null) {
                fullContent += delta
                controller.enqueue(encoder.encode(
                  `data: ${JSON.stringify({ delta, id: finalId })}\n\n`
                ))
              }
              // Forward tool_use events to client
              if (parsed.choices?.[0]?.delta?.tool_calls) {
                for (const tc of parsed.choices[0].delta.tool_calls) {
                  if (tc.function) {
                    controller.enqueue(encoder.encode(
                      `data: ${JSON.stringify({ tool_use: { name: tc.function.name, input: tc.function.arguments }, id: finalId })}\n\n`
                    ))
                  }
                }
              }
              // Forward thinking/reasoning blocks
              const thinking = parsed.choices?.[0]?.delta?.reasoning_content || parsed.choices?.[0]?.delta?.thinking
              if (thinking) {
                controller.enqueue(encoder.encode(
                  `data: ${JSON.stringify({ thinking, id: finalId })}\n\n`
                ))
              }
            } catch { /* skip */ }
          }
        }
      } catch {
        controller.enqueue(encoder.encode(
          `data: ${JSON.stringify({ error: 'Stream interrupted' })}\n\n`
        ))
      } finally {
        controller.close()
      }
    },
    cancel() { upstreamReader.cancel() }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}

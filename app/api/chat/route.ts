import { NextRequest, NextResponse } from 'next/server'

// Model ID mapping — UI label → OpenRouter model ID
const MODEL_MAP: Record<string, string> = {
  'claude-sonnet-4-6': 'anthropic/claude-sonnet-4-5',
  'claude-haiku-4-5': 'anthropic/claude-haiku-4-5',
  'gpt-4o': 'openai/gpt-4o',
  'gpt-4o-mini': 'openai/gpt-4o-mini',
  'gemini-2.0-flash': 'google/gemini-2.0-flash-001',
}

export async function POST(req: NextRequest) {
  try {
    const { model, messages } = await req.json()

    const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY
    if (!OPENROUTER_KEY) {
      return NextResponse.json({ error: 'OPENROUTER_API_KEY not configured' }, { status: 500 })
    }

    const orModel = MODEL_MAP[model] || 'anthropic/claude-sonnet-4-5'

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENROUTER_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://kaos.nabit.work',
        'X-Title': 'KAOS Mission Control',
      },
      body: JSON.stringify({
        model: orModel,
        messages: [
          {
            role: 'system',
            content: `You are KAOS — Nabit AI Orchestration System. You are Michael Saenz's AI orchestrator, managing the Kemuni and Vespera projects under Nabit LLC. Be direct, sharp, and competent. No filler. Current date: ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}.`
          },
          ...messages
        ],
        max_tokens: 1024,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      return NextResponse.json({ error: `OpenRouter error: ${err}` }, { status: 500 })
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content || 'No response.'

    return NextResponse.json({
      id: 'msg-' + Date.now(),
      role: 'assistant',
      content,
      model,
    })
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to process chat request' },
      { status: 500 }
    )
  }
}

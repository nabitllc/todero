import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { model, messages } = await req.json()

    // Mock response for now
    // TODO: Integrate with actual LLM API (OpenClaw, OpenRouter, etc)
    const response = {
      id: 'chat-' + Date.now(),
      role: 'assistant',
      content: `I am Kemuni Agent, running on ${model}. This chat interface is functional. You can save conversations in localStorage, switch models, and attach files. The actual API integration is pending OpenClaw authentication setup.`,
      model,
    }

    return NextResponse.json(response)
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to process chat request' },
      { status: 500 }
    )
  }
}

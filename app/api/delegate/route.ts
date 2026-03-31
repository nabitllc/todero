// TOD-487: API endpoint for delegating tasks to named agents
// POST /api/delegate
// Body: { taskType: string, prompt: string, agentId?: string }
//
// Routes to named agent via openclaw message. Falls back to gateway API.
// Anonymous subagents only used when no named agent matches.

import { NextRequest, NextResponse } from 'next/server'
import { delegateTask } from '@/lib/agent-dispatch'

export async function POST(req: NextRequest) {
  const auth = req.headers.get('x-internal-secret')
  if (auth !== (process.env.INTERNAL_SECRET ?? 'kaos-internal-2026')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await req.json()
  const { taskType, prompt, agentId } = body as {
    taskType?: string; prompt?: string; agentId?: string
  }

  if (!prompt) {
    return NextResponse.json({ error: 'prompt is required' }, { status: 400 })
  }

  const result = await delegateTask(
    taskType ?? 'unknown',
    prompt,
    agentId ? { forceAgent: agentId } : undefined
  )

  return NextResponse.json(result, { status: result.ok ? 200 : 502 })
}

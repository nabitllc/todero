// TOD-765: Loop Breaker — agent failure tracking REST endpoint
//
// GET  /api/agent-failures          — list all agents with failure state
// GET  /api/agent-failures?agent=X  — single agent failure state
// POST /api/agent-failures          — record failure or success event
//   Body: { agent_id: string, error_message?: string, success?: boolean }
//   - success=true  → reset failure_count to 0
//   - success=false (default) → increment if same error, reset to 1 if different

import { NextRequest, NextResponse } from 'next/server'
import {
  getAllAgentFailures,
  getAgentFailures,
  recordAgentFailure,
  resetAgentFailures,
} from '@/lib/agent-failures'

export async function GET(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get('agent')
  try {
    if (agentId) {
      const state = await getAgentFailures(agentId)
      return NextResponse.json(state ?? { agent_id: agentId, failure_count: 0 })
    }
    const all = await getAllAgentFailures()
    return NextResponse.json(all)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as { agent_id?: string; error_message?: string; success?: boolean }
    const { agent_id, error_message, success } = body

    if (!agent_id) {
      return NextResponse.json({ error: 'agent_id is required' }, { status: 400 })
    }

    if (success) {
      await resetAgentFailures(agent_id)
      return NextResponse.json({ ok: true, agent_id, failure_count: 0, reset: true })
    }

    if (!error_message) {
      return NextResponse.json(
        { error: 'error_message is required when success is not true' },
        { status: 400 },
      )
    }

    const state = await recordAgentFailure(agent_id, error_message)
    return NextResponse.json({ ok: true, ...state })
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

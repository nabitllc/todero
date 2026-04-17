// app/api/agent-runs/[id]/route.ts
// Internal PATCH endpoint — updates cost/token stats (and optionally status)
// on an agent_runs row after a builder session completes.
//
// Called by scripts/builder-with-cost.sh with x-internal-secret.
// Phase 7 of OpenClaw → Native Stack migration (TOD-1514).

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/hub-client'

const INTERNAL_SECRET = process.env.INTERNAL_SECRET ?? 'kaos-internal-2026'

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = req.headers.get('x-internal-secret')
  if (auth !== INTERNAL_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  if (!id || !/^[0-9a-f-]{36}$/.test(id)) {
    return NextResponse.json({ error: 'Invalid run id' }, { status: 400 })
  }

  let body: {
    tokens_used?: number
    cost_usd?: number
    status?: string
    output?: string
    error?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const update: Record<string, unknown> = {}

  if (typeof body.tokens_used === 'number') update.tokens_used = body.tokens_used
  if (typeof body.cost_usd === 'number') update.cost_usd = body.cost_usd
  if (typeof body.status === 'string') update.status = body.status
  if (typeof body.output === 'string') update.output = body.output
  if (typeof body.error === 'string') update.error = body.error

  // Auto-stamp finished_at when the session reaches a terminal status
  if (body.status === 'done' || body.status === 'error') {
    update.finished_at = new Date().toISOString()
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No recognised fields to update' }, { status: 400 })
  }

  const db = createAdminClient()
  const { data, error } = await db
    .from('agent_runs')
    .update(update)
    .eq('id', id)
    .select('id, status, tokens_used, cost_usd, finished_at')
    .single()

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}

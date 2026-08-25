// TOD-766: Per-agent pause/unpause endpoint for loop breaker recovery
//
// GET  /api/agent-pause?agent=builder  — check if agent is paused
// PATCH /api/agent-pause               — { agent: string, paused: boolean } — toggle pause state
//   paused=false: clears is_paused flag and resets consecutive_failures counter
//   paused=true:  manually pause an agent (e.g. for maintenance)

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dbUnavailableResponse } from '@/lib/db-http'

/** One `agent_memory` key/value row. */
type MemoryRow = { value: Record<string, unknown> }

/** Read a single agent_memory key, or `{}` when it is absent or unreadable. */
async function readMemory(agentId: string, key: string): Promise<Record<string, unknown>> {
  const { data, error } = await db()
    .from('agent_memory')
    .select('value')
    .eq('agent_id', agentId)
    .eq('key', key)
    .limit(1)
  if (error) return {}
  return ((data ?? []) as MemoryRow[])[0]?.value ?? {}
}

/** GET /api/agent-pause?agent=<agentId> — returns pause state for the agent */
export async function GET(req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const agentId = req.nextUrl.searchParams.get('agent')
  if (!agentId) {
    return NextResponse.json({ error: 'Missing ?agent= parameter' }, { status: 400 })
  }

  const [pauseState, breakerState] = await Promise.all([
    readMemory(agentId, 'is_paused'),
    readMemory(agentId, 'loop_breaker'),
  ])

  return NextResponse.json({
    agent: agentId,
    is_paused: pauseState.paused === true,
    paused_at: pauseState.paused_at ?? null,
    paused_reason: pauseState.reason ?? null,
    consecutive_failures: breakerState.consecutive_failures ?? 0,
    last_failure_at: breakerState.last_failure_at ?? null,
    last_issue_id: pauseState.last_issue_id ?? breakerState.last_issue_id ?? null,
  })
}

/** PATCH /api/agent-pause — { agent: string, paused: boolean }
 *  Un-pausing (paused=false): clears is_paused flag and resets consecutive_failures
 *  Pausing  (paused=true):  manually sets is_paused flag (for maintenance use)
 */
export async function PATCH(req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const agentId = body.agent as string | undefined
  const paused = body.paused as boolean | undefined

  if (!agentId) {
    return NextResponse.json({ error: 'Missing agent field' }, { status: 400 })
  }
  if (typeof paused !== 'boolean') {
    return NextResponse.json({ error: 'Missing or invalid paused field (must be boolean)' }, { status: 400 })
  }

  const now = new Date().toISOString()

  // Update is_paused record
  await db().from('agent_memory').upsert({
    agent_id: agentId,
    key: 'is_paused',
    value: {
      paused,
      paused_at: paused ? now : null,
      reason: paused ? (body.reason ?? 'manual pause') : null,
      cleared_at: paused ? null : now,
      cleared_by: paused ? null : (body.cleared_by ?? 'human'),
    },
    updated_at: now,
  })

  // When un-pausing: also reset consecutive_failures counter
  if (!paused) {
    await db().from('agent_memory').upsert({
      agent_id: agentId,
      key: 'loop_breaker',
      value: { consecutive_failures: 0, last_failure_at: now },
      updated_at: now,
    })
  }

  return NextResponse.json({
    ok: true,
    agent: agentId,
    is_paused: paused,
    updated_at: now,
    message: paused
      ? `Agent '${agentId}' has been manually paused.`
      : `Agent '${agentId}' has been un-paused. Consecutive failure counter reset.`,
  })
}

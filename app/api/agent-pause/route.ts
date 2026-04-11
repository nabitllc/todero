// TOD-766: Per-agent pause/unpause endpoint for loop breaker recovery
//
// GET  /api/agent-pause?agent=builder  — check if agent is paused
// PATCH /api/agent-pause               — { agent: string, paused: boolean } — toggle pause state
//   paused=false: clears is_paused flag and resets consecutive_failures counter
//   paused=true:  manually pause an agent (e.g. for maintenance)

import { NextRequest, NextResponse } from 'next/server'

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? 'https://twthgapiouiqhavrcnry.supabase.co'
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''
const HEADERS = {
  'apikey': SUPA_KEY,
  'Authorization': `Bearer ${SUPA_KEY}`,
  'Content-Type': 'application/json',
}

/** GET /api/agent-pause?agent=<agentId> — returns pause state for the agent */
export async function GET(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get('agent')
  if (!agentId) {
    return NextResponse.json({ error: 'Missing ?agent= parameter' }, { status: 400 })
  }

  const [pauseRes, breakerRes] = await Promise.all([
    fetch(`${SUPA_URL}/rest/v1/agent_memory?agent_id=eq.${agentId}&key=eq.is_paused&limit=1`, { headers: HEADERS }),
    fetch(`${SUPA_URL}/rest/v1/agent_memory?agent_id=eq.${agentId}&key=eq.loop_breaker&limit=1`, { headers: HEADERS }),
  ])

  const pauseData = pauseRes.ok ? await pauseRes.json() as Array<{ value: Record<string, unknown> }> : []
  const breakerData = breakerRes.ok ? await breakerRes.json() as Array<{ value: Record<string, unknown> }> : []

  const pauseState = pauseData[0]?.value ?? {}
  const breakerState = breakerData[0]?.value ?? {}

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
  await fetch(`${SUPA_URL}/rest/v1/agent_memory`, {
    method: 'POST',
    headers: { ...HEADERS, 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify({
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
    }),
  })

  // When un-pausing: also reset consecutive_failures counter
  if (!paused) {
    await fetch(`${SUPA_URL}/rest/v1/agent_memory`, {
      method: 'POST',
      headers: { ...HEADERS, 'Prefer': 'resolution=merge-duplicates' },
      body: JSON.stringify({
        agent_id: agentId,
        key: 'loop_breaker',
        value: { consecutive_failures: 0, last_failure_at: now },
        updated_at: now,
      }),
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

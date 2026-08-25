// TOD-766: Per-agent pause/unpause endpoint for loop breaker recovery
//
// GET  /api/agent-pause?agent=builder  — check if agent is paused
// PATCH /api/agent-pause               — { agent: string, paused: boolean } — toggle pause state
//   paused=false: clears is_paused flag and resets consecutive_failures counter
//   paused=true:  manually pause an agent (e.g. for maintenance)

import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dbUnavailableResponse, dbQueryErrorResponse } from '@/lib/db-http'

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

  // Read the pause record BEFORE overwriting it — when un-pausing, this is
  // the only place `last_issue_id` (the issue the loop breaker blocked when
  // it paused this agent — see lib/loop-breaker.ts pauseAgent()) is still
  // reachable, since the write below replaces the value that carries it.
  const priorPauseState = !paused ? await readMemory(agentId, 'is_paused') : null

  // Update is_paused record. onConflict is load-bearing, not decoration:
  // agent_memory's real uniqueness is UNIQUE(agent_id, key) (it predates the
  // migrations directory — see migrations/016_agent_documents.sql's note),
  // not its `id` primary key. Omitting onConflict makes the seam default to
  // the primary key, which is never present in this payload, so every call
  // INSERTs a fresh row instead of updating the existing one — silently, no
  // error — and readers get whichever row happens to sort first.
  const { error: pauseError } = await db().from('agent_memory').upsert({
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
  }, { onConflict: 'agent_id,key' })
  if (pauseError) return dbQueryErrorResponse(pauseError, 'agent_memory')

  // When un-pausing: also reset consecutive_failures counter, and clear the
  // issue block the loop breaker set (lib/loop-breaker.ts pauseAgent() does
  // BOTH agent_memory.is_paused=true AND issues.is_blocked=true /
  // blocked_by='system:loop_breaker' when it trips — see the identical
  // reasoning in app/api/inbox/route.ts's loop_breaker_pause effect handler,
  // which this mirrors for the direct un-pause toggle in AgentDetailView).
  // Un-pausing without clearing the block reports full recovery while the
  // agent still cannot be dispatched, which is the exact defect this route
  // exists to not repeat.
  let breakerResetError: string | null = null
  let issueUnblocked = false
  let stillBlockedBy: string | null = null
  let blockedIssueLabel: string | null = null

  if (!paused) {
    const { error } = await db().from('agent_memory').upsert({
      agent_id: agentId,
      key: 'loop_breaker',
      value: { consecutive_failures: 0, last_failure_at: now },
      updated_at: now,
    }, { onConflict: 'agent_id,key' })
    if (error) breakerResetError = error.message

    const lastIssueId = typeof priorPauseState?.last_issue_id === 'string' ? priorPauseState.last_issue_id : null
    if (lastIssueId) {
      const { data: issueRows, error: findError } = await db().from('issues')
        .select('id, task_key, blocked_by')
        .eq('id', lastIssueId)
        .limit(1)
      const issue = !findError
        ? (issueRows as Array<{ id: string; task_key: string | null; blocked_by: string | null }> | null)?.[0]
        : undefined
      if (issue) {
        blockedIssueLabel = issue.task_key ?? issue.id
        if (issue.blocked_by === 'system:loop_breaker') {
          const { error: clearError } = await db().from('issues')
            .update({ is_blocked: false, blocked_by: null, updated_at: now })
            .eq('id', lastIssueId)
            .eq('blocked_by', 'system:loop_breaker')
          if (!clearError) {
            issueUnblocked = true
          } else {
            stillBlockedBy = `system:loop_breaker (clear failed: ${clearError.message})`
          }
        } else if (issue.blocked_by) {
          // Some other system (e.g. a ceiling stop) blocked the same issue
          // after the loop breaker did — never clear a block this route
          // doesn't own. Report it honestly instead of a blanket "recovered".
          stillBlockedBy = issue.blocked_by
        }
      }
    }
  }

  const message = paused
    ? `Agent '${agentId}' has been manually paused.`
    : stillBlockedBy
      ? `Agent '${agentId}' un-paused, but issue ${blockedIssueLabel ?? ''} is still blocked by ${stillBlockedBy} — not re-dispatchable.`
      : issueUnblocked
        ? `Agent '${agentId}' has been un-paused. Consecutive failure counter reset; issue ${blockedIssueLabel} unblocked and re-dispatchable.`
        : `Agent '${agentId}' has been un-paused. Consecutive failure counter reset.`

  return NextResponse.json({
    ok: !breakerResetError,
    agent: agentId,
    is_paused: paused,
    updated_at: now,
    message,
    ...(breakerResetError ? { error: `failure counter reset failed: ${breakerResetError}` } : {}),
    ...(!paused ? { issue_unblocked: issueUnblocked, still_blocked_by: stillBlockedBy } : {}),
  })
}

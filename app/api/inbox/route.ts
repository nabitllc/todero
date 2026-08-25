// TOD-762: inbox_requests API route — GET list, POST create, PATCH resolve
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/hub-client'
import type { DbAdapter, DbRow } from '@/lib/db'
import { dbUnavailableResponse, dbQueryErrorResponse } from '@/lib/db-http'

// ── Round-3 fix: a decision with no consequence is theatre ──────────────────
//
// PATCH used to write the status row and stop. No agent ever waits on an
// approval (requestApproval() in lib/inbox.ts has zero callers), and the two
// real producers — lib/loop-breaker.ts (`loop_breaker_pause`) and
// lib/agent-budget.ts (`ceiling_stop`) — leave the agent exactly as stopped
// no matter what the operator clicks, because nothing downstream of the
// status write ever touches the thing that actually stopped it
// (agent_memory.is_paused, or the issue's is_blocked/blocked_by). So the
// Approve/Deny buttons rendered a clean success while changing nothing.
//
// This map dispatches the real consequence, keyed on the row's `type`, in
// the same request that records the decision — and the outcome (what
// actually happened, not what the human typed) is what gets persisted and
// shown back. A `type` with no entry here gets no automated consequence, and
// the UI must not render a button that implies one (see InboxTab.tsx /
// InboxDrawer.tsx: unregistered types get "Acknowledge", not Approve/Deny).

export interface InboxEffectOutcome {
  /** What was actually attempted — 'none' when the decision itself has no consequence (denied/no handler). */
  effect: string
  ok: boolean
  /** Human-readable — includes the failure message when the effect threw. */
  detail: string
}

interface InboxEffectArgs {
  db: DbAdapter
  /** true only for status === 'approved'. denied/explained/timeout all take the non-approval branch. */
  approved: boolean
  status: string
  agentId: string | null
  taskKey: string | null
  requestContext: DbRow
  /** Whatever the operator typed in the modal (e.g. a deny reason) — folded into `detail`, never dropped. */
  humanInput: unknown
}

type InboxEffectHandler = (args: InboxEffectArgs) => Promise<InboxEffectOutcome>

/** Pulls `{ reason }` out of the modal's typed payload, if present. */
function humanReasonText(humanInput: unknown): string | null {
  if (humanInput && typeof humanInput === 'object' && !Array.isArray(humanInput)) {
    const r = (humanInput as Record<string, unknown>).reason
    if (typeof r === 'string' && r.trim()) return r.trim()
  }
  return null
}

/** Shared "nothing released" outcome for denied/explained/timeout, on any effect type. */
function nonApprovalOutcome(status: string, humanInput: unknown, stateWord: string): InboxEffectOutcome {
  const reason = humanReasonText(humanInput)
  const base = `${status} — agent remains ${stateWord}`
  return { effect: 'none', ok: true, detail: reason ? `${base} (${reason})` : base }
}

const INBOX_EFFECTS: Record<string, InboxEffectHandler> = {
  // lib/loop-breaker.ts pauseAgent() does TWO things when it trips: writes
  // agent_memory.is_paused={paused:true} (the flag PATCH /api/run-agent's
  // isAgentPaused() gate checks) AND sets issues.is_blocked=true,
  // blocked_by='system:loop_breaker' on the failing issue (lib/loop-breaker.ts
  // pauseAgent(), ~line 114) so main can triage it. Approving must undo BOTH
  // halves — exactly like ceiling_stop below undoes both its agent_memory
  // marker and its issue block — or the agent comes back un-paused with
  // nothing to dispatch, which is a half-consequence reported as a full one.
  async loop_breaker_pause({ db, approved, status, agentId, requestContext, humanInput }) {
    if (!approved) return nonApprovalOutcome(status, humanInput, 'paused')
    if (!agentId) {
      return { effect: 'agent_unpause', ok: false, detail: 'no agent id on this request — nothing to un-pause' }
    }
    const now = new Date().toISOString()
    try {
      // onConflict: 'agent_id,key' is load-bearing, not decoration. Verified
      // live against the real database: agent_memory's actual uniqueness is
      // UNIQUE(agent_id, key) (it predates the migrations directory — see
      // migrations/016_agent_documents.sql's note), not its `id` primary
      // key. Every existing upsert in the codebase (lib/loop-breaker.ts,
      // PATCH /api/agent-pause) omits onConflict, so the SDK defaults to the
      // primary key, does a bare INSERT on a row that already exists, and
      // throws "duplicate key value violates ... agent_memory_agent_id_key_key".
      // PATCH /api/agent-pause never checks its upsert's error, so it was
      // observed live reporting `{ok:true, is_paused:false}` while the row
      // underneath stayed unchanged (paused:true) — an armed control that
      // silently does nothing is the exact defect this piece exists to
      // remove, so it is not enough to just call that pattern; it has to be
      // called correctly. Sequential (not Promise.all) because two upserts
      // fired concurrently against the same adapter connection were also
      // observed to throw spuriously even with onConflict correct.
      const unpause = await db.from('agent_memory').upsert({
        agent_id: agentId,
        key: 'is_paused',
        value: { paused: false, paused_at: null, reason: null, cleared_at: now, cleared_by: 'inbox_approval' },
        updated_at: now,
      }, { onConflict: 'agent_id,key' })
      if (unpause.error) throw new Error(unpause.error.message)
      const resetBreaker = await db.from('agent_memory').upsert({
        agent_id: agentId,
        key: 'loop_breaker',
        value: { consecutive_failures: 0, last_failure_at: now },
        updated_at: now,
      }, { onConflict: 'agent_id,key' })
      if (resetBreaker.error) throw new Error(resetBreaker.error.message)

      // Second half: clear the issue block pauseAgent() set. `last_issue_id`
      // is the issues.id UUID (lib/loop-breaker.ts pauseAgent() writes it
      // straight from recordAgentFailure's `issueId` param, not a display
      // key) — see the identical `context.last_issue_id` write in
      // lib/loop-breaker.ts's inbox insert.
      const lastIssueId = typeof requestContext.last_issue_id === 'string' ? requestContext.last_issue_id : null
      if (!lastIssueId) {
        return { effect: 'agent_unpause', ok: true, detail: `agent '${agentId}' un-paused (request carried no issue — nothing to unblock)` }
      }
      const { data: issueRows, error: findError } = await db.from('issues')
        .select('id, task_key, blocked_by')
        .eq('id', lastIssueId)
        .limit(1)
      if (findError) throw new Error(findError.message)
      const issue = (issueRows as Array<{ id: string; task_key: string | null; blocked_by: string | null }> | null)?.[0]
      if (!issue) {
        return { effect: 'agent_unpause', ok: true, detail: `agent '${agentId}' un-paused (issue ${lastIssueId} not found — nothing to unblock)` }
      }
      const issueLabel = issue.task_key ?? issue.id
      // Guard on blocked_by so we never clear a block some other system
      // owns (e.g. ceiling_stop blocked the same issue after the loop
      // breaker did) — matches the WHERE-clause guard on the update itself.
      if (issue.blocked_by !== 'system:loop_breaker') {
        return {
          effect: 'agent_unpause',
          ok: false,
          detail: `agent '${agentId}' un-paused; issue ${issueLabel} is still blocked by ${issue.blocked_by ?? 'unknown'} — not re-dispatchable`,
        }
      }
      const { error: clearError } = await db.from('issues')
        .update({ is_blocked: false, blocked_by: null, updated_at: now })
        .eq('id', lastIssueId)
        .eq('blocked_by', 'system:loop_breaker')
      if (clearError) throw new Error(clearError.message)
      return { effect: 'agent_unpause', ok: true, detail: `agent '${agentId}' un-paused; issue ${issueLabel} unblocked and re-dispatchable` }
    } catch (err) {
      return { effect: 'agent_unpause', ok: false, detail: `un-pause failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  },

  // lib/agent-budget.ts stopRun() marks the issue is_blocked=true,
  // blocked_by='system:ceiling_stop:<ceiling>' — that is the actual gate
  // (app/api/run-agent/route.ts skips any is_blocked issue for a normal
  // agent). Approving must clear it on the specific issue named by the
  // request's task_key, or the "re-dispatchable" agent has nothing to pick
  // up. Also clears the agent_memory.ceiling_stop display marker.
  async ceiling_stop({ db, approved, status, agentId, taskKey, humanInput }) {
    if (!approved) return nonApprovalOutcome(status, humanInput, 'stopped')
    const now = new Date().toISOString()
    try {
      if (agentId) {
        // onConflict required — see the identical note in loop_breaker_pause above.
        const { error } = await db.from('agent_memory').upsert({
          agent_id: agentId,
          key: 'ceiling_stop',
          value: { cleared: true, cleared_at: now, cleared_by: 'inbox_approval' },
          updated_at: now,
        }, { onConflict: 'agent_id,key' })
        if (error) throw new Error(error.message)
      }
      if (!taskKey) {
        return { effect: 'ceiling_clear', ok: true, detail: 'ceiling marker cleared (request carried no task_key — no issue to unblock)' }
      }
      const { data: issues, error: findError } = await db.from('issues').select('id').eq('task_key', taskKey).limit(1)
      if (findError) throw new Error(findError.message)
      const issueId = (issues as Array<{ id: string }> | null)?.[0]?.id
      if (!issueId) {
        return { effect: 'ceiling_clear', ok: true, detail: `ceiling marker cleared (issue ${taskKey} not found — nothing to unblock)` }
      }
      const { error: clearError } = await db.from('issues')
        .update({ is_blocked: false, blocked_by: null, updated_at: now })
        .eq('id', issueId)
      if (clearError) throw new Error(clearError.message)
      return { effect: 'ceiling_clear', ok: true, detail: `ceiling marker cleared; issue ${taskKey} unblocked and re-dispatchable` }
    } catch (err) {
      return { effect: 'ceiling_clear', ok: false, detail: `clear failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  },
}

/**
 * Dispatch the real consequence of a decision, and return what actually
 * happened. Never throws — an effect handler that throws is caught and
 * turned into `{ ok: false, detail: <the throw message> }` so a broken
 * effect still records honestly rather than 500ing the whole PATCH.
 */
async function runInboxEffect(
  db: DbAdapter,
  row: DbRow,
  status: string,
  humanInput: unknown,
): Promise<InboxEffectOutcome> {
  const type = typeof row.type === 'string' ? row.type : ''
  const handler = INBOX_EFFECTS[type]
  if (!handler) {
    const inputNote = humanInput !== undefined ? ` — input recorded: ${JSON.stringify(humanInput).slice(0, 200)}` : ''
    return { effect: 'none', ok: true, detail: `no automated effect registered for request type "${type || 'unknown'}"; recorded as ${status} only${inputNote}` }
  }
  const requestContext: DbRow = (row.context && typeof row.context === 'object' && !Array.isArray(row.context))
    ? row.context as DbRow
    : {}
  const agentId = typeof row.agent === 'string' && row.agent
    ? row.agent
    : (typeof requestContext.agent_id === 'string' ? requestContext.agent_id : null)
  const taskKey = typeof requestContext.task_key === 'string' ? requestContext.task_key : null
  try {
    return await handler({
      db, approved: status === 'approved', status, agentId, taskKey, requestContext, humanInput,
    })
  } catch (err) {
    return { effect: type, ok: false, detail: `effect threw: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/** GET /api/inbox?status=pending — list inbox requests */
export async function GET(req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const url = new URL(req.url)
  const status = url.searchParams.get('status')
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 200)

  const db = createAdminClient()
  let query = db
    .from('inbox')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return dbQueryErrorResponse(error, 'inbox')
  return NextResponse.json(data)
}

/** POST /api/inbox — create approval request */
export async function POST(req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const body = await req.json() as {
    agent?: string
    type?: string
    context?: unknown
    expires_at?: string
    issue_id?: string
  }

  if (!body.agent || !body.type) {
    return NextResponse.json({ error: 'agent and type are required' }, { status: 400 })
  }

  // Same reasoning as PATCH below: `issue_id` shipped in migration 022, so
  // always sending `issue_id: null` broke creation on an install that has
  // only run 011 — the write named a column that doesn't exist there yet,
  // even for requests that never wanted to link an issue at all.
  const row: Record<string, unknown> = {
    agent: body.agent,
    type: body.type,
    context: body.context ?? null,
    expires_at: body.expires_at ?? null,
  }
  if (body.issue_id !== undefined) row.issue_id = body.issue_id

  const db = createAdminClient()
  let { data, error } = await db.from('inbox').insert(row).select().single()

  let issueIdDropped = false
  if (error?.code === 'PGRST204' && 'issue_id' in row) {
    issueIdDropped = true
    const { issue_id: _dropped, ...withoutIssueId } = row
    ;({ data, error } = await db.from('inbox').insert(withoutIssueId).select().single())
  }

  if (error) return dbQueryErrorResponse(error, 'inbox')
  return NextResponse.json(
    issueIdDropped
      ? { ...data, _warning: 'issue_id not persisted — database schema is missing that column (run: npm run db:migrate)' }
      : data,
    { status: 201 },
  )
}

/** PATCH /api/inbox — resolve a request (approve / deny / explain) */
export async function PATCH(req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const body = await req.json() as {
    id?: string
    status?: string
    resolved_by?: string
    response_data?: unknown
  }

  if (!body.id || !body.status) {
    return NextResponse.json({ error: 'id and status are required' }, { status: 400 })
  }

  const allowed = ['approved', 'denied', 'explained', 'timeout']
  if (!allowed.includes(body.status)) {
    return NextResponse.json(
      { error: `status must be one of: ${allowed.join(', ')}` },
      { status: 400 }
    )
  }

  // The decision itself — who, when, what status — always persists via
  // status/resolved_by/resolved_at, which have existed since migration 011.
  const updates: Record<string, unknown> = {
    status: body.status,
    resolved_by: body.resolved_by ?? 'user',
    resolved_at: new Date().toISOString(),
  }

  const db = createAdminClient()
  const { data: decidedRow, error: decideError } = await db
    .from('inbox')
    .update(updates)
    .eq('id', body.id)
    .select()
    .single()

  if (decideError) {
    // A well-formed request against an id that does not exist must be a 4xx,
    // not a 500 — `.single()` reports "0 rows" the same way whether the
    // predicate matched nothing or (in principle) too much.
    if (decideError.code === 'PGRST116') {
      return NextResponse.json({ error: 'inbox request not found' }, { status: 404 })
    }
    return dbQueryErrorResponse(decideError, 'inbox')
  }

  // ── Dispatch the consequence, in the same request ──────────────────────
  // A decision with no consequence is theatre: this is what actually un-pauses
  // an agent (loop_breaker_pause) or clears a ceiling stop and re-opens the
  // issue for pickup (ceiling_stop) — see INBOX_EFFECTS above. The outcome
  // (what really happened, including the failure message if the effect
  // threw) is what gets persisted as response_data, never the human-typed
  // reason alone.
  const outcome = await runInboxEffect(db, decidedRow as DbRow, body.status, body.response_data)

  let { data, error } = await db
    .from('inbox')
    .update({ response_data: outcome })
    .eq('id', body.id)
    .select()
    .single()

  // PGRST204: PostgREST's schema cache has no `response_data` column for
  // `inbox` — an install whose live database ran migration 011 but not 022
  // (response_data/issue_id). The decision, and the effect it dispatched,
  // already happened above regardless; only the "what happened as a result"
  // payload is unavailable to persist here. Retry without it rather than
  // losing the whole write.
  let responseDataDropped = false
  if (error?.code === 'PGRST204') {
    responseDataDropped = true
    // The payload doesn't have to be lost just because the dedicated column
    // is missing: `context` (JSONB) has existed since migration 011 on every
    // install. Read-modify-write it so "what happened as a result" survives
    // — merged in as `context.resolution.effect` — instead of being silently
    // dropped on the floor. `decidedRow` already carries the current
    // `context` from the first update above.
    const existingContext =
      decidedRow.context && typeof decidedRow.context === 'object' && !Array.isArray(decidedRow.context)
        ? (decidedRow.context as Record<string, unknown>)
        : {}
    const mergedContext = {
      ...existingContext,
      resolution: {
        by: updates.resolved_by,
        at: updates.resolved_at,
        status: body.status,
        effect: outcome,
      },
    }
    const { data: contextData, error: contextError } = await db
      .from('inbox')
      .update({ context: mergedContext })
      .eq('id', body.id)
      .select()
      .single()
    // If this second write also fails, fall through with `decidedRow` and
    // still report `_warning` below — the operator is told the payload
    // didn't persist rather than shown a false success. The effect itself
    // (the un-pause / ceiling clear) already ran either way.
    data = (!contextError && contextData) ? contextData : decidedRow
    error = null
  }

  if (error) return dbQueryErrorResponse(error, 'inbox')
  return NextResponse.json(
    responseDataDropped
      ? { ...data, _warning: 'response_data not persisted — database schema is missing that column (run: npm run db:migrate)' }
      : data,
  )
}

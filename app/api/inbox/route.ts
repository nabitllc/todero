// TOD-762: inbox_requests API route — GET list, POST create, PATCH resolve
import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/hub-client'
import type { DbAdapter, DbRow } from '@/lib/db'
import { dbUnavailableResponse, dbQueryErrorResponse } from '@/lib/db-http'
import { hasPermission, type Role } from '@/lib/rbac-types'
import { inboxDecisionActor } from './actor'
import {
  APPROVE_PERMISSION,
  DECIDE_PERMISSION,
  EFFECT_TYPES,
  approvalTarget,
  attributeDecision,
  auditRowForOutcome,
  auditRowForRefusal,
  authorizeDecision,
  issueRefsToResolve,
  preflightDecision,
  resolveRowProject,
  scopeToProject,
  type ApprovalRow,
} from '@/lib/approvals'

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
  /**
   * The issue this decision is supposed to act on, resolved by
   * `approvalTarget()` in lib/approvals.ts — the SAME function that decides
   * the approve button's label and that `lookupIssueTarget()` preflights.
   *
   * It used to be read here as `requestContext.last_issue_id` alone, while
   * `approvalTarget()` reads `context.last_issue_id ?? row.issue_id`. A row
   * linked through the `inbox.issue_id` COLUMN — a shape `POST /api/inbox`
   * accepts as first-class and has a PGRST204 retry to persist — therefore
   * got a button reading "Approve — un-pause <agent> and unblock <issue>",
   * passed the preflight, and then hit an effect handler that could not see
   * the issue at all. Measured live on 2026-08-26, before this fix, on a
   * fixture whose issue_id column was set and whose context carried no
   * last_issue_id:
   *
   *   HTTP 200, response_data.ok = true,
   *   detail "agent 'lane7-fix-agent' un-paused (request carried no issue —
   *           nothing to unblock)",
   *   audit row outcome 'applied'.
   *
   * That is precisely the "green approval for an approval that touched
   * nothing" this module's header says is now a 409. One resolver, so the
   * label, the preflight and the effect cannot disagree about what the
   * decision acts on.
   */
  issueId: string | null
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
  async loop_breaker_pause({ db, approved, status, agentId, issueId, humanInput }) {
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
      // lib/loop-breaker.ts's inbox insert. `issueId` here is that value OR
      // the `inbox.issue_id` column, resolved once by `approvalTarget()` —
      // see the field's note on InboxEffectArgs for the silent success that
      // reading only the context half produced.
      const lastIssueId = issueId
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
        // `preflightDecision()` in lib/approvals.ts already refuses this case
        // with a 409 before anything is written, so reaching here means the
        // issue was deleted BETWEEN that check and this write. Either way it
        // must not report ok:true — "un-paused (nothing to unblock)" was the
        // exact silent success the approval-surface piece exists to remove.
        return { effect: 'agent_unpause', ok: false, detail: `agent '${agentId}' un-paused, but issue ${lastIssueId} no longer exists — it was deleted mid-decision, so nothing was unblocked and the agent has nothing to pick up` }
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
        // Same reasoning as loop_breaker_pause above: the preflight refuses a
        // vanished target with a 409, so this branch is the mid-decision race
        // only — and it reports ok:false, never a clean success over a no-op.
        return { effect: 'ceiling_clear', ok: false, detail: `ceiling marker cleared, but issue ${taskKey} no longer exists — it was deleted mid-decision, so nothing was unblocked` }
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

// ── The registry and the descriptions must not drift ───────────────────────
//
// `lib/approvals.ts` is what the UI reads to label a button ("Approve —
// un-pause builder and unblock TOD-9001") and what `preflightDecision()`
// consults to decide whether approving is even permitted. This file is what
// actually dispatches. If the two key sets ever disagree, either a button
// promises an effect that cannot run, or an effect that exists is refused as
// unregistered. Both are silent until someone clicks. Fail at module load
// instead — this throws when the route file is first imported, which surfaces
// as an immediate 500 on /api/inbox rather than a wrong answer later.
{
  const dispatchable = Object.keys(INBOX_EFFECTS).sort().join(',')
  const described = [...EFFECT_TYPES].sort().join(',')
  if (dispatchable !== described) {
    throw new Error(
      `inbox effect registry drift: app/api/inbox/route.ts dispatches [${dispatchable}] ` +
      `but lib/approvals.ts describes [${described}]. Every dispatchable type must be describable, ` +
      `and every describable type must be dispatchable — otherwise a button promises what nothing will do.`,
    )
  }
}

// ── Placing a request in a project ─────────────────────────────────────────
//
// `inbox` has no project column (migrations/011_inbox.sql). A request is
// placed by `context.project` if it carries one, otherwise by the project of
// the issue it points at. This builds the id/task_key -> project map that
// `lib/approvals.ts`'s pure resolver needs, with ONE query per key shape.
// A row that resolves to nothing stays unresolvable — see scopeToProject().
async function projectsForRows(
  db: DbAdapter,
  rows: readonly ApprovalRow[],
): Promise<{ map: Map<string, string>; error: { message: string; code?: string } | null }> {
  const map = new Map<string, string>()
  const { ids, taskKeys } = issueRefsToResolve(rows)
  if (ids.length === 0 && taskKeys.length === 0) return { map, error: null }

  if (ids.length > 0) {
    const { data, error } = await db.from('issues').select('id, task_key, project').in('id', ids)
    if (error) return { map, error }
    for (const r of (data ?? []) as Array<{ id?: string; task_key?: string; project?: string }>) {
      if (r.project && r.id) map.set(r.id, r.project)
      if (r.project && r.task_key) map.set(r.task_key, r.project)
    }
  }
  if (taskKeys.length > 0) {
    const { data, error } = await db.from('issues').select('id, task_key, project').in('task_key', taskKeys)
    if (error) return { map, error }
    for (const r of (data ?? []) as Array<{ id?: string; task_key?: string; project?: string }>) {
      if (r.project && r.id) map.set(r.id, r.project)
      if (r.project && r.task_key) map.set(r.task_key, r.project)
    }
  }
  return { map, error: null }
}

/**
 * Does the issue this decision would touch still exist?
 *
 * `null` means "there was nothing to look up" — the request points at no
 * issue at all — which is different from "the issue is gone" (`false`) and is
 * why `preflightDecision()` takes a tri-state rather than a boolean.
 */
async function lookupIssueTarget(
  db: DbAdapter,
  row: ApprovalRow,
): Promise<{ issueExists: boolean | null; issueRef: string | null }> {
  const target = approvalTarget(row)
  if (!target.needsIssue) return { issueExists: null, issueRef: null }
  if (target.issueId) {
    const { data, error } = await db.from('issues').select('id').eq('id', target.issueId).limit(1)
    // A failed lookup is NOT proof the issue exists. Fail closed: report it
    // as missing so the approval is refused rather than let through on an
    // error we could not read.
    if (error) return { issueExists: false, issueRef: `${target.issueId} (lookup failed: ${error.message})` }
    return { issueExists: ((data as unknown[] | null)?.length ?? 0) > 0, issueRef: target.issueId }
  }
  if (target.taskKey) {
    const { data, error } = await db.from('issues').select('id').eq('task_key', target.taskKey).limit(1)
    if (error) return { issueExists: false, issueRef: `${target.taskKey} (lookup failed: ${error.message})` }
    return { issueExists: ((data as unknown[] | null)?.length ?? 0) > 0, issueRef: target.taskKey }
  }
  return { issueExists: null, issueRef: null }
}

/**
 * Append one row to `approval_decisions`. Best effort by design: the audit
 * write must never turn a decision that already happened into an HTTP error.
 * What it must never do is fail SILENTLY — the failure comes back so the
 * caller can put it in the response's `_warning`, where the operator sees it.
 */
async function recordDecision(db: DbAdapter, auditRow: Record<string, unknown>): Promise<string | null> {
  const { error } = await db.from('approval_decisions').insert(auditRow)
  if (!error) return null
  return `decision NOT written to the audit trail: ${error.message} (run: npm run db:migrate)`
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
  // ONE resolver for what this decision acts on. `approvalTarget()` is what
  // describeApproval() builds the button label from and what
  // lookupIssueTarget() preflights, so deriving the effect's arguments from
  // anywhere else is how a button promises an unblock the handler cannot see
  // (measured, 2026-08-26 — see InboxEffectArgs.issueId).
  const target = approvalTarget(row as unknown as ApprovalRow)
  const { agentId, issueId, taskKey } = target
  try {
    return await handler({
      db, approved: status === 'approved', status, agentId, issueId, taskKey, requestContext, humanInput,
    })
  } catch (err) {
    return { effect: type, ok: false, detail: `effect threw: ${err instanceof Error ? err.message : String(err)}` }
  }
}

/**
 * GET /api/inbox?status=pending[&project=Limiglow] — list inbox requests.
 *
 * TWO RESPONSE SHAPES, and the split is load-bearing:
 *
 *   no `project` -> a bare JSON array, byte-identical to what this route
 *     returned before the approval-surface piece. Four consumers this piece
 *     does not own read it that way (app/page.tsx's pending badge,
 *     components/InboxDrawer.tsx, components/SidebarNav.tsx,
 *     components/tabs/OverviewTab.tsx's deliberately fleet-wide "Needs you"
 *     leg). Changing the unscoped shape would break all four.
 *
 *   `project=X` -> `{ data, total, has_more, scope }`, where `scope` reports
 *     how many rows matched, how many belong to another project, and how
 *     many could not be placed at all. A row that cannot be placed is
 *     EXCLUDED, never shown "just in case" — see scopeToProject().
 */
export async function GET(req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const url = new URL(req.url)
  const status = url.searchParams.get('status')
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '50'), 200)
  const projectParam = url.searchParams.get('project')

  // `?project=` with an empty value is a caller bug — most likely a template
  // that interpolated a null scope. Answering the whole fleet for it would
  // be exactly the silent widening this piece exists to prevent, so it is a
  // 400 that says which parameter was empty.
  if (projectParam !== null && !projectParam.trim()) {
    return NextResponse.json(
      { error: 'project= was given but empty. Omit the parameter for a fleet-wide list, or pass a project name.' },
      { status: 400 },
    )
  }

  const db = createAdminClient()
  let query = db
    .from('inbox')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return dbQueryErrorResponse(error, 'inbox')

  if (projectParam === null) return NextResponse.json(data)

  const rows = (data ?? []) as ApprovalRow[]
  const { map, error: lookupError } = await projectsForRows(db, rows)
  // A failed issue lookup means nothing can be placed. Say so instead of
  // returning a confidently-empty scoped list.
  if (lookupError) return dbQueryErrorResponse(lookupError, 'issues')

  const scoped = scopeToProject(rows, projectParam.trim(), map)
  return NextResponse.json({
    data: scoped.rows,
    total: scoped.rows.length,
    has_more: rows.length >= limit,
    scope: scoped.scope,
    // What THIS session may actually do with the rows above.
    //
    // The surface used to render an Approve button to every caller and find
    // out what happened only after the click. Now that PATCH refuses a role
    // without `settings:write`, a read-only session was being offered a
    // control guaranteed to 403 — an offered action that fails. This block
    // is the server's own answer, resolved by the SAME function the decision
    // route authorises with, so the UI cannot disagree with the gate about
    // who may decide.
    //
    // It is deliberately NOT on the unscoped array response: that shape has
    // four consumers this piece does not own (see the note above).
    decide: decideRights(req),
  })
}

/** What the calling session may do with a decision, from the server's own
 *  role resolution — not from anything the client sent. */
function decideRights(req: NextRequest): {
  role: Role | null
  can_record: boolean
  can_approve: boolean
  ignored_role_claim: string | null
} {
  const actor = inboxDecisionActor(req, null)
  return {
    role: actor.role,
    can_record: !!actor.role && hasPermission(actor.role, DECIDE_PERMISSION),
    can_approve: !!actor.role && hasPermission(actor.role, APPROVE_PERMISSION),
    ignored_role_claim: actor.ignoredClaim,
  }
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

  const db = createAdminClient()

  // ── Who is deciding ─────────────────────────────────────────────────────
  // `decidedBy` used to be `body.resolved_by ?? 'user'` — the caller's own
  // unchecked claim, which is how a live PATCH signed
  // "definitely-not-a-human-bot" was accepted with a 200 and written into the
  // append-only trail verbatim. The role comes from the request now and is
  // recorded ALONGSIDE the claimed name — see attributeDecision(). Only the
  // role half is proven, and the format keeps the two halves distinguishable
  // rather than letting the claim stand alone.
  //
  // The role source is `./actor`, NOT lib/with-permission.ts's resolveRole().
  // That function accepts any valid session password and then believes the
  // client-typed `mc-role` cookie, so `mc-auth=view2026; mc-role=admin` —
  // a READ-ONLY credential — resolved to `admin` and was measured releasing a
  // paused agent with a 200. `inboxDecisionActor()` derives the role from the
  // credential and lets `mc-role` only ever narrow it. See that file's header
  // for the before/after measurement.
  const actor = inboxDecisionActor(req, body.resolved_by ?? null)
  const decidedBy = attributeDecision(actor)
  const decidedAt = new Date().toISOString()

  // ── Read before writing ─────────────────────────────────────────────────
  // The row is fetched, not updated-and-returned, because the decision has to
  // be allowed BEFORE anything is written. The old code UPDATE'd first, then
  // discovered the target was gone, then reported a clean success anyway.
  const { data: currentRow, error: readError } = await db
    .from('inbox')
    .select('*')
    .eq('id', body.id)
    .single()

  if (readError) {
    // A well-formed request against an id that does not exist must be a 4xx,
    // not a 500 — `.single()` reports "0 rows" the same way whether the
    // predicate matched nothing or (in principle) too much.
    if (readError.code === 'PGRST116') {
      return NextResponse.json({ error: 'inbox request not found' }, { status: 404 })
    }
    return dbQueryErrorResponse(readError, 'inbox')
  }

  const requestRow = currentRow as ApprovalRow

  // Placing the request in a project, for the audit row. Best effort: an
  // unplaceable request records project=null rather than a guess. Resolved
  // BEFORE the two refusal gates below so a refused attempt is filed against
  // the same project a permitted one would have been.
  const { map: projectMap } = await projectsForRows(db, [requestRow])
  const requestProject = resolveRowProject(requestRow, projectMap)

  /** Record a refusal in the append-only trail and answer with it. Nothing is
   *  written to `inbox` — the request stays exactly as pending as it was. */
  const refuse = async (
    refusal: { code: string; httpStatus: number; reason: string },
    extra: Record<string, unknown> = {},
  ) => {
    const auditWarning = await recordDecision(db, auditRowForRefusal({
      row: requestRow,
      decision: body.status as string,
      refusal,
      humanInput: body.response_data,
      project: requestProject,
      decidedBy,
      decidedAt,
    }) as unknown as Record<string, unknown>)
    return NextResponse.json(
      {
        error: refusal.reason,
        code: refusal.code,
        inbox_id: requestRow.id,
        // The request is deliberately untouched — say so, or the operator has
        // to guess whether their click half-landed.
        request_status: requestRow.status,
        ...extra,
        ...(auditWarning ? { _warning: auditWarning } : {}),
      },
      { status: refusal.httpStatus },
    )
  }

  // ── Refused when the actor is not allowed to make it ────────────────────
  // Three refusals, and all three are recorded rather than merely returned:
  //   * no role on the request at all (nothing to attribute the decision to)
  //   * a role without issues:write (cannot record any decision)
  //   * a role without settings:write attempting to APPROVE — the split that
  //     makes "an agent files; you approve" enforced rather than described
  //   * an approval signed in the name of the very agent that filed it
  // This runs BEFORE the fail-closed preflight because a caller who may not
  // decide at all should not learn whether the target issue still exists.
  const authorized = authorizeDecision({ actor, row: requestRow, decision: body.status })
  if (!authorized.ok) {
    // A refusal that arrived because the caller ASKED for a role it does not
    // hold has to say so, or the operator reads "role: viewer" and cannot tell
    // it apart from a plain read-only session. The sentence goes into
    // `reason`, so it lands in the append-only trail's `detail` too — an
    // attempted escalation that is only visible in an HTTP response the
    // attacker receives is not recorded anywhere that matters.
    const escalation = actor.ignoredClaim
      ? ` The request also asked to act as "${actor.ignoredClaim}" via the mc-role cookie; that cookie can only narrow the role its credential proves, never widen it, so it was ignored.`
      : ''
    return refuse(
      { ...authorized, reason: authorized.reason + escalation },
      {
        role: actor.role ?? 'unauthenticated',
        ...(actor.ignoredClaim ? { ignored_role_claim: actor.ignoredClaim } : {}),
        ...(authorized.required ? { required: authorized.required } : {}),
      },
    )
  }

  // ── Fail closed ─────────────────────────────────────────────────────────
  // Three refusals, all of which previously read as clean successes:
  //   * the issue this approval would unblock has been deleted
  //   * the request type has no effect anything can dispatch
  //   * the request was already decided, and a second PATCH would overwrite
  //     the first decision and its author
  // A refusal writes NOTHING to `inbox` — the request stays pending — and
  // writes one `approval_decisions` row so the attempt is not a silence.
  const targetLookup = await lookupIssueTarget(db, requestRow)
  const preflight = preflightDecision({
    row: requestRow,
    decision: body.status,
    lookup: targetLookup,
  })

  if (!preflight.ok) return refuse(preflight)

  // The decision itself — who, when, what status — always persists via
  // status/resolved_by/resolved_at, which have existed since migration 011.
  const updates: Record<string, unknown> = {
    status: body.status,
    resolved_by: decidedBy,
    resolved_at: decidedAt,
  }

  // `.eq('status', 'pending')` is the concurrency half of the ALREADY_RESOLVED
  // guard above: two operators clicking at once would both pass the preflight
  // read, and without this predicate the second write would still overwrite
  // the first decision. With it, the loser matches zero rows and gets the
  // same 409 as anyone else arriving late.
  const { data: decidedRow, error: decideError } = await db
    .from('inbox')
    .update(updates)
    .eq('id', body.id)
    .eq('status', 'pending')
    .select()
    .single()

  if (decideError) {
    if (decideError.code === 'PGRST116') {
      return NextResponse.json(
        {
          error: 'This request stopped being pending between reading it and deciding it — someone else decided it first. Nothing was overwritten.',
          code: 'ALREADY_RESOLVED',
          inbox_id: requestRow.id,
        },
        { status: 409 },
      )
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

  // ── The append-only record ─────────────────────────────────────────────
  // `inbox` holds current state and is overwritable; this is the row that
  // survives. `outcome` is derived from what the effect REPORTED — an effect
  // that came back `ok:false` records `failed`, not `applied`, so an
  // approval that did not take effect cannot read back later as one that did.
  const auditWarning = await recordDecision(db, auditRowForOutcome({
    row: requestRow,
    decision: body.status,
    effect: outcome,
    humanInput: body.response_data,
    project: requestProject,
    decidedBy,
    decidedAt,
  }) as unknown as Record<string, unknown>)

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

  // Two independent things can degrade without failing the decision: the
  // response_data column being absent, and the audit insert failing. Both
  // are reported; neither is allowed to be silent.
  const warnings = [
    responseDataDropped
      ? 'response_data not persisted — database schema is missing that column (run: npm run db:migrate)'
      : null,
    auditWarning,
  ].filter((w): w is string => !!w)

  return NextResponse.json(
    warnings.length > 0 ? { ...data, _warning: warnings.join(' · ') } : data,
  )
}

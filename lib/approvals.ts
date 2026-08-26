// lib/approvals.ts — approval-surface piece (Wave 6)
//
// The pure half of the human-in-the-loop. No I/O, no database handle, no
// React: every function here takes plain data and returns plain data, which
// is what makes `lib/__tests__/approvals.test.ts` able to prove the refusals
// rather than assert them in a comment.
//
// WHAT THIS EXISTS TO FIX (see docs/rebuild/pieces/pieces6/approval-surface.md)
//
//   * An approve button that does not say what it approves is worse than no
//     button. `describeApproval()` is the single place that turns a row into
//     the four things a human needs before deciding: what is being asked, by
//     whom, what approval does, and what refusal leaves in place. The API and
//     the UI read the SAME registry, so a button label cannot drift from the
//     effect the server will actually dispatch.
//
//   * Fail closed. `preflightDecision()` decides whether a decision may be
//     recorded AT ALL, before anything is written. Before this piece,
//     `app/api/inbox/route.ts`'s effect handlers answered
//     `{ ok: true, detail: 'issue … not found — nothing to unblock' }` — a
//     green approval for an approval that touched nothing. That is the exact
//     shape of a silent success, and it is now a 409.
//
//   * Scope refuses rather than widens. `resolveRowProject()` returns null
//     when a request cannot be tied to a project, and `scopeToProject()`
//     EXCLUDES those rows from a project-scoped answer instead of falling
//     back to showing them. A request that cannot be placed is reported as
//     unresolvable, never quietly attributed to the project you happen to be
//     looking at.

import { ROLE_PERMISSIONS, hasPermission, type Permission, type Role } from '@/lib/rbac-types'

/** The statuses `inbox.status` is allowed to hold (migration 022's CHECK). */
export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'explained' | 'timeout'

/** The subset of an inbox row this module reads. Extra columns are ignored. */
export interface ApprovalRow {
  id: string
  agent: string | null
  type: string | null
  context: Record<string, unknown> | null
  status: string | null
  issue_id?: string | null
  resolved_by?: string | null
  resolved_at?: string | null
}

/** What a decision on a row must still be able to act on. */
export interface ApprovalTarget {
  /** Agent the request came from, or null when the row carries none. */
  agentId: string | null
  /** `issues.id` this decision would unblock, when the request carries one. */
  issueId: string | null
  /** `issues.task_key` this decision would unblock, when the request carries one. */
  taskKey: string | null
  /** True when approving is supposed to touch an issue at all. */
  needsIssue: boolean
}

/** Everything the surface must show before a human can decide. */
export interface ApprovalDescription {
  /** The one question this item asks. */
  question: string
  /** Which agent is asking. Never blank — falls back to a named unknown. */
  agent: string
  /** Exactly what approving does. */
  ifApproved: string
  /** Exactly what refusing leaves in place. */
  ifRefused: string
  /** Button label naming the consequence, or null when there is no approve
   *  button to render because approving would do nothing. */
  approveLabel: string | null
  /** Button label for the refusal path. Always present — refusing is always
   *  a legitimate answer, including for a type with no automated effect. */
  refuseLabel: string
  /** Label for the second, confirming click once a reason has been typed.
   *  Its own string rather than `Confirm — ${refuseLabel}`, which composed
   *  into the double-dashed "Confirm — Refuse — leave it stopped". */
  confirmRefuseLabel: string
  /** Whether `app/api/inbox/route.ts`'s INBOX_EFFECTS has a handler for this type. */
  hasRegisteredEffect: boolean
}

/**
 * The registry. One entry per request type that `INBOX_EFFECTS` in
 * `app/api/inbox/route.ts` can actually dispatch. Keeping the two keyed on
 * the same strings is the point: `EFFECT_TYPES` below is exported so the
 * route can assert the two sets agree at module load rather than drifting.
 */
interface ApprovalKind {
  /** Human phrase for the type, used to build the question. */
  asks: (t: ApprovalTarget) => string
  approved: (t: ApprovalTarget) => string
  refused: (t: ApprovalTarget) => string
  approveLabel: (t: ApprovalTarget) => string
  /** Does approving this type touch an issue row? */
  touchesIssue: (t: ApprovalTarget) => boolean
  /** Does approving this type require an agent id? */
  requiresAgent: boolean
}

/** Short label for whatever issue a request points at, for use in a sentence. */
function issueLabel(t: ApprovalTarget): string {
  return t.taskKey ?? t.issueId ?? 'its issue'
}

function agentLabel(t: ApprovalTarget): string {
  return t.agentId ?? 'an unnamed agent'
}

const APPROVAL_KINDS: Record<string, ApprovalKind> = {
  // lib/loop-breaker.ts pauseAgent() writes agent_memory.is_paused AND sets
  // issues.is_blocked / blocked_by='system:loop_breaker' on the failing
  // issue. Approving undoes both halves — so the label has to name both, or
  // it is describing half of what the button does.
  loop_breaker_pause: {
    requiresAgent: true,
    touchesIssue: t => !!t.issueId,
    asks: t =>
      `${agentLabel(t)} failed repeatedly and the loop breaker paused it. May it start again?`,
    approved: t =>
      t.issueId
        ? `Clears agent_memory.is_paused for ${agentLabel(t)}, resets its failure counter, and clears the system:loop_breaker block on ${issueLabel(t)} so it is dispatchable again.`
        : `Clears agent_memory.is_paused for ${agentLabel(t)} and resets its failure counter. This request carries no issue, so nothing is unblocked.`,
    refused: t =>
      `${agentLabel(t)} stays paused and will not be dispatched. ${t.issueId ? `${issueLabel(t)} stays blocked by system:loop_breaker.` : 'No issue is affected.'} Your reason is recorded.`,
    approveLabel: t =>
      t.issueId
        ? `Approve — un-pause ${agentLabel(t)} and unblock ${issueLabel(t)}`
        : `Approve — un-pause ${agentLabel(t)}`,
  },

  // lib/agent-budget.ts stopRun() sets issues.is_blocked=true,
  // blocked_by='system:ceiling_stop:<ceiling>'. That block is the actual gate
  // app/api/run-agent/route.ts checks.
  ceiling_stop: {
    requiresAgent: false,
    touchesIssue: t => !!t.taskKey,
    asks: t =>
      `${agentLabel(t)} hit a spend or time ceiling on ${issueLabel(t)} and was stopped. May it keep going?`,
    approved: t =>
      t.taskKey
        ? `Clears the ceiling_stop marker${t.agentId ? ` for ${agentLabel(t)}` : ''} and unblocks ${issueLabel(t)} so it can be picked up again — the run resumes and keeps spending.`
        : `Clears the ceiling_stop marker${t.agentId ? ` for ${agentLabel(t)}` : ''}. This request names no issue, so nothing is unblocked.`,
    refused: t =>
      `The stop stands. ${t.taskKey ? `${issueLabel(t)} stays blocked and no further spend happens on it.` : 'No issue is affected.'} Your reason is recorded.`,
    approveLabel: t =>
      t.taskKey
        ? `Approve — clear the ceiling and unblock ${issueLabel(t)}`
        : `Approve — clear the ceiling stop`,
  },
}

/**
 * The registered kind for a request type, or undefined.
 *
 * WHY THIS IS NOT `APPROVAL_KINDS[type]`. `APPROVAL_KINDS` is an object
 * literal, so it inherits `Object.prototype`, and `row.type` is a free-text
 * column any caller can fill: `APPROVAL_KINDS['constructor']` is the `Object`
 * constructor — truthy — and the very next line calls `kind.touchesIssue(...)`
 * on it, which is a TypeError, which is an empty HTTP 500.
 *
 * MEASURED on the running dev server, 2026-08-26, before this helper existed:
 *
 *     POST /api/inbox {"agent":"…","type":"constructor",…}   -> HTTP 201
 *     GET  /api/inbox?project=Limiglow                       -> HTTP 500 (empty body)
 *     PATCH /api/inbox {id, status:"approved"}                -> HTTP 500 (empty body)
 *
 * That is a denial of service on the whole approval surface, planted by one
 * accepted request: while that single row existed, NOBODY could load the
 * project's approval queue, including to delete it through this API. It
 * cleared the moment the row was removed (verified: 200 again). One own-key
 * check is the difference between "an unknown type is refused with a 422 that
 * names it" and "the queue is gone".
 */
function kindFor(type: string | null | undefined): ApprovalKind | undefined {
  if (!type) return undefined
  return Object.prototype.hasOwnProperty.call(APPROVAL_KINDS, type)
    ? APPROVAL_KINDS[type]
    : undefined
}

/** Request types with a registered, dispatchable consequence. */
export const EFFECT_TYPES: readonly string[] = Object.keys(APPROVAL_KINDS)

/** True when approving this type can actually cause something to happen. */
export function hasRegisteredEffect(type: string | null | undefined): boolean {
  return !!type && Object.prototype.hasOwnProperty.call(APPROVAL_KINDS, type)
}

function contextOf(row: ApprovalRow): Record<string, unknown> {
  const c = row.context
  return c && typeof c === 'object' && !Array.isArray(c) ? c : {}
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

/**
 * What a decision on this row would have to act on.
 *
 * Mirrors exactly how `app/api/inbox/route.ts` resolves its handler args —
 * `row.agent` then `context.agent_id`; `context.last_issue_id` for the loop
 * breaker; `context.task_key` for the ceiling stop — so the preflight checks
 * the same target the effect will later touch, not a differently-derived one.
 */
export function approvalTarget(row: ApprovalRow): ApprovalTarget {
  const ctx = contextOf(row)
  const agentId = str(row.agent) ?? str(ctx.agent_id)
  const issueId = str(ctx.last_issue_id) ?? str(row.issue_id)
  const taskKey = str(ctx.task_key)
  const kind = kindFor(row.type)
  const base: ApprovalTarget = { agentId, issueId, taskKey, needsIssue: false }
  return { ...base, needsIssue: kind ? kind.touchesIssue(base) : false }
}

/**
 * The four things a human needs before deciding, plus the button labels.
 *
 * A type with no registered effect gets `approveLabel: null` on purpose: the
 * caller must render no approve button at all rather than one that resolves
 * to "recorded as approved, nothing happened".
 */
export function describeApproval(row: ApprovalRow): ApprovalDescription {
  const target = approvalTarget(row)
  const type = row.type ?? ''
  const kind = kindFor(type)
  const agent = target.agentId ?? 'an unnamed agent'

  if (!kind) {
    const shown = type || 'an untyped request'
    return {
      question: `${agent} filed "${shown}" and it is waiting on you.`,
      agent,
      ifApproved: `Nothing. There is no automated effect registered for "${shown}", so approving would file a decision that changes nothing in the system — this surface refuses it rather than showing you a green tick for a no-op.`,
      ifRefused: `The request is filed as acknowledged with your note. Nothing in the system changes either way — this type has no automated effect.`,
      approveLabel: null,
      refuseLabel: 'Acknowledge and file',
      confirmRefuseLabel: 'Confirm — file the acknowledgement',
      hasRegisteredEffect: false,
    }
  }

  return {
    question: kind.asks(target),
    agent,
    ifApproved: kind.approved(target),
    ifRefused: kind.refused(target),
    approveLabel: kind.approveLabel(target),
    refuseLabel: 'Refuse — leave it stopped',
    confirmRefuseLabel: `Confirm — ${agent} stays stopped`,
    hasRegisteredEffect: true,
  }
}

// ─── Fail closed ────────────────────────────────────────────────────────────

/** Existence facts the caller looked up, handed to the pure preflight. */
export interface TargetLookup {
  /** true / false when the row's issue was looked up; null when there was no
   *  issue to look up (the request carries none). */
  issueExists: boolean | null
  /** How the issue was addressed, for the refusal message. */
  issueRef?: string | null
}

export type PreflightRefusalCode =
  | 'ALREADY_RESOLVED'
  | 'NO_REGISTERED_EFFECT'
  | 'TARGET_MISSING'
  | 'NO_AGENT'
  | 'UNKNOWN_STATUS'

export type PreflightResult =
  | { ok: true }
  | { ok: false; code: PreflightRefusalCode; httpStatus: number; reason: string }

const DECIDABLE: readonly string[] = ['approved', 'denied', 'explained', 'timeout']

/**
 * May this decision be recorded at all?
 *
 * Called BEFORE anything is written, so a refusal leaves the request pending
 * — the operator can come back to it once the world is consistent again,
 * instead of finding it marked approved with nothing done.
 *
 * The asymmetry between approval and refusal is deliberate and is the whole
 * safety property: approving is the action that *releases* an agent, so it
 * has to clear every gate. Denying/acknowledging only ever leaves things
 * stopped, so it is permitted on any pending row, including a type with no
 * registered effect and a row whose issue has since been deleted.
 *
 * NOT CHECKED, and deliberately so: whether the agent exists. `inbox.agent`
 * is a free-text column, not a foreign key (see migrations/011_inbox.sql), so
 * there is no table this could consult without inventing a registry that does
 * not exist. What IS checked is that an effect requiring an agent has a
 * non-empty agent id to act on.
 */
export function preflightDecision(args: {
  row: ApprovalRow
  decision: string
  lookup: TargetLookup
}): PreflightResult {
  const { row, decision, lookup } = args

  if (!DECIDABLE.includes(decision)) {
    return {
      ok: false,
      code: 'UNKNOWN_STATUS',
      httpStatus: 400,
      reason: `"${decision}" is not a decision this surface can record — expected one of: ${DECIDABLE.join(', ')}.`,
    }
  }

  // Already decided. The inbox row is mutated in place, so a second PATCH
  // used to silently overwrite the first decision and its resolved_by. An
  // audit trail you can overwrite is not an audit trail.
  if (row.status && row.status !== 'pending') {
    const who = row.resolved_by ?? 'someone'
    const when = row.resolved_at ?? 'an unrecorded time'
    return {
      ok: false,
      code: 'ALREADY_RESOLVED',
      httpStatus: 409,
      reason: `This request was already decided: ${row.status} by ${who} at ${when}. Re-deciding would overwrite that record, so it is refused.`,
    }
  }

  // Everything below only constrains APPROVAL. Refusal is always safe.
  if (decision !== 'approved') return { ok: true }

  const type = row.type ?? ''
  const kind = kindFor(type)
  if (!kind) {
    return {
      ok: false,
      code: 'NO_REGISTERED_EFFECT',
      httpStatus: 422,
      reason: `No automated effect is registered for request type "${type || 'unknown'}", so an approval here would change nothing. Refused rather than recorded as an approval that did nothing. Acknowledge it instead (status: explained), or register an effect for this type.`,
    }
  }

  const target = approvalTarget(row)

  if (kind.requiresAgent && !target.agentId) {
    return {
      ok: false,
      code: 'NO_AGENT',
      httpStatus: 409,
      reason: `Approving "${type}" un-pauses an agent, and this request carries no agent id (inbox.agent and context.agent_id are both empty). There is nothing to release, so it is refused.`,
    }
  }

  // The fail-closed case this piece exists for: the request is about an
  // issue, and that issue is gone. Approving would have reported success
  // while touching nothing.
  if (target.needsIssue && lookup.issueExists === false) {
    const ref = lookup.issueRef ?? issueLabel(target)
    return {
      ok: false,
      code: 'TARGET_MISSING',
      httpStatus: 409,
      reason: `The issue this approval would unblock (${ref}) no longer exists. Approving would report success while changing nothing, so it is refused and the request stays pending.`,
    }
  }

  return { ok: true }
}

// ─── Project scope ──────────────────────────────────────────────────────────

/**
 * The project a request belongs to, or null when it cannot be established.
 *
 * `inbox` has no project column (migrations/011_inbox.sql), so a request is
 * placed by, in order: an explicit `context.project`, then the project of the
 * issue it points at — which the caller must have looked up and passed in as
 * `projectByIssueKey`. Nothing else. Returning null is a real answer, not a
 * failure: the caller must exclude the row, not guess.
 */
export function resolveRowProject(
  row: ApprovalRow,
  projectByIssueKey: ReadonlyMap<string, string>,
): string | null {
  const ctx = contextOf(row)
  const explicit = str(ctx.project)
  if (explicit) return explicit
  const target = approvalTarget(row)
  for (const key of [target.issueId, target.taskKey]) {
    if (key) {
      const p = projectByIssueKey.get(key)
      if (p) return p
    }
  }
  return null
}

export interface ScopeCounts {
  project: string
  /** Rows that resolve to `project`. */
  matched: number
  /** Rows that resolve to a DIFFERENT project. */
  other_project: number
  /** Rows whose project could not be established at all. */
  unresolvable: number
}

export interface ScopedRows<T> {
  rows: T[]
  scope: ScopeCounts
}

/**
 * Split rows into the ones belonging to `project` and the ones that do not,
 * counting the unplaceable ones separately.
 *
 * Unresolvable rows are EXCLUDED, never included "just in case". Widening a
 * scope on ambiguity is how a decision meant for one business gets made
 * while looking at another. The count is returned so the surface can say
 * "3 requests could not be placed" instead of hiding them without a trace.
 *
 * Case-insensitive on the project name: `projects.id` is 'Limiglow' while
 * the URL segment is 'limiglow'.
 */
export function scopeToProject<T extends ApprovalRow>(
  rows: readonly T[],
  project: string,
  projectByIssueKey: ReadonlyMap<string, string>,
): ScopedRows<T> {
  const want = project.trim().toLowerCase()
  const kept: T[] = []
  let other = 0
  let unresolvable = 0
  for (const row of rows) {
    const p = resolveRowProject(row, projectByIssueKey)
    if (p === null) { unresolvable++; continue }
    if (p.trim().toLowerCase() === want) kept.push(row)
    else other++
  }
  return {
    rows: kept,
    scope: { project, matched: kept.length, other_project: other, unresolvable },
  }
}

/** Issue ids and task keys worth looking up to place a set of rows. */
export function issueRefsToResolve(rows: readonly ApprovalRow[]): { ids: string[]; taskKeys: string[] } {
  const ids = new Set<string>()
  const taskKeys = new Set<string>()
  for (const row of rows) {
    const ctx = contextOf(row)
    if (str(ctx.project)) continue // already placeable without a lookup
    const t = approvalTarget(row)
    if (t.issueId) ids.add(t.issueId)
    if (t.taskKey) taskKeys.add(t.taskKey)
  }
  return { ids: [...ids], taskKeys: [...taskKeys] }
}

// ─── Who is allowed to decide ───────────────────────────────────────────────
//
// THE GAP THIS CLOSES, measured before it was written (2026-08-26, live
// against the dev server, see docs/rebuild/pieces/pieces8/approval-surface.md):
//
//   PATCH /api/inbox {"id":…,"status":"approved","resolved_by":
//   "definitely-not-a-human-bot"}  ->  200, effect applied, and the
//   append-only audit row recorded `decided_by:"definitely-not-a-human-bot"`.
//
// The decision persisted and the effect really ran — that half was already
// true. What was not true was attribution: `decided_by` was whatever string
// the caller typed, checked against nothing, and the route carried no
// permission check of its own at all. An audit trail that records the
// caller's own claim about who they are is a log, not an audit trail; and a
// permission nobody is ever refused by is not a permission.
//
// THE STANDARD BEING MATCHED. `app/api/conversations/[id]/messages/[messageId]`
// splits drafting from approving with two permissions: `projects:write` to
// write a draft, `settings:write` ON TOP to approve one — so a drafting agent
// (role `member`, which holds the first and not the second) gets 201 on the
// draft and 403 the moment it approves its own work. The inbox is the same
// shape of problem: an agent FILES the request (lib/loop-breaker.ts,
// lib/agent-budget.ts insert it), and approving that request is what releases
// that same agent. So the same split applies here, with `issues:write` as the
// baseline because that is what middleware.ts already uses to separate viewer
// from everyone else on a write.
//
// WHAT THIS CAN AND CANNOT PROVE, stated rather than implied. Todero has no
// per-person identity: the workspace authenticates a PASSWORD, not a person,
// so every session on the owner password is the same session whatever name it
// types. The role is provable; the person is not. `attributeDecision()`
// therefore records both halves and keeps them distinguishable — the claimed
// name, and the role the server resolved — instead of writing the unbacked
// half alone.
//
// CORRECTION, 2026-08-26 (round 2). The paragraph above previously ended
// "The role IS provable; the person is NOT" while pointing at
// `lib/with-permission.ts`'s `resolveRole()` as the thing that proved it.
// That was false as shipped, and a fresh critic measured it: `resolveRole()`
// accepts ANY valid session password and then reads the role straight out of
// the client-typed `mc-role` cookie, so a session holding only the READ-ONLY
// viewer password could name itself `admin`. Measured live on this route
// before the fix, one variable changed between the two requests:
//
//   mc-auth=view2026; mc-role=viewer  ->  403
//   mc-auth=view2026; mc-role=admin   ->  200, agent un-paused,
//                                          decided_by "michael (admin)"
//
// Neither half was proven when the caller could raise its own role with a
// cookie value and no extra credential, and the append-only trail was
// recording an escalation as an admin decision.
//
// `resolveDecisionRole()` below is the fix, and it is the role source this
// piece's route now uses. It derives the role from the CREDENTIAL presented
// (`mc-auth`), and lets `mc-role` only ever NARROW that — never widen it. A
// cookie asking for more than the password proves is ignored and reported as
// `ignoredClaim` so the attempt is visible rather than silently downgraded.
//
// SCOPE OF THE FIX, RE-STATED 2026-08-26 (round 3) because the previous
// version of this paragraph was stale in a way that pointed away from the
// live hole. It said the remaining exposure was "every other caller of
// `resolveRole()`". That is no longer where the exposure is:
// `lib/with-permission.ts:121` now calls `resolveDecisionRole()` itself, so
// those routes are on the fixed source.
//
// The door that is still open is a DIFFERENT one, and it never called
// `resolveRole()` at all — `app/api/db/[...path]/route.ts`. `inbox` is in
// that route's WRITABLE_TABLES, and its only write gate is
//
//     function isViewer(req) { return req.cookies.get('mc-role')?.value === 'viewer' }
//
// — the exact client-typed cookie this module exists to stop trusting, read
// with the polarity inverted: anything that is not the literal string
// "viewer" is treated as a writer. MEASURED on the running dev server,
// 2026-08-26, one credential, one row, in the same shell:
//
//   mc-auth=view2026; mc-role=owner  PATCH /api/inbox            -> 403 PERMISSION_DENIED
//                                                                   (role viewer, claim ignored,
//                                                                    refusal filed in the trail)
//   mc-auth=view2026; mc-role=owner  PATCH /api/db/inbox?id=eq.<same row>
//                                    {"status":"approved",
//                                     "resolved_by":"definitely-not-a-human-bot"}
//                                                                -> HTTP 200
//                                    row: status=approved,
//                                         resolved_by="definitely-not-a-human-bot",
//                                         resolved_at=null,
//                                         approval_decisions rows written: 0
//   mc-auth=view2026; mc-role=owner  DELETE /api/db/inbox?id=eq.<a second row>
//                                                                -> HTTP 200, row destroyed
//
// So while that route keeps `inbox` writable, this module's gate is one of
// TWO writers to the same column and only one of them is gated. Do not read
// "the role is provable" as a property of `inbox.resolved_by` — it is a
// property of what THIS module writes. `/api/db/inbox` writes that column
// verbatim from an unauthenticated string with no role appended at all.
//
// That route is not in this piece's ownership. The diff that closes it is one
// token wide and is written up as SEAM-1 in
// docs/rebuild/pieces/pieces9/approval-surface.md, and it is expressed as a
// test that FAILS UNTIL THE SEAM LANDS rather than as prose:
// `__tests__/api/inbox-db-proxy-seam.test.ts`.

/**
 * The passwords a Mission Control session can present, and the role each one
 * grants. Read from env by the caller — this module stays free of `process`.
 *
 * The password→role contract is `app/api/auth/route.ts`'s, not a second one
 * invented here: MC_PASSWORD signs you in as `owner`, MC_MEMBER_PASSWORD as
 * `member`, MC_VIEWER_PASSWORD as `viewer`, and that is exactly what it
 * writes into the `mc-role` cookie. Deriving the role from the credential
 * means using THAT mapping. `lib/with-permission.ts` uses a different one
 * (MC_PASSWORD → `admin`, and no `member` at all), which is part of why the
 * two disagreed about who was signed in.
 */
export interface SessionCredentials {
  /** MC_PASSWORD — grants `owner`. */
  ownerPassword: string
  /** MC_VIEWER_PASSWORD — grants `viewer`. */
  viewerPassword: string
  /** MC_MEMBER_PASSWORD when configured — grants `member`. Unset on this install. */
  memberPassword?: string | null
}

/** The three role-bearing signals a request can carry, as raw strings. */
export interface RequestCredential {
  /** `mc-auth` cookie. The only one of the three the client cannot invent. */
  sessionPassword: string | null
  /** `mc-role` cookie. A client-typed string: may narrow, never widen. */
  claimedRole: string | null
  /** `X-Agent-Role`. Honoured only when no valid session is presented. */
  agentRoleHeader: string | null
}

export interface ResolvedDecisionRole {
  /** The role the request actually gets, after narrowing. */
  role: Role | null
  /** The role the presented credential proves, before any narrowing. */
  granted: Role | null
  /** A `mc-role` value that asked for more than the credential proves, and
   *  was therefore ignored. Null when the cookie was absent, unrecognised in
   *  a harmless way, or a legitimate narrowing. */
  ignoredClaim: string | null
}

/**
 * True when `name` is a role THIS BUILD DEFINES — an own key of
 * `ROLE_PERMISSIONS` whose value is an actual permission list.
 *
 * WHY NOT `name in ROLE_PERMISSIONS`. That was the original guard, and `in`
 * walks the prototype chain. `ROLE_PERMISSIONS` is an object literal, so
 * `'constructor' in ROLE_PERMISSIONS`, `'toString' in …`, `'valueOf' in …`,
 * `'hasOwnProperty' in …`, `'isPrototypeOf' in …` and `'__proto__' in …` are
 * ALL true. The value behind each is a function or `Object.prototype`, never
 * an array, so `isNarrowerOrEqual` below then called `.every` on it.
 *
 * MEASURED on the running dev server, 2026-08-26, before this fix — a valid
 * READ-ONLY session, one cookie as the only variable:
 *
 *     mc-auth=view2026; mc-role=viewer        PATCH /api/inbox       -> 403
 *     mc-auth=view2026; mc-role=constructor   PATCH /api/inbox       -> 500, empty body
 *                                             GET /api/inbox?project -> 500, empty body
 *                                             GET /api/conversations -> 500, empty body
 *
 * Six for six across constructor / toString / valueOf / hasOwnProperty /
 * isPrototypeOf / __proto__, and the blast radius is every `withPermission`
 * route, because `lib/with-permission.ts:121` calls `resolveDecisionRole()`
 * too. This is not an escalation — the crash happens before any role is
 * granted — but "an unreadable cookie must never be treated as an upgrade"
 * was only ever half the property. The other half is that it must not be
 * treated as a crash either, and this predicate is what makes the function
 * TOTAL over the string domain its callers actually hand it.
 */
function isDefinedRole(name: string): name is Role {
  return (
    Object.prototype.hasOwnProperty.call(ROLE_PERMISSIONS, name) &&
    Array.isArray(ROLE_PERMISSIONS[name as Role])
  )
}

/** True when `candidate` can do nothing `ceiling` cannot. */
function isNarrowerOrEqual(candidate: Role, ceiling: Role): boolean {
  const allowed = ROLE_PERMISSIONS[ceiling]
  const wanted = ROLE_PERMISSIONS[candidate]
  // Array.isArray, not truthiness: a prototype member is truthy and has no
  // `.every`, which is the exact shape of the 500 documented above.
  if (!Array.isArray(allowed) || !Array.isArray(wanted)) return false
  return wanted.every(p => allowed.includes(p))
}

/** Which role does this password prove? Unknown password proves nothing. */
function roleFromPassword(password: string | null, creds: SessionCredentials): Role | null {
  if (!password) return null
  if (creds.ownerPassword && password === creds.ownerPassword) return 'owner'
  if (creds.viewerPassword && password === creds.viewerPassword) return 'viewer'
  if (creds.memberPassword && password === creds.memberPassword) return 'member'
  return null
}

/**
 * The role this request may act with — derived from the credential, narrowed
 * (never widened) by the `mc-role` cookie.
 *
 * Narrowing is allowed on purpose: an admin session that sets `mc-role=viewer`
 * is asking to be treated as less, and honouring that is fail-safe. Widening
 * is refused because it is not a request, it is a claim with nothing behind
 * it — and `admin` vs `viewer` here is the difference between "may release a
 * paused agent" and "may read".
 *
 * The ordinary signed-in operator is unaffected: `app/api/auth/route.ts` sets
 * `mc-role=owner` for the owner password, which matches what that credential
 * grants exactly, so nothing is narrowed and nothing is ignored. What changes
 * is only the case the cookie and the credential DISAGREE about.
 *
 * ONE VISIBLE CONSEQUENCE, stated rather than buried: the role recorded for an
 * owner session is now `owner`, so `attributeDecision()` writes
 * `"michael (owner)"` where it wrote `"michael (admin)"` before. `admin` was
 * `lib/with-permission.ts`'s word for the owner password, not the login's own
 * — `app/api/auth/route.ts` has always called that credential `owner`. The
 * trail now says what the operator actually signed in as. No permission
 * changes with it: `owner` is a superset of `admin`, and this route checks
 * only `issues:write` and `settings:write`, which both hold.
 *
 * Pure AND TOTAL: every input is an argument, and every combination of the
 * three raw strings returns rather than throws, so lib/__tests__ can prove
 * the escalation is closed without a server.
 *
 * "Total" is not decoration. This docstring used to claim only purity, and
 * the function was NOT total: the guards below tested `wanted in
 * ROLE_PERMISSIONS`, and `in` walks the prototype chain, so `constructor`,
 * `toString`, `valueOf`, `hasOwnProperty`, `isPrototypeOf` and `__proto__`
 * all passed the guard and then hit `.every` on a function. Measured live,
 * six for six, on a valid read-only session: HTTP 500 with an empty body from
 * PATCH /api/inbox, GET /api/inbox?project=… and GET /api/conversations?project=…
 * — and the whole 11-test `approvals-role-source.test.ts` was green over it,
 * because every case it tried was a string the guard handled. `isDefinedRole`
 * is the fix; `lib/__tests__/approvals-role-source.test.ts` now enumerates
 * `Object.getOwnPropertyNames(Object.prototype)` so the class cannot come
 * back rather than the six names that happened to be found.
 */
export function resolveDecisionRole(
  cred: RequestCredential,
  creds: SessionCredentials,
): ResolvedDecisionRole {
  const granted = roleFromPassword(cred.sessionPassword, creds)

  if (!granted) {
    // No session. An agent caller may present X-Agent-Role — middleware.ts
    // already requires such a caller to prove itself with the internal
    // secret, so this is defence in depth, not the front door.
    const claimed = cred.agentRoleHeader?.trim()
    if (claimed && isDefinedRole(claimed)) {
      const role = claimed
      return { role, granted: role, ignoredClaim: null }
    }
    return { role: null, granted: null, ignoredClaim: null }
  }

  const wanted = cred.claimedRole?.trim()
  if (!wanted || !isDefinedRole(wanted)) {
    // No cookie, or a value that names no role at all. The credential stands
    // on its own — an unreadable cookie must never be treated as an upgrade,
    // and (see `isDefinedRole`) must not be treated as a crash either. Every
    // string reaches this branch except the seven `ROLE_PERMISSIONS` actually
    // defines, so the function is total: `resolveDecisionRole` cannot throw
    // for ANY combination of the three raw strings a request can carry.
    return { role: granted, granted, ignoredClaim: null }
  }

  const asked = wanted
  if (isNarrowerOrEqual(asked, granted)) {
    return { role: asked, granted, ignoredClaim: null }
  }
  return { role: granted, granted, ignoredClaim: wanted }
}

/** Baseline right to record ANY decision (deny, acknowledge, approve). */
export const DECIDE_PERMISSION: Permission = 'issues:write'

/** The extra right approving requires, on top of DECIDE_PERMISSION. */
export const APPROVE_PERMISSION: Permission = 'settings:write'

export type ActorRefusalCode =
  | 'NO_ACTOR'
  | 'PERMISSION_DENIED'
  | 'SELF_APPROVAL'
  | 'UNSIGNED_APPROVAL'

/** Who the server believes is deciding. */
export interface DecisionActor {
  /** Role resolved from the request's CREDENTIAL by `resolveDecisionRole()`
   *  above — not read from the `mc-role` cookie, which can only narrow it.
   *  null means the request proved no role at all. */
  role: Role | null
  /** Display name the caller supplied in `resolved_by`. A claim, not a proof. */
  claimedBy: string | null
}

/** Structural shape shared by a preflight refusal and an actor refusal, so the
 *  audit-row builder can record either without caring which it is. */
export interface DecisionRefusal {
  code: string
  httpStatus: number
  reason: string
}

export type ActorResult =
  | { ok: true }
  | { ok: false; code: ActorRefusalCode; httpStatus: number; reason: string; required: Permission | null }

/**
 * The attributable string written to `inbox.resolved_by` and
 * `approval_decisions.decided_by`.
 *
 * Format: `"<claimed name> (<proven role>)"`, or just `"(<proven role>)"`-less
 * `"<role>"` when nothing was claimed. The parenthesised half is the only
 * half THIS FUNCTION'S CALLER verified, and it is always present — so a row
 * reading `michael (owner)` says "someone holding an owner session typed the
 * name michael", which is exactly as much as is actually known, no more.
 *
 * READ THAT AS A PROPERTY OF THIS WRITER, NOT OF THE COLUMN. It was
 * previously written as "the only half the server verified", which reads as
 * a guarantee about `inbox.resolved_by` itself, and that is false as shipped:
 * `app/api/db/[...path]/route.ts` also writes that column, with no role
 * resolution of any kind. Measured 2026-08-26 with a READ-ONLY credential:
 * `[{"status":"approved","resolved_by":"definitely-not-a-human-bot","resolved_at":null}]`
 * — a value with no parenthesised half at all, which is how a reader can tell
 * such a row from one this function wrote. See the SCOPE OF THE FIX block
 * above and SEAM-1 in the piece doc.
 *
 * A dedicated `decided_by_role` column would be the better shape and is
 * offered as an optional seam diff in this piece's doc; it needs a migration,
 * and migrations are not this lane's to write.
 */
export function attributeDecision(actor: DecisionActor): string {
  const role = actor.role ?? 'unauthenticated'
  const claim = actor.claimedBy && actor.claimedBy.trim() ? actor.claimedBy.trim() : null
  return claim ? `${claim} (${role})` : role
}

/** The agent names a decision on this row must not be made in the name of. */
function requestingAgentNames(row: ApprovalRow): string[] {
  const ctx = contextOf(row)
  const names = [str(row.agent), str(ctx.agent_id)]
  return names.filter((n): n is string => !!n).map(n => n.toLowerCase())
}

/**
 * May THIS actor record THIS decision on THIS row?
 *
 * Pure, and separate from `preflightDecision()` on purpose: preflight asks
 * "is the world in a state where this decision can take effect", this asks
 * "is the caller allowed to make it at all". They fail with different codes
 * and different HTTP statuses, and conflating them would make a 403 read as
 * a 409.
 *
 * The asymmetry is the same one preflight has, for the same reason:
 * approving RELEASES an agent, refusing only ever leaves it stopped. So
 * `settings:write` gates approval alone, and a `member`-role agent keeps the
 * ability to acknowledge or deny a request it filed.
 */
export function authorizeDecision(args: {
  actor: DecisionActor
  row: ApprovalRow
  decision: string
}): ActorResult {
  const { actor, row, decision } = args
  const role = actor.role

  // No role at all. Never fall back to "user" — an unattributable decision is
  // exactly what this section exists to stop being possible.
  if (!role) {
    return {
      ok: false,
      code: 'NO_ACTOR',
      httpStatus: 403,
      required: DECIDE_PERMISSION,
      reason:
        'This request proved no role, so a decision made through it would be attributable to nobody. ' +
        'Sign in, or present a recognised agent role.',
    }
  }

  if (!hasPermission(role, DECIDE_PERMISSION)) {
    return {
      ok: false,
      code: 'PERMISSION_DENIED',
      httpStatus: 403,
      required: DECIDE_PERMISSION,
      reason:
        `missing permission: ${DECIDE_PERMISSION} is not granted to role "${role}". ` +
        'Recording any decision — approve, deny or acknowledge — is a write.',
    }
  }

  if (decision !== 'approved') return { ok: true }

  if (!hasPermission(role, APPROVE_PERMISSION)) {
    return {
      ok: false,
      code: 'PERMISSION_DENIED',
      httpStatus: 403,
      required: APPROVE_PERMISSION,
      reason:
        `missing permission: ${APPROVE_PERMISSION} is not granted to role "${role}". ` +
        'Filing a request and approving one are deliberately different rights — approving is what releases the agent, ' +
        'so the agent that filed it cannot be the thing that grants it.',
    }
  }

  const claim = actor.claimedBy?.trim().toLowerCase()

  // ── An approval nobody signed ────────────────────────────────────────────
  //
  // MEASURED, 2026-08-26, one fixture, one session, ONE variable — the
  // presence of `resolved_by` in the body:
  //
  //   {"id":…,"status":"approved","resolved_by":"lane5-self-agent"}  -> 403 SELF_APPROVAL
  //   {"id":…,"status":"approved"}                                   -> 200, agent released,
  //                                                                      trail records the bare
  //                                                                      word "owner"
  //
  // So the SELF_APPROVAL refusal below was OPT-IN: it only fired against a
  // caller that volunteered the agent's own name, and the refused variant was
  // the MORE attributable of the two. Omitting the name was the way through
  // it, and the way through it produced the less informative audit row.
  //
  // The repo had already answered this question for the other approval
  // surface, and this copies that answer rather than inventing one:
  // `lib/conversations.ts` (validateMessageAction) returns
  //
  //   422 'approve requires approved_by — an approval must record who made it'
  //
  // Denials, acknowledgements and timeouts are deliberately NOT gated: they
  // only ever leave the agent stopped, and refusing an unsigned "stop"
  // would push an operator toward doing nothing. Approving is the action
  // that releases an agent, so it is the one that must be signed.
  //
  // NOTE what this is not. Todero authenticates a PASSWORD, not a person, so
  // the signature is still a claim — `attributeDecision()` records it as
  // `"<claim> (<proven role>)"` and only the parenthesised half is proven.
  // What changes is that the claim can no longer be OMITTED, which is what
  // made the self-approval rule optional.
  if (!claim) {
    return {
      ok: false,
      code: 'UNSIGNED_APPROVAL',
      httpStatus: 422,
      required: null,
      reason:
        'An approval must record who made it: send `resolved_by`. Approving is what releases the agent that filed this request, ' +
        'and the check that an agent cannot approve its own request compares that name against the requesting agent — ' +
        'so an unsigned approval is one this surface cannot check. Denying or acknowledging does not require a name.',
    }
  }

  // Even a session that holds the right may not sign the decision in the name
  // of the agent that asked for it. This is the inbox's form of "an agent
  // cannot approve its own draft": approving `loop_breaker_pause` un-pauses
  // exactly the agent named on the row.
  if (requestingAgentNames(row).includes(claim)) {
    return {
      ok: false,
      code: 'SELF_APPROVAL',
      httpStatus: 403,
      required: null,
      reason:
        `This approval is signed "${actor.claimedBy?.trim()}", which is the agent that filed the request. ` +
        'Approving it is what releases that agent, so it cannot be recorded in that agent\'s own name.',
    }
  }

  return { ok: true }
}

// ─── The audit row ──────────────────────────────────────────────────────────

/** Why `approval_decisions` exists — see migrations/061_approval_decisions.sql. */
export type DecisionOutcome = 'applied' | 'no_effect' | 'failed' | 'refused'

export interface DecisionAuditRow {
  inbox_id: string
  request_type: string | null
  request_agent: string | null
  decision: string
  outcome: DecisionOutcome
  effect: string | null
  detail: string
  human_reason: string | null
  project: string | null
  decided_by: string
  decided_at: string
}

/** Pull `{ reason }` out of whatever the operator typed, if anything. */
export function humanReason(input: unknown): string | null {
  if (input && typeof input === 'object' && !Array.isArray(input)) {
    const r = (input as Record<string, unknown>).reason
    if (typeof r === 'string' && r.trim()) return r.trim()
  }
  return null
}

/**
 * Build the append-only audit row for a decision that was ALLOWED and ran.
 * `outcome` is derived from what the effect actually reported, never from
 * what the human asked for: an effect that returned `ok:false` records
 * `failed`, not `applied`.
 */
export function auditRowForOutcome(args: {
  row: ApprovalRow
  decision: string
  effect: { effect?: unknown; ok?: unknown; detail?: unknown } | null
  humanInput: unknown
  project: string | null
  decidedBy: string
  decidedAt: string
}): DecisionAuditRow {
  const { row, decision, effect, humanInput, project, decidedBy, decidedAt } = args
  const effectName = typeof effect?.effect === 'string' ? effect.effect : null
  const detail = typeof effect?.detail === 'string' && effect.detail.trim()
    ? effect.detail.trim()
    : `${decision} recorded`
  const outcome: DecisionOutcome =
    effect?.ok === false ? 'failed'
      : (!effectName || effectName === 'none') ? 'no_effect'
        : 'applied'
  return {
    inbox_id: row.id,
    request_type: row.type ?? null,
    request_agent: row.agent ?? null,
    decision,
    outcome,
    effect: effectName,
    detail,
    human_reason: humanReason(humanInput),
    project,
    decided_by: decidedBy,
    decided_at: decidedAt,
  }
}

/**
 * Build the append-only audit row for a decision that was REFUSED.
 *
 * Takes the structural `DecisionRefusal` rather than the preflight's own
 * union, so an ACTOR refusal (403 PERMISSION_DENIED / SELF_APPROVAL / NO_ACTOR
 * from `authorizeDecision()`) lands in the same append-only table as a
 * preflight refusal. A permission that refuses silently leaves no evidence it
 * was ever exercised, which is the same defect as no permission at all.
 */
export function auditRowForRefusal(args: {
  row: ApprovalRow
  decision: string
  refusal: DecisionRefusal
  humanInput: unknown
  project: string | null
  decidedBy: string
  decidedAt: string
}): DecisionAuditRow {
  const { row, decision, refusal, humanInput, project, decidedBy, decidedAt } = args
  return {
    inbox_id: row.id,
    request_type: row.type ?? null,
    request_agent: row.agent ?? null,
    decision,
    outcome: 'refused',
    effect: refusal.code,
    detail: refusal.reason,
    human_reason: humanReason(humanInput),
    project,
    decided_by: decidedBy,
    decided_at: decidedAt,
  }
}

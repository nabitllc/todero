'use client'
// components/tabs/InboxTab.tsx — approval-surface piece (Wave 6)
//
// The surface where the one human in a "0 or 1 person business manager"
// actually decides. Rebuilt on components/nav/Card.tsx's contract: one
// question per card, one number that came from a real query, that query
// printed as `source`, an empty state that names the project, and an error
// that REPLACES the body rather than sitting next to an empty state.
//
// Two cards:
//   inbox-waiting   — what is waiting on you IN THIS PROJECT, as ApprovalCards
//   inbox-decisions — the append-only record of what you already decided
//                     (migration 061 approval_decisions), including refusals
//
// SCOPE. This tab takes no props (app/page.tsx renders it as <InboxTab />, and
// that file belongs to another piece this round), so it reads the project from
// `useProjectScope()` — the single Provider app/page.tsx mounts around every
// destination. That is the same value every other tab receives as a
// `projectFilter` prop, read from the source instead of re-typed.
//
// The counts below are the server's own `scope` numbers, never `items.length`
// — GET /api/inbox?project=X reports how many rows matched, how many belong
// to another project, and how many could not be placed at all, and the empty
// state says so instead of implying the fleet is quiet.

import React, { useCallback, useState } from 'react'
import { fetchJson, useApiData, type ApiError } from '@/hooks/useApiData'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import Card from '@/components/nav/Card'
import { useProjectScope } from '@/components/nav/ProjectScope'
import ApprovalCard, { type Decision, type InboxEntry } from '@/components/tabs/ApprovalCard'
import { ROLE_PERMISSIONS } from '@/lib/rbac-types'
import { formatAgo } from '@/lib/time'

/** `scope` block GET /api/inbox returns whenever `project=` is given. */
interface InboxScope {
  project: string
  matched: number
  other_project: number
  unresolvable: number
}

/** `decide` block GET /api/inbox returns alongside `scope` — what THIS
 *  session may do, resolved by the same code that authorises PATCH. */
interface DecideRights {
  role: string | null
  can_record: boolean
  can_approve: boolean
  ignored_role_claim: string | null
}

interface ScopedInbox {
  data: InboxEntry[]
  total: number
  has_more: boolean
  scope: InboxScope
  /** Optional: an older server, or a cached response, may not carry it. When
   *  absent nothing is claimed about the session's rights — the notice below
   *  is not rendered, rather than guessing. */
  decide?: DecideRights
}

/** One row of `approval_decisions` (migrations/061_approval_decisions.sql). */
interface DecisionRow {
  id: string
  inbox_id: string
  request_type: string | null
  request_agent: string | null
  decision: string
  outcome: 'applied' | 'no_effect' | 'failed' | 'refused'
  effect: string | null
  detail: string
  human_reason: string | null
  project: string | null
  decided_by: string
  decided_at: string
}

interface DecisionsPayload {
  data: DecisionRow[]
  total: number
  has_more: boolean
}

const OUTCOME_STYLE: Record<DecisionRow['outcome'], { label: string; className: string }> = {
  applied: { label: 'APPLIED', className: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' },
  no_effect: { label: 'RECORDED', className: 'bg-white/[0.06] text-white/50 border-white/10' },
  failed: { label: 'FAILED', className: 'bg-red-500/10 text-red-400 border-red-500/20' },
  refused: { label: 'REFUSED', className: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
}

function timeAgo(at: string | null | undefined): string {
  // TOD-2434: one clock. Returns '' for an absent timestamp rather than a
  // plausible age.
  return formatAgo(at)
}

/** Per-item note: the server's refusal reason, or what a landed decision did. */
type ItemNote = { kind: 'refused' | 'done' | 'warning'; text: string }

/** Strings `attributeDecision()` writes when the caller claimed NO name — the
 *  server's own word for the role, standing alone. `unauthenticated` is in the
 *  list because that is what it writes for `role: null`, and treating it as a
 *  person's name would be the worst possible misread of that row. */
const BARE_ROLE_WORDS: readonly string[] = [
  ...Object.keys(ROLE_PERMISSIONS),
  'unauthenticated',
]

/**
 * Split `approval_decisions.decided_by` into the half the caller CLAIMED and
 * the half the server PROVED.
 *
 * PATCH /api/inbox writes `"<claimed name> (<role>)"` — see attributeDecision()
 * in lib/approvals.ts. Showing them as one string would let the unverified
 * half borrow the authority of the verified one, which is the whole defect
 * that format exists to fix, so they are rendered as two different things.
 *
 * THREE shapes reach here, and they must not be collapsed into two:
 *
 *   "michael (admin)"  -> a claimed name AND a proven role.
 *   "admin"            -> a proven role and NO name. `attributeDecision()`
 *                         writes exactly this when `resolved_by` is omitted,
 *                         and it is live-reachable: PATCH /api/inbox with no
 *                         `resolved_by` returns `"resolved_by":"admin"`
 *                         (measured 2026-08-26). This used to fall into the
 *                         case below and render amber "role unverified" with
 *                         a tooltip reading "no role was recorded with it" —
 *                         both false of the one row where the role is the
 *                         ONLY thing recorded. A trail that mislabels a
 *                         correctly-attributed row is the same defect as one
 *                         that flatters an unattributed one, pointed the
 *                         other way.
 *   "some-bot"         -> a name and no role: a row written before the actor
 *                         gate existed. Marked unverified, correctly.
 *
 * `claim: null` therefore means "no name was claimed", never "the name is
 * missing".
 */
export function splitActor(decidedBy: string): { claim: string | null; role: string | null } {
  const trimmed = decidedBy.trim()
  const m = /^(.*)\s\(([^()]+)\)$/.exec(trimmed)
  if (m) return { claim: m[1].trim(), role: m[2].trim() }
  if (BARE_ROLE_WORDS.includes(trimmed)) return { claim: null, role: trimmed }
  return { claim: trimmed, role: null }
}

export default function InboxTab() {
  const { project } = useProjectScope()

  // No project scope yet means there is nothing honest to show — the whole
  // point of this surface is that a decision belongs to a business. Say that,
  // rather than falling back to a fleet-wide list.
  const pendingUrl = project
    ? `/api/inbox?status=pending&project=${encodeURIComponent(project)}`
    : null
  const decisionsUrl = project
    ? `/api/inbox/decisions?project=${encodeURIComponent(project)}&limit=25`
    : null

  const pendingQ = useApiData<ScopedInbox>(pendingUrl)
  const decisionsQ = useApiData<DecisionsPayload>(decisionsUrl)

  const [busyId, setBusyId] = useState<string | null>(null)
  const [notes, setNotes] = useState<Record<string, ItemNote>>({})

  const refetchAll = useCallback(() => {
    pendingQ.refetch()
    decisionsQ.refetch()
  }, [pendingQ, decisionsQ])

  const decide = useCallback(async (entry: InboxEntry, decision: Decision, responseData: unknown) => {
    setBusyId(entry.id)
    // `resolved_by` is a CLAIM, and is sent as one. Todero authenticates a
    // PASSWORD, not a person, so every signed-in session on the owner
    // credential is the same session whatever name it types.
    //
    // What makes the decision attributable is the half the server adds and
    // this client cannot forge: PATCH /api/inbox records `"<claim> (<role>)"`
    // (lib/approvals.ts attributeDecision) and refuses the write outright
    // when that role may not decide.
    //
    // That sentence was NOT true until 2026-08-26. The role came from
    // lib/with-permission.ts's resolveRole(), which accepted any valid
    // session password and then read the role out of the `mc-role` cookie —
    // so this client, or any other, COULD forge the half described here as
    // unforgeable: `mc-auth=view2026; mc-role=admin` (a read-only credential)
    // was measured releasing a paused agent with a 200 and filing itself as
    // "michael (admin)". The route now resolves the role from the credential
    // (app/api/inbox/actor.ts) and lets `mc-role` only narrow it. Sending a
    // name here is therefore a label on a decision the server has already
    // proven the right to make — not the thing that authorises it.
    const r = await fetchJson<InboxEntry & { _warning?: string }>('/api/inbox', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: entry.id, status: decision, resolved_by: 'michael', response_data: responseData }),
    })
    setBusyId(null)
    if (!r.ok) {
      // A 409/422 here is the server FAILING CLOSED — the request is still
      // pending and nothing was changed. It belongs on the item that was
      // refused, in the server's own words, not in a generic red banner that
      // would leave the operator guessing whether the click half-landed.
      setNotes(n => ({
        ...n,
        [entry.id]: { kind: 'refused', text: `Refused (${r.error.status}${r.error.code ? ` ${r.error.code}` : ''}): ${r.error.message}` },
      }))
      return
    }
    if (r.data._warning) {
      setNotes(n => ({ ...n, [entry.id]: { kind: 'warning', text: r.data._warning as string } }))
    } else {
      setNotes(n => {
        const { [entry.id]: _gone, ...rest } = n
        return rest
      })
    }
    refetchAll()
  }, [refetchAll])

  const scope = pendingQ.data?.scope ?? null
  const pending = pendingQ.data?.data ?? []
  const decisions = decisionsQ.data?.data ?? []
  const rights = pendingQ.data?.decide ?? null

  // WHAT THIS IS AND IS NOT. It is a warning, not a gate. The buttons live in
  // components/tabs/ApprovalCard.tsx, which this piece does not own, so they
  // are still rendered enabled to a session that cannot use them; the exact
  // diff that would disable them is written up as a seam request in this
  // piece's doc rather than applied from outside its ownership. Saying
  // nothing at all was the worse option: the operator otherwise learns their
  // session cannot approve only by clicking and reading a 403.
  const rightsNotice = (() => {
    if (!rights) return null
    if (rights.can_approve) return null
    const who = rights.role ? `a "${rights.role}" session` : 'a session that proved no role'
    if (!rights.can_record) {
      return `This is ${who}, which may not record any decision here. The buttons below will be refused with a 403 and nothing will change — the refusal is filed either way.`
    }
    return `This is ${who}. It may deny or acknowledge a request, but not approve one: approving is what releases the agent that filed it. Approve will be refused with a 403.`
  })()

  // A cookie that asked for more than the credential proves is worth saying
  // out loud even when the session can approve — it means something on this
  // browser is trying to act as a role it does not hold.
  const ignoredClaimNotice = rights?.ignored_role_claim
    ? `The mc-role cookie on this browser asks to act as "${rights.ignored_role_claim}", which the signed-in credential does not grant. It is ignored: that cookie can narrow a role, never widen it.`
    : null

  const pendingSource = pendingUrl
    ? `GET ${pendingUrl}`
    : 'GET /api/inbox — not requested: no project is in scope'
  const decisionsSource = decisionsUrl
    ? `GET ${decisionsUrl} (table: approval_decisions, migration 061)`
    : 'GET /api/inbox/decisions — not requested: no project is in scope'

  // The empty message must name the project AND account for anything the
  // scope deliberately excluded — a quiet card over 4 unplaceable requests
  // would be the same silent-empty lie this repo has a build guard about.
  const emptyMessage = (() => {
    if (!project) return 'No project is in scope, so no approvals are listed. Pick a project in the rail.'
    const excluded: string[] = []
    if (scope && scope.other_project > 0) {
      excluded.push(`${scope.other_project} ${scope.other_project === 1 ? 'belongs' : 'belong'} to another project`)
    }
    if (scope && scope.unresolvable > 0) excluded.push(`${scope.unresolvable} could not be placed in any project`)
    const tail = excluded.length > 0 ? ` Of the pending requests fleet-wide, ${excluded.join(' and ')}.` : ''
    return `No agent is waiting on you in ${project}.${tail}`
  })()

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
      <Card
        id="inbox-waiting"
        title="Waiting on you"
        source={pendingSource}
        metric={scope ? { value: scope.matched, label: 'to decide', tone: scope.matched > 0 ? 'amber' : 'default' } : undefined}
        action={project ? { label: 'Refresh', onClick: refetchAll } : undefined}
        empty={!pendingQ.error && !pendingQ.loading && pending.length === 0
          ? { active: true, message: emptyMessage }
          : undefined}
      >
        {/* The error REPLACES the body: when `error` is set the empty state
            above is not active and no rows render, so the card never shows a
            reassuring "nothing waiting" over a refused load. */}
        {pendingQ.error ? (
          <ApiErrorBanner error={pendingQ.error} onRetry={pendingQ.refetch} />
        ) : pendingQ.loading ? (
          <p className="text-white/30 text-xs">Loading approvals for {project ?? 'no project'}…</p>
        ) : (
          <div className="space-y-2">
            {rightsNotice && (
              <p
                data-testid="inbox-rights-notice"
                className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-amber-300/80 text-[11px] leading-snug"
              >
                {rightsNotice}
              </p>
            )}
            {ignoredClaimNotice && (
              <p
                data-testid="inbox-ignored-claim-notice"
                className="rounded-lg border border-amber-500/20 bg-amber-500/[0.06] px-3 py-2 text-amber-300/80 text-[11px] leading-snug"
              >
                {ignoredClaimNotice}
              </p>
            )}
            {pending.map(entry => (
              <ApprovalCard
                key={entry.id}
                entry={entry}
                busy={busyId === entry.id}
                note={notes[entry.id] ?? null}
                onDecide={(decision, responseData) => decide(entry, decision, responseData)}
              />
            ))}
          </div>
        )}
      </Card>

      <Card
        id="inbox-decisions"
        title="Decisions on record"
        source={decisionsSource}
        metric={decisionsQ.data ? { value: decisionsQ.data.total, label: 'recorded' } : undefined}
        empty={!decisionsQ.error && !decisionsQ.loading && decisions.length === 0
          ? {
            active: true,
            message: project
              ? `No decision has been recorded in ${project} yet. Every approval, refusal and refused-approval lands here the moment it happens.`
              : 'No project is in scope, so no decision history is listed.',
          }
          : undefined}
      >
        {decisionsQ.error ? (
          <ApiErrorBanner error={decisionsQ.error} onRetry={decisionsQ.refetch} />
        ) : decisionsQ.loading ? (
          <p className="text-white/30 text-xs">Loading decisions for {project ?? 'no project'}…</p>
        ) : (
          <ul className="space-y-1.5">
            {decisions.map(d => (
              <li key={d.id} className="rounded-lg border border-white/10 bg-[#080808] px-3 py-2">
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-[9px] font-mono font-medium px-1.5 py-0.5 rounded border shrink-0 ${OUTCOME_STYLE[d.outcome]?.className ?? OUTCOME_STYLE.no_effect.className}`}>
                    {OUTCOME_STYLE[d.outcome]?.label ?? d.outcome.toUpperCase()}
                  </span>
                  {(() => {
                    const actor = splitActor(d.decided_by)
                    // Three shapes, three sentences — see splitActor(). The
                    // middle one (a role and no claimed name) used to be
                    // rendered as the third and told the operator that no
                    // role had been recorded, on the one row where the role
                    // is the only thing that WAS recorded.
                    if (actor.role && !actor.claim) {
                      return (
                        <span className="text-white text-[11px] font-medium truncate">
                          {d.decision}
                          <span
                            className="text-white/40 font-mono text-[10px] ml-1"
                            title={`Recorded against the role the server resolved from the request's credential. No name was claimed on this decision, and none is shown — Todero has no per-person identity to fill one in with.`}
                          >
                            · role {actor.role}, no name claimed
                          </span>
                        </span>
                      )
                    }
                    return (
                      <span className="text-white text-[11px] font-medium truncate">
                        {d.decision} by {actor.claim}
                        {actor.role ? (
                          <span
                            className="text-white/40 font-mono text-[10px] ml-1"
                            title={`Role the server resolved from the credential the request presented — the mc-role cookie can only narrow it, never widen it. The name "${actor.claim}" is the caller's own label and is not verified: Todero has no per-person identity.`}
                          >
                            · role {actor.role}
                          </span>
                        ) : (
                          <span
                            className="text-amber-400/70 font-mono text-[10px] ml-1"
                            title="This row carries a name and no role, which is what the decision route wrote before it resolved one. The name alone was never checked against anything."
                          >
                            · role unverified
                          </span>
                        )}
                      </span>
                    )
                  })()}
                  <span className="text-white/25 text-[10px] shrink-0 ml-auto">{timeAgo(d.decided_at)}</span>
                </div>
                <p className="text-white/55 text-[11px] leading-snug">{d.detail}</p>
                {d.human_reason && (
                  <p className="text-white/35 text-[10px] mt-0.5">their reason: {d.human_reason}</p>
                )}
                <p className="text-white/25 text-[10px] font-mono mt-0.5">
                  {d.request_agent ?? 'unknown agent'} · {d.request_type ?? 'untyped'} · inbox {d.inbox_id}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}

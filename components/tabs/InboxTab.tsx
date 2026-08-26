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
import { formatAgo } from '@/lib/time'

/** `scope` block GET /api/inbox returns whenever `project=` is given. */
interface InboxScope {
  project: string
  matched: number
  other_project: number
  unresolvable: number
}

interface ScopedInbox {
  data: InboxEntry[]
  total: number
  has_more: boolean
  scope: InboxScope
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
                  <span className="text-white text-[11px] font-medium truncate">
                    {d.decision} by {d.decided_by}
                  </span>
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

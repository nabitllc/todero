'use client'
// components/tabs/ApprovalCard.tsx — approval-surface piece (Wave 6)
//
// ONE approval item: what is being asked, by which agent, what happens if you
// approve, and what happens if you refuse.
//
// The rule this file exists to enforce: an approve button that does not say
// what it approves is worse than no button. Every string below — including
// the button labels — comes from `describeApproval()` in lib/approvals.ts.
//
// WHAT THIS FILE USED TO CLAIM, AND WHY IT WAS FALSE.
//
//     "A label therefore cannot promise an effect the server would refuse:
//      app/api/inbox/route.ts throws at import time if its dispatch table and
//      that registry ever disagree."
//
// That import-time check compares two SETS OF TYPE KEYS. It proves that every
// describable type is dispatchable. It cannot see anything about THIS ROW —
// and the server's refusals are per-row: `preflightDecision()` 409s an
// approval whose agent id is empty (NO_AGENT) or whose target issue has
// vanished (TARGET_MISSING). `describeApproval()` never called it. Measured:
// of four approval cards rendered live, TWO carried an Approve button the
// server refuses with a 409.
//
// So the guarantee is no longer asserted in a comment — it is executed.
// `approveGate()` below runs the SAME `preflightDecision()` the route runs,
// on this row, and a refused row gets a disabled button carrying the server's
// own sentence. What makes a label safe is that one call, not the set check.
//
// The one thing this surface cannot know for free is whether the target issue
// still exists — that is a database fact, and the route looks it up before it
// decides. This card looks it up too (`useIssueExistence` below), and until
// the answer arrives the button is DISABLED rather than optimistically live:
// an unanswered question is not a yes.
//
// A type with no registered effect still gets NO approve button at all
// (`approveLabel === null`), because approving it would record a decision
// that changes nothing — and the server refuses it with a 422 rather than
// returning a green tick over a no-op. Its reason is now shown, instead of
// the button silently not being there.

import React, { useEffect, useState } from 'react'
import {
  approvalTarget,
  describeApproval,
  preflightDecision,
  type ApprovalRow,
  type PreflightRefusalCode,
  type TargetLookup,
} from '@/lib/approvals'
import { fetchJson } from '@/hooks/useApiData'
import { issuesUrl } from '@/lib/db/browser'
import { useProjectScope } from '@/components/nav/ProjectScope'

export interface InboxEntry extends ApprovalRow {
  id: string
  agent: string
  type: string
  context: Record<string, unknown> | null
  status: 'pending' | 'approved' | 'denied' | 'timeout' | 'explained'
  created_at: string
  expires_at: string | null
  resolved_at: string | null
  resolved_by: string | null
  response_data: unknown
  issue_id: string | null
}

export type Decision = 'approved' | 'denied' | 'explained'

export function timeRemaining(expiresAt: string | null): string {
  if (!expiresAt) return 'no expiry'
  const diff = new Date(expiresAt).getTime() - Date.now()
  if (diff <= 0) return 'expired'
  const m = Math.floor(diff / 60000)
  return m > 0 ? `expires in ${m}m` : `expires in ${Math.floor(diff / 1000)}s`
}

// ─── The gate ────────────────────────────────────────────────────────────────

/**
 * `'unverified'` — the existence of this row's target issue has not been
 * established yet (still loading, or the lookup itself failed). It is NOT a
 * synonym for "no issue to check": that case is a real `TargetLookup` with
 * `issueExists: null`.
 */
export type ApprovalLookup = TargetLookup | 'unverified'

/** This surface's own pre-server code, for the one question it must ask first. */
export type ApproveBlock = PreflightRefusalCode | 'UNVERIFIED'

/** What the Approve button may be, on THIS row, right now. */
export interface ApproveGate {
  /** The label to render, or null when no approve button may exist at all. */
  label: string | null
  /** May it be clicked? False whenever the server would refuse the click. */
  enabled: boolean
  /** The refusal, VERBATIM from lib/approvals.ts, or null when approvable. */
  reason: string | null
  /** Which gate answered, for tests and for the tone of the note. */
  block: ApproveBlock | null
}

/**
 * Ask the server's own preflight what would happen, and shape the button
 * around the answer.
 *
 * Pure: every fact it needs is an argument, so
 * components/tabs/__tests__/approval-card.test.ts can prove the refusals
 * rather than a reviewer asserting them.
 *
 * `NO_REGISTERED_EFFECT` keeps its existing treatment — no button at all,
 * because there is nothing for a button to do — and every OTHER refusal code
 * renders the button disabled with the reason attached. Disabled rather than
 * hidden on purpose: an operator looking at a request that cannot be approved
 * needs to know WHY it cannot, and a button that simply is not there answers
 * no question at all.
 */
export function approveGate(row: ApprovalRow, lookup: ApprovalLookup): ApproveGate {
  const d = describeApproval(row)
  const target = approvalTarget(row)

  // The one question this surface must answer before it can ask the preflight
  // anything. Answering it with a guess is what a green button over a 409 is.
  if (lookup === 'unverified' && target.needsIssue) {
    const ref = target.taskKey ?? target.issueId ?? 'the issue this request points at'
    return {
      label: d.approveLabel,
      enabled: false,
      block: 'UNVERIFIED',
      reason:
        `Approving this unblocks ${ref}, and the server refuses the decision with a 409 if that issue no longer exists. ` +
        `Whether it does has not been established yet, so the button stays closed rather than promising an effect that may be refused.`,
    }
  }

  const preflight = preflightDecision({
    row,
    decision: 'approved',
    lookup: lookup === 'unverified' ? { issueExists: null } : lookup,
  })

  if (preflight.ok) {
    return { label: d.approveLabel, enabled: d.approveLabel !== null, reason: null, block: null }
  }

  if (preflight.code === 'NO_REGISTERED_EFFECT') {
    return { label: null, enabled: false, reason: preflight.reason, block: preflight.code }
  }

  return { label: d.approveLabel, enabled: false, reason: preflight.reason, block: preflight.code }
}

/**
 * Does this row's target issue still exist?
 *
 * `app/api/inbox/route.ts` asks this with an admin client before it decides;
 * this asks it through the browser's scoped issues seam, so the answer is
 * "visible in this project and not archived" rather than "exists anywhere".
 * The two differ only for a row pointing outside the project you are looking
 * at or at an archived issue — and in both of those cases this errs toward
 * DISABLING a button the server might have accepted, which is the safe
 * direction: over-refusal costs a reload, over-promising costs the operator a
 * 409 and their trust in the button.
 *
 * A failed lookup returns `'unverified'` and stays there. Fail closed: a
 * request that did not answer is not a row that exists.
 */
function useIssueExistence(entry: InboxEntry, project: string | null): ApprovalLookup {
  const target = approvalTarget(entry)
  const needs = target.needsIssue
  const byKey = target.taskKey
  const byId = target.issueId
  const [lookup, setLookup] = useState<ApprovalLookup>(
    needs ? 'unverified' : { issueExists: null, issueRef: null },
  )

  useEffect(() => {
    if (!needs) {
      setLookup({ issueExists: null, issueRef: null })
      return
    }
    if (!project) return
    const ref = byKey ?? byId
    if (!ref) return
    const filter = byKey
      ? `task_key=eq.${encodeURIComponent(byKey)}`
      : `id=eq.${encodeURIComponent(byId as string)}`
    let cancelled = false
    fetchJson<unknown>(issuesUrl(`${filter}&select=id&limit=1`, { project })).then(r => {
      if (cancelled) return
      if (!r.ok) {
        // Not proof of absence and not proof of presence. Say neither.
        setLookup('unverified')
        return
      }
      const rows = Array.isArray(r.data) ? r.data : []
      setLookup({ issueExists: rows.length > 0, issueRef: ref })
    })
    return () => { cancelled = true }
  }, [needs, byKey, byId, project])

  return lookup
}

function Consequence({ label, text, tone }: { label: string; text: string; tone: 'emerald' | 'amber' }) {
  const color = tone === 'emerald' ? 'text-emerald-300/80' : 'text-amber-300/80'
  return (
    <div className="flex gap-2 text-[11px] leading-relaxed">
      <span className={`shrink-0 font-medium ${color}`}>{label}</span>
      <span className="text-white/55">{text}</span>
    </div>
  )
}

export default function ApprovalCard({
  entry,
  busy,
  note,
  onDecide,
}: {
  entry: InboxEntry
  /** True while this item's decision is in flight — both buttons disable. */
  busy: boolean
  /** Server's answer for THIS item: a refusal reason, or a landed outcome. */
  note: { kind: 'refused' | 'done' | 'warning'; text: string } | null
  onDecide: (decision: Decision, responseData: unknown) => void
}) {
  const d = describeApproval(entry)
  const [reason, setReason] = useState('')
  const [showReason, setShowReason] = useState(false)

  const refuseDecision: Decision = d.hasRegisteredEffect ? 'denied' : 'explained'

  const submitRefusal = () => {
    if (!reason.trim()) return
    onDecide(refuseDecision, { reason: reason.trim() })
  }

  const noteColor =
    note?.kind === 'refused' ? 'text-red-300 border-red-500/25 bg-red-500/[0.07]'
      : note?.kind === 'warning' ? 'text-amber-300 border-amber-500/25 bg-amber-500/[0.07]'
        : 'text-emerald-300 border-emerald-500/25 bg-emerald-500/[0.07]'

  return (
    <article className="rounded-xl border border-white/10 bg-[#080808] p-3.5">
      <div className="flex items-start justify-between gap-3 mb-2">
        <p className="text-white text-xs font-medium leading-snug">{d.question}</p>
        <span className="shrink-0 text-[10px] font-mono text-white/30">{timeRemaining(entry.expires_at)}</span>
      </div>

      <p className="text-[10px] font-mono text-white/35 mb-2.5">
        asked by {d.agent} · {entry.type} · inbox {entry.id}
      </p>

      <div className="space-y-1.5 mb-3">
        <Consequence label="If you approve" text={d.ifApproved} tone="emerald" />
        <Consequence label="If you refuse" text={d.ifRefused} tone="amber" />
      </div>

      {note && (
        <p role="status" className={`mb-3 rounded-lg border px-2.5 py-1.5 text-[11px] leading-snug ${noteColor}`}>
          {note.text}
        </p>
      )}

      {showReason && (
        <div className="mb-2.5">
          <label htmlFor={`reason-${entry.id}`} className="block text-[10px] text-white/40 mb-1">
            Why? Recorded on the decision — required.
          </label>
          <textarea
            id={`reason-${entry.id}`}
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={2}
            className="w-full bg-transparent border border-white/10 rounded-lg px-2.5 py-1.5 text-[11px] text-white outline-none focus:border-white/25 resize-none"
          />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {/* No approve button when approving would change nothing. The server
            refuses that case with a 422; rendering the button anyway would
            just be an invitation to get refused. */}
        {d.approveLabel && (
          <button
            type="button"
            disabled={busy}
            onClick={() => onDecide('approved', reason.trim() ? { reason: reason.trim() } : undefined)}
            className="px-3 py-1.5 text-[11px] font-medium rounded-lg bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {d.approveLabel}
          </button>
        )}
        {showReason ? (
          <button
            type="button"
            disabled={busy || !reason.trim()}
            onClick={submitRefusal}
            className="px-3 py-1.5 text-[11px] font-medium rounded-lg bg-red-600/20 hover:bg-red-600/40 text-red-300 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {busy ? 'Recording…' : d.confirmRefuseLabel}
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={() => setShowReason(true)}
            className="px-3 py-1.5 text-[11px] font-medium rounded-lg bg-white/[0.06] hover:bg-white/[0.12] text-white/70 disabled:opacity-40 transition-colors"
          >
            {d.refuseLabel}
          </button>
        )}
      </div>
    </article>
  )
}

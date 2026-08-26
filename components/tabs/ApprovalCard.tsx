'use client'
// components/tabs/ApprovalCard.tsx — approval-surface piece (Wave 6)
//
// ONE approval item: what is being asked, by which agent, what happens if you
// approve, and what happens if you refuse.
//
// The rule this file exists to enforce: an approve button that does not say
// what it approves is worse than no button. Every string below — including
// the button labels — comes from `describeApproval()` in lib/approvals.ts,
// which is the SAME module `preflightDecision()` uses to decide whether the
// server will accept the click. A label therefore cannot promise an effect
// the server would refuse: `app/api/inbox/route.ts` throws at import time if
// its dispatch table and that registry ever disagree.
//
// A type with no registered effect gets NO approve button at all
// (`approveLabel === null`), because approving it would record a decision
// that changes nothing — and the server refuses it with a 422 rather than
// returning a green tick over a no-op.

import React, { useState } from 'react'
import { describeApproval, type ApprovalRow } from '@/lib/approvals'

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
            {busy ? 'Recording…' : `Confirm — ${d.refuseLabel}`}
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

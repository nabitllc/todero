'use client'
// components/nav/NowSignal.tsx — TOD-2381 (nav-six-destinations)
// Now absorbs "Infra — the signal" (the detail lives at settings/infra, the
// full InfraTab). This is a small, honest summary built ONLY from data
// app/page.tsx already fetches for real (liveStatus.rollup, the live agent
// roster, inbox pending count) — never the "Needs you / Since yesterday /
// Limits" widgets design/Main.dc.html mocks up. Those need agent-approval-
// queue, cost-ceiling and no-progress-halt telemetry this codebase does not
// expose yet; inventing numbers for them is exactly the anti-pattern this
// reconstruction is most trying to kill, so they are left out and named here
// instead (see the builder report for the full list of what was skipped).

import React from 'react'

interface Rollup { ok: number; down: number; degraded: number; unknown: number; total: number; overall: string }

interface AgentLike {
  id: string
  liveness?: 'live' | 'stale' | 'idle'
  currentTask?: string | null
}

interface Props {
  inboxPendingCount: number
  liveAgents: AgentLike[] | null
  rollup: Rollup | null
  onOpenInbox: () => void
  onOpenFleet: () => void
}

export default function NowSignal({ inboxPendingCount, liveAgents, rollup, onOpenInbox, onOpenFleet }: Props) {
  const live = (liveAgents ?? []).filter(a => a.liveness === 'live')

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <button onClick={onOpenInbox} className="text-left border border-white/10 rounded-lg p-4 hover:bg-white/[0.03] transition-colors">
          <p className="text-white/75 text-xs uppercase tracking-widest font-mono mb-1">Needs you</p>
          <p className={`text-2xl font-semibold ${inboxPendingCount > 0 ? 'text-amber-400' : 'text-white'}`}>{inboxPendingCount}</p>
          <p className="text-white/60 text-xs mt-1">from /api/inbox?status=pending</p>
        </button>

        <button onClick={onOpenFleet} className="text-left border border-white/10 rounded-lg p-4 hover:bg-white/[0.03] transition-colors">
          <p className="text-white/75 text-xs uppercase tracking-widest font-mono mb-1">Running now</p>
          <p className="text-2xl font-semibold text-white">{liveAgents === null ? '—' : live.length}</p>
          <p className="text-white/60 text-xs mt-1">agents with a live heartbeat</p>
        </button>

        <div className="border border-white/10 rounded-lg p-4">
          <p className="text-white/75 text-xs uppercase tracking-widest font-mono mb-1">Infra rollup</p>
          {rollup ? (
            <p className={`text-2xl font-semibold ${rollup.overall === 'ok' ? 'text-emerald-400' : rollup.overall === 'down' ? 'text-red-400' : 'text-amber-400'}`}>
              {rollup.ok}<span className="text-white/60 text-sm font-normal">/{rollup.total} ok</span>
            </p>
          ) : (
            <p className="text-2xl font-semibold text-white/60">—</p>
          )}
          <p className="text-white/60 text-xs mt-1">detail at Settings → Infra</p>
        </div>
      </div>

      {live.length > 0 && (
        <div className="border border-white/10 rounded-lg divide-y divide-white/5">
          {live.map(a => (
            <div key={a.id} className="flex items-center gap-2.5 px-4 py-2.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
              <span className="text-white text-sm font-medium">{a.id}</span>
              <span className="text-white/70 text-xs truncate">{a.currentTask || 'heartbeat just now'}</span>
            </div>
          ))}
        </div>
      )}

      {live.length === 0 && liveAgents !== null && (
        <p className="text-white/60 text-xs">No agent has a live heartbeat right now.</p>
      )}
    </div>
  )
}

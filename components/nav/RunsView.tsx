'use client'
// components/nav/RunsView.tsx — TOD-2381 (nav-six-destinations)
// "Runs does not exist yet. It is the one genuinely new destination. If the
// data behind it is not there, render an honest empty state that says what
// will appear and why it is empty — never a placeholder that implies data."
//
// This reads real rows straight from agent_runs (via the same same-origin db
// proxy app/page.tsx already uses for agent runs / issue counts). It does
// NOT render a per-step trace, a cost breakdown, or a "what it learned" panel
// like design/Run.dc.html's mockup shows — that mockup's own numbers (tokens
// per step, $ cost, "2 of 3 to skill") have no backing table in this schema
// today (agent_runs has only tokens_used/cost_usd at the RUN level, not per
// step). Inventing that breakdown would be exactly the fabricated-value
// defect this reconstruction cares most about, so it is left out and named
// here instead.

import React, { useEffect, useState } from 'react'
import { dbUrl, dbRestHeaders } from '@/lib/db/browser'
import { fetchJson } from '@/hooks/useApiData'

interface AgentRunRow {
  id: string
  agent_id: string
  task_id: string | null
  task_title: string | null
  status: string
  started_at: string
  completed_at: string | null
  tokens_used: number | null
  cost_usd: number | null
  error: string | null
}

function fmtDuration(startedAt: string, completedAt: string | null): string {
  const end = completedAt ? new Date(completedAt).getTime() : Date.now()
  const ms = Math.max(0, end - new Date(startedAt).getTime())
  const mins = Math.floor(ms / 60000)
  const secs = Math.floor((ms % 60000) / 1000)
  return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
}

const STATUS_TONE: Record<string, string> = {
  running: 'text-blue-400 bg-blue-500/10 border-blue-500/25',
  completed: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
  done: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
  error: 'text-red-400 bg-red-500/10 border-red-500/25',
  failed: 'text-red-400 bg-red-500/10 border-red-500/25',
}

export default function RunsView({ projectName }: { projectName?: string | null }) {
  const [rows, setRows] = useState<AgentRunRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const url = dbUrl('agent_runs?select=id,agent_id,task_id,task_title,status,started_at,completed_at,tokens_used,cost_usd,error&order=started_at.desc&limit=100')
    fetchJson<AgentRunRow[]>(url, { headers: dbRestHeaders() }).then(r => {
      if (cancelled) return
      if (!r.ok) { setError(`${r.error.status}: ${r.error.message}`); setRows(null); return }
      setError(null)
      setRows(Array.isArray(r.data) ? r.data : [])
    })
    return () => { cancelled = true }
  }, [])

  if (error) {
    return (
      <div className="border border-red-500/25 bg-red-500/[0.06] rounded-lg px-4 py-3 text-sm text-red-300">
        agent_runs unavailable — {error}
      </div>
    )
  }

  if (rows === null) {
    return <div className="text-white/60 text-sm py-8 text-center">Loading runs…</div>
  }

  if (rows.length === 0) {
    return (
      <div className="border border-dashed border-white/15 rounded-xl px-5 py-8 text-center space-y-2">
        <p className="text-white/70 text-sm font-medium">
          No runs recorded yet{projectName ? ` — ${projectName} has not had an agent dispatched to it` : ''}.
        </p>
        <p className="text-white/75 text-xs max-w-md mx-auto leading-relaxed">
          This will fill in the moment an agent is dispatched — every row comes straight from the
          <code className="mx-1 text-white/70 font-mono">agent_runs</code>
          table (agent, task, status, started/completed, tokens, cost). Nothing here is estimated.
          {projectName && ' Runs are agent-wide, not filtered by project — an agent works across every project it is assigned to.'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-white/75 text-xs font-mono">
        {rows.length} run{rows.length === 1 ? '' : 's'} · every number below is recorded, never estimated · step-level trace and per-step cost are not captured by this schema yet
        {projectName && ' · shown across every project, not filtered to ' + projectName}
      </p>
      <div className="border border-white/10 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/[0.04] text-left text-white/75 text-xs">
              <th className="px-3 py-2 font-medium">Agent</th>
              <th className="px-3 py-2 font-medium">Task</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Duration</th>
              <th className="px-3 py-2 font-medium text-right">Tokens</th>
              <th className="px-3 py-2 font-medium text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-b border-white/5 last:border-b-0 hover:bg-white/[0.03]">
                <td className="px-3 py-2.5 text-white font-medium">{r.agent_id}</td>
                <td className="px-3 py-2.5 text-white/70 max-w-[320px] truncate" title={r.error ?? undefined}>
                  {r.task_title || '—'}
                  {r.error && <span className="ml-2 text-red-400 text-xs">· {r.error.slice(0, 60)}</span>}
                </td>
                <td className="px-3 py-2.5">
                  <span className={`text-xs font-mono border rounded px-1.5 py-0.5 ${STATUS_TONE[r.status] ?? 'text-white/70 bg-white/5 border-white/10'}`}>
                    {r.status}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-white/70 font-mono text-xs">{fmtDuration(r.started_at, r.completed_at)}</td>
                <td className="px-3 py-2.5 text-right text-white/70 font-mono text-xs">{r.tokens_used ?? '—'}</td>
                <td className="px-3 py-2.5 text-right text-white/70 font-mono text-xs">{r.cost_usd != null ? `$${r.cost_usd.toFixed(2)}` : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

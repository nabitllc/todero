'use client'
// components/nav/RunsView.tsx — TOD-2381 (nav-six-destinations), extended by
// the runs-traces piece (Run Safety & Enforcement).
//
// "Runs does not exist yet. It is the one genuinely new destination. If the
// data behind it is not there, render an honest empty state that says what
// will appear and why it is empty — never a placeholder that implies data."
//
// This reads real rows straight from agent_runs (via the same same-origin db
// proxy app/page.tsx already uses for agent runs / issue counts).
//
// WHAT CHANGED, AND WHAT DID NOT
// ------------------------------
// This file used to say, correctly, that it does NOT render a per-step trace
// or a cost breakdown because "agent_runs has only tokens_used/cost_usd at the
// RUN level, not per step". That refusal was right, and it was NOT fixed by
// making the empty look nicer: migrations/060_run_steps.sql adds the missing
// table, POST /api/run-steps validates writes into it, and
// components/tabs/RunTraceCard.tsx draws the trace from those rows. A run with
// no run_steps rows still says so in words — see lib/run-trace.ts's
// NO_STEPS_MESSAGE — because an empty trace would imply the run did nothing.
//
// Still NOT rendered, for the original reason: design/Run.dc.html's "What it
// learned" panel and its "2 of 3 to skill" counter. No column records a
// per-run lesson or its promotion progress; the promotion threshold lives in a
// script. RunTraceCard names that absence on screen instead of approximating it.

import React, { useEffect, useState } from 'react'
import { dbUrl, dbRestHeaders } from '@/lib/db/browser'
import { formatElapsedBetween } from '@/lib/time'
import { fetchJson } from '@/hooks/useApiData'
import { useProjectScope } from './ProjectScope'
import RunTraceCard from '@/components/tabs/RunTraceCard'

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
  /** Written only by lib/agent-budget.ts's stopRun — the one source of "a ceiling fired". */
  stopped_reason: string | null
  error: string | null
}

/**
 * one-clock (pieces6): the duration and the word that says which duration it
 * is.
 *
 * This column used to render a bare number from a local formatter, and the
 * SAME run could read "30s" here (started -> completed) and "14h 37m" on the
 * Fleet Office canvas (started -> now) with nothing on either screen saying
 * which measurement it was. Both numbers were correct; the reader could not
 * tell them apart. So the word ships with the number:
 *
 *   ran 30s        — the run finished, and this is how long it took
 *   running 14h 37m — the run has not finished, and this is how long so far
 *   —              — agent_runs.started_at is null, so nothing was measured
 *
 * The arithmetic is lib/time.ts's and nothing here duplicates it.
 */
function runDuration(startedAt: string, completedAt: string | null): { text: string; title: string } {
  const value = formatElapsedBetween(startedAt, completedAt)
  if (value === null) {
    return { text: '—', title: 'agent_runs.started_at is null — this run’s duration was never recorded' }
  }
  return completedAt
    ? { text: `ran ${value}`, title: 'agent_runs.started_at → completed_at' }
    : { text: `running ${value}`, title: 'agent_runs.started_at → now — this run has not completed' }
}

const STATUS_TONE: Record<string, string> = {
  running: 'text-blue-400 bg-blue-500/10 border-blue-500/25',
  completed: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
  done: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
  error: 'text-red-400 bg-red-500/10 border-red-500/25',
  failed: 'text-red-400 bg-red-500/10 border-red-500/25',
  stopped: 'text-amber-400 bg-amber-500/10 border-amber-500/25',
}

export default function RunsView() {
  // scope-is-a-boundary: read from the one Context Provider instead of a
  // same-named prop — see components/nav/ProjectScope.tsx. Runs is
  // deliberately agent-wide (see file header), so the scope is used only for
  // the copy below, never as a query filter.
  const { project: projectName } = useProjectScope()
  const [rows, setRows] = useState<AgentRunRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** The one run whose trace is open. Null = none; this is a drill-down, not a list of traces. */
  const [openRunId, setOpenRunId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const url = dbUrl('agent_runs?select=id,agent_id,task_id,task_title,status,started_at,completed_at,tokens_used,cost_usd,stopped_reason,error&order=started_at.desc&limit=100')
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
          table (agent, task, status, started/completed, tokens, cost), and opening a row shows its
          per-step trace from
          <code className="mx-1 text-white/70 font-mono">run_steps</code>.
          Nothing here is estimated.
          {projectName && ' Runs are agent-wide, not filtered by project — an agent works across every project it is assigned to.'}
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-white/75 text-xs font-mono">
        {rows.length} run{rows.length === 1 ? '' : 's'} · every number below is recorded, never estimated · open a run for its per-step trace from run_steps
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
            {rows.map(r => {
              const open = openRunId === r.id
              return (
                <React.Fragment key={r.id}>
                  <tr
                    className={`border-b border-white/5 hover:bg-white/[0.03] cursor-pointer ${open ? 'bg-white/[0.04]' : ''}`}
                    onClick={() => setOpenRunId(open ? null : r.id)}
                    aria-expanded={open}
                    aria-controls={`run-trace-${r.id}`}
                    tabIndex={0}
                    role="button"
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setOpenRunId(open ? null : r.id)
                      }
                    }}
                  >
                    <td className="px-3 py-2.5 text-white font-medium">
                      <span className="text-white/40 font-mono text-xs mr-1.5">{open ? '▾' : '▸'}</span>
                      {r.agent_id}
                    </td>
                    <td className="px-3 py-2.5 text-white/70 max-w-[320px] truncate" title={r.error ?? undefined}>
                      {r.task_title || '—'}
                      {r.error && <span className="ml-2 text-red-400 text-xs">· {r.error.slice(0, 60)}</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-xs font-mono border rounded px-1.5 py-0.5 ${STATUS_TONE[r.status] ?? 'text-white/70 bg-white/5 border-white/10'}`}>
                        {r.status}
                      </span>
                      {r.stopped_reason && (
                        <span className="ml-1.5 text-[10px] font-mono text-amber-400" title="agent_runs.stopped_reason">
                          {r.stopped_reason}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-white/70 font-mono text-xs" title={runDuration(r.started_at, r.completed_at).title}>
                      {runDuration(r.started_at, r.completed_at).text}
                    </td>
                    <td className="px-3 py-2.5 text-right text-white/70 font-mono text-xs">{r.tokens_used ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right text-white/70 font-mono text-xs">{r.cost_usd != null ? `$${r.cost_usd.toFixed(2)}` : '—'}</td>
                  </tr>
                  {open && (
                    <tr className="border-b border-white/5 bg-black/20">
                      <td colSpan={6} className="px-3 pb-4" id={`run-trace-${r.id}`}>
                        <RunTraceCard
                          runId={r.id}
                          agentId={r.agent_id}
                          startedAt={r.started_at}
                          completedAt={r.completed_at}
                          stoppedReason={r.stopped_reason}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

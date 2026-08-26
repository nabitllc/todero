'use client'
// ─── components/tabs/OfficeTab.tsx — Fleet ▸ Office ──────────────────────────
//
// fleet-cards piece. design/Fleet.dc.html's Office panel carries this line in
// its header:
//
//     "positions reflect the workspace folder each agent is in"
//
// On this app that sentence is false, and the piece brief is explicit about
// what to do when it is: "If that data does not exist, the office must SAY it
// is decorative rather than implying position means something."
//
// It does not exist. GET /api/agents builds every roster row with a literal
// `workspace: null` — all three builders in app/api/agents/route.ts do
// (buildAgents, buildRegistrationAgent, and the vault row builder). No agent
// reports a folder, and nothing on this host measures one. So this card counts
// the rows that DO report a workspace, live, and says in words what that
// number means. The claim is therefore self-correcting: the day agents start
// reporting a folder, the count stops being 0 and the wording changes with it,
// because both are computed from the same field rather than from a comment.
//
// The floor below is the existing AgentOffice canvas, unchanged. It is kept
// because it is a real activity view — its dots and its feed come from
// agent_runs rows — but its LAYOUT is a simulation, and the card now says so
// instead of letting an operator read a position as a fact.
//
// Second thing removed: this file used to carry a hardcoded id -> display-name
// map ('main' -> 'KAOS', 'ops' -> 'Ingo', …) used to label activity rows. That
// is eight agent names asserted by a component, which is exactly what "no
// hardcoded agent, model, or tier names" forbids — an id absent from the map
// silently borrowed a robot emoji and looked like the others. Names now come
// from the roster GET /api/agents actually returned, and an id with no roster
// row says so.

import React, { useCallback, useEffect, useState } from 'react'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import { fetchJson, type ApiError } from '@/hooks/useApiData'
import AgentOffice from '@/components/AgentOffice'
import Card from '@/components/nav/Card'
import { dbUrl, dbRestHeaders } from '@/lib/db/browser'
import { runLiveness, type AgentRunStatus } from '@/hooks/useAgentStatus'
import { formatElapsed } from '@/components/office/officeDrawing'

/** The roster fields this surface needs: who exists, and where they say they are. */
interface OfficeRosterRow {
  id: string
  name: string
  emoji?: string
  /** The workspace folder the agent reports. Null on every row today. */
  workspace?: string | null
}

interface OfficeRoster {
  agents: OfficeRosterRow[]
}

/** One `agent_runs` row as this panel reads it. */
interface RunRow {
  agent_id: string
  task_title?: string | null
  status?: string | null
  started_at?: string | null
}

const ROSTER_QUERY = '/api/agents'
const RUNS_QUERY = 'agent_runs?select=agent_id,task_title,status,started_at,tokens_used&order=started_at.desc&limit=20'

/**
 * The label for an agent id seen in an `agent_runs` row. An id the roster does
 * not name is reported as unknown TO THE ROSTER, with its raw id — never
 * dressed up with a generic emoji so it reads like a configured agent.
 */
function labelFor(agentId: string, roster: OfficeRosterRow[] | null): { name: string; note: string | null } {
  if (roster === null) return { name: agentId, note: 'roster not loaded — this is the raw agent_runs id' }
  const row = roster.find(a => a.id === agentId)
  if (!row) return { name: agentId, note: 'no roster row for this id' }
  return { name: row.name, note: null }
}

// ── Activity list ────────────────────────────────────────────────────────────

function RunList({
  title,
  tone,
  runs,
  roster,
  suffix,
}: {
  title: string
  tone: string
  runs: RunRow[]
  roster: OfficeRosterRow[] | null
  suffix?: string
}) {
  if (runs.length === 0) return null
  return (
    <div>
      <div className={`text-[9px] uppercase tracking-widest mb-1.5 font-semibold ${tone}`}>
        {title} ({runs.length})
      </div>
      {runs.map((r, i) => {
        const label = labelFor(r.agent_id, roster)
        return (
          <div key={`${r.agent_id}-${i}`} className="flex items-center gap-2 py-1.5 border-b border-white/10 last:border-0">
            <div className="min-w-0 flex-1">
              <p className="text-white/85 text-[11px] font-medium truncate">{label.name}</p>
              <p className="text-white/45 text-[9px] truncate">{r.task_title || 'no task title recorded on this run'}</p>
              {label.note && <p className="text-amber-300/70 text-[9px] truncate">{label.note}</p>}
            </div>
            {r.started_at && (
              <span className="text-[9px] text-white/40 font-mono shrink-0">
                {formatElapsed(r.started_at) || '<1m'}{suffix ?? ''}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function OfficeActivityPanel({ roster }: { roster: OfficeRosterRow[] | null }) {
  const [runs, setRuns] = useState<RunRow[]>([])
  const [runsError, setRunsError] = useState<ApiError | null>(null)
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const fetchRuns = () => {
      void fetchJson<RunRow[]>(dbUrl(RUNS_QUERY), { headers: dbRestHeaders() }).then(res => {
        // TOD-654: a refused query keeps the banner up instead of showing
        // "no runs" as though the office were simply idle.
        if (!res.ok) { setRunsError(res.error); setRuns([]); return }
        setRunsError(null)
        if (Array.isArray(res.data)) setRuns(res.data)
      })
    }
    fetchRuns()
    const iv = setInterval(fetchRuns, 120000)
    return () => clearInterval(iv)
  }, [])

  // Single shared liveness rule (hooks/useAgentStatus.ts:runLiveness) — the
  // canvas's "0 ACTIVE" and this panel's "Active (n)" can never disagree,
  // because they both run the same function over the same rows.
  const liveRuns = runs.filter(r => runLiveness(r) === 'live')
  const staleRuns = runs.filter(r => runLiveness(r) === 'stale')
  const endedRuns = runs.filter(r => runLiveness(r) === 'ended').slice(0, 10)
  const failedRuns = runs.filter(r => r.status === 'error')

  return (
    <div
      className={`absolute top-3 right-3 z-10 rounded-xl border border-white/10 shadow-2xl transition-all ${collapsed ? 'w-10' : 'w-72'}`}
      style={{ background: 'rgba(10,10,10,0.92)', backdropFilter: 'blur(12px)' }}
    >
      {collapsed ? (
        <button onClick={() => setCollapsed(false)} className="w-full h-10 flex items-center justify-center text-white/40 hover:text-white text-xs">◀</button>
      ) : (
        <div className="p-3 space-y-3 max-h-[60vh] overflow-y-auto">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-white/50">Subagent activity</span>
            <button onClick={() => setCollapsed(true)} className="text-white/30 hover:text-white/70 text-xs">▶</button>
          </div>
          <p className="font-mono text-[9px] text-white/30 leading-snug break-all">{RUNS_QUERY}</p>
          {runsError ? (
            <ApiErrorBanner error={runsError} />
          ) : (
            <>
              {liveRuns.length === 0 && (
                <div className="text-white/35 text-[10px] py-1">No agent_runs row is currently running.</div>
              )}
              <RunList title="Active" tone="text-emerald-400/70" runs={liveRuns} roster={roster} />
              <RunList title="Stale — process ended without reporting" tone="text-amber-400/70" runs={staleRuns} roster={roster} suffix=" ago" />
              <RunList title="Failed" tone="text-red-400/70" runs={failedRuns.slice(0, 3)} roster={roster} />
              <RunList title="Recent" tone="text-white/50" runs={endedRuns} roster={roster} />
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ── OfficeTab ────────────────────────────────────────────────────────────────

export default function OfficeTab({
  agentRunsData,
}: {
  // Kept in the signature because app/page.tsx passes it. The activity panel
  // reads agent_runs directly (with the query printed above it) rather than a
  // pre-digested map, so the numbers on screen have a query behind them.
  agentRunsData?: Record<string, { taskTitle: string; startedAt: string | null; status: AgentRunStatus }>
}) {
  const [roster, setRoster] = useState<OfficeRosterRow[] | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    const r = await fetchJson<OfficeRoster>(ROSTER_QUERY)
    if (r.ok && Array.isArray(r.data?.agents)) { setRoster(r.data.agents); setError(null) }
    else { setRoster(null); setError(r.ok ? { status: r.status, endpoint: ROSTER_QUERY, message: 'response carried no agents array' } : r.error) }
    setLoaded(true)
  }, [])

  useEffect(() => { void load() }, [load])

  const rows = roster ?? []
  const placed = rows.filter(a => typeof a.workspace === 'string' && a.workspace.trim() !== '')

  const source = (
    <>
      GET {ROSTER_QUERY} — counting rows whose `workspace` field is non-null; the route returns the full roster,
      no limit/offset, so the count is exact
    </>
  )

  // An error REPLACES the body. An empty floor over a failed roster fetch
  // would read as "no agents", which is the one thing it must never say.
  if (error) {
    return (
      <Card id="fleet-office" title="Where is each agent working?" source={source}>
        <ApiErrorBanner error={error} onRetry={load} />
      </Card>
    )
  }

  return (
    <Card
      id="fleet-office"
      title="Where is each agent working?"
      source={source}
      metric={loaded ? { value: placed.length, label: `of ${rows.length} agents report a workspace folder`, tone: placed.length === 0 ? 'amber' : 'default' } : undefined}
      empty={
        loaded && rows.length === 0
          ? { active: true, message: 'This fleet has no roster, so there is nobody to place on a floor. The Roster card on Fleet ▸ Team names the files that were searched.' }
          : undefined
      }
    >
      {loaded && placed.length === 0 ? (
        <p className="text-amber-300/85 text-[11px] leading-relaxed mb-2">
          No agent reports a workspace folder — GET {ROSTER_QUERY} returns <span className="font-mono">workspace: null</span>{' '}
          for all {rows.length} rows. <strong className="font-semibold">The positions on the floor below are decorative.</strong>{' '}
          Where a figure stands is a layout produced by the office canvas, not a measurement of where any agent is working.
          The activity panel and the status dots are real: they come from <span className="font-mono">agent_runs</span> rows.
        </p>
      ) : (
        <p className="text-white/45 text-[11px] leading-relaxed mb-2">
          {placed.length} of {rows.length} roster rows report a workspace folder. The floor below still LAYS OUT figures
          by the office canvas&apos;s own arrangement, not by that folder — a reported workspace is shown in the activity
          panel, never as a position.
        </p>
      )}
      <div className="relative h-[68vh] min-h-[460px] -mx-4 md:-mx-5 border-t border-white/5">
        <AgentOffice />
        <OfficeActivityPanel roster={roster} />
      </div>
    </Card>
  )
}

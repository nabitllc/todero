'use client'

import React, { useEffect, useState, useCallback } from 'react'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import ActivityFeed from '@/components/ActivityFeed'
import { readApiError, type ApiError } from '@/hooks/useApiData'
import { dbUrl, dbRestHeaders } from '@/lib/db/browser'
import Card from '@/components/nav/Card'

// cards-and-identity piece (Wave 6): Now's four cards — Needs you, Running
// now, Bolt status, Recent activity. Every other panel this file used to
// render (Subscriptions & Balances, Project Health, Per-Project Progress,
// the old two-hardcoded-then-later-query-driven Sprint Countdowns, Risk
// Radar and Today's Standup as SEPARATE cards) is gone from THIS
// destination, not rewritten in place — see the piece doc's build
// instruction 3: Subscriptions moves to Settings, Project Progress moves to
// Work, and Risk Radar + the inbox count + the blockers list merge into one
// "Needs you" card. Settings and Work are owned by other pieces; until they
// pick this up, that content simply does not exist anywhere in the app. That
// is a real, intentional gap — see the builder report, not a silent drop.
//
// TOD-654 follow-up (carried over): every fetch below distinguishes a
// refused/failed load from a genuinely empty answer. `null` = not
// loaded/refused; `[]` = the server said there is nothing. Cards render the
// failure in place of the empty state, never alongside it.

const SUPA_HEADERS = dbRestHeaders()

/** Loose projection of the issue rows these cards select. */
interface IssueRow {
  id?: string
  task_key?: string
  title?: string
  project?: string
  assignee?: string
  priority?: string
  status?: string
  type?: string
  blocked_by?: string | null
}

interface InboxItem { id: string; agent: string; type: string; created_at: string }

interface SprintRow { sprint_number?: number | string; name?: string; project?: string; start_date?: string; end_date?: string }

type Fetched<T> = { ok: true; data: T } | { ok: false; error: ApiError }

/** Short, readable label for provenance text: the path without its querystring. */
function endpointLabel(url: string): string {
  const path = url.split('?')[0]
  if (path.startsWith('/')) return path
  try { return new URL(path).pathname } catch { return path }
}

/** fetch + parse that hands back the failure instead of an empty array. */
async function fetchJson<T>(url: string, init?: RequestInit): Promise<Fetched<T>> {
  const endpoint = endpointLabel(url)
  try {
    const res = await fetch(url, init)
    if (!res.ok) return { ok: false, error: await readApiError(res, endpoint) }
    return { ok: true, data: (await res.json()) as T }
  } catch (e) {
    return {
      ok: false,
      error: { status: 0, endpoint, message: e instanceof Error ? e.message : 'could not reach the server' },
    }
  }
}

/** First failure in a Promise.all group, or null when every leg succeeded. */
function firstError(results: Fetched<unknown>[]): ApiError | null {
  const failed = results.find(r => !r.ok)
  return failed && !failed.ok ? failed.error : null
}

/** Rows out of a successful fetch; `[]` only ever means "the server said none". */
function rowsOf<T>(res: Fetched<T[]>): T[] {
  return res.ok && Array.isArray(res.data) ? res.data : []
}

/** Bump the returned counter to re-run a card's load effect. */
function useReload(): [number, () => void] {
  const [n, setN] = useState(0)
  return [n, useCallback(() => setN(v => v + 1), [])]
}

/** Skeleton stand-in for a list whose rows have not come back yet. */
function PendingRows({ rows = 2 }: { rows?: number }) {
  return (
    <div data-testid="pending-rows" aria-label="not loaded yet" className="space-y-1.5">
      {Array.from({ length: rows }).map((_, i) => (
        <span key={i} className="block h-2.5 rounded bg-white/10 animate-pulse" style={{ width: `${80 - i * 22}%` }} />
      ))}
    </div>
  )
}

/**
 * Bolt units (build instruction 4): a 24h window rendered with day-granularity
 * math is exactly the fabrication TOD-2401 deleted ("0 days left" with hours
 * still on the clock). This never invokes day math for anything under 48h —
 * it reads real hours/minutes off the millisecond difference directly, so
 * there is no rounding step that can collapse "9 hours left" into "0".
 */
function formatRemaining(ms: number): string {
  if (ms <= 0) return 'ended'
  const totalMinutes = Math.round(ms / 60000)
  if (totalMinutes < 60) return `${totalMinutes}m`
  const totalHours = ms / 3600000
  if (totalHours < 48) {
    const h = Math.floor(ms / 3600000)
    const m = Math.round((ms % 3600000) / 60000)
    return m > 0 ? `${h}h ${m}m` : `${h}h`
  }
  return `${Math.floor(ms / 86400000)}d`
}

// ─── Needs you — inbox + blockers + risk radar merged (build instruction 3) ──

interface NeedRow {
  key: string
  kind: 'inbox' | 'blocked' | 'risk'
  title: string
  subtitle: string
}

const KIND_LABEL: Record<NeedRow['kind'], { text: string; className: string }> = {
  inbox: { text: 'INBOX', className: 'bg-blue-500/10 text-blue-400 border-blue-500/20' },
  blocked: { text: 'BLOCKED', className: 'bg-red-500/10 text-red-400 border-red-500/20' },
  risk: { text: 'P0 BUG', className: 'bg-amber-500/10 text-amber-400 border-amber-500/20' },
}

function NeedsYouCard({ projectFilter, onNavigate }: { projectFilter: string | null; onNavigate: (id: string) => void }) {
  const [inboxItems, setInboxItems] = useState<InboxItem[] | null>(null)
  const [blocked, setBlocked] = useState<IssueRow[] | null>(null)
  const [p0, setP0] = useState<IssueRow[] | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [reloadKey, reload] = useReload()

  useEffect(() => {
    let cancelled = false
    const since24h = new Date(Date.now() - 24 * 3600000).toISOString()
    ;(async () => {
      const [inboxRes, blockedRes, p0Res] = await Promise.all([
        // Inbox is agent-approval-queue data, deliberately fleet-wide rather
        // than project-scoped — same as the badge PrimaryNav already shows.
        fetchJson<InboxItem[]>('/api/inbox?status=pending'),
        fetchJson<IssueRow[]>(
          dbUrl(`issues?or=(blocked_by.not.is.null,is_blocked.eq.true)&status=not.in.(completed,released,closed)&select=task_key,title,blocked_by,assignee&limit=5`),
          { headers: SUPA_HEADERS },
        ),
        fetchJson<IssueRow[]>(
          dbUrl(`issues?type=eq.bug&priority=eq.critical&status=in.(open,in_progress)&created_at=lte.${since24h}&select=task_key,title,project,assignee&limit=5`),
          { headers: SUPA_HEADERS },
        ),
      ])
      if (cancelled) return
      const failure = firstError([inboxRes, blockedRes, p0Res])
      if (failure) { setError(failure); setInboxItems(null); setBlocked(null); setP0(null); return }
      setError(null)
      setInboxItems(rowsOf(inboxRes))
      setBlocked(rowsOf(blockedRes))
      setP0(rowsOf(p0Res))
    })()
    return () => { cancelled = true }
  }, [reloadKey])

  const source = (
    <>
      GET /api/inbox?status=pending (fleet-wide)
      <br />
      /api/db/issues?or=(blocked_by.not.is.null,is_blocked.eq.true)&amp;status=not.in.(completed,released,closed)
      <br />
      /api/db/issues?type=eq.bug&amp;priority=eq.critical&amp;status=in.(open,in_progress)&amp;created_at=lte.&lt;24h ago&gt;
    </>
  )

  if (error) {
    return <Card id="now-needs-you" title="Needs you" source={source}><ApiErrorBanner error={error} onRetry={reload} /></Card>
  }
  if (inboxItems === null || blocked === null || p0 === null) {
    return <Card id="now-needs-you" title="Needs you" source={source}><PendingRows rows={3} /></Card>
  }

  const rows: NeedRow[] = [
    ...inboxItems.map(i => ({ key: `inbox-${i.id}`, kind: 'inbox' as const, title: i.type.replace(/_/g, ' '), subtitle: `agent: ${i.agent}` })),
    ...p0.map(i => ({ key: `p0-${i.task_key ?? i.id}`, kind: 'risk' as const, title: i.title ?? '(untitled)', subtitle: i.task_key ?? '' })),
    ...blocked.map(i => ({ key: `blocked-${i.task_key ?? i.id}`, kind: 'blocked' as const, title: i.title ?? '(untitled)', subtitle: i.blocked_by ? `blocked by ${i.blocked_by}` : (i.task_key ?? '') })),
  ]
  const total = rows.length

  return (
    <Card
      id="now-needs-you"
      title="Needs you"
      source={source}
      metric={total > 0 ? { value: total, label: 'waiting', tone: 'amber' } : { value: 0, label: 'waiting' }}
      empty={total === 0 ? {
        active: true,
        message: `Nothing needs you in ${projectFilter ?? 'this project'} right now — inbox, blockers and P0 bugs (>24h) are all clear.`,
      } : undefined}
    >
      <div className="space-y-1.5">
        {rows.slice(0, 6).map(r => (
          <button
            key={r.key}
            onClick={() => onNavigate(r.kind === 'inbox' ? 'inbox' : 'board')}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg border border-white/10 bg-[#080808] hover:bg-white/[0.04] text-left transition-colors"
          >
            <span className={`text-[9px] font-mono font-medium px-1.5 py-0.5 rounded border shrink-0 ${KIND_LABEL[r.kind].className}`}>
              {KIND_LABEL[r.kind].text}
            </span>
            <span className="text-white text-xs font-medium truncate flex-1">{r.title}</span>
            <span className="text-white/30 text-[10px] shrink-0 truncate max-w-[160px]">{r.subtitle}</span>
          </button>
        ))}
        {total > 6 && <p className="text-white/30 text-[10px] pl-1">+{total - 6} more</p>}
      </div>
    </Card>
  )
}

// ─── Running now — real heartbeat liveness, no token/cost figures this ──────
// codebase does not track on Now (see components/nav/NowSignal.tsx's header
// comment: those need agent-approval-queue/cost telemetry that doesn't exist
// yet — Runs, not Now, is where a real cost eventually belongs).

interface LiveAgentRow {
  id: string
  liveness?: 'live' | 'stale' | 'idle'
  currentTask?: string | null
}

interface AgentRunInfo { taskTitle: string; startedAt: string | null; status: string }

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m`
  return `${totalSec}s`
}

function RunningNowCard({
  liveAgents, agentsError, agentRunsData, onReload,
}: {
  liveAgents: LiveAgentRow[] | null
  agentsError: ApiError | null | undefined
  agentRunsData: Record<string, AgentRunInfo>
  onReload: () => void
}) {
  const source = 'GET /api/agents (liveness === "live") — fleet-wide, not project-scoped'
  if (agentsError) {
    return <Card id="now-running" title="Running now" source={source}><ApiErrorBanner error={agentsError} onRetry={onReload} /></Card>
  }
  if (liveAgents === null) {
    return <Card id="now-running" title="Running now" source={source}><PendingRows rows={2} /></Card>
  }
  const live = liveAgents.filter(a => a.liveness === 'live')
  return (
    <Card
      id="now-running"
      title="Running now"
      source={source}
      metric={{ value: live.length, label: live.length === 1 ? 'agent' : 'agents' }}
      empty={live.length === 0 ? { active: true, message: 'No agent has a live heartbeat right now.' } : undefined}
    >
      <div className="divide-y divide-white/5 border border-white/10 rounded-lg overflow-hidden">
        {live.map(a => {
          const run = agentRunsData[a.id]
          const elapsedMs = run?.startedAt ? Date.now() - new Date(run.startedAt).getTime() : null
          return (
            <div key={a.id} className="flex items-center gap-2.5 px-3 py-2.5">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 animate-pulse" />
              <span className="text-white text-sm font-medium shrink-0">{a.id}</span>
              <span className="text-white/60 text-xs truncate flex-1">{a.currentTask || run?.taskTitle || 'heartbeat just now'}</span>
              {elapsedMs !== null && <span className="text-white/40 text-xs font-mono shrink-0">{formatElapsed(elapsedMs)}</span>}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ─── Bolt status — the 24h equivalent of a sprint (build instruction 4) ─────
//
// Reads the same `sprints` table the old Sprint Countdowns card did (column
// names unchanged — this is a display/units change, not a migration). What
// changed: units are derived from the ACTUAL remaining milliseconds, never
// from a fixed day-granularity formula, so a 24h window renders in hours
// however short it gets — never "0 days left" while hours remain, which is
// the exact fabrication TOD-2401 deleted. A row whose window really does
// span two weeks renders honestly as a Sprint, not relabeled into a bolt it
// isn't (build instruction 4: "render it honestly rather than pretending it
// is a bolt").

function BoltStatusCard({ projectFilter }: { projectFilter: string | null }) {
  const [rows, setRows] = useState<SprintRow[] | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [reloadKey, reload] = useReload()
  const [, forceTick] = useState(0)

  useEffect(() => {
    let live = true
    const scope = projectFilter ? `&project=eq.${encodeURIComponent(projectFilter)}` : ''
    void (async () => {
      const r = await fetchJson<SprintRow[]>(
        dbUrl(`sprints?status=eq.active${scope}&select=sprint_number,name,project,start_date,end_date&order=end_date.asc&limit=4`),
        { headers: SUPA_HEADERS },
      )
      if (!live) return
      if (!r.ok) { setError(r.error); setRows(null); return }
      setError(null)
      setRows(Array.isArray(r.data) ? r.data : [])
    })()
    return () => { live = false }
  }, [projectFilter, reloadKey])

  // Re-render every 30s so the hour/minute countdown stays live without a refetch.
  useEffect(() => {
    const t = setInterval(() => forceTick(n => n + 1), 30000)
    return () => clearInterval(t)
  }, [])

  const source = `/api/db/sprints?status=eq.active${projectFilter ? `&project=eq.${projectFilter}` : ''}&select=sprint_number,name,project,start_date,end_date`

  if (error) {
    return <Card id="now-bolt-status" title="Bolt status" source={source}><ApiErrorBanner error={error} onRetry={reload} /></Card>
  }
  if (rows === null) {
    return <Card id="now-bolt-status" title="Bolt status" source={source}><PendingRows rows={2} /></Card>
  }
  if (rows.length === 0) {
    return (
      <Card
        id="now-bolt-status"
        title="Bolt status"
        source={source}
        empty={{
          active: true,
          message: `No active bolt for ${projectFilter ?? 'this project'}. A countdown appears here once one is opened — nothing is overdue, there is simply nothing scheduled yet.`,
        }}
      />
    )
  }

  const computed = rows.map(row => {
    const startsAt = row.start_date ? new Date(row.start_date) : null
    const endsAt = row.end_date ? new Date(row.end_date) : null
    const windowMs = startsAt && endsAt ? endsAt.getTime() - startsAt.getTime() : null
    // <=30h counts as bolt-scale even allowing for a little slack around the
    // nominal 24h; a real two-week sprint is nowhere near this threshold.
    const isBolt = windowMs !== null && windowMs <= 30 * 3600000
    const remainingMs = endsAt ? endsAt.getTime() - Date.now() : null
    const elapsedMs = startsAt ? Date.now() - startsAt.getTime() : null
    const pct = windowMs && windowMs > 0 && elapsedMs !== null ? Math.max(0, Math.min(100, Math.round((elapsedMs / windowMs) * 100))) : null
    const noun = windowMs === null ? 'Bolt' : isBolt ? 'Bolt' : 'Sprint'
    const label = row.name ?? (row.sprint_number != null ? `${noun} ${row.sprint_number}` : noun)
    return { row, remainingMs, pct, label, noun }
  })
  const soonest = computed.reduce((a, b) => (a.remainingMs ?? Infinity) <= (b.remainingMs ?? Infinity) ? a : b)

  return (
    <Card
      id="now-bolt-status"
      title="Bolt status"
      source={source}
      metric={soonest.remainingMs !== null ? { value: formatRemaining(soonest.remainingMs), label: 'left' } : undefined}
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {computed.map(({ row, remainingMs, pct, label, noun }) => {
          const urgent = remainingMs !== null && remainingMs <= 3 * 3600000 && remainingMs > 0
          const ended = remainingMs !== null && remainingMs <= 0
          return (
            <div key={`${row.project ?? ''}-${row.sprint_number ?? label}`} className="rounded-xl border border-white/10 p-3.5 bg-[#080808]">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="text-white/50 text-[10px] font-semibold uppercase tracking-widest">{label}</span>
                {row.project && <span className="text-white/25 text-[9px]">{row.project}</span>}
                {noun === 'Bolt' && (
                  <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-white/10 text-white/40 font-mono">24h</span>
                )}
                {urgent && <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-red-900/40 text-red-400 font-semibold">DUE SOON</span>}
              </div>
              {remainingMs !== null ? (
                <span className={`text-2xl font-bold tabular-nums leading-none ${ended ? 'text-white/40' : urgent ? 'text-red-500' : 'text-white/85'}`}>
                  {formatRemaining(Math.max(0, remainingMs))}{!ended && <span className="text-white/40 text-xs font-normal ml-1.5">left</span>}
                </span>
              ) : (
                <span className="text-white/40 text-sm">no end date set</span>
              )}
              {pct !== null && (
                <div className="w-full rounded-full h-1.5 bg-white/5 mt-2">
                  <div className={`h-1.5 rounded-full transition-all ${urgent ? 'bg-red-500' : 'bg-white/40'}`} style={{ width: `${pct}%` }} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// ─── Recent activity ─────────────────────────────────────────────────────────

function RecentActivityCard({ projectFilter, onNavigate }: { projectFilter: string | null; onNavigate: (id: string) => void }) {
  const [count, setCount] = useState<number | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [reloadKey, reload] = useReload()

  useEffect(() => {
    let cancelled = false
    const params = new URLSearchParams({ limit: '5' })
    if (projectFilter) params.set('project', projectFilter)
    fetchJson<unknown[]>(`/api/activity-feed?${params}`).then(res => {
      if (cancelled) return
      if (!res.ok) { setError(res.error); setCount(null); return }
      setError(null)
      setCount(Array.isArray(res.data) ? res.data.length : 0)
    })
    return () => { cancelled = true }
  }, [projectFilter, reloadKey])

  const source = `GET /api/activity-feed?limit=5${projectFilter ? `&project=${projectFilter}` : ''}`

  if (error) {
    return <Card id="now-recent-activity" title="Recent activity" source={source}><ApiErrorBanner error={error} onRetry={reload} /></Card>
  }

  return (
    <Card
      id="now-recent-activity"
      title="Recent activity"
      source={source}
      metric={count !== null ? { value: count, label: count === 1 ? 'event' : 'events' } : undefined}
      empty={count === 0 ? {
        active: true,
        message: `No activity for ${projectFilter ?? 'this project'} in the last window — that is correct, not broken.`,
      } : undefined}
    >
      {count !== 0 && <ActivityFeed limit={5} projectFilter={projectFilter} onNavigate={onNavigate} />}
    </Card>
  )
}

// ─── Now ──────────────────────────────────────────────────────────────────

export default function OverviewTab({
  globalSync,
  syncing,
  liveAgents,
  agentsError,
  agentRunsData,
  onNavigate,
  projectFilter,
}: {
  globalSync: () => Promise<void>
  syncing: boolean
  /** Real /api/agents roster — null = not loaded yet. */
  liveAgents: LiveAgentRow[] | null
  agentsError?: ApiError | null
  /** Real agent_runs poll, keyed by agent id — see app/page.tsx. */
  agentRunsData: Record<string, AgentRunInfo>
  onNavigate: (tab: string) => void
  projectFilter: string | null
}) {
  const [boltRunning, setBoltRunning] = useState(false)
  const [boltToast, setBoltToast] = useState<{ text: string; ok: boolean } | null>(null)

  // Endpoint name (/api/run-sprint) is legacy — app/api/** is out of this
  // piece's file ownership (another agent is verifying it concurrently) — but
  // what it starts is described honestly to the operator as a bolt.
  const handleRunBolt = async () => {
    setBoltRunning(true)
    setBoltToast(null)
    try {
      const res = await fetch('/api/run-sprint', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      const data = await res.json()
      if (res.ok && data.ok) {
        setBoltToast({ text: `Bolt started: ${data.task ?? data.message ?? 'Builder is working'}`, ok: true })
      } else {
        setBoltToast({ text: data.message ?? 'Bolt trigger failed', ok: false })
      }
    } catch {
      setBoltToast({ text: 'Could not reach the bolt API', ok: false })
    } finally {
      setBoltRunning(false)
      setTimeout(() => setBoltToast(null), 5000)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end gap-2">
        <button
          onClick={handleRunBolt}
          disabled={boltRunning}
          className="text-[10px] px-3 py-1.5 rounded-lg border border-emerald-500/30 text-emerald-400 hover:text-emerald-300 hover:border-emerald-400/50 bg-emerald-500/5 transition-all flex items-center gap-1.5 disabled:opacity-50 font-medium"
        >
          {boltRunning ? (
            <span className="w-3 h-3 border border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin inline-block" />
          ) : (
            <span>▶</span>
          )}
          {boltRunning ? 'Starting…' : 'Run Bolt'}
        </button>
        <button
          onClick={globalSync}
          disabled={syncing}
          className="text-[10px] px-3 py-1.5 rounded-lg border border-white/10 text-white/40 hover:text-white hover:border-white/20 bg-[#0f0f0f]/50 transition-all flex items-center gap-1.5 disabled:opacity-50"
        >
          {syncing ? (
            <span className="w-3 h-3 border border-white/30 border-t-transparent rounded-full animate-spin inline-block" />
          ) : (
            <span>↻</span>
          )}
          {syncing ? 'Syncing…' : 'Sync'}
        </button>
      </div>
      {boltToast && (
        <div className={`rounded-xl border px-4 py-3 text-xs font-medium ${boltToast.ok ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400' : 'border-red-500/30 bg-red-500/5 text-red-400'}`}>
          {boltToast.text}
        </div>
      )}

      <NeedsYouCard projectFilter={projectFilter} onNavigate={onNavigate} />
      <RunningNowCard liveAgents={liveAgents} agentsError={agentsError} agentRunsData={agentRunsData} onReload={globalSync} />
      <BoltStatusCard projectFilter={projectFilter} />
      <RecentActivityCard projectFilter={projectFilter} onNavigate={onNavigate} />
    </div>
  )
}

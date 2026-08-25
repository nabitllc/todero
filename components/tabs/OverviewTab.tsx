'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { AGENT_DISPLAY, daysUntil, daysSince, miniPct } from '@/lib/mc-constants'
import { Bar, SH } from '@/lib/mc-atoms'
import { deriveIssueStatusCategory } from '@/lib/status-category'
import ActiveAgentsCard from '@/components/ActiveAgentsCard'
import ActivityFeed from '@/components/ActivityFeed'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import { readApiError, useApiData, type ApiError } from '@/hooks/useApiData'
import { dbUrl, dbRestHeaders } from '@/lib/db/browser'

// TOD-654 follow-up: the Overview is the app's front door, and every panel on it
// used to parse every response body without checking `res.ok`. A 403/500 body parses
// into an object, `Array.isArray(...)` says false, and the panel quietly rendered
// "P0 Bugs 0" / "Nothing shipped" / "No blockers" over a refused request. Every
// fetch below now goes through `fetchJson`, which keeps the failure, and every
// panel renders the failure *in place of* its empty state — never alongside it.

const SUPA_HEADERS = dbRestHeaders()

/** Loose projection of the issue rows the Overview panels select. */
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
  parent_id?: string | null
  resolution_type?: string | null
}

interface SprintRow { sprint_number?: number | string; name?: string; project?: string; start_date?: string; end_date?: string }

type Fetched<T> = { ok: true; data: T } | { ok: false; error: ApiError }

/**
 * Short, readable label for the banner: the path without its querystring,
 * which on the database proxy runs to hundreds of characters.
 */
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

/** The three statuses the board treats as finished. */
const isDone = (status?: string) => ['completed', 'released', 'closed'].includes(status ?? '')

/** Rows out of a successful fetch; `[]` only ever means "the server said none". */
function rowsOf(res: Fetched<IssueRow[]>): IssueRow[] {
  return res.ok && Array.isArray(res.data) ? res.data : []
}

/** Bump the returned counter to re-run a panel's load effect. */
function useReload(): [number, () => void] {
  const [n, setN] = useState(0)
  return [n, useCallback(() => setN(v => v + 1), [])]
}

/**
 * A value nobody has answered yet: an em-dash and a pulsing bar.
 *
 * Deliberately not `0`. A zero is a claim — "we asked and there are none" —
 * and rendering it before the request resolves (or forever, when the app
 * bundle never booted and no request was made at all) is the exact lie this
 * piece exists to remove.
 */
function Pending({ w = 'w-6' }: { w?: string }) {
  return (
    <span data-testid="pending-value" aria-label="not loaded yet" className="inline-flex items-center gap-1.5 align-middle">
      <span className="text-white/40 tabular-nums">&mdash;</span>
      <span className={`${w} h-1.5 rounded-full bg-white/10 animate-pulse`} />
    </span>
  )
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

/** The card chrome every Overview panel shares. */
function PanelCard({ icon, title, badge, children }: {
  icon: string
  title: string
  badge?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="rounded-2xl border border-white/10 p-4 md:p-5 bg-[#0f0f0f]">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">{icon}</span>
        <span className="text-xs font-semibold tracking-widest text-white/50 uppercase">{title}</span>
        {badge}
      </div>
      {children}
    </div>
  )
}

// INF-77: Needs-attention block (high/critical open issues)
function NeedsAttentionBlock() {
  const [items, setItems] = useState<IssueRow[]>([])
  const [error, setError] = useState<ApiError | null>(null)
  const [reloadKey, reload] = useReload()
  useEffect(() => {
    let cancelled = false
    fetchJson<IssueRow[]>(dbUrl(`issues?assignee=eq.main&status=in.(open,backlog)&priority=in.(critical,high)&select=task_key,title,project,priority,blocked_by,description&order=priority.asc&limit=5`), {
      headers: SUPA_HEADERS,
    }).then(res => {
      if (cancelled) return
      setError(res.ok ? null : res.error)
      setItems(rowsOf(res))
    })
    return () => { cancelled = true }
  }, [reloadKey])
  // A refused load is louder than a quiet block, not quieter than one.
  if (error) {
    return (
      <PanelCard icon="🚨" title="Needs Your Attention">
        <ApiErrorBanner error={error} onRetry={reload} />
      </PanelCard>
    )
  }
  if (items.length === 0) return null
  return (
    <div className="rounded-2xl border border-white/10 p-4 md:p-5 bg-[#0f0f0f]">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">🚨</span>
        <span className="text-xs font-semibold tracking-widest text-white/50 uppercase">Needs Your Attention</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-900/30 text-red-400 font-medium">{items.length}</span>
      </div>
      <div className="space-y-2">
        {items.slice(0, 3).map((t, i) => (
          <div key={t.task_key || i} className="flex items-start gap-3 px-3 py-2.5 rounded-xl border border-white/10 bg-[#080808]">
            <span className="text-red-400 text-xs mt-0.5">{t.priority === 'critical' ? '🔴' : '🟠'}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {t.task_key && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-white/40 shrink-0">{t.task_key}</span>}
                <p className="text-white text-xs font-medium truncate">{t.title}</p>
              </div>
              <p className="text-white/30 text-[10px] mt-0.5 truncate">
                {t.blocked_by ? `Blocked by: ${t.blocked_by}` : t.project || 'Needs decision'}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// INF-76: Done-yesterday wins callout
function DoneYesterdayWins() {
  const [wins, setWins] = useState<IssueRow[]>([])
  const [error, setError] = useState<ApiError | null>(null)
  const [reloadKey, reload] = useReload()
  useEffect(() => {
    let cancelled = false
    const now = new Date()
    const yStart = new Date(now); yStart.setDate(now.getDate()-1); yStart.setHours(0,0,0,0)
    const yEnd = new Date(now); yEnd.setHours(0,0,0,0)
    fetchJson<IssueRow[]>(dbUrl(`issues?status=in.(completed,released,closed)&updated_at=gte.${yStart.toISOString()}&updated_at=lt.${yEnd.toISOString()}&select=task_key,title,project,assignee,resolution_type&limit=10`), {
      headers: SUPA_HEADERS,
    }).then(res => {
      if (cancelled) return
      setError(res.ok ? null : res.error)
      setWins(rowsOf(res))
    })
    return () => { cancelled = true }
  }, [reloadKey])
  if (error) {
    return (
      <PanelCard icon="🏆" title="Yesterday's Wins">
        <ApiErrorBanner error={error} onRetry={reload} />
      </PanelCard>
    )
  }
  if (wins.length === 0) return null
  const ASSIGNEE_EMOJI: Record<string,string> = { main:'🧠', builder:'🔨', tester:'🧪', scout:'🔍', ops:'⚙️', 'kemuni-sme':'🚀', 'vespera-sme':'🖤' }
  return (
    <div className="bg-[#0f0f0f] border border-white/10 rounded-xl p-4 md:p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">🏆</span>
        <span className="text-xs font-semibold tracking-widest text-emerald-400 uppercase">Yesterday&apos;s Wins</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-900/40 text-emerald-400 font-medium">{wins.length} shipped</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {wins.map((w, i) => (
          <div key={w.task_key || i} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-emerald-900/30 text-xs bg-emerald-500/5">
            {w.assignee && ASSIGNEE_EMOJI[w.assignee] && <span>{ASSIGNEE_EMOJI[w.assignee]}</span>}
            {w.task_key && <span className="font-mono text-emerald-600 text-[9px]">{w.task_key}</span>}
            <span className="text-emerald-300 truncate max-w-[180px]">{w.title}</span>
            {w.project && <span className="text-emerald-700 text-[9px]">{w.project}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

interface RiskSignals { p0Bugs: IssueRow[]; blocked: IssueRow[]; noChildren: IssueRow[] }

// MC-119: Risk Radar card
function RiskRadarCard({ onNavigate }: { onNavigate: (tab: string) => void }) {
  // null until every leg of the load has returned ok. An empty-array seed
  // rendered three green "0" badges on first paint — and permanently whenever
  // the bundle failed to boot, because then the effect below never ran.
  const [risks, setRisks] = useState<RiskSignals | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [reloadKey, reload] = useReload()
  useEffect(() => {
    let cancelled = false
    const since24h = new Date(Date.now() - 24 * 3600000).toISOString()
    ;(async () => {
      const [p0, blocked, features] = await Promise.all([
        fetchJson<IssueRow[]>(dbUrl(`issues?type=eq.bug&priority=eq.critical&status=in.(open,in_progress)&created_at=lte.${since24h}&select=task_key,title,project,assignee&limit=20`), { headers: SUPA_HEADERS }),
        fetchJson<IssueRow[]>(dbUrl(`issues?is_blocked=eq.true&assignee=not.is.null&status=not.in.(completed,released,closed)&select=task_key,title,project,assignee,blocked_by&limit=20`), { headers: SUPA_HEADERS }),
        fetchJson<IssueRow[]>(dbUrl(`issues?type=eq.feature&status=not.in.(completed,released,closed)&select=id,task_key,title,project&limit=100`), { headers: SUPA_HEADERS }),
      ])
      if (cancelled) return
      // Any leg refusing means the counts below would be fiction.
      const failure = firstError([p0, blocked, features])
      if (failure) { setError(failure); setRisks(null); return }

      const featureIds = rowsOf(features).map(f => f.id).filter((id): id is string => !!id)
      // Scoped to the (small) set of open features rather than pulling every
      // parent_id in the table: that used to be `limit=1000` over ~2000+ rows,
      // which silently dropped children for whichever features lost the coin
      // flip and made them look orphaned ("Features (0 children)") when they
      // were not.
      const children = featureIds.length === 0
        ? { ok: true as const, data: [] as IssueRow[] }
        : await fetchJson<IssueRow[]>(dbUrl(`issues?parent_id=in.(${featureIds.join(',')})&select=parent_id&limit=1000`), { headers: SUPA_HEADERS })
      if (cancelled) return
      const childrenFailure = firstError([children])
      if (childrenFailure) { setError(childrenFailure); setRisks(null); return }
      setError(null)
      const parentIds = new Set(rowsOf(children).map(c => c.parent_id))
      const noChildren = rowsOf(features).filter(f => !parentIds.has(f.id ?? null))
      setRisks({ p0Bugs: rowsOf(p0), blocked: rowsOf(blocked), noChildren })
    })()
    return () => { cancelled = true }
  }, [reloadKey])
  // `items: null` = not answered. Every counter below is derived from it, so
  // there is no path that can turn "unknown" back into a number.
  const signals: { label: string; items: IssueRow[] | null; icon: string }[] = [
    { label: 'P0 Bugs (>24h)', items: risks?.p0Bugs ?? null, icon: '\u{1F534}' },
    { label: 'Blocked Issues', items: risks?.blocked ?? null, icon: '\u{1F6AB}' },
    { label: 'Features with no children', items: risks?.noChildren ?? null, icon: '\u26A0\uFE0F' },
  ]
  return (
    <PanelCard icon={'\u{1F6E1}\uFE0F'} title="Risk Radar">
      {error ? <ApiErrorBanner error={error} onRetry={reload} /> : (
      <div className="space-y-2.5">
        {signals.map(s => {
          const count = s.items === null ? null : s.items.length
          const badgeClass = count === null
            ? 'bg-white/5 text-white/40 border border-white/10 cursor-default'
            : count === 0
              ? 'bg-green-500/10 text-green-400 border border-green-500/20'
              : count <= 3
                ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                : 'bg-red-500/10 text-red-400 border border-red-500/20'
          return (
            <div key={s.label} className="rounded-xl border border-white/10 px-3 py-2.5 bg-[#080808]">
              <div className="flex items-center gap-2">
                <span className="text-xs">{s.icon}</span>
                <span className="text-white/40 text-xs flex-1">{s.label}</span>
                <button onClick={() => onNavigate('board')} disabled={count === null}
                  className={`text-xs font-bold px-2 py-0.5 rounded-full transition-colors hover:opacity-80 ${badgeClass}`}>
                  {count === null ? <Pending w="w-5" /> : count}
                </button>
              </div>
              {count === null && <div className="mt-2"><PendingRows rows={2} /></div>}
              {s.items !== null && count !== null && count > 0 && (
                <div className="mt-2 space-y-1">
                  {s.items.slice(0, 3).map((item, i) => (
                    <div key={item.task_key || i} className="flex items-center gap-2 text-[10px]">
                      {item.task_key && <span className="font-mono text-white/50">{item.task_key}</span>}
                      <span className="text-white/40 truncate">{item.title}</span>
                    </div>
                  ))}
                  {count > 3 && <span className="text-[9px] text-white/30">+{count - 3} more</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>
      )}
    </PanelCard>
  )
}

interface StandupData { shipped: IssueRow[]; inFlight: IssueRow[]; blockers: IssueRow[] }

// MC-120: Today's Standup card
function StandupCard() {
  // null = unanswered. Seeding empty arrays made the front page open on
  // "Shipped Yesterday (0) Nothing shipped / Ongoing Today (0) Nothing in
  // progress / Blockers (0) No blockers" — three confident answers to
  // questions nothing had asked yet.
  const [data, setData] = useState<StandupData | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [reloadKey, reload] = useReload()
  useEffect(() => {
    let cancelled = false
    const since24h = new Date(Date.now() - 24 * 3600000).toISOString()
    Promise.all([
      fetchJson<IssueRow[]>(dbUrl(`issues?status=in.(completed,released,closed)&updated_at=gte.${since24h}&select=task_key,title&order=updated_at.desc&limit=5`), { headers: SUPA_HEADERS }),
      fetchJson<IssueRow[]>(dbUrl(`issues?status=eq.in_progress&select=task_key,title,assignee&order=updated_at.desc&limit=5`), { headers: SUPA_HEADERS }),
      fetchJson<IssueRow[]>(dbUrl(`issues?or=(blocked_by.not.is.null,is_blocked.eq.true)&status=not.in.(completed,released,closed)&select=task_key,title,blocked_by,assignee&limit=5`), { headers: SUPA_HEADERS }),
    ]).then(([shipped, inFlight, blockers]) => {
      if (cancelled) return
      // "Nothing shipped" / "No blockers" must never stand in for a refusal.
      const failure = firstError([shipped, inFlight, blockers])
      setError(failure)
      if (failure) { setData(null); return }
      setData({
        shipped: rowsOf(shipped),
        inFlight: rowsOf(inFlight),
        blockers: rowsOf(blockers),
      })
    })
    return () => { cancelled = true }
  }, [reloadKey])
  // `items: null` until the three queries all return ok; the empty-state
  // sentence below is only reachable from a real, successful empty answer.
  const sections: { label: string; icon: string; items: IssueRow[] | null; emptyMsg: string; colorClass: string }[] = [
    { label: 'Shipped Yesterday', icon: '\u2705', items: data?.shipped ?? null, emptyMsg: 'Nothing shipped', colorClass: 'text-green-400' },
    { label: 'Ongoing Today', icon: '\u{1F527}', items: data?.inFlight ?? null, emptyMsg: 'Nothing in progress', colorClass: 'text-blue-400' },
    { label: 'Blockers', icon: '\u{1F6AB}', items: data?.blockers ?? null, emptyMsg: 'No blockers', colorClass: 'text-red-400' },
  ]
  return (
    <PanelCard icon={'\u{1F4CB}'} title="Today's Standup">
      {error ? <ApiErrorBanner error={error} onRetry={reload} /> : (
      <div className="space-y-3">
        {sections.map(s => (
          <div key={s.label}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs">{s.icon}</span>
              <span className={`text-[10px] font-semibold uppercase tracking-wider ${s.colorClass}`}>{s.label}</span>
              <span className="text-[9px] text-white/30">({s.items === null ? '\u2014' : s.items.length})</span>
            </div>
            {s.items === null ? (
              <div className="pl-5"><PendingRows rows={2} /></div>
            ) : s.items.length === 0 ? (
              <p className="text-[10px] text-white/20 italic pl-5">{s.emptyMsg}</p>
            ) : (
              <div className="space-y-1 pl-5">
                {s.items.slice(0, 5).map((item, i) => (
                  <div key={item.task_key || i} className="flex items-center gap-2 text-xs">
                    {item.task_key && <span className="text-[9px] font-mono text-white/50 shrink-0">{item.task_key}</span>}
                    <span className="text-white/40 truncate">{item.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      )}
    </PanelCard>
  )
}

// MC-102 / TOD-774: Sprint Progress Card with status category bar
const SPRINT_CATS = [
  { label: 'Planned', color: '#6b7280' },
  { label: 'Ongoing', color: '#3b82f6' },
  { label: 'SignOff', color: '#10b981' },
  { label: 'Done',    color: '#a855f7' },
] as const

function SprintProgressCard() {
  const [sprintData, setSprintData] = useState<{total:number;done:number}|null>(null)
  const [cats, setCats] = useState<Record<string,number>>({Planned:0,Ongoing:0,SignOff:0,Done:0})
  const [priorData, setPriorData] = useState<{total:number;done:number}|null>(null)
  const [sprintLabel, setSprintLabel] = useState('')
  const [sprintDate, setSprintDate] = useState('')
  const [countdown, setCountdown] = useState('')
  const [error, setError] = useState<ApiError | null>(null)
  const [reloadKey, reload] = useReload()

  useEffect(() => {
    let cancelled = false
    const headers = SUPA_HEADERS
    ;(async () => {
      // Fetch active sprint dynamically
      const sprints = await fetchJson<SprintRow[]>(dbUrl(`sprints?status=eq.active&select=sprint_number,start_date,end_date&limit=1`), { headers })
      if (cancelled) return
      if (!sprints.ok) { setError(sprints.error); setSprintData(null); return }
      setError(null)
      const active = Array.isArray(sprints.data) ? sprints.data[0] : undefined
      if (!active) return
      const activeDate = active.start_date ?? ''
      setSprintLabel(`Sprint ${active.sprint_number ?? '?'}`)
      setSprintDate(activeDate)

      // Fetch issues for active sprint
      const issues = await fetchJson<IssueRow[]>(dbUrl(`issues?sprint=eq.${activeDate}&select=id,status`), { headers })
      if (cancelled) return
      if (!issues.ok) { setError(issues.error); setSprintData(null); return }
      const rows = rowsOf(issues)
      setSprintData({ total: rows.length, done: rows.filter(i => isDone(i.status)).length })
      const counts: Record<string,number> = {Planned:0,Ongoing:0,SignOff:0,Done:0}
      for (const issue of rows) {
        const cat = deriveIssueStatusCategory(issue.status)
        if (cat) counts[cat] = (counts[cat] ?? 0) + 1
      }
      setCats(counts)

      // Prior sprint, for the velocity badge only. Best-effort on purpose: if it
      // fails the badge is omitted, which claims nothing — unlike the counts
      // above, which would be a lie if they were shown over a refused request.
      const priorSprints = await fetchJson<SprintRow[]>(dbUrl(`sprints?status=eq.closed&select=sprint_number,start_date&order=created_at.desc&limit=1`), { headers })
      if (cancelled || !priorSprints.ok) return
      const priorDate = Array.isArray(priorSprints.data) ? priorSprints.data[0]?.start_date : undefined
      if (!priorDate) return
      const priorIssues = await fetchJson<IssueRow[]>(dbUrl(`issues?sprint=eq.${priorDate}&select=id,status`), { headers })
      if (cancelled || !priorIssues.ok) return
      const priorRows = rowsOf(priorIssues)
      setPriorData({ total: priorRows.length, done: priorRows.filter(i => isDone(i.status)).length })
    })()
    return () => { cancelled = true }
  }, [reloadKey])

  useEffect(() => {
    const update = () => {
      // TOD-XXX: delegate to lib/time.ts — DST-correct. Previously hardcoded
      // +11 hours assuming EDT forever, broke after DST fall-back.
      // Dynamic import to avoid SSR issues
      import('@/lib/time').then(({ nextEtTime }) => {
        const now = new Date()
        const target = nextEtTime(7, 0, now)
        const diff = target.getTime() - now.getTime()
        const h = Math.floor(diff / 3600000)
        const m = Math.floor((diff % 3600000) / 60000)
        const s = Math.floor((diff % 60000) / 1000)
        setCountdown(`${h}h ${m}m ${s}s`)
      }).catch(() => {
        // Fallback: raw math
        const now = new Date()
        const target = new Date(now)
        target.setUTCHours(11, 0, 0, 0)
        if (target <= now) target.setDate(target.getDate() + 1)
        const diff = target.getTime() - now.getTime()
        setCountdown(`${Math.floor(diff/3600000)}h`)
      })
    }
    update()
    const t = setInterval(update, 1000)
    return () => clearInterval(t)
  }, [])

  if (error) {
    return (
      <PanelCard icon="🏃" title={sprintLabel || 'Sprint'}>
        <ApiErrorBanner error={error} onRetry={reload} />
      </PanelCard>
    )
  }
  if (!sprintData || sprintData.total === 0) return null
  const pct = Math.round((sprintData.done / sprintData.total) * 100)
  const velocityDelta = priorData && priorData.done > 0
    ? sprintData.done - priorData.done
    : null

  return (
    <div className="rounded-2xl border border-white/10 p-4 md:p-5 bg-[#0f0f0f]">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm">🏃</span>
          <span className="text-xs font-semibold tracking-widest text-white/50 uppercase">{sprintLabel || 'Sprint'}{sprintDate ? ` · ${sprintDate}` : ''}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-white/30">Next 7am EDT in</span>
          <span className="text-[11px] font-mono text-white/40">{countdown}</span>
        </div>
      </div>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-white text-sm font-semibold tabular-nums">{sprintData.done}/{sprintData.total}</span>
        <span className="text-white/50 text-xs">done</span>
        {velocityDelta !== null && (
          <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${velocityDelta > 0 ? 'bg-green-500/10 text-green-400' : velocityDelta < 0 ? 'bg-red-500/10 text-red-400' : 'bg-zinc-500/20 text-zinc-400'}`}>
            {velocityDelta > 0 ? '+' : ''}{velocityDelta} vs prior
          </span>
        )}
        <span className={`ml-auto text-lg font-bold tabular-nums ${pct === 100 ? 'text-green-500' : pct >= 50 ? 'text-blue-500' : 'text-amber-500'}`}>{pct}%</span>
      </div>
      <div className="w-full rounded-full h-2 bg-[#1a1a1a]">
        <div className={`h-2 rounded-full transition-all duration-500 ${pct === 100 ? 'bg-green-500' : pct >= 50 ? 'bg-blue-500' : 'bg-amber-500'}`} style={{width: pct+'%'}} />
      </div>
      {/* TOD-774: Status category breakdown bar */}
      <div className="mt-3">
        <div className="flex w-full rounded-full h-2 overflow-hidden bg-[#1a1a1a]">
          {SPRINT_CATS.map(c => {
            const w = sprintData.total > 0 ? ((cats[c.label] ?? 0) / sprintData.total) * 100 : 0
            return w > 0 ? (
              <div key={c.label} style={{width: w + '%', background: c.color}} className="h-2 transition-all duration-500" />
            ) : null
          })}
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1.5">
          {SPRINT_CATS.map(c => (
            <div key={c.label} className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{background: c.color}} />
              <span className="text-[9px] text-white/40">{c.label}</span>
              <span className="text-[9px] text-white/60 tabular-nums">{cats[c.label] ?? 0}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// MC-111: Project Breakdown Bars (epic/feature/issue)
function ProjectBreakdownBars({ project }: { project: string }) {
  const [data, setData] = useState<{epics:{done:number;total:number};features:{done:number;total:number};issues:{done:number;total:number}}|null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [reloadKey, reload] = useReload()
  useEffect(() => {
    let cancelled = false
    // Goes through /api/issues (limit=0 = every matching row, paged through
    // server-side) rather than the raw db proxy's `&limit=500`: a
    // per-project total above 500 — Todero alone runs ~1,600 — used to be
    // dropped from these bars with nothing to say a truncation happened.
    fetchJson<{ data: IssueRow[]; total: number }>(
      `/api/issues?project=${encodeURIComponent(project)}&limit=0`,
    ).then(res => {
      if (cancelled) return
      if (!res.ok) { setError(res.error); setData(null); return }
      setError(null)
      const rows = (res.data.data ?? []).filter(r => r.status !== 'backlog')
      const count = (type: string) => {
        const matching = rows.filter(r => r.type === type)
        return { done: matching.filter(r => isDone(r.status)).length, total: matching.length }
      }
      const leaves = rows.filter(r => !['epic','feature'].includes(r.type ?? ''))
      setData({ epics: count('epic'), features: count('feature'), issues: { done: leaves.filter(r => isDone(r.status)).length, total: leaves.length } })
    })
    return () => { cancelled = true }
  }, [project, reloadKey])
  if (error) {
    return (
      <div className="mt-2 pt-2 border-t border-white/10">
        <ApiErrorBanner error={error} onRetry={reload} />
      </div>
    )
  }
  if (!data) return null
  const rows = [
    { label: 'Epics', ...data.epics, colorClass: 'bg-purple-500' },
    { label: 'Features', ...data.features, colorClass: 'bg-blue-500' },
    { label: 'Issues', ...data.issues, colorClass: 'bg-green-500' },
  ]
  return (
    <div className="mt-2 pt-2 border-t border-white/10 space-y-1.5">
      {rows.map(r => (
        <div key={r.label} className="flex items-center gap-2">
          <span className="text-[9px] text-white/50 w-12 shrink-0">{r.label}</span>
          <div className="flex-1 h-1 rounded-full bg-[#1a1a1a]">
            <div className={`h-1 rounded-full transition-all ${r.colorClass}`} style={{width: r.total > 0 ? (r.done/r.total*100)+'%' : '0%'}} />
          </div>
          <span className="text-[9px] text-white/30 tabular-nums w-8 text-right">{r.done}/{r.total}</span>
        </div>
      ))}
    </div>
  )
}

/**
 * TOD-2368 round 3: the Per-Project Progress card used to read `proj.taskCounts`,
 * a field `/api/projects` never sends (that endpoint returns bare project rows —
 * no deadline, no color, no counts). Every card therefore rendered a permanent
 * "not measured" state. This fetches each project's real issue total with one
 * cheap head-style call — `?limit=1` still returns the exact PostgREST count via
 * `total` without shipping row data — so the figure is real the moment it
 * resolves, and stays null (rendered as "not measured") only while in flight or
 * on failure.
 */
function useProjectIssueTotals(names: readonly string[]): Record<string, number | null> {
  const [totals, setTotals] = useState<Record<string, number | null>>({})
  const key = names.join(',')
  useEffect(() => {
    let cancelled = false
    Promise.all(names.map(async name => {
      const res = await fetchJson<{ total: number }>(`/api/issues?project=${encodeURIComponent(name)}&limit=1`)
      return [name, res.ok && typeof res.data.total === 'number' ? res.data.total : null] as const
    })).then(entries => { if (!cancelled) setTotals(Object.fromEntries(entries)) })
    return () => { cancelled = true }
    // `key` is the stable, primitive form of `names` — depending on it
    // instead of the array avoids re-fetching every render on a fresh array
    // identity (the caller derives `names` from sprintProjects, so it is a
    // new array reference on every render even when the contents match).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return totals
}

type ServiceState = 'ok' | 'degraded' | 'down' | 'unknown'
interface ServiceReading { status: ServiceState; note: string; checkedAt: string }
interface LiveStatusPayload { services?: Record<string, ServiceReading> }

const SERVICE_STATE_COLOR: Record<ServiceState, string> = {
  ok: '#10b981',
  degraded: '#f59e0b',
  down: '#ef4444',
  unknown: '#71717a',
}

const SUBSCRIPTION_TILES: Array<{ key: string; name: string; icon: string }> = [
  { key: 'claude', name: 'Claude', icon: '🧠' },
  { key: 'vercel', name: 'Vercel', icon: '▲' },
  { key: 'braveSearch', name: 'Brave Search', icon: '🦁' },
]

/**
 * INF-66 / TOD: kill-fake-infra-greens. This panel used to hardcode three
 * subscriptions ("Claude Pro $20/mo · Active", "Vercel Pro · Renews Apr 24",
 * "Brave Search · Renews Apr 21") that were never read from anywhere — literal
 * strings next to nothing real, telling the operator three confident lies.
 * Every tile here now reads its status and note straight off `services`, the
 * same object /api/status hands to the Infra tab: 'unknown' renders its real
 * reason, never a fabricated plan/price.
 */
function SubscriptionsPanel({ liveStatus }: { liveStatus: LiveStatusPayload | null }) {
  const { data, error, refetch } = useApiData<LiveStatusPayload>('/api/status')
  const services: Record<string, ServiceReading> = liveStatus?.services ?? data?.services ?? {}
  const tiles = SUBSCRIPTION_TILES.map(({ key, name, icon }) => {
    const svc = services[key]
    const status: ServiceState = svc?.status ?? 'unknown'
    return { name, icon, note: svc?.note ?? 'not checked this request', color: SERVICE_STATE_COLOR[status], status }
  })
  return (
    <PanelCard icon="💳" title="Subscriptions & Balances">
      {error ? <ApiErrorBanner error={error} onRetry={refetch} /> : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {tiles.map(s => (
            <div key={s.name} className="rounded-xl border border-white/10 px-3 py-2.5 bg-[#080808]">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-xs">{s.icon}</span>
                <span className="text-white text-[11px] font-medium">{s.name}</span>
              </div>
              <p className="text-[10px]" style={{color: s.color}}>{s.note}</p>
            </div>
          ))}
        </div>
      )}
    </PanelCard>
  )
}

/**
 * Sprint countdowns, from the sprints table.
 *
 * This block used to render TWO HARDCODED CARDS — Vespera and Kemuni — built
 * from `KEMUNI_DEADLINE` / `VESPERA_DEADLINE` constants in `lib/mc-constants`.
 * They were not queried, so no project filter could ever remove them, and they
 * had run out months earlier: the most prominent thing on the landing screen
 * was two dead countdowns reading "0 days left · 100% elapsed" for projects the
 * operator had not selected. Michael described the effect exactly — it made a
 * working system look like a stalled one.
 *
 * A card now renders from a sprint row or it does not render. When there is no
 * active sprint, that is stated in words rather than implied by a dead number.
 */
function SprintCountdowns({ projectFilter }: { projectFilter?: string | null }) {
  const [sprints, setSprints] = useState<SprintRow[] | null>(null)
  const [failed, setFailed] = useState<ApiError | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let live = true
    const scope = projectFilter ? `&project=eq.${encodeURIComponent(projectFilter)}` : ''
    // fetchJson RETURNS its failure rather than throwing, so a `.catch` would
    // never fire and a failed load would render as "no active sprint" — the
    // exact silent-failure shape Wave 5 went after. Check `ok`.
    void (async () => {
      const r = await fetchJson<SprintRow[]>(
        dbUrl(`sprints?status=eq.active${scope}&select=sprint_number,name,project,start_date,end_date&order=end_date.asc&limit=4`),
        { headers: SUPA_HEADERS },
      )
      if (!live) return
      if (!r.ok) { setFailed(r.error); setSprints(null); return }
      setFailed(null)
      setSprints(Array.isArray(r.data) ? r.data : [])
    })()
    return () => { live = false }
  }, [projectFilter, reloadKey])

  const where = projectFilter ? `for ${projectFilter}` : 'across every project'

  // The shared banner, not a bespoke red div: one error surface across the app
  // means a failed load always looks like a failed load, and always offers the
  // same retry. scripts/smoke-test-layout.sh guards that this stays shared.
  if (failed) return <ApiErrorBanner error={failed} onRetry={() => setReloadKey(k => k + 1)} />
  if (sprints === null) {
    return <div className="rounded-2xl border border-white/10 px-5 py-4 text-xs text-white/30">Loading sprints…</div>
  }
  if (sprints.length === 0) {
    return (
      <div className="rounded-2xl border border-white/10 px-5 py-4">
        <p className="text-white/50 text-sm">No active sprint {where}.</p>
        <p className="text-white/30 text-xs mt-1">
          A countdown appears here once a sprint is opened. Nothing is overdue — there is simply nothing scheduled yet.
        </p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      {sprints.map(sp => {
        const startsAt = sp.start_date ? new Date(sp.start_date) : null
        const endsAt = sp.end_date ? new Date(sp.end_date) : null
        // Length comes from the row's own dates. The old cards carried a
        // hardcoded totalDays (9 and 30) that no longer matched anything.
        const totalDays =
          startsAt && endsAt ? Math.max(1, Math.round((endsAt.getTime() - startsAt.getTime()) / 86400000)) : null
        const left = endsAt ? daysUntil(endsAt) : null
        const elapsed = startsAt ? daysSince(startsAt) : null
        const pct = totalDays !== null && elapsed !== null ? miniPct(elapsed, totalDays) : null
        const urgent = left !== null && left <= 3
        const label = sp.name ?? (sp.sprint_number != null ? `Sprint ${sp.sprint_number}` : 'Sprint')

        return (
          <div key={`${sp.project ?? ''}-${sp.sprint_number ?? label}`} className="rounded-2xl border border-white/10 p-5 md:p-6 bg-white/[0.02]">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-white/40 text-xs font-semibold uppercase tracking-widest">{label}</span>
              {sp.project && <span className="text-white/25 text-[10px]">{sp.project}</span>}
              {urgent && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-900/40 text-red-400 font-semibold">DUE SOON</span>}
            </div>
            {left !== null ? (
              <div className="flex items-baseline gap-2 mb-1">
                <span className={`text-5xl md:text-6xl font-black tabular-nums leading-none ${urgent ? 'text-red-500' : 'text-white/80'}`}>{left}</span>
                <span className="text-white/50 text-lg font-medium">days left</span>
              </div>
            ) : (
              <p className="text-white/40 text-sm mb-1">No end date set</p>
            )}
            <p className="text-white/30 text-xs mb-3">
              {endsAt ? endsAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : 'end date not set'}
              {totalDays !== null && elapsed !== null ? ` · Day ${elapsed}/${totalDays}` : ''}
            </p>
            {pct !== null && (
              <>
                <div className="w-full rounded-full h-2.5 bg-white/5">
                  <div className={`h-2.5 rounded-full transition-all ${urgent ? 'bg-red-500' : 'bg-white/40'}`} style={{ width: pct + '%' }} />
                </div>
                <div className="flex justify-between mt-1.5">
                  <span className="text-white/30 text-[10px]">{pct}% elapsed</span>
                  <span className="text-white/30 text-[10px]">{100 - pct}% remaining</span>
                </div>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function OverviewTab({
  globalSync,
  syncing,
  liveStatus,
  sprintProjects,
  projectsError,
  onRetryProjects,
  onNavigate,
  projectFilter,
}: {
  globalSync: () => Promise<void>
  syncing: boolean
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped /api/status payload
  liveStatus: any
  /**
   * null = /api/projects has not answered yet, or refused. Never a stand-in
   * list: the progress cards below read done/total straight off these rows, so
   * a placeholder here surfaces as "Vespera 0% done 0/0" on the front page.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped project rows
  sprintProjects: any[] | null
  /** Why /api/projects failed, if it did — shown in place of the cards. */
  projectsError?: ApiError | null
  onRetryProjects?: () => void
  onNavigate: (tab: string) => void
  projectFilter?: string | null
}) {
  const [sprintRunning, setSprintRunning] = useState(false)
  const [sprintToast, setSprintToast] = useState<{text: string; ok: boolean} | null>(null)
  // Names come from the real /api/projects rows this component was handed —
  // never a hand-written list. Before sprintProjects has answered, this is
  // `[]`, so the totals hook simply has nothing to fetch yet.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped project rows
  const liveProjectNames = (sprintProjects ?? []).map((p: any) => p.name).filter((n): n is string => !!n)
  const projectIssueTotals = useProjectIssueTotals(liveProjectNames)

  const handleRunSprint = async () => {
    setSprintRunning(true)
    setSprintToast(null)
    try {
      const res = await fetch('/api/run-sprint', { method: 'POST', headers: { 'Content-Type': 'application/json' } })
      const data = await res.json()
      if (res.ok && data.ok) {
        setSprintToast({ text: `🚀 Sprint started: ${data.task ?? data.message ?? 'Builder is working'}`, ok: true })
      } else {
        setSprintToast({ text: data.message ?? 'Sprint trigger failed', ok: false })
      }
    } catch {
      setSprintToast({ text: 'Could not reach sprint API', ok: false })
    } finally {
      setSprintRunning(false)
      setTimeout(() => setSprintToast(null), 5000)
    }
  }

  return (
    <>
            <div className="space-y-5">

              {/* MC-112: Sync button + Run Sprint */}
              <div className="flex justify-end gap-2">
                <button
                  onClick={handleRunSprint}
                  disabled={sprintRunning}
                  className="text-[10px] px-3 py-1.5 rounded-lg border border-emerald-500/30 text-emerald-400 hover:text-emerald-300 hover:border-emerald-400/50 bg-emerald-500/5 transition-all flex items-center gap-1.5 disabled:opacity-50 font-medium">
                  {sprintRunning ? (
                    <span className="w-3 h-3 border border-emerald-400/30 border-t-emerald-400 rounded-full animate-spin inline-block" />
                  ) : (
                    <span>▶</span>
                  )}
                  {sprintRunning ? 'Starting...' : 'Run Sprint'}
                </button>
                <button
                  onClick={globalSync}
                  disabled={syncing}
                  className="text-[10px] px-3 py-1.5 rounded-lg border border-white/10 text-white/40 hover:text-white hover:border-white/20 bg-[#0f0f0f]/50 transition-all flex items-center gap-1.5 disabled:opacity-50">
                  {syncing ? (
                    <span className="w-3 h-3 border border-white/30 border-t-transparent rounded-full animate-spin inline-block" />
                  ) : (
                    <span>↻</span>
                  )}
                  {syncing ? 'Syncing...' : 'Sync'}
                </button>
              </div>
              {sprintToast && (
                <div className={`rounded-xl border px-4 py-3 text-xs font-medium ${sprintToast.ok ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-400' : 'border-red-500/30 bg-red-500/5 text-red-400'}`}>
                  {sprintToast.text}
                </div>
              )}

              <SprintCountdowns projectFilter={projectFilter} />

              {/* TOD-649: Active Agents live status */}
              <ActiveAgentsCard agentCurrentTask={liveStatus?.agentCurrentTask} />

              {/* ── Needs Your Attention (INF-77) ── */}
              <NeedsAttentionBlock />

              {/* MC-119: Risk Radar + MC-120: Standup */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <RiskRadarCard onNavigate={onNavigate} />
                <StandupCard />
              </div>

              {/* INF-76: Done-yesterday wins */}
              <DoneYesterdayWins />

              {/* ── Subscriptions & Balances (INF-66) ── */}
              <SubscriptionsPanel liveStatus={liveStatus ?? null} />

              {/* ── Project Health Card ── */}
              {(()=>{
                if (projectsError) {
                  return (
                    <PanelCard icon="📊" title="Project Health">
                      <ApiErrorBanner error={projectsError} onRetry={onRetryProjects} />
                    </PanelCard>
                  )
                }
                if (sprintProjects === null) {
                  return (
                    <PanelCard icon="📊" title="Project Health">
                      <PendingRows rows={3} />
                    </PanelCard>
                  )
                }
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped project rows
                const allProjects = sprintProjects.filter((p: any) => p.taskCounts && p.taskCounts.total > 0)
                // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped project rows
                const sorted = [...allProjects].sort((a: any, b: any) => (a.taskProgress ?? 0) - (b.taskProgress ?? 0))
                if (!sorted.length) return null
                return (
                  <div className="rounded-2xl border border-white/10 p-4 md:p-5 bg-[#0f0f0f]">
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">📊</span>
                        <span className="text-xs font-semibold tracking-widest text-white/50 uppercase">Project Health</span>
                      </div>
                      <span className="text-white/20 text-[10px]">sorted by progress ↑</span>
                    </div>
                    <div className="space-y-3.5">
                      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped project rows */}
                      {sorted.map((proj: any) => {
                        const tc = proj.taskCounts!
                        const pct = proj.taskProgress ?? 0
                        const isLow = pct < 30
                        const isMid = pct >= 30 && pct < 70
                        const barColor = isLow ? '#ef4444' : isMid ? '#f59e0b' : '#10b981'
                        const statusLabel = isLow ? 'Needs work' : isMid ? 'In progress' : 'Nearly done'
                        const statusColor = isLow ? '#ef4444' : isMid ? '#f59e0b' : '#10b981'
                        return (
                          <div key={proj.id}>
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-base shrink-0">{proj.emoji}</span>
                                <span className="text-white text-xs font-medium truncate">{proj.name}</span>
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0 font-medium"
                                  style={{background: statusColor+'18', color: statusColor}}>
                                  {statusLabel}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0 ml-2">
                                <span className="text-white/40 text-xs tabular-nums font-medium">{tc.done}<span className="text-white/20">/{tc.total}</span></span>
                                <span className="text-white/30 text-[10px] tabular-nums w-8 text-right">{pct}%</span>
                              </div>
                            </div>
                            <Bar v={pct} color={barColor} bg='#1a1a1a' />
                            {/* MC-109: Status breakdown subtext */}
                            <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1.5 text-[9px]">
                              {tc.open > 0 && <span className="text-white/50">Open: {tc.open}</span>}
                              {tc.inProgress > 0 && <span className="text-blue-400">In Progress: {tc.inProgress}</span>}
                              {(tc.inReview ?? 0) > 0 && <span className="text-amber-400">In Review: {tc.inReview}</span>}
                              {(tc.blocked ?? 0) > 0 && <span className="text-red-400 font-medium">Blocked: {tc.blocked}</span>}
                              {tc.open === 0 && tc.inProgress === 0 && !(tc.inReview ?? 0) && !(tc.blocked ?? 0) && (
                                <span className="text-white/20">All done</span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}

              {/* ── Per-Project Progress Reports (INF-65) ── */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm">📋</span>
                  <span className="text-xs font-semibold tracking-widest text-white/50 uppercase">Project Progress</span>
                </div>
                {projectsError ? (
                  <ApiErrorBanner error={projectsError} onRetry={onRetryProjects} />
                ) : sprintProjects === null ? (
                  /* Unanswered: names are not known yet -- they come from
                     /api/projects, which has not replied -- so these skeleton
                     cards carry no name text. Filling the slot with a guessed
                     name is the exact defect this card was rebuilt to remove;
                     four is a neutral placeholder count, not a claim. */
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                    {[0, 1, 2, 3].map(i => (
                      <div key={i} className="rounded-2xl border border-white/10 p-4 bg-[#0f0f0f]">
                        <div className="flex items-center gap-2 mb-3">
                          <span className="w-20 h-3 rounded bg-white/10 animate-pulse" />
                        </div>
                        <div className="flex items-baseline gap-1 mb-3">
                          <span className="text-2xl font-bold tabular-nums text-white/30">&mdash;</span>
                          <span className="text-white/30 text-[10px]">total issues</span>
                        </div>
                        <PendingRows rows={3} />
                      </div>
                    ))}
                  </div>
                ) : sprintProjects.length === 0 ? (
                  <p className="text-white/30 text-xs">No projects yet -- this card fills in once one exists.</p>
                ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                  {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped project rows */}
                  {sprintProjects.map((proj: any) => {
                    const projName: string = proj.name
                    // Real count from useProjectIssueTotals's per-project head-style
                    // call, never the fabricated proj.taskCounts (a field
                    // /api/projects never sends). Null means "not measured yet / the
                    // fetch failed", rendered as an em-dash, never as 0.
                    const total: number | null = projectIssueTotals[projName] ?? null
                    // /api/projects carries no deadline field on real rows -- guard
                    // against Invalid Date/NaN instead of printing "NaNd left".
                    const dlRaw = proj.deadline
                    const dl = dlRaw ? new Date(dlRaw) : null
                    const left = dl && !isNaN(dl.getTime()) ? daysUntil(dl) : null
                    const blockers: number | null = typeof proj.blockerCount === 'number' ? proj.blockerCount : null
                    const lastPR = proj.lastPRDate
                    const lastPRLabel = lastPR
                      ? new Date(lastPR).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                      : '—'
                    const pColor = proj.color ?? '#6b7280'
                    return (
                      <div key={proj.id ?? projName} className="rounded-2xl border border-white/10 p-4 bg-[#0f0f0f]">
                        <div className="flex items-center gap-2 mb-3">
                          {/* No emoji map keyed by name: /api/projects sends no
                              emoji field, so a neutral dot stands in for every
                              real project rather than a hand-written table. */}
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: pColor }} />
                          <span className="text-white text-xs font-semibold truncate">{projName}</span>
                        </div>
                        {/* Total issues -- a real count, not a % computed from data
                            this call doesn't have. The done/in-progress/open
                            breakdown is genuinely measured just below, by
                            ProjectBreakdownBars, which fetches every row. */}
                        <div className="flex items-baseline gap-1 mb-3">
                          <span className="text-2xl font-bold tabular-nums" style={{ color: total === null ? '#71717a' : pColor }}>
                            {total === null ? <Pending w="w-8" /> : total}
                          </span>
                          <span className="text-white/30 text-[10px]">total issues</span>
                        </div>
                        {/* Stats grid */}
                        <div className="grid grid-cols-2 gap-2 text-[10px]">
                          <div>
                            <span className="text-white/30 block">Deadline</span>
                            <span className="text-white/70 font-medium">{left === null ? 'not measured' : `${left}d left`}</span>
                          </div>
                          <div>
                            <span className="text-white/30 block">Last PR</span>
                            <span className="text-white/70 font-medium">{lastPRLabel}</span>
                          </div>
                          <div>
                            <span className="text-white/30 block">Blockers</span>
                            <span className={blockers !== null && blockers > 0 ? 'text-red-400 font-medium' : 'text-white/50'}>
                              {blockers === null ? '\u2014' : blockers}
                            </span>
                          </div>
                          <div>
                            <span className="text-white/30 block">Breakdown</span>
                            {/* JSX text is not a string literal \u2014 a bare \u2193 here rendered verbatim. */}
                            <span className="text-white/50">{'below \u2193'}</span>
                          </div>
                        </div>
                        {/* MC-111: Epic/Feature/Issue breakdown \u2014 genuinely measured */}
                        <ProjectBreakdownBars project={projName} />
                      </div>
                    )
                  })}
                </div>
                )}
              </div>

              {/* Sprint Progress Card (MC-102) */}
              <SprintProgressCard />

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {/* /api/projects sends bare project rows — id, name, description,
                    owner, status, business_id — none of the deadline/color/
                    taskCounts fields this card was built against. Every value
                    below is guarded so a real project (no deadline data) renders
                    "not measured" rather than the NaN/Invalid Date that used to
                    print, and a "Mission Control" or "Todero" row that has no
                    sprint countdown to show says so instead of feigning one. */}
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped project rows */}
                {(sprintProjects ?? []).map((proj: any)=>{
                  const dlRaw = proj.deadline, stRaw = proj.startDate
                  const dl = dlRaw ? new Date(dlRaw) : null
                  const st = stRaw ? new Date(stRaw) : null
                  const left = dl && !isNaN(dl.getTime()) ? daysUntil(dl) : null
                  const elap = st && !isNaN(st.getTime()) ? daysSince(st) : null
                  const pct = elap !== null && typeof proj.totalDays === 'number' && proj.totalDays > 0
                    ? miniPct(elap, proj.totalDays) : null
                  const dlLabel = dl && !isNaN(dl.getTime())
                    ? dl.toLocaleDateString('en-US',{month:'short',day:'numeric'}) : null
                  const cardColor = proj.color ?? '#6b7280'
                  const cardBorder = proj.borderColor ?? 'border-white/10'
                  const cardBg = proj.bg ?? '#0f0f0f'
                  const cardDesc = proj.desc ?? proj.description ?? ''
                  const isUrgent = left !== null && left<=2 && cardColor!=='#ffffff'
                  return (
                    <div key={proj.id} className={`rounded-2xl p-4 md:p-5 border ${cardBorder} card-glow`} style={{background:cardBg}}>
                      <div className="flex justify-between items-start mb-4">
                        <div className="min-w-0 flex-1 mr-2">
                          <p className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{color:cardColor==='#ffffff'?'#71717a':cardColor+'b3'}}>{proj.name}</p>
                          <p className="text-white text-xs sm:text-sm font-medium truncate">{cardDesc}</p>
                        </div>
                        <span className="text-xl">{proj.emoji}</span>
                      </div>
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-3">
                        <span className={`text-3xl md:text-4xl font-bold tabular-nums ${isUrgent ? 'text-red-400' : left === null ? 'text-white/30' : 'text-white'}`}>
                          {left === null ? '—' : left}
                        </span>
                        <span className="text-white/50 text-sm">{left === null ? 'not measured' : ' Days'}</span>
                        {proj.totalDays != null && (
                          <span className="ml-auto text-white/30 text-xs">Day {elap ?? '—'}/{proj.totalDays}</span>
                        )}
                      </div>
                      {pct !== null && <Bar v={pct} color={cardColor} bg={cardColor==='#ffffff'?'#1e1e1e':'#1a0a2a'} />}
                      <div className="flex flex-col sm:flex-row justify-between mt-1.5 gap-0.5">
                        <span className="text-white/30 text-[10px]">{pct === null ? 'no sprint window set' : `${pct}% elapsed`}</span>
                        {dlLabel && <span className="text-white/30 text-[10px]">{dlLabel}</span>}
                      </div>
                      {proj.taskCounts && proj.taskCounts.total > 0 && (
                        <div className="mt-3 pt-3 border-t border-white/10">
                          <div className="flex justify-between mb-1.5">
                            <span className="text-white/30 text-[10px]">Issues</span>
                            <span className="text-white/50 text-[10px]">{proj.taskCounts.done}/{proj.taskCounts.total} done</span>
                          </div>
                          <Bar v={proj.taskProgress} color='#10b981' bg='#0a1a12' />
                          <div className="flex gap-3 mt-1">
                            {proj.taskCounts.inProgress > 0 && <span className="text-blue-400 text-[9px]">● {proj.taskCounts.inProgress} active</span>}
                            {proj.taskCounts.open > 0 && <span className="text-white/30 text-[9px]">○ {proj.taskCounts.open} open</span>}
                          </div>
                        </div>
                      )}
                      {proj.activeFeatures && proj.activeFeatures.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-white/10">
                          <span className="text-white/30 text-[10px] font-semibold uppercase tracking-wider">Active Features</span>
                          <div className="mt-1.5 space-y-1.5">
                            {proj.activeFeatures.slice(0, 3).map((af: any) => (
                              <div key={af.id}>
                                <div className="flex items-center justify-between">
                                  <span className="text-white/40 text-[10px] truncate flex-1 min-w-0 mr-2">{af.title}</span>
                                  <span className="text-white/30 text-[9px] shrink-0">{af.done}/{af.total}</span>
                                </div>
                                <div className="w-full rounded-full h-1 mt-0.5" style={{background:'#1a1a1a'}}>
                                  <div className="h-1 rounded-full transition-all" style={{width:af.pct+'%',background:'#3b82f6'}} />
                                </div>
                              </div>
                            ))}
                          </div>
                          {proj.activeFeatures.length > 3 && (
                            <p className="text-white/30 text-[9px] mt-1">+{proj.activeFeatures.length - 3} more</p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Live Activity Feed (mini) */}
              <div>
                <SH icon="📡">Recent Activity</SH>
                <ActivityFeed limit={5} projectFilter={projectFilter} onNavigate={onNavigate} />
              </div>

            </div>
    </>
  )
}

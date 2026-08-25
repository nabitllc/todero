'use client'
import React, { useEffect, useState, useCallback } from 'react'
import { Dot, Chip, Bar, SH } from '@/lib/mc-atoms'
import type { CostSnapshot } from '@/lib/issues'
import { Button, EmptyState } from '@/components/ui'
import { Server, Rocket } from 'lucide-react'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import { fetchJson, type ApiError } from '@/hooks/useApiData'

interface DeployRecord {
  id: string
  project: string
  branch: string
  commit_sha: string | null
  commit_message: string | null
  status: string
  source: string
  url: string | null
  triggered_by: string | null
  duration_ms: number | null
  error_message: string | null
  created_at: string
  finished_at: string | null
}

const STATUS_STYLE: Record<string, string> = {
  ready: 'text-green-400 border-green-500/30 bg-green-500/10',
  building: 'text-yellow-400 border-yellow-500/30 bg-yellow-500/10',
  pending: 'text-blue-400 border-blue-500/30 bg-blue-500/10',
  error: 'text-red-400 border-red-500/30 bg-red-500/10',
  canceled: 'text-white/40 border-white/10 bg-white/5',
}

// INF-204: Sparkline SVG component for 7-day cost trend
// TOD: kill-fake-infra-greens — a day with no stored snapshot is `cost: null`,
// not 0. Plotting null as 0 would draw a real-looking flat line through days
// nothing measured, so the polyline breaks into separate segments around
// gaps instead of running through them.
function CostSparkline({ data }: { data: CostSnapshot[] }) {
  if (!data) return null
  const known = data.filter((d): d is CostSnapshot & { cost: number } => d.cost !== null)
  if (known.length < 2) return null
  const max = Math.max(...known.map(d => d.cost), 0.01)
  const w = 180
  const h = 40
  const pad = 2
  // Build one or more polyline segments, breaking at each null.
  const segments: string[][] = []
  let current: string[] = []
  data.forEach((d, i) => {
    if (d.cost === null) {
      if (current.length) segments.push(current)
      current = []
      return
    }
    const x = pad + (i / (data.length - 1)) * (w - pad * 2)
    const y = h - pad - (d.cost / max) * (h - pad * 2)
    current.push(`${x},${y}`)
  })
  if (current.length) segments.push(current)
  const lastKnown = known[known.length - 1].cost
  const prevKnown = known[known.length - 2].cost
  const trend = lastKnown > prevKnown ? '#ef4444' : lastKnown < prevKnown ? '#22c55e' : '#666'
  const lastPt = segments[segments.length - 1]?.[segments[segments.length - 1].length - 1]?.split(',')
  return (
    <div className="flex items-center gap-2">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0">
        {segments.map((seg, i) => (
          <polyline
            key={i}
            points={seg.join(' ')}
            fill="none"
            stroke={trend}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {/* Dot on last known point */}
        {lastPt && <circle cx={lastPt[0]} cy={lastPt[1]} r="3" fill={trend} />}
      </svg>
      <div className="text-[9px] text-white/30">
        {data.map(d => d.date.slice(5)).join(' · ')}
      </div>
    </div>
  )
}

export default function InfraTab({ liveStatus, statusError, agoSec, statusCountdown, onRefresh }: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- /api/status is a wide untyped health payload
  liveStatus: any
  /** Why /api/status failed, if it did. TOD-654: shown, never papered over. */
  statusError?: ApiError | null
  agoSec: number
  statusCountdown: number
  onRefresh: () => void
}) {
            const [deploys, setDeploys] = useState<DeployRecord[] | null>(null)
            const [deploysError, setDeploysError] = useState<ApiError | null>(null)
            // INF-204: 7-day cost history for sparkline
            const [costHistory, setCostHistory] = useState<CostSnapshot[]>([])
            const [costHistoryError, setCostHistoryError] = useState<ApiError | null>(null)
            const [reload, setReload] = useState(0)

            useEffect(() => {
              fetchJson<DeployRecord[]>('/api/deploy-history?limit=20').then(r => {
                if (!r.ok) { setDeploysError(r.error); setDeploys(null); return }
                setDeploysError(null)
                setDeploys(Array.isArray(r.data) ? r.data : [])
              })
              // INF-204: fetch cost history
              fetchJson<CostSnapshot[]>('/api/settings/cost-history').then(r => {
                if (!r.ok) { setCostHistoryError(r.error); setCostHistory([]); return }
                setCostHistoryError(null)
                if (Array.isArray(r.data)) setCostHistory(r.data)
              })
            }, [reload])
            const ls = liveStatus
            // OpenRouter numbers are real only when /api/status actually reached
            // OpenRouter this request. No fallback dollar figures — an unconnected
            // account showing "$9.57 remaining" is exactly the fabrication this
            // tab used to run on.
            const orConnected = !!ls?.openrouter
            // TOD: kill-fake-infra-greens — OpenRouter reports limit:null for
            // any pay-as-you-go key. That must stay null through the UI, not
            // get coerced to 0/10 — a coerced 0 would render "$X.XX / $0.00"
            // and a coerced 10 would resurrect the fabricated "$9.57 / $10.00"
            // this tab was rebuilt to stop showing.
            const orLimit: number | null = typeof ls?.openrouter?.limit === 'number' ? ls.openrouter.limit : null
            const orRemaining: number | null = typeof ls?.openrouter?.remaining === 'number' ? ls.openrouter.remaining : null
            const orUsed = ls?.openrouter?.used ?? 0
            const orPct = orLimit !== null && orLimit > 0 ? Math.min(100, Math.round((orUsed / orLimit) * 100)) : 0
            const usageCost = ls?.usage?.totalCost ?? 0
            const usageTokens = ls?.usage?.totalTokens ?? 0
            const usageByModel: Record<string,number> = ls?.usage?.byModel ?? {}
            const todayCost = ls?.usage?.todayCost ?? 0
            const todayTokens = ls?.usage?.todayTokens ?? 0
            const heartbeats: any[] = ls?.heartbeats ?? []

            // TOD: kill-fake-infra-greens — /api/health, the one honest probe in
            // the cluster, was wired to zero screens before this. Its own 503
            // is meaningful data (which check failed), not just a fetch error —
            // so this reads it directly instead of through the "non-2xx = error"
            // fetchJson path other cards use.
            const [health, setHealth] = useState<Record<string, any> | null>(null)
            const [healthUnreachable, setHealthUnreachable] = useState<string | null>(null)
            const fetchHealth = useCallback(() => {
              fetch('/api/health', { cache: 'no-store' })
                .then(async r => {
                  const body = await r.json().catch(() => null)
                  if (!body) { setHealthUnreachable(`HTTP ${r.status} — no parseable body`); setHealth(null); return }
                  setHealthUnreachable(null)
                  setHealth(body)
                })
                .catch(e => { setHealthUnreachable(e instanceof Error ? e.message : 'could not reach /api/health'); setHealth(null) })
            }, [])
            useEffect(() => { fetchHealth() }, [fetchHealth])

            // TOD-768: circuit breaker state
            const [cbState, setCbState] = useState<Record<string, {tripped: boolean; consecutive_failures: number; last_error?: string; tripped_at?: string}>>({})
            const [cbError, setCbError] = useState<ApiError | null>(null)
            const fetchCb = useCallback(() => {
              fetchJson<{ providers?: Record<string, {tripped: boolean; consecutive_failures: number; last_error?: string; tripped_at?: string}> }>('/api/circuit-breaker')
                .then(r => {
                  if (!r.ok) { setCbError(r.error); setCbState({}); return }
                  setCbError(null)
                  if (r.data?.providers) setCbState(r.data.providers)
                })
            }, [])
            useEffect(() => { fetchCb() }, [fetchCb])
            const cbProviders = Object.entries(cbState)
            const cbTripped = cbProviders.some(([, p]) => p.tripped)

            // TOD: kill-fake-infra-greens — every tile below reads its status and
            // note straight off ls.services, which /api/status populates from a
            // real probe run in that same request (or 'unknown' when no probe
            // exists / no credential is configured on this host). No literal
            // 'ok' is assigned in this file — the server did the measuring.
            type ServiceState = 'ok' | 'degraded' | 'down' | 'unknown'
            interface ServiceReading { status: ServiceState; note: string; checkedAt: string }
            const services: Record<string, ServiceReading> = ls?.services ?? {}
            const SERVICE_TILES: Array<{ key: string; name: string }> = [
              { key: 'claude',      name: 'Claude Max' },
              { key: 'openrouter',  name: 'OpenRouter' },
              { key: 'telegram',    name: 'Telegram' },
              { key: 'discord',     name: 'Discord' },
              { key: 'ollama',      name: 'Ollama' },
              { key: 'vercel',      name: 'Vercel' },
              { key: 'supabase',    name: 'Supabase' },
              { key: 'github',      name: 'GitHub' },
              { key: 'braveSearch', name: 'Brave Search' },
              { key: 'cloudflare',  name: 'Cloudflare' },
            ]
            const liveInfra = SERVICE_TILES.map(({ key, name }) => {
              const svc = services[key]
              return {
                name,
                note: svc?.note ?? 'not checked this request',
                status: svc?.status ?? 'unknown',
                checkedAt: svc?.checkedAt ?? null,
              }
            })

            // TOD: kill-fake-infra-greens — how long ago each tile's own probe ran,
            // not one shared "Updated Ns ago" for all ten. Falls back to the shared
            // clock only when a tile has no checkedAt at all.
            function tileAgo(checkedAt: string | null): string {
              if (!checkedAt) return `${agoSec}s ago`
              const s = Math.max(0, Math.round((Date.now() - new Date(checkedAt).getTime()) / 1000))
              if (s < 60) return `${s}s ago`
              if (s < 3600) return `${Math.round(s / 60)}m ago`
              return `${Math.round(s / 3600)}h ago`
            }

            return (
            <div className="space-y-5">
              {/* TOD-654: /api/status refused => say so. The service tiles below
                  are derived from that payload, so they would otherwise render
                  their hardcoded fallbacks as if they were live readings. */}
              {statusError && <ApiErrorBanner error={statusError} onRetry={onRefresh} />}
              {cbError && <ApiErrorBanner error={cbError} onRetry={fetchCb} />}
              {costHistoryError && <ApiErrorBanner error={costHistoryError} onRetry={() => setReload(n => n + 1)} />}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <SH icon="🔌">Services</SH>
                <div className="flex items-center gap-2 sm:gap-3 mb-4 flex-wrap">
                  {ls && <><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 anim-pg"/><span className="text-white/20 text-[10px]">Updated {agoSec}s ago</span></>}
                  {!ls && statusError && <span className="text-red-400 text-[10px]">data unavailable</span>}
                  {!ls && !statusError && <span className="text-yellow-600 text-[10px]">Loading…</span>}
                  <span className="text-white/20 text-[10px] font-mono tabular-nums" title="Auto-refresh countdown">↻ {statusCountdown}s</span>
                  <Button variant="secondary" size="sm" onClick={()=>{onRefresh()}}>Refresh</Button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {(ls ? liveInfra : []).map(svc=>(
                  <div key={svc.name} className="rounded-xl p-3 md:p-4 border border-white/10 flex items-start gap-3 card-glow" style={{background:'#0f0f0f'}}>
                    <Dot status={svc.status} />
                    <div>
                      <p className="text-white text-sm font-medium">{svc.name}</p>
                      <p className="text-white/30 text-xs mt-0.5">{svc.note}</p>
                      <p className="text-white/20 text-[10px] mt-0.5">checked {tileAgo(svc.checkedAt)}</p>
                    </div>
                  </div>
                ))}
              </div>

              <SH icon="📬">Heartbeat Schedule</SH>
              <div className="rounded-2xl border border-white/10 overflow-hidden" style={{background:'#0f0f0f'}}>
                {/* TOD: kill-fake-infra-greens — this used to fall back to five
                    invented rows (a fake "every 4h" for an agent that may not
                    exist on this host) whenever the live list was empty. An
                    empty state beats a guess. */}
                {heartbeats.length === 0 && <EmptyState icon={Server} title="No heartbeat schedule reported" className="py-6" />}
                {heartbeats.map((hb:any, i:number, arr:any[])=>(
                  <div key={hb.agentId} className={'flex items-center gap-3 md:gap-4 px-4 md:px-5 py-3 '+(i<arr.length-1?'border-b border-white/10':'')}>
                    <Dot status={hb.enabled ? 'active' : 'planned'} />
                    <span className="font-mono text-xs text-white shrink-0">{hb.agentId}</span>
                    <span className="text-white/50 text-xs flex-1">{hb.enabled ? `every ${hb.every}` : 'disabled'}</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${hb.enabled ? 'text-green-400 border-green-500/30 bg-green-500/10' : 'text-white/40 border-white/10 bg-white/5'}`}>
                      {hb.enabled ? 'active' : 'off'}
                    </span>
                  </div>
                ))}
              </div>

              <SH icon="📊">Token Usage</SH>
              <div className="rounded-2xl border border-white/10 p-4 md:p-5" style={{background:'#0f0f0f'}}>
                <div className="flex items-end justify-between mb-4">
                  <div className="flex items-baseline gap-4 md:gap-6 flex-wrap">
                    <div>
                      <p className="text-white/50 text-[10px] mb-1 uppercase tracking-wider">Today</p>
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-2xl font-bold text-white">${todayCost.toFixed(2)}</span>
                        <span className="text-white/30 text-xs">{(todayTokens/1000).toFixed(0)}k tok</span>
                      </div>
                    </div>
                    <div>
                      <p className="text-white/50 text-[10px] mb-1 uppercase tracking-wider">All-time</p>
                      {ls?.usage ? (
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-2xl font-bold text-white">${usageCost.toFixed(2)}</span>
                          <span className="text-white/30 text-xs">{(usageTokens/1000).toFixed(0)}k tok</span>
                        </div>
                      ) : (
                        <p className="text-white/30 text-xs">not tracked on this host</p>
                      )}
                    </div>
                  </div>
                  {ls && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 anim-pg" title="Live"/>}
                </div>
                {/* INF-204: 7-day cost trend sparkline.
                    TOD: kill-fake-infra-greens — a chart needs at least two
                    measured days to draw a trend; anything less is not a
                    trend, it's a guess dressed as one, so it falls through
                    to the EmptyState below instead of rendering a
                    real-looking flat line. */}
                {costHistory.filter(d => d.cost !== null).length >= 2 ? (
                  <div className="mb-4 p-3 rounded-xl border border-white/5" style={{ background: '#0a0a0a' }}>
                    <p className="text-white/30 text-[9px] uppercase tracking-widest mb-2">7-Day Cost Trend</p>
                    <CostSparkline data={costHistory} />
                  </div>
                ) : (
                  !costHistoryError && costHistory.length > 0 && (
                    <div className="mb-4">
                      <EmptyState icon={Server} title="No cost snapshots recorded on this host" className="py-4" />
                    </div>
                  )
                )}
                <div className="space-y-2">
                  {Object.entries(usageByModel).sort((a,b)=>b[1]-a[1]).map(([model, cost])=>{
                    const pct = usageCost > 0 ? Math.round((cost/usageCost)*100) : 0
                    return (
                      <div key={model}>
                        <div className="flex justify-between mb-1">
                          <span className="text-white/40 text-xs font-mono">{model.split('/').pop()}</span>
                          <span className="text-white/50 text-xs">${(cost as number).toFixed(3)} ({pct}%)</span>
                        </div>
                        <Bar v={pct} color={model.includes('haiku')?'#a855f7':'#3b82f6'} bg="rgba(255,255,255,0.05)"/>
                      </div>
                    )
                  })}
                  {!statusError && Object.keys(usageByModel).length === 0 && <EmptyState icon={Server} title="No session data yet" className="py-4" />}
                </div>
              </div>

              <SH icon="🚀">Deploy History</SH>
              <div className="rounded-2xl border border-white/10 overflow-hidden" style={{background:'#0f0f0f'}}>
                {deploysError && <div className="px-5 py-4"><ApiErrorBanner error={deploysError} onRetry={() => setReload(n => n + 1)} /></div>}
                {!deploysError && deploys === null && <div className="px-5 py-4 text-white/30 text-xs">Loading deploys…</div>}
                {!deploysError && deploys?.length === 0 && <EmptyState icon={Rocket} title="No deploys recorded yet" className="py-6" />}
                {(deploys ?? []).map((d, i) => {
                  const ago = Math.round((Date.now() - new Date(d.created_at).getTime()) / 60000)
                  const agoLabel = ago < 60 ? `${ago}m ago` : ago < 1440 ? `${Math.round(ago/60)}h ago` : `${Math.round(ago/1440)}d ago`
                  const dur = d.duration_ms ? `${(d.duration_ms/1000).toFixed(1)}s` : null
                  return (
                    <div key={d.id} className={'flex items-center gap-3 px-4 md:px-5 py-3 ' + (i < (deploys?.length ?? 0) - 1 ? 'border-b border-white/10' : '')}>
                      <Dot status={d.status === 'ready' ? 'ok' : d.status === 'error' ? 'warn' : d.status === 'building' ? 'scheduled' : 'planned'} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-white text-xs font-medium truncate">{d.project}</span>
                          <span className="text-white/30 text-[10px] font-mono">{d.branch}</span>
                          {d.commit_sha && <span className="text-white/20 text-[10px] font-mono">{d.commit_sha.slice(0, 7)}</span>}
                        </div>
                        {d.commit_message && <p className="text-white/30 text-[10px] mt-0.5 truncate">{d.commit_message}</p>}
                        {d.error_message && <p className="text-red-400/60 text-[10px] mt-0.5 truncate">{d.error_message}</p>}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {dur && <span className="text-white/20 text-[10px]">{dur}</span>}
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border ${STATUS_STYLE[d.status] ?? STATUS_STYLE.canceled}`}>
                          {d.status}
                        </span>
                        <span className="text-white/20 text-[10px]">{agoLabel}</span>
                      </div>
                    </div>
                  )
                })}
              </div>

              <SH icon="✅">Cluster Health (/api/health)</SH>
              <div className="rounded-2xl border border-white/10 p-5" style={{background:'#0f0f0f'}}>
                {/* TOD: kill-fake-infra-greens — /api/health runs its own probe
                    (a live query against the issues table, on a hard timeout)
                    independent of everything above. Nothing renders here that
                    health didn't just say. */}
                {!health && !healthUnreachable && <p className="text-white/30 text-xs">Checking…</p>}
                {healthUnreachable && <ApiErrorBanner error={{ status: 0, endpoint: '/api/health', message: healthUnreachable }} onRetry={fetchHealth} />}
                {health && (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2">
                      <Dot status={health.ok ? 'ok' : 'down'} />
                      <span className="text-white text-sm font-medium">{health.ok ? 'Healthy' : 'Unhealthy'}</span>
                      <span className="text-white/20 text-[10px] ml-auto">checked {health.ts ? new Date(health.ts).toLocaleTimeString() : 'just now'}</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                      <div className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2">
                        <Dot status={health.db?.reachable ? 'ok' : 'down'} sm />
                        <span className="text-white/60">Database</span>
                        <span className="text-white/30 ml-auto">{health.db?.reachable ? `${health.db.latencyMs ?? '?'}ms` : (health.db?.error ?? 'unreachable')}</span>
                      </div>
                      <div className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2">
                        <Dot status={Array.isArray(health.runtimes) && health.runtimes.length > 0 ? 'ok' : 'unknown'} sm />
                        <span className="text-white/60">Runtimes</span>
                        <span className="text-white/30 ml-auto">{Array.isArray(health.runtimes) ? health.runtimes.length : 0} registered</span>
                      </div>
                      <div className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2">
                        <Dot status={health.worktrees?.count > 0 ? 'ok' : 'unknown'} sm />
                        <span className="text-white/60">Worktrees</span>
                        <span className="text-white/30 ml-auto">{health.worktrees?.count ?? 0} active</span>
                      </div>
                      <div className="flex items-center gap-2 rounded-lg border border-white/10 px-3 py-2">
                        <Dot status={health.lastHeartbeat ? 'ok' : 'unknown'} sm />
                        <span className="text-white/60">Last heartbeat</span>
                        <span className="text-white/30 ml-auto truncate max-w-[10rem]">{health.lastHeartbeat?.timestamp ?? health.lastHeartbeat?.time ?? 'none recorded'}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <SH icon="🖥">Host</SH>
              <div className="rounded-2xl border border-white/10 p-5" style={{background:'#0f0f0f'}}>
                {/* TOD: kill-fake-infra-greens — this card used to hardcode
                    "Mac mini · Apple Silicon" on every host, Windows included.
                    It now reads whatever machine /api/status is actually
                    running on. */}
                <div className="flex items-start gap-4">
                  <span className="text-3xl">{"🖥️"}</span>
                  <div>
                    {ls?.system ? (
                      <>
                        <p className="text-white font-medium text-sm">{ls.system.hostname} · {ls.system.platform} · {ls.system.arch} · {ls.system.totalMemGB}GB</p>
                        <p className="text-white/50 text-xs mt-0.5">Todero native stack · Node {ls.system.nodeVersion} · up {Math.round((ls.system.uptimeSec ?? 0) / 60)}m</p>
                      </>
                    ) : (
                      <p className="text-white/30 text-xs">Host details unavailable — {statusError ? 'no successful /api/status response yet' : 'loading…'}</p>
                    )}
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {['Todero :3000', 'Ollama :11434'].map(l=><Chip key={l} label={l}/>)}
                    </div>
                  </div>
                </div>
              </div>

              {/* TOD-768: Circuit Breaker card */}
              <SH icon="⚡">Circuit Breaker</SH>
              <div className="rounded-2xl border border-white/10 p-3 sm:p-4" style={{background: cbTripped ? 'rgba(239,68,68,0.1)' : '#0f0f0f'}}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${cbTripped ? 'bg-red-500 animate-pulse' : cbProviders.length === 0 ? 'bg-white/20' : 'bg-emerald-500'}`} />
                    <span className="text-xs font-medium text-white">
                      {cbTripped ? 'TRIPPED — agents paused' : cbProviders.length === 0 ? 'No provider has reported' : 'Healthy'}
                    </span>
                  </div>
                  <button onClick={fetchCb} className="text-white/30 hover:text-white/60 text-xs transition-colors">↻ refresh</button>
                </div>
                {cbProviders.length === 0 ? (
                  <p className="text-white/30 text-xs">No provider has reported to the circuit breaker yet on this host — that is not the same as "no failures".</p>
                ) : (
                  <div className="space-y-2">
                    {cbProviders.map(([provider, ps]) => (
                      <div key={provider} className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${ps.tripped ? 'bg-red-500' : 'bg-white/20'}`} />
                          <span className="text-white/70 truncate">{provider}</span>
                          {ps.last_error && <span className="text-white/30 truncate hidden sm:block">{ps.last_error.slice(0, 60)}</span>}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={ps.tripped ? 'text-red-400' : 'text-white/40'}>
                            {ps.consecutive_failures} fail{ps.consecutive_failures !== 1 ? 's' : ''}
                          </span>
                          {ps.tripped && (
                            <button
                              onClick={async () => {
                                await fetch('/api/circuit-breaker', { method: 'DELETE', headers: {'Content-Type':'application/json'}, body: JSON.stringify({ provider }) })
                                fetchCb()
                              }}
                              className="px-2 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white/60 text-[10px] transition-colors"
                            >
                              reset
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <SH icon="💳">OpenRouter Balance</SH>
              <div className="rounded-2xl border border-white/10 p-5" style={{background:'#0f0f0f'}}>
                {/* TOD: kill-fake-infra-greens — this card used to show
                    "$9.57 / $10.00" on a host with no OpenRouter key at all.
                    It now only shows numbers /api/status actually fetched. */}
                {orConnected ? (
                  <>
                    <div className="flex items-end justify-between mb-3">
                      <div>
                        <p className="text-white/50 text-xs mb-1">Monthly credit</p>
                        <div className="flex items-baseline gap-2">
                          {/* TOD: kill-fake-infra-greens — OpenRouter reports
                              limit:null for pay-as-you-go keys (the common
                              case). No limit means no denominator and no
                              progress bar to fill against — showing "/ $0.00"
                              or a fabricated ceiling is exactly the
                              "$9.57 / $10.00" this tab was rebuilt to stop
                              showing. */}
                          {orLimit === null ? (
                            <span className="text-3xl font-bold text-white">${orUsed.toFixed(2)}</span>
                          ) : (
                            <>
                              <span className="text-3xl font-bold text-white">${(orRemaining ?? 0).toFixed(2)}</span>
                              <span className="text-white/30 text-sm">/ ${orLimit.toFixed(2)}</span>
                            </>
                          )}
                        </div>
                      </div>
                      <p className="text-white/30 text-xs">
                        {orLimit === null ? '$' + orUsed.toFixed(3) + ' used · no credit limit set on this key' : `$${orUsed.toFixed(3)} used · resets monthly`}
                      </p>
                    </div>
                    {orLimit !== null && <Bar v={orPct} color="#3b82f6" bg="rgba(255,255,255,0.05)" />}
                  </>
                ) : (
                  <div className="flex items-center gap-2">
                    <Dot status="unknown" />
                    <p className="text-white/30 text-xs">Not connected — no OPENROUTER_API_KEY configured on this host.</p>
                  </div>
                )}
              </div>
            </div>
            )
}

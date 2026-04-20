'use client'
import React, { useEffect, useState, useCallback } from 'react'
import { Dot, Chip, Bar, SH } from '@/lib/mc-atoms'
import type { CostSnapshot } from '@/lib/issues'
import { Button, EmptyState } from '@/components/ui'
import { Server, Rocket } from 'lucide-react'

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
function CostSparkline({ data }: { data: CostSnapshot[] }) {
  if (!data || data.length < 2) return null
  const costs = data.map(d => d.cost)
  const max = Math.max(...costs, 0.01)
  const w = 180
  const h = 40
  const pad = 2
  const points = costs.map((c, i) => {
    const x = pad + (i / (costs.length - 1)) * (w - pad * 2)
    const y = h - pad - (c / max) * (h - pad * 2)
    return `${x},${y}`
  })
  const lastCost = costs[costs.length - 1]
  const prevCost = costs[costs.length - 2]
  const trend = lastCost > prevCost ? '#ef4444' : lastCost < prevCost ? '#22c55e' : '#666'
  return (
    <div className="flex items-center gap-2">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="shrink-0">
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke={trend}
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Dot on last point */}
        {(() => {
          const lastPt = points[points.length - 1].split(',')
          return <circle cx={lastPt[0]} cy={lastPt[1]} r="3" fill={trend} />
        })()}
      </svg>
      <div className="text-[9px] text-white/30">
        {data.map(d => d.date.slice(5)).join(' · ')}
      </div>
    </div>
  )
}

export default function InfraTab({ liveStatus, agoSec, statusCountdown, onRefresh }: {
  liveStatus: any
  agoSec: number
  statusCountdown: number
  onRefresh: () => void
}) {
            const [deploys, setDeploys] = useState<DeployRecord[]>([])
            const [deploysLoaded, setDeploysLoaded] = useState(false)
            // INF-204: 7-day cost history for sparkline
            const [costHistory, setCostHistory] = useState<CostSnapshot[]>([])

            useEffect(() => {
              fetch('/api/deploy-history?limit=20')
                .then(r => r.json())
                .then(d => { if (Array.isArray(d)) setDeploys(d); setDeploysLoaded(true) })
                .catch(() => setDeploysLoaded(true))
              // INF-204: fetch cost history
              fetch('/api/settings/cost-history')
                .then(r => r.json())
                .then(d => { if (Array.isArray(d)) setCostHistory(d) })
                .catch(() => {})
            }, [])
            const ls = liveStatus
            const orRemaining = ls?.openrouter?.remaining ?? 9.57
            const orLimit = ls?.openrouter?.limit ?? 10
            const orUsed = ls?.openrouter?.used ?? 0.43
            const orPct = orLimit > 0 ? Math.min(100, Math.round((orUsed / orLimit) * 100)) : 0
            const ollamaOk = ls?.ollama?.running ?? true
            const ollamaModels = ls?.ollama?.models ?? ['gemma3:4b']
            const vercelStatus = ls?.vercel?.lastDeploy?.status?.toUpperCase() ?? 'READY'
            const vercelSt = vercelStatus === 'READY' ? 'ok' : vercelStatus === 'ERROR' ? 'warn' : vercelStatus === 'BUILDING' ? 'scheduled' : 'ok'
            // Phase 4 (TOD-1514): OpenClaw retired 2026-04-09
            const tgOk = ls?.channels?.telegram ?? true
            const dsOk = ls?.channels?.discord ?? true
            const usageCost = ls?.usage?.totalCost ?? 0
            const usageTokens = ls?.usage?.totalTokens ?? 0
            const usageByModel: Record<string,number> = ls?.usage?.byModel ?? {}
            const todayCost = ls?.usage?.todayCost ?? 0
            const todayTokens = ls?.usage?.todayTokens ?? 0
            const heartbeats: any[] = ls?.heartbeats ?? []

            // TOD-768: circuit breaker state
            const [cbState, setCbState] = useState<Record<string, {tripped: boolean; consecutive_failures: number; last_error?: string; tripped_at?: string}>>({})
            const fetchCb = useCallback(() => {
              fetch('/api/circuit-breaker')
                .then(r => r.ok ? r.json() : null)
                .then(d => { if (d?.providers) setCbState(d.providers) })
                .catch(() => {})
            }, [])
            useEffect(() => { fetchCb() }, [fetchCb])
            const cbProviders = Object.entries(cbState)
            const cbTripped = cbProviders.some(([, p]) => p.tripped)

            const liveInfra = [
              { name:'OpenClaw',     note: 'Retired 2026-04-09 · replaced by native stack', status: 'warn' },
              { name:'Claude Max',   note:'OAuth \u00b7 sonnet-4-6 + haiku-4-5', status:'ok' },
              { name:'OpenRouter',   note:`$${orRemaining.toFixed(2)} / $${orLimit.toFixed(2)} remaining`, status: orRemaining < 1 ? 'warn' : 'ok' },
              { name:'Telegram',     note: tgOk ? '@KemuniClaw1Bot \u00b7 connected' : 'Disconnected', status: tgOk ? 'ok' : 'warn' },
              { name:'Discord',      note: dsOk ? 'Kemuni Server \u00b7 connected' : 'Disconnected', status: dsOk ? 'ok' : 'warn' },
              { name:'Ollama',       note: ollamaOk ? ollamaModels.join(', ') : 'Offline', status: ollamaOk ? 'ok' : 'warn' },
              { name:'Vercel',       note: ls?.vercel ? `${vercelStatus}${ls.vercel.lastDeploy?.branch?' \u00b7 '+ls.vercel.lastDeploy.branch:''}${ls.vercel.lastDeploy?.commitSha?' \u00b7 '+ls.vercel.lastDeploy.commitSha.slice(0,7):''}${ls.vercel.lastDeploy?.createdAt?' \u00b7 '+new Date(ls.vercel.lastDeploy.createdAt).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):''}` : 'Unknown', status: vercelSt },
              { name:'Supabase',     note:'Kemuni Agent HQ \u00b7 Vespera + Agent Brain', status:'ok' },
              { name:'GitHub',       note:'nabitllc org \u00b7 kemuniagent@gmail.com',    status:'ok' },
              { name:'Brave Search', note:'API \u00b7 renews Apr 21',                     status:'ok' },
              { name:'Cloudflare',   note:'Tunnel active \u00b7 trycloudflare.com',       status:'ok' },
            ]

            return (
            <div className="space-y-5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <SH icon="\ud83d\udd0c">Services</SH>
                <div className="flex items-center gap-2 sm:gap-3 mb-4 flex-wrap">
                  {ls && <><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 anim-pg"/><span className="text-white/20 text-[10px]">Updated {agoSec}s ago</span></>}
                  {!ls && <span className="text-yellow-600 text-[10px]">Loading\u2026</span>}
                  <span className="text-white/20 text-[10px] font-mono tabular-nums" title="Auto-refresh countdown">\u21bb {statusCountdown}s</span>
                  <Button variant="secondary" size="sm" onClick={()=>{onRefresh()}}>Refresh</Button>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {liveInfra.map(svc=>(
                  <div key={svc.name} className="rounded-xl p-3 md:p-4 border border-white/10 flex items-start gap-3 card-glow" style={{background:'#0f0f0f'}}>
                    <Dot status={svc.status} />
                    <div>
                      <p className="text-white text-sm font-medium">{svc.name}</p>
                      <p className="text-white/30 text-xs mt-0.5">{svc.note}</p>
                    </div>
                  </div>
                ))}
              </div>

              <SH icon="\ud83d\udcac">Heartbeat Schedule</SH>
              <div className="rounded-2xl border border-white/10 overflow-hidden" style={{background:'#0f0f0f'}}>
                {(heartbeats.length > 0 ? heartbeats : [
                  {agentId:'main', enabled:true, every:'4h'},
                  {agentId:'scout', enabled:false, every:'disabled'},
                  {agentId:'ops', enabled:false, every:'disabled'},
                  {agentId:'kemuni-sme', enabled:false, every:'disabled'},
                  {agentId:'vespera-sme', enabled:false, every:'disabled'},
                ]).map((hb:any, i:number, arr:any[])=>(
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

              <SH icon="\ud83d\udcca">Token Usage</SH>
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
                      <div className="flex items-baseline gap-1.5">
                        <span className="text-2xl font-bold text-white">${usageCost.toFixed(2)}</span>
                        <span className="text-white/30 text-xs">{(usageTokens/1000).toFixed(0)}k tok</span>
                      </div>
                    </div>
                  </div>
                  {ls && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 anim-pg" title="Live"/>}
                </div>
                {/* INF-204: 7-day cost trend sparkline */}
                {costHistory.length > 0 && (
                  <div className="mb-4 p-3 rounded-xl border border-white/5" style={{ background: '#0a0a0a' }}>
                    <p className="text-white/30 text-[9px] uppercase tracking-widest mb-2">7-Day Cost Trend</p>
                    <CostSparkline data={costHistory} />
                  </div>
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
                  {Object.keys(usageByModel).length === 0 && <EmptyState icon={Server} title="No session data yet" className="py-4" />}
                </div>
              </div>

              <SH icon="\ud83d\ude80">Deploy History</SH>
              <div className="rounded-2xl border border-white/10 overflow-hidden" style={{background:'#0f0f0f'}}>
                {!deploysLoaded && <div className="px-5 py-4 text-white/30 text-xs">Loading deploys…</div>}
                {deploysLoaded && deploys.length === 0 && <EmptyState icon={Rocket} title="No deploys recorded yet" className="py-6" />}
                {deploys.map((d, i) => {
                  const ago = Math.round((Date.now() - new Date(d.created_at).getTime()) / 60000)
                  const agoLabel = ago < 60 ? `${ago}m ago` : ago < 1440 ? `${Math.round(ago/60)}h ago` : `${Math.round(ago/1440)}d ago`
                  const dur = d.duration_ms ? `${(d.duration_ms/1000).toFixed(1)}s` : null
                  return (
                    <div key={d.id} className={'flex items-center gap-3 px-4 md:px-5 py-3 ' + (i < deploys.length - 1 ? 'border-b border-white/10' : '')}>
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

              <SH icon="\ud83d\udda5">Hardware</SH>
              <div className="rounded-2xl border border-white/10 p-5" style={{background:'#0f0f0f'}}>
                <div className="flex items-start gap-4">
                  <span className="text-3xl">{"\ud83d\udda5\ufe0f"}</span>
                  <div>
                    <p className="text-white font-medium text-sm">Mac mini \u00b7 Apple Silicon \u00b7 8GB \u00b7 arm64</p>
                    <p className="text-white/50 text-xs mt-0.5">Todero native stack \u00b7 macOS 26.3.1 \u00b7 Node 22.22.1</p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {['Todero :3000','Ollama :11434','Cloudflare Tunnel'].map(l=><Chip key={l} label={l}/>)}
                    </div>
                  </div>
                </div>
              </div>

              {/* TOD-768: Circuit Breaker card */}
              <SH icon="⚡">Circuit Breaker</SH>
              <div className="rounded-2xl border border-white/10 p-3 sm:p-4" style={{background: cbTripped ? 'rgba(239,68,68,0.1)' : '#0f0f0f'}}>
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${cbTripped ? 'bg-red-500 animate-pulse' : 'bg-emerald-500'}`} />
                    <span className="text-xs font-medium text-white">{cbTripped ? 'TRIPPED — agents paused' : 'Healthy'}</span>
                  </div>
                  <button onClick={fetchCb} className="text-white/30 hover:text-white/60 text-xs transition-colors">↻ refresh</button>
                </div>
                {cbProviders.length === 0 ? (
                  <p className="text-white/30 text-xs">No failures recorded.</p>
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

              <SH icon="\ud83d\udcb3">OpenRouter Balance</SH>
              <div className="rounded-2xl border border-white/10 p-5" style={{background:'#0f0f0f'}}>
                <div className="flex items-end justify-between mb-3">
                  <div>
                    <p className="text-white/50 text-xs mb-1">Monthly credit</p>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-bold text-white">${orRemaining.toFixed(2)}</span>
                      <span className="text-white/30 text-sm">/ ${orLimit.toFixed(2)}</span>
                    </div>
                  </div>
                  <p className="text-white/30 text-xs">${orUsed.toFixed(3)} used \u00b7 resets monthly</p>
                </div>
                <Bar v={orPct} color="#3b82f6" bg="rgba(255,255,255,0.05)" />
                <p className="text-white/20 text-xs mt-2">Daily billing report via n8n \u2192 Telegram</p>
              </div>
            </div>
            )
}

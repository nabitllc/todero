'use client'
import React from 'react'
import { Dot, Chip, Bar, SH } from '@/lib/mc-atoms'

export default function InfraTab({ liveStatus, agoSec, statusCountdown, onRefresh }: {
  liveStatus: any
  agoSec: number
  statusCountdown: number
  onRefresh: () => void
}) {
            const ls = liveStatus
            const orRemaining = ls?.openrouter?.remaining ?? 9.57
            const orLimit = ls?.openrouter?.limit ?? 10
            const orUsed = ls?.openrouter?.used ?? 0.43
            const orPct = orLimit > 0 ? Math.min(100, Math.round((orUsed / orLimit) * 100)) : 0
            const ollamaOk = ls?.ollama?.running ?? true
            const ollamaModels = ls?.ollama?.models ?? ['gemma3:4b']
            const n8nOk = ls?.n8n?.running ?? true
            const n8nWf = ls?.n8n?.activeWorkflows ?? '?'
            const n8nTotal = ls?.n8n?.totalWorkflows ?? '?'
            const vercelStatus = ls?.vercel?.lastDeploy?.status?.toUpperCase() ?? 'READY'
            const vercelSt = vercelStatus === 'READY' ? 'ok' : vercelStatus === 'ERROR' ? 'warn' : vercelStatus === 'BUILDING' ? 'scheduled' : 'ok'
            const oc = ls?.openclaw
            const ocVersion = oc?.version ?? '2026.3.23-2'
            const ocUpToDate = oc?.upToDate ?? true
            const tgOk = ls?.channels?.telegram ?? true
            const dsOk = ls?.channels?.discord ?? true
            const usageCost = ls?.usage?.totalCost ?? 0
            const usageTokens = ls?.usage?.totalTokens ?? 0
            const usageByModel: Record<string,number> = ls?.usage?.byModel ?? {}
            const todayCost = ls?.usage?.todayCost ?? 0
            const todayTokens = ls?.usage?.todayTokens ?? 0
            const heartbeats: any[] = ls?.heartbeats ?? []

            const liveInfra = [
              { name:'OpenClaw',     note: `v${ocVersion}${ocUpToDate ? ' \u2713 up to date' : ' \u26a0 update available'}`, status: ocUpToDate ? 'ok' : 'warn' },
              { name:'Claude Max',   note:'OAuth \u00b7 sonnet-4-6 + haiku-4-5', status:'ok' },
              { name:'OpenRouter',   note:`$${orRemaining.toFixed(2)} / $${orLimit.toFixed(2)} remaining`, status: orRemaining < 1 ? 'warn' : 'ok' },
              { name:'Telegram',     note: tgOk ? '@KemuniClaw1Bot \u00b7 connected' : 'Disconnected', status: tgOk ? 'ok' : 'warn' },
              { name:'Discord',      note: dsOk ? 'Kemuni Server \u00b7 connected' : 'Disconnected', status: dsOk ? 'ok' : 'warn' },
              { name:'n8n',          note: n8nOk ? `:5678 \u00b7 ${n8nWf}/${n8nTotal} active` : 'Offline', status: n8nOk ? 'ok' : 'warn' },
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
                  <button onClick={()=>{onRefresh()}} className="text-white/30 hover:text-white/40 text-[10px] border border-white/10 rounded px-2 py-0.5 transition-colors">Refresh</button>
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
                    <span className="text-[10px] px-2 py-0.5 rounded-full border" style={hb.enabled
                      ? {color:'#10b981',borderColor:'#10b98140',background:'#10b98115'}
                      : {color:'#52525b',borderColor:'#27272a',background:'#18181b'}}>
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
                <div className="space-y-2">
                  {Object.entries(usageByModel).sort((a,b)=>b[1]-a[1]).map(([model, cost])=>{
                    const pct = usageCost > 0 ? Math.round((cost/usageCost)*100) : 0
                    return (
                      <div key={model}>
                        <div className="flex justify-between mb-1">
                          <span className="text-white/40 text-xs font-mono">{model.split('/').pop()}</span>
                          <span className="text-white/50 text-xs">${(cost as number).toFixed(3)} ({pct}%)</span>
                        </div>
                        <Bar v={pct} color={model.includes('haiku')?'#a855f7':'#3b82f6'} bg="#1a1a2a"/>
                      </div>
                    )
                  })}
                  {Object.keys(usageByModel).length === 0 && <p className="text-white/20 text-xs">No session data yet</p>}
                </div>
              </div>

              <SH icon="\ud83d\udda5">Hardware</SH>
              <div className="rounded-2xl border border-white/10 p-5" style={{background:'#0f0f0f'}}>
                <div className="flex items-start gap-4">
                  <span className="text-3xl">{"\ud83d\udda5\ufe0f"}</span>
                  <div>
                    <p className="text-white font-medium text-sm">Mac mini \u00b7 Apple Silicon \u00b7 8GB \u00b7 arm64</p>
                    <p className="text-white/50 text-xs mt-0.5">Dedicated OpenClaw machine \u00b7 macOS 26.3.1 \u00b7 Node 22.22.1</p>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {['OpenClaw :18789','n8n :5678','Ollama :11434','Mission Control :3000','Cloudflare Tunnel'].map(l=><Chip key={l} label={l}/>)}
                    </div>
                  </div>
                </div>
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
                <Bar v={orPct} color="#3b82f6" bg="#1a1a2a" />
                <p className="text-white/20 text-xs mt-2">Daily billing report via n8n \u2192 Telegram</p>
              </div>
            </div>
            )
}

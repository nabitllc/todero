'use client'
import React, { useState } from 'react'
import { pColor } from '@/lib/mc-constants'
import { Chip } from '@/lib/mc-atoms'
import { StatusDot, Button, EmptyState } from '@/components/ui'
import { Zap } from 'lucide-react'

interface AutomationsTabProps {
  displayCrons: any[]
}

export default function AutomationsTab({ displayCrons }: AutomationsTabProps) {
  const [autoProjectFilter, setAutoProjectFilter] = useState<string|null>(null)
  const [cronModal, setCronModal] = useState<any>(null)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-medium text-white">Automations</h2>
          <p className="text-xs text-white/50 mt-0.5">All scheduled jobs — LaunchAgents, Vercel crons, and background scripts</p>
        </div>
        <a href="https://n8n.nabit.work" target="_blank" rel="noopener noreferrer"
          className="text-xs text-white/40 hover:text-white border border-white/10 hover:border-white/20 px-3 py-1.5 rounded-lg transition-all">
          Open n8n editor ↗
        </a>
      </div>
      {/* Project filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {['All', 'Infrastructure', 'Vespera', 'Kemuni', 'Todero'].map(pf => {
          const count = pf === 'All' ? displayCrons.length : displayCrons.filter((c:any) => c.project === pf).length
          if (pf !== 'All' && count === 0) return null
          return (
            <Button key={pf} variant={(autoProjectFilter === null && pf === 'All') || autoProjectFilter === pf ? 'primary' : 'secondary'} size="sm"
              onClick={() => setAutoProjectFilter(pf === 'All' ? null : pf)}
              className={`text-[10px] ${(autoProjectFilter === null && pf === 'All') || autoProjectFilter === pf ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30' : ''}`}>
              {pf} ({count})
            </Button>
          )
        })}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        {[
          {label:'Total jobs', value: displayCrons.length, color:'#a855f7'},
          {label:'Active', value: displayCrons.filter((c:any)=>c.status==='active'||c.status==='ok').length, color:'#10b981'},
          {label:'Errors', value: displayCrons.filter((c:any)=>c.status==='error'||(c as any).consecutiveErrors>0).length, color:'#ef4444'},
        ].map(s=>(
          <div key={s.label} className="rounded-xl border border-white/10 px-4 py-3 bg-[#0f0f0f]">
            <div className="text-xl font-bold" style={{color:s.color}}>{s.value}</div>
            <div className="text-[10px] text-white/30 uppercase tracking-wider mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Grouped cron list */}
      <div className="rounded-xl border border-white/10 overflow-hidden bg-[#0f0f0f]">
        {(['launchagent','vercel-cron','n8n'] as const).map(src => {
          const group = displayCrons.filter((c:any) => (c.source ?? 'n8n') === src && (!autoProjectFilter || c.project === autoProjectFilter))
          if (group.length === 0) return null
          const srcLabel = src === 'launchagent' ? '⚡ LaunchAgents' : src === 'n8n' ? '🔧 n8n (retired)' : '⏱ Vercel Crons'
          return (
            <div key={src}>
              <div className="px-4 py-1.5 text-[9px] font-semibold uppercase tracking-widest text-white/30 border-b border-white/10 bg-[#080808]">{srcLabel}</div>
              {group.map((c:any, i:number, arr:any[]) => {
                const modelColor = c.model==='n8n'?'#6b7280':c.model==='Haiku'?'#3b82f6':c.model==='Sonnet'?'#a855f7':c.model==='Gemma'?'#10b981':'#6b7280'
                const isError = c.status === 'error' || (c.consecutiveErrors ?? 0) > 0
                return (
                  <div key={c.id}
                    className={'flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4 px-4 py-3 cursor-pointer hover:bg-white/5 transition-all ' + (i<arr.length-1?'border-b border-white/10':'') + (isError ? ' bg-red-950/30' : '')}
                    onClick={()=>setCronModal(c)}>
                    <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                      <StatusDot variant={isError ? 'error' : c.status === 'active' || c.status === 'ok' ? 'active' : c.status === 'scheduled' ? 'warning' : 'idle'} sm />
                      <span className="font-mono text-xs text-white/40 w-12 shrink-0">{c.time}</span>
                      <span className="text-white/30 text-[10px] w-14 shrink-0">{c.days}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded font-mono shrink-0"
                        style={{background:modelColor+'20',color:modelColor,border:'1px solid '+modelColor+'30'}}>
                        {c.model}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Chip label={c.project} color={pColor(c.project)} />
                      <span className="text-white/70 text-xs truncate">{c.name || c.desc}</span>
                      {isError && <span className="text-[9px] text-red-400 shrink-0">⚠ {c.consecutiveErrors}x</span>}
                      {c.lastRunAtMs && <span className="text-white/30 text-[9px] shrink-0 ml-auto">{Math.round((Date.now()-c.lastRunAtMs)/60000)}m ago</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
        {displayCrons.filter((c:any) => !autoProjectFilter || c.project === autoProjectFilter).length === 0 && (
          <EmptyState icon={Zap} title="No automations found" description="Automations will appear here once configured" />
        )}
      </div>

      {/* Cron Detail Modal */}
      {cronModal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60" onClick={()=>setCronModal(null)}>
          <div className="w-full max-w-sm md:rounded-2xl rounded-t-2xl border border-white/10 p-5 md:p-6 space-y-3 max-h-[85vh] overflow-y-auto bg-[#080808]" onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-white font-semibold text-sm">{(cronModal as any).name || cronModal.id}</h3>
              <Button variant="icon" onClick={()=>setCronModal(null)}>✕</Button>
            </div>
            <div className="space-y-2.5">
              {(cronModal as any).desc && (cronModal as any).desc !== (cronModal as any).name && (
                <div><p className="text-white/30 text-[10px] uppercase tracking-wider">Description</p><p className="text-white/40 text-sm">{(cronModal as any).desc}</p></div>
              )}
              <div><p className="text-white/30 text-[10px] uppercase tracking-wider">Schedule</p><p className="text-white/70 text-sm font-mono">{cronModal.time} · {cronModal.days}</p></div>
              <div><p className="text-white/30 text-[10px] uppercase tracking-wider">Runner</p><p className="text-white/70 text-sm font-mono">{cronModal.model}</p></div>
              <div><p className="text-white/30 text-[10px] uppercase tracking-wider">Project</p><Chip label={cronModal.project} color={pColor(cronModal.project)} /></div>
              <div><p className="text-white/30 text-[10px] uppercase tracking-wider">Source</p><p className="text-white/70 text-sm font-mono">{(cronModal as any).source ?? 'n8n'}</p></div>
              <div><p className="text-white/30 text-[10px] uppercase tracking-wider">Status</p><div className="flex items-center gap-2"><StatusDot variant={cronModal.status === 'active' || cronModal.status === 'ok' ? 'active' : cronModal.status === 'error' ? 'error' : 'idle'} /><span className="text-white/70 text-sm">{cronModal.status}</span></div></div>
              {(cronModal as any).lastRunAtMs && <div><p className="text-white/30 text-[10px] uppercase tracking-wider">Last Run</p><p className="text-white/70 text-sm">{new Date((cronModal as any).lastRunAtMs).toLocaleString()}</p></div>}
              {(cronModal as any).lastRunStatus && <div><p className="text-white/30 text-[10px] uppercase tracking-wider">Last Result</p><p className={`text-sm font-mono ${(cronModal as any).lastRunStatus==='ok'||( cronModal as any).lastRunStatus==='success'?'text-green-400':'text-red-400'}`}>{(cronModal as any).lastRunStatus}</p></div>}
              {(cronModal as any).source === 'launchagent' && <>
                {(cronModal as any).sessionTarget && <div><p className="text-white/30 text-[10px] uppercase tracking-wider">Session Target</p><p className="text-white/70 text-sm font-mono">{(cronModal as any).sessionTarget}</p></div>}
                {(cronModal as any).consecutiveErrors > 0 && <div><p className="text-white/30 text-[10px] uppercase tracking-wider">Consecutive Errors</p><p className="text-red-400 text-sm font-mono">{(cronModal as any).consecutiveErrors}</p></div>}
              </>}
              <div className="pt-2 border-t border-white/10">
                <div className="flex items-center justify-between">
                  <span className="text-white/30 text-[10px] uppercase tracking-wider">Enabled</span>
                  <span className={`text-sm font-medium ${cronModal.status === 'planned' ? 'text-white/50' : 'text-green-400'}`}>
                    {cronModal.status === 'planned' ? 'Disabled' : 'Active'}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

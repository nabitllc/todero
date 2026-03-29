'use client'
import React, { useState } from 'react'
import { pColor } from '@/lib/mc-constants'

function Dot({status,sm}:{status:string;sm?:boolean}) {
  const sz = sm ? 'w-1.5 h-1.5' : 'w-2 h-2'
  const cls = status==='active'||status==='ok' ? 'bg-emerald-500 animate-pulse'
    : status==='scheduled' ? 'bg-yellow-500'
    : status==='planned' ? 'bg-zinc-700'
    : status==='error' ? 'bg-red-500'
    : 'bg-zinc-600'
  return <span className={'inline-block rounded-full shrink-0 '+sz+' '+cls} />
}

function Chip({label,color}:{label:string;color?:string}) {
  return (
    <span className="inline-block text-[10px] font-medium px-2 py-0.5 rounded-full border"
      style={color
        ?{color,borderColor:color+'40',background:color+'15'}
        :{color:'#555',borderColor:'#2a2a2a',background:'#141414'}}>
      {label}
    </span>
  )
}

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
          <h2 className="text-lg font-semibold text-white">Automations</h2>
          <p className="text-xs text-zinc-500 mt-0.5">All scheduled jobs — OpenClaw crons, n8n workflows, and heartbeats</p>
        </div>
        <a href="https://n8n.nabit.work" target="_blank" rel="noopener noreferrer"
          className="text-xs text-zinc-400 hover:text-white border border-zinc-700 hover:border-zinc-500 px-3 py-1.5 rounded-lg transition-colors">
          Open n8n editor ↗
        </a>
      </div>
      {/* Project filter */}
      <div className="flex items-center gap-2 flex-wrap">
        {['All', 'Infrastructure', 'Vespera', 'Kemuni', 'Mission Control'].map(pf => {
          const count = pf === 'All' ? displayCrons.length : displayCrons.filter((c:any) => c.project === pf).length
          if (pf !== 'All' && count === 0) return null
          return (
            <button key={pf} onClick={() => setAutoProjectFilter(pf === 'All' ? null : pf)}
              className={`text-[10px] font-semibold uppercase tracking-wider px-2.5 py-1 rounded-lg border transition-all ${(autoProjectFilter === null && pf === 'All') || autoProjectFilter === pf ? 'border-blue-600 bg-blue-900/30 text-blue-400' : 'border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'}`}>
              {pf} ({count})
            </button>
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
          <div key={s.label} className="rounded-xl border border-zinc-800/60 px-4 py-3" style={{background:'#0f0f0f'}}>
            <div className="text-xl font-bold" style={{color:s.color}}>{s.value}</div>
            <div className="text-[10px] text-zinc-600 uppercase tracking-wider mt-0.5">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Grouped cron list */}
      <div className="rounded-2xl border border-zinc-800/60 overflow-hidden" style={{background:'#0f0f0f'}}>
        {(['openclaw-cron','n8n','openclaw'] as const).map(src => {
          const group = displayCrons.filter((c:any) => (c.source ?? 'n8n') === src && (!autoProjectFilter || c.project === autoProjectFilter))
          if (group.length === 0) return null
          const srcLabel = src === 'openclaw-cron' ? '⚡ OpenClaw Crons' : src === 'n8n' ? '🔧 n8n Workflows' : '💓 Heartbeats'
          return (
            <div key={src}>
              <div className="px-4 py-1.5 text-[9px] font-semibold uppercase tracking-widest text-zinc-600 border-b border-zinc-800/60" style={{background:'#080808'}}>{srcLabel}</div>
              {group.map((c:any, i:number, arr:any[]) => {
                const modelColor = c.model==='n8n'?'#6b7280':c.model==='Haiku'?'#3b82f6':c.model==='Sonnet'?'#a855f7':c.model==='Gemma'?'#10b981':'#6b7280'
                const isError = c.status === 'error' || (c.consecutiveErrors ?? 0) > 0
                return (
                  <div key={c.id}
                    className={'flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4 px-4 py-3 cursor-pointer hover:bg-zinc-800/30 transition-colors ' + (i<arr.length-1?'border-b border-zinc-800/40':'')}
                    style={isError ? {background:'#1a0808'} : {}}
                    onClick={()=>setCronModal(c)}>
                    <div className="flex items-center gap-2 sm:gap-3 shrink-0">
                      <Dot status={isError ? 'error' : c.status} sm />
                      <span className="font-mono text-xs text-zinc-400 w-12 shrink-0">{c.time}</span>
                      <span className="text-zinc-600 text-[10px] w-14 shrink-0">{c.days}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded font-mono shrink-0"
                        style={{background:modelColor+'20',color:modelColor,border:'1px solid '+modelColor+'30'}}>
                        {c.model}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <Chip label={c.project} color={pColor(c.project)} />
                      <span className="text-zinc-300 text-xs truncate">{c.name || c.desc}</span>
                      {isError && <span className="text-[9px] text-red-400 shrink-0">⚠ {c.consecutiveErrors}x</span>}
                      {c.lastRunAtMs && <span className="text-zinc-600 text-[9px] shrink-0 ml-auto">{Math.round((Date.now()-c.lastRunAtMs)/60000)}m ago</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })}
        {displayCrons.filter((c:any) => !autoProjectFilter || c.project === autoProjectFilter).length === 0 && (
          <div className="px-4 py-8 text-center text-zinc-600 text-sm">No automations found</div>
        )}
      </div>

      {/* Cron Detail Modal */}
      {cronModal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60" onClick={()=>setCronModal(null)}>
          <div className="w-full max-w-sm md:rounded-2xl rounded-t-2xl border border-zinc-800 p-5 md:p-6 space-y-3 max-h-[85vh] overflow-y-auto" style={{background:'#0a0a0a'}} onClick={e=>e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-white font-semibold text-sm">{(cronModal as any).name || cronModal.id}</h3>
              <button onClick={()=>setCronModal(null)} className="text-zinc-600 hover:text-white text-lg">✕</button>
            </div>
            <div className="space-y-2.5">
              {(cronModal as any).desc && (cronModal as any).desc !== (cronModal as any).name && (
                <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider">Description</p><p className="text-zinc-400 text-sm">{(cronModal as any).desc}</p></div>
              )}
              <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider">Schedule</p><p className="text-zinc-300 text-sm font-mono">{cronModal.time} · {cronModal.days}</p></div>
              <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider">Runner</p><p className="text-zinc-300 text-sm font-mono">{cronModal.model}</p></div>
              <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider">Project</p><Chip label={cronModal.project} color={pColor(cronModal.project)} /></div>
              <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider">Source</p><p className="text-zinc-300 text-sm font-mono">{(cronModal as any).source ?? 'n8n'}</p></div>
              <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider">Status</p><div className="flex items-center gap-2"><Dot status={cronModal.status} /><span className="text-zinc-300 text-sm">{cronModal.status}</span></div></div>
              {(cronModal as any).lastRunAtMs && <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider">Last Run</p><p className="text-zinc-300 text-sm">{new Date((cronModal as any).lastRunAtMs).toLocaleString()}</p></div>}
              {(cronModal as any).lastRunStatus && <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider">Last Result</p><p className={`text-sm font-mono ${(cronModal as any).lastRunStatus==='ok'||( cronModal as any).lastRunStatus==='success'?'text-emerald-400':'text-red-400'}`}>{(cronModal as any).lastRunStatus}</p></div>}
              {(cronModal as any).source === 'openclaw-cron' && <>
                {(cronModal as any).sessionTarget && <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider">Session Target</p><p className="text-zinc-300 text-sm font-mono">{(cronModal as any).sessionTarget}</p></div>}
                {(cronModal as any).consecutiveErrors > 0 && <div><p className="text-zinc-600 text-[10px] uppercase tracking-wider">Consecutive Errors</p><p className="text-red-400 text-sm font-mono">{(cronModal as any).consecutiveErrors}</p></div>}
              </>}
              <div className="pt-2 border-t border-zinc-800/50">
                <div className="flex items-center justify-between">
                  <span className="text-zinc-600 text-[10px] uppercase tracking-wider">Enabled</span>
                  <span className={`text-sm font-medium ${cronModal.status === 'planned' ? 'text-zinc-500' : 'text-emerald-400'}`}>
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

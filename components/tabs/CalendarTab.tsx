'use client'
import React, { useState } from 'react'
import { Dot, Chip, SH } from '@/lib/mc-atoms'
import { pColor, fmtMins, CRONS } from '@/lib/mc-constants'

const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

export default function CalendarTab({
  calendarIssues,
  sprintProjects,
  calendarView,
  setCalendarView,
  displayCrons,
  nextRuns,
  cronModal,
  setCronModal,
}: {
  calendarIssues: any[]
  sprintProjects: any[]
  calendarView: 'week' | 'month'
  setCalendarView: (v: 'week' | 'month') => void
  displayCrons: any[]
  nextRuns: any[]
  cronModal: any
  setCronModal: (c: any) => void
}) {
            const calIssues = (calendarIssues ?? []) as any[]
            const calSprints = (sprintProjects ?? []) as any[]
            const calView = calendarView
            const todayIdx = new Date().getDay()
            // Helper: get week dates
            const getWeekDates = () => {
              const now = new Date()
              const startOfWeek = new Date(now); startOfWeek.setDate(now.getDate() - now.getDay())
              return Array.from({length:7},(_,i)=>{ const d=new Date(startOfWeek); d.setDate(startOfWeek.getDate()+i); return d })
            }
            // Helper: get month dates grid (6 weeks)
            const getMonthDates = () => {
              const now = new Date()
              const first = new Date(now.getFullYear(), now.getMonth(), 1)
              const startDay = first.getDay()
              const start = new Date(first); start.setDate(1 - startDay)
              return Array.from({length:42},(_,i)=>{ const d=new Date(start); d.setDate(start.getDate()+i); return d })
            }
            const dates = calView === 'week' ? getWeekDates() : getMonthDates()
            const todayStr = new Date().toISOString().slice(0,10)
            // Group issues by due_date
            const issuesByDate: Record<string,any[]> = {}
            calIssues.forEach((iss:any) => {
              if (!iss.due_date) return
              const d = iss.due_date.slice(0,10)
              if (!issuesByDate[d]) issuesByDate[d] = []
              issuesByDate[d].push(iss)
            })
            // Sprint ranges
            const sprintRanges = calSprints.map((p:any)=>({
              name: p.name || p.id,
              color: p.color || '#3b82f6',
              start: p.startDate || p.start_date,
              end: p.deadline || p.end_date,
            })).filter(s=>s.start && s.end)
            const isInSprint = (dateStr:string, s:any) => dateStr >= s.start && dateStr <= s.end
            const projColor = (p:string) => p==='Vespera'?'#a855f7':p==='Kemuni'?'#3b82f6':p==='Infrastructure'?'#f59e0b':'#6b7280'
            // Cron label helper
            const cronLabel = (c:any) => (c.name || c.desc || c.id.replace(/-/g,' '))

            return (
            <div className="space-y-5">
              {/* View toggle */}
              <div className="flex items-center justify-between">
                <SH icon="📅">Calendar</SH>
                <div className="flex gap-1 bg-[#0f0f0f] rounded-lg p-0.5 border border-white/10">
                  {(['week','month'] as const).map(v=>(
                    <button key={v} onClick={()=>setCalendarView(v)}
                      className={'px-3 py-1 text-[11px] font-semibold rounded-md transition-all '+(calView===v?'bg-white text-black':'text-white/50 hover:text-white/70')}>
                      {v === 'week' ? 'Week' : 'Month'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Sprint boundary blocks */}
              {sprintRanges.length>0 && (
                <div className="flex flex-wrap gap-2">
                  {sprintRanges.map((s,i)=>(
                    <div key={i} className="flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs"
                      style={{borderColor:s.color+'40',background:s.color+'10',color:s.color}}>
                      <span className="font-semibold">{s.name}</span>
                      <span className="text-white/50 font-mono text-[10px]">{s.start} — {s.end}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Always Running */}
              <div>
                <SH icon="⚡">Always Running</SH>
                <div className="flex flex-wrap gap-2">
                  {CRONS.filter(c=>c.days==='daily'&&c.status==='active').map(c=>(
                    <div key={c.id} className="flex items-center gap-2 px-2.5 md:px-3 py-1.5 rounded-full border cursor-pointer hover:brightness-125 transition-all"
                      style={{background:pColor(c.project)+'15',borderColor:pColor(c.project)+'40'}}
                      onClick={()=>setCronModal(c)}>
                      <Dot status="active" sm />
                      <span className="text-xs font-medium" style={{color:pColor(c.project)}}>{cronLabel(c)}</span>
                      <span className="text-white/30 text-[10px]">· {c.time}</span>
                      <span className="text-[9px] px-1 py-0.5 rounded bg-white/10 text-white/40 font-mono">{c.model}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Calendar Grid */}
              <div>
                <SH icon={calView==='week'?"📅":"🗓"}>{ calView==='week'?'This Week':'This Month'}</SH>
                <div className="overflow-x-auto -mx-1 px-1"><div className={'grid grid-cols-7 gap-1 min-w-[580px]'}>
                  {/* Day headers */}
                  {DAYS.map((day,di)=>(
                    <div key={day} className={'text-center text-[10px] font-semibold py-1 rounded-lg '+(
                      di===todayIdx && calView==='week' ? 'bg-white text-black' : 'text-white/50 bg-[#0f0f0f]/50'
                    )}>
                      {day}
                    </div>
                  ))}
                  {/* Date cells */}
                  {dates.map((d,i)=>{
                    const ds = d.toISOString().slice(0,10)
                    const isToday = ds === todayStr
                    const isCurrentMonth = d.getMonth() === new Date().getMonth()
                    const dayIssues = issuesByDate[ds] || []
                    const dayCrons = displayCrons.filter((c:any)=>{
                      if(c.days==='daily') return true
                      if(c.days===DAYS[d.getDay()]) return true
                      return false
                    })
                    const inSprints = sprintRanges.filter(s=>isInSprint(ds,s))
                    return (
                      <div key={i} className={'rounded-lg border p-1.5 min-h-[60px] '+(calView==='month'?'min-h-[48px]':'')}
                        style={{
                          background: isToday?'rgba(99,102,241,0.08)':inSprints.length>0?(inSprints[0].color+'08'):'#080808',
                          borderColor: isToday?'rgba(255,255,255,0.2)':inSprints.length>0?(inSprints[0].color+'25'):'rgba(255,255,255,0.05)',
                          opacity: calView==='month'&&!isCurrentMonth?0.4:1,
                        }}>
                        <div className="flex items-center justify-between mb-1">
                          <span className={'text-[10px] font-mono '+(isToday?'text-white font-bold':'text-white/50')}>{d.getDate()}</span>
                          {inSprints.map((s,si)=>(
                            <span key={si} className="text-[7px] px-1 rounded" style={{background:s.color+'20',color:s.color}}>{s.name.slice(0,3)}</span>
                          ))}
                        </div>
                        {/* Issue due dates */}
                        {dayIssues.slice(0,3).map((iss:any)=>(
                          <div key={iss.id} className="text-[9px] leading-tight mb-0.5 px-1 py-0.5 rounded truncate cursor-pointer hover:brightness-125"
                            style={{background:projColor(iss.project)+'18',color:projColor(iss.project),borderLeft:`2px solid ${projColor(iss.project)}`}}
                            title={`${iss.task_key}: ${iss.title}`}>
                            {iss.task_key}: {iss.title?.slice(0,20)}
                          </div>
                        ))}
                        {dayIssues.length>3 && <div className="text-[8px] text-white/30">+{dayIssues.length-3} more</div>}
                        {/* Cron events (compact in month view) */}
                        {calView==='week' && dayCrons.slice(0,3).map((c:any)=>(
                          <div key={c.id} className="text-[9px] leading-tight mb-0.5 px-1 py-0.5 rounded truncate cursor-pointer hover:brightness-125"
                            style={{background:'rgba(255,255,255,0.03)',color:'rgba(255,255,255,0.4)'}}
                            onClick={()=>setCronModal(c)}>
                            {c.time} {cronLabel(c)}
                          </div>
                        ))}
                        {calView==='month' && dayCrons.length>0 && (
                          <div className="text-[8px] text-white/30">{dayCrons.length} cron{dayCrons.length>1?'s':''}</div>
                        )}
                      </div>
                    )
                  })}
                </div></div>
              </div>
              <div>
                <SH icon="⏭">Next Up</SH>
                <div className="space-y-2">
                  {nextRuns.map(({cron,mins},i)=>(
                    <div key={cron.id} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4 px-4 md:px-5 py-3 rounded-xl border border-white/10 cursor-pointer hover:border-white/20 transition-colors" style={{background:'#0f0f0f'}} onClick={()=>setCronModal(cron)}>
                      <div className="flex items-center gap-2 sm:gap-4 flex-1 min-w-0">
                        <span className="text-white/30 text-xs shrink-0">#{i+1}</span>
                        <Dot status={cron.status} />
                        <span className="font-mono text-xs text-white truncate">{cron.id}</span>
                      </div>
                      <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
                        <span className="text-white/50 text-xs truncate">{cron.desc}</span>
                        <span className="text-xs font-semibold tabular-nums shrink-0" style={{color:mins<60?'#f59e0b':'#6b7280'}}>
                          in {fmtMins(mins)}
                        </span>
                        <Chip label={cron.project} color={pColor(cron.project)} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Automations / Crons */}
              <div>
                <SH icon="🤖">Automations</SH>
                <div className="rounded-2xl border border-white/10 overflow-hidden" style={{background:'#0f0f0f'}}>
                  {/* Group by source */}
                  {(['openclaw-cron','n8n','openclaw'] as const).map(src => {
                    const group = displayCrons.filter((c:any) => (c.source ?? 'n8n') === src)
                    if (group.length === 0) return null
                    const srcLabel = src === 'openclaw-cron' ? '⚡ OpenClaw Crons' : src === 'n8n' ? '🔧 n8n Workflows' : '💓 Heartbeats'
                    return (
                      <div key={src}>
                        <div className="px-4 py-1.5 text-[9px] font-semibold uppercase tracking-widest text-white/30 border-b border-white/10" style={{background:'#080808'}}>{srcLabel}</div>
                        {group.map((c:any,i:number,arr:any[])=>{
                          const modelColor = c.model==='n8n'?'#6b7280':c.model==='Haiku'?'#3b82f6':c.model==='Sonnet'?'#a855f7':c.model==='Gemma'?'#10b981':'#6b7280'
                          const isError = c.status === 'error' || (c.consecutiveErrors ?? 0) > 0
                          return (
                            <div key={c.id} className={'flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-4 px-4 md:px-5 py-3 cursor-pointer hover:bg-white/5 transition-colors '+(i<arr.length-1?'border-b border-white/10':'')}
                              style={isError ? {background:'rgba(239,68,68,0.05)'} : {}}
                              onClick={()=>setCronModal(c)}>
                              <div className="flex items-center gap-2 sm:gap-4">
                                <span className="font-mono text-xs text-white/40 shrink-0">{c.time}</span>
                                <span className="text-white/30 text-[10px] shrink-0">{c.days}</span>
                                <span className="text-[9px] px-1.5 py-0.5 rounded font-mono shrink-0"
                                  style={{background:modelColor+'20',color:modelColor,border:'1px solid '+modelColor+'30'}}>
                                  {c.model}
                                </span>
                                <Dot status={isError ? 'error' : c.status} sm />
                                {isError && <span className="text-[9px] text-red-400">⚠ {c.consecutiveErrors}x error</span>}
                              </div>
                              <div className="flex items-center gap-2 min-w-0">
                                <Chip label={c.project} color={pColor(c.project)} />
                                <span className="text-white/70 text-xs truncate">{c.name || c.desc}</span>
                                {c.lastRunAtMs && <span className="text-white/30 text-[9px] shrink-0 ml-auto">{Math.round((Date.now()-c.lastRunAtMs)/60000)}m ago</span>}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Cron Detail Modal */}
              {cronModal && (
                <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60" onClick={()=>setCronModal(null)}>
                  <div className="w-full max-w-sm md:rounded-2xl rounded-t-2xl border border-white/10 p-5 md:p-6 space-y-3 max-h-[85vh] overflow-y-auto" style={{background:'#080808'}} onClick={e=>e.stopPropagation()}>
                    <div className="flex items-center justify-between">
                      <h3 className="text-white font-semibold text-sm">{cronModal.id}</h3>
                      <button onClick={()=>setCronModal(null)} className="text-white/30 hover:text-white text-lg">✕</button>
                    </div>
                    <div className="space-y-2.5">
                      <div><p className="text-white/30 text-[10px] uppercase tracking-wider">Description</p><p className="text-white/70 text-sm">{cronModal.desc}</p></div>
                      <div><p className="text-white/30 text-[10px] uppercase tracking-wider">Time</p><p className="text-white/70 text-sm font-mono">{cronModal.time}</p></div>
                      <div><p className="text-white/30 text-[10px] uppercase tracking-wider">Schedule</p><p className="text-white/70 text-sm">{cronModal.days}</p></div>
                      <div><p className="text-white/30 text-[10px] uppercase tracking-wider">Runner</p><p className="text-white/70 text-sm font-mono">{cronModal.model}</p></div>
                      <div><p className="text-white/30 text-[10px] uppercase tracking-wider">Project</p><Chip label={cronModal.project} color={pColor(cronModal.project)} /></div>
                      <div><p className="text-white/30 text-[10px] uppercase tracking-wider">Status</p><div className="flex items-center gap-2"><Dot status={cronModal.status} /><span className="text-white/70 text-sm">{cronModal.status}</span></div></div>
                      {(cronModal as any).source === 'openclaw-cron' && <>
                        {(cronModal as any).sessionTarget && <div><p className="text-white/30 text-[10px] uppercase tracking-wider">Session Target</p><p className="text-white/70 text-sm font-mono">{(cronModal as any).sessionTarget}</p></div>}
                        {(cronModal as any).lastRunAtMs && <div><p className="text-white/30 text-[10px] uppercase tracking-wider">Last Run</p><p className="text-white/70 text-sm">{new Date((cronModal as any).lastRunAtMs).toLocaleString()}</p></div>}
                        {(cronModal as any).lastRunStatus && <div><p className="text-white/30 text-[10px] uppercase tracking-wider">Last Status</p><p className={`text-sm font-mono ${(cronModal as any).lastRunStatus === 'ok' ? 'text-emerald-400' : 'text-red-400'}`}>{(cronModal as any).lastRunStatus}</p></div>}
                        {(cronModal as any).consecutiveErrors > 0 && <div><p className="text-white/30 text-[10px] uppercase tracking-wider">Consecutive Errors</p><p className="text-red-400 text-sm font-mono">{(cronModal as any).consecutiveErrors}</p></div>}
                      </>}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )
}

'use client'
import React from 'react'
import { Chip, Dot, SH } from '@/lib/mc-atoms'
import { Button, EmptyState as EmptyStateUI } from '@/components/ui'
import { Users } from 'lucide-react'
import AgentDetailView from '@/components/tabs/AgentDetailView'

function formatAgo(ms: number): string {
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s ago`
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ${min % 60}m ago`
  const d = Math.floor(h / 24)
  return `${d}d ${h % 24}h ago`
}

function lastActiveLabel(agentId: string, runsData: Record<string, {taskTitle:string; startedAt:string|null; status:string}>): string {
  const ar = runsData[agentId]
  if (!ar?.startedAt) return 'never'
  const started = new Date(ar.startedAt).getTime()
  if (Number.isNaN(started)) return 'unknown'
  const diff = Date.now() - started
  if (ar.status === 'running' && diff < 30 * 60_000) return 'active now'
  return formatAgo(diff)
}

export default function AgentsTab({
  displayAgents,
  agentLiveStatus,
  agentRunsData,
  liveAgents,
  act,
  agentModal,
  setAgentModal,
  projectFilter,
}: {
  displayAgents: any[]
  agentLiveStatus: (agentId: string) => { dot: 'green'|'amber'|'grey'; label: string }
  agentRunsData: Record<string, {taskTitle:string; startedAt:string|null; status:string}>
  liveAgents: any[] | null
  act: (id: string) => string
  agentModal: any
  setAgentModal: (a: any) => void
  projectFilter?: string | null
}) {
  // /api/agents stamps every row with where the roster came from. When it fell
  // back to the built-in list the UI must say so — otherwise a host with no
  // AGENTS.md looks identical to one with a real roster.
  const rosterSource: string | undefined = liveAgents?.[0]?.rosterSource
  const rosterWarning: string | null = liveAgents?.[0]?.rosterWarning ?? null

  return (
            <div className="space-y-6">
              {liveAgents && <div className="flex items-center gap-2 mb-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 anim-pg"/><span className="text-white/30 text-[10px]">Live agent data · {displayAgents.length} agents</span></div>}
              {rosterSource === 'builtin' && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                  <span className="text-amber-300 text-[11px] font-medium shrink-0">Built-in roster</span>
                  <span className="text-white/60 text-[10px] leading-relaxed">
                    {rosterWarning ?? 'No AGENTS.md found on this host.'} Showing the built-in agent list — set TODERO_AGENTS_MD to point at a real roster.
                  </span>
                </div>
              )}
              {displayAgents.length === 0 && <EmptyStateUI icon={Users} title="No agents registered yet" />}

              {/* Lead agent card */}
              {displayAgents.length > 0 && (() => {
                const ls0 = agentLiveStatus(displayAgents[0].id)
                const dotColor = ls0.dot === 'green' ? 'bg-emerald-500 dot-health-green' : ls0.dot === 'amber' ? 'bg-amber-500 dot-health-amber' : 'bg-white/10'
                return <div className="flex justify-center">
                <div className="rounded-2xl p-4 md:p-6 border border-white/10/50 card-glow w-full max-w-xs sm:max-w-sm cursor-pointer hover:border-white/20 transition-colors" style={{background:'#0f0f0f'}} onClick={()=>setAgentModal(displayAgents[0])}>
                  <div className="flex items-center gap-4 mb-4">
                    <div className="w-14 h-14 rounded-2xl flex items-center justify-center text-3xl" style={{background:'#1a1a1a'}}>
                      {displayAgents[0].emoji}
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <p className="text-white font-semibold">{displayAgents[0].name}</p>
                        <span className={`inline-block w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`} title={ls0.label} />
                        {displayAgents[0].type === 'consultant' && (
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-purple-500/50 text-purple-300 bg-purple-500/10 font-semibold">Consultant</span>
                        )}
                        {displayAgents[0].modelShort && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-white/50">{displayAgents[0].modelShort}</span>}
                      </div>
                      <p className="text-white/50 text-xs">{displayAgents[0].role}</p>
                      {agentRunsData[displayAgents[0].id]?.status === 'running' && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-medium mt-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                          On duty
                        </span>
                      )}
                      {ls0.dot === 'green' && <p className="text-emerald-400/80 text-[10px] font-mono mt-0.5 truncate max-w-[200px]">↳ {ls0.label}</p>}
                      {ls0.dot === 'amber' && <p className="text-amber-400/70 text-[10px] font-mono mt-0.5">{ls0.label}</p>}
                      {ls0.dot === 'grey' && <p className="text-white/30 text-[10px] font-mono mt-0.5">Idle · last active {lastActiveLabel(displayAgents[0].id, agentRunsData)}</p>}
                    </div>
                  </div>
                  <p className="text-white/50 text-sm mb-4 leading-relaxed">{displayAgents[0].desc}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {displayAgents[0].capabilities.map((c:string)=><Chip key={c} label={c}/>)}
                  </div>
                </div>
              </div>
              })()}
              <div className="flex justify-center">
                <div className="w-px h-6 bg-gradient-to-b from-white/20 to-transparent" />
              </div>
              <div className="flex justify-center">
                <div className="w-3/4 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
              </div>

              {/* Active agents */}
              <SH icon="🤖">Active Agents</SH>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {displayAgents.slice(1).filter((a:any)=>a.status!=='planned').sort((a:any,b:any)=>{
                  const la = agentLiveStatus(a.id).dot, lb = agentLiveStatus(b.id).dot
                  const pri = (d: string) => d==='green'?0:d==='amber'?1:2
                  if(pri(la)!==pri(lb)) return pri(la)-pri(lb)
                  return (a.ago??9999)-(b.ago??9999)
                }).map((a:any)=>{
                  const ls = agentLiveStatus(a.id)
                  const dotColor = ls.dot === 'green' ? 'bg-emerald-500 dot-health-green' : ls.dot === 'amber' ? 'bg-amber-500 dot-health-amber' : 'bg-white/10'
                  return (
                  <div key={a.id} className="rounded-2xl p-5 border card-glow cursor-pointer hover:border-white/20 transition-colors" style={{background:'#0f0f0f',borderColor:a.color+'28'}} onClick={()=>setAgentModal(a)}>
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl shrink-0"
                        style={{background:a.color+'18',border:'1px solid '+a.color+'30'}}>
                        {a.emoji}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <p className="text-white text-sm font-semibold truncate">{a.name}</p>
                          <span className={`inline-block w-2 h-2 rounded-full shrink-0 ${dotColor}`} title={ls.label} />
                          {a.type === 'consultant' && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-purple-500/50 text-purple-300 bg-purple-500/10 font-semibold">Consultant</span>
                          )}
                          {a.modelShort && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-white/50">{a.modelShort}</span>}
                        </div>
                        <p className="text-white/50 text-xs truncate">{a.role}</p>
                        {agentRunsData[a.id]?.status === 'running' && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-[10px] font-medium mt-0.5">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                            On duty
                          </span>
                        )}
                        <p className={`text-[10px] font-mono truncate ${ls.dot==='green'?'text-emerald-400/80':ls.dot==='amber'?'text-amber-400/70':'text-white/20'}`}>
                          {ls.dot === 'green' ? `↳ ${ls.label}` : ls.label}
                        </p>
                        <p className="text-[9px] font-mono text-white/30 truncate" title="Time since last run">
                          last active {lastActiveLabel(a.id, agentRunsData)}
                        </p>
                      </div>
                    </div>
                    {ls.dot === 'green' && (a.currentTask || agentRunsData[a.id]?.taskTitle) && <p className="text-emerald-400/60 text-[10px] mb-2 truncate">↳ {(a.currentTask || agentRunsData[a.id]?.taskTitle || '').slice(0,40)}</p>}
                    <p className="text-white/50 text-xs leading-relaxed mb-3">{a.desc}</p>
                    <div className="flex flex-wrap gap-1 mb-2">
                      {a.capabilities.map((c:string)=><Chip key={c} label={c}/>)}
                    </div>
                  </div>
                  )
                })}
              </div>

              {/* Planned agents */}
              {displayAgents.filter((a:any)=>a.status==='planned').length > 0 && (<>
                <SH icon="📋">Planned Agents</SH>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {displayAgents.filter((a:any)=>a.status==='planned').map((a:any)=>(
                    <div key={a.id} className="rounded-2xl p-5 border border-dashed cursor-pointer hover:border-white/20 transition-colors opacity-60 hover:opacity-90" style={{background:'#080808',borderColor:a.color+'20'}} onClick={()=>setAgentModal(a)}>
                      <div className="flex items-center gap-3 mb-3">
                        <div className="w-11 h-11 rounded-xl flex items-center justify-center text-2xl shrink-0"
                          style={{background:a.color+'10',border:'1px dashed '+a.color+'25'}}>
                          {a.emoji}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <p className="text-white/40 text-sm font-semibold truncate">{a.name}</p>
                            <span className="text-[8px] px-1.5 py-0.5 rounded-full border border-white/10 text-white/50 bg-[#0f0f0f] font-semibold uppercase">Planned</span>
                            {a.type === 'consultant' && (
                              <span className="text-[9px] px-1.5 py-0.5 rounded-full border border-purple-500/50 text-purple-300 bg-purple-500/10 font-semibold">Consultant</span>
                            )}
                            {a.modelShort && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-white/50">{a.modelShort}</span>}
                          </div>
                          <p className="text-white/30 text-xs truncate">{a.role}</p>
                        </div>
                      </div>
                      <p className="text-white/30 text-xs leading-relaxed mb-3">{a.desc}</p>
                      <div className="flex flex-wrap gap-1 mb-2">
                        {a.capabilities.map((c:string)=><Chip key={c} label={c}/>)}
                      </div>
                      {(a as any).activatesWhen && (
                        <div className="mt-2 pt-2 border-t border-white/10">
                          <span className="text-[9px] text-white/30">Activates: </span>
                          <span className="text-[9px] text-white/50">{(a as any).activatesWhen}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </>)}


              {/* Agent Detail View */}
              {agentModal && (
                <AgentDetailView agent={agentModal} onClose={() => setAgentModal(null)} />
              )}
            </div>
  )
}

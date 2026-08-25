'use client'
import React from 'react'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import type { ApiError } from '@/hooks/useApiData'

/** One journal entry inside a memory file. */
export interface MemEntry {
  title: string
  bullets: string[]
  body: string
}

/** A row of /api/memory's `files` array. */
export interface MemFile {
  filename: string
  label: string
  date: string
  kb: number
  words: number
  group: 'today' | 'yesterday' | 'week' | 'month' | 'older'
  entries: MemEntry[]
}

/**
 * TOD-654: `memFiles` is `MemFile[] | null`, not `MemFile[]`. `null` means the
 * load failed or has not finished — the component must branch on it, and the
 * type makes forgetting a compile error. Neither the "{n} entries" counter nor
 * the "No memory files yet." empty state may render while `error` is set.
 */
export default function MemoryTab({ memFiles, error, onRetry, openMem, setOpenMem }: {
  memFiles: MemFile[] | null
  error?: ApiError | null
  onRetry?: () => void
  openMem: string | null
  setOpenMem: (f: string | null) => void
}) {
  const loaded: MemFile[] | null = error ? null : memFiles
  return (
            <div className="flex gap-0 h-[calc(100vh-88px)] -mx-6 -my-5">

              {/* Left panel */}
              <div className={`${openMem ? 'hidden md:flex' : 'flex'} w-full md:w-64 shrink-0 border-r border-white/10 flex-col overflow-hidden`} style={{background:'#0f0f0f'}}>
                {/* Search */}
                <div className="px-3 py-3 border-b border-white/10">
                  <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/10" style={{background:'#111'}}>
                    <svg className="w-3 h-3 text-white/30" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                    <span className="text-white/30 text-xs">Search memory...</span>
                  </div>
                </div>

                {/* Long-Term Memory card */}
                <div className="px-3 py-2.5 border-b border-white/10 flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 text-sm"
                    style={{background:'linear-gradient(135deg,#4f46e5,#7c3aed)'}}>
                    🧠
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-xs font-semibold">Long-Term Memory</p>
                    <p className="text-white/30 text-[10px]">MEMORY.md · updated daily</p>
                  </div>
                </div>

                {/* DAILY JOURNAL header */}
                <div className="px-4 pt-3 pb-1 flex items-center justify-between">
                  <span className="text-white/50 text-[10px] font-semibold uppercase tracking-widest">Daily Journal</span>
                  <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-full"
                    style={{background: loaded ? '#3b82f620' : '#ef444420', color: loaded ? '#3b82f6' : '#ef4444'}}>
                    {loaded ? `${loaded.length} entries` : error ? 'data unavailable' : 'loading…'}
                  </span>
                </div>

                {/* File list */}
                <div className="flex-1 overflow-y-auto">
                  {error ? (
                    <div className="px-3 py-3">
                      <ApiErrorBanner error={error} onRetry={onRetry} />
                    </div>
                  ) : loaded === null ? (
                    <p className="text-white/20 text-xs px-4 py-3">Loading memory…</p>
                  ) : loaded.length===0 ? (
                    <p className="text-white/20 text-xs px-4 py-3">No memory files yet.</p>
                  ) : (
                    (['today','yesterday','week','month','older'] as const).map(group => {
                      const grouped = loaded.filter(f=>f.group===group)
                      if(!grouped.length) return null
                      const labels: Record<string,string> = {
                        today:'Today', yesterday:'Yesterday',
                        week:'This Week', month:'This Month', older:'Older'
                      }
                      const isCompact = group==='month'||group==='older'
                      return (
                        <div key={group} className="mb-0.5">
                          {/* Group header */}
                          <div className="flex items-center gap-2 px-4 py-1.5">
                            <svg className="w-3 h-3 text-white/20 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isCompact ? "M9 5l7 7-7 7" : "M19 9l-7 7-7-7"} />
                            </svg>
                            <span className="text-white/30 text-[10px] font-semibold uppercase tracking-wider">
                              {labels[group]}
                            </span>
                            <span className="text-white/20 text-[10px]">({grouped.length})</span>
                          </div>
                          {/* Files */}
                          {!isCompact && grouped.map(f=>(
                            <button key={f.filename}
                              onClick={()=>setOpenMem(openMem===f.filename?null:f.filename)}
                              className={'w-full text-left px-4 py-2 border-l-2 transition-all '+(
                                openMem===f.filename
                                  ? 'border-l-indigo-500 bg-white/10'
                                  : 'border-l-transparent hover:bg-[#0f0f0f]/50 hover:border-l-white/10'
                              )}>
                              <div className="flex items-center gap-2">
                                {/* Calendar icon */}
                                <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"
                                  style={{color: openMem===f.filename ? '#818cf8' : '#52525b'}}>
                                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" strokeWidth="2"/>
                                  <line x1="16" y1="2" x2="16" y2="6" strokeWidth="2"/>
                                  <line x1="8" y1="2" x2="8" y2="6" strokeWidth="2"/>
                                  <line x1="3" y1="10" x2="21" y2="10" strokeWidth="2"/>
                                </svg>
                                <span className={'text-xs font-medium '+(openMem===f.filename?'text-white':'text-white/40')}>
                                  {f.label}
                                </span>
                              </div>
                              <p className="text-white/30 text-[10px] mt-0.5 pl-5">{f.kb} KB · {f.words} words</p>
                            </button>
                          ))}
                          {isCompact && grouped.length>0 && (
                            <p className="text-white/20 text-[10px] px-4 pb-1.5">
                              {grouped.length} file{grouped.length>1?'s':''} — click to expand
                            </p>
                          )}
                        </div>
                      )
                    })
                  )}
                </div>
              </div>

              {/* Right panel: journal view */}
              <div className={`${openMem ? 'flex' : 'hidden md:flex'} flex-1 flex-col overflow-hidden`} style={{background:'#080808'}}>
              {openMem && <button onClick={()=>setOpenMem(null)} className="md:hidden shrink-0 flex items-center gap-2 px-4 py-3 border-b border-white/10 text-white/40 text-xs hover:text-white">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7"/></svg>
                Back to list
              </button>}
              <div className="flex-1 overflow-y-auto">
                {error ? (
                  <div className="flex items-center justify-center h-full px-8">
                    <div className="max-w-xl w-full">
                      <ApiErrorBanner error={error} onRetry={onRetry} />
                    </div>
                  </div>
                ) : !openMem ? (
                  <div className="flex items-center justify-center h-full">
                    <div className="text-center">
                      <div className="w-12 h-12 rounded-2xl mx-auto mb-4 flex items-center justify-center text-2xl"
                        style={{background:'linear-gradient(135deg,#4f46e5,#7c3aed)'}}>🧠</div>
                      <p className="text-white/40 text-sm font-medium">Select a journal entry</p>
                      <p className="text-white/20 text-xs mt-1">Session logs appear on the left</p>
                    </div>
                  </div>
                ) : (()=>{
                  const file = loaded?.find(f=>f.filename===openMem)
                  if(!file) return null
                  const fullDate = new Date(file.date+'T12:00:00').toLocaleDateString('en-US',{
                    weekday:'long', year:'numeric', month:'long', day:'numeric'
                  })
                  return (
                    <div className="px-8 py-7 max-w-3xl">
                      {/* Header */}
                      <div className="mb-7 pb-5 border-b border-white/10/50">
                        <p className="text-indigo-400 text-xs font-semibold uppercase tracking-widest mb-1">Daily Journal</p>
                        <h1 className="text-white text-xl font-bold mb-1">
                          Journal: <span className="text-white/70 font-medium">{file.date}</span>
                        </h1>
                        <p className="text-white/50 text-sm">
                          {fullDate} &nbsp;·&nbsp; {file.kb} KB &nbsp;·&nbsp; {file.words} words
                        </p>
                      </div>

                      {/* Entries */}
                      <div className="space-y-10">
                        {file.entries.map((entry, i)=>(
                          <div key={i} className="flex gap-4">
                            {/* Left: colored dot + line */}
                            <div className="flex flex-col items-center pt-1 shrink-0">
                              <div className="w-3 h-3 rounded-full shrink-0"
                                style={{background: i%3===0?'#6366f1':i%3===1?'#8b5cf6':'#a78bfa',
                                  boxShadow:'0 0 0 3px '+(i%3===0?'#6366f120':i%3===1?'#8b5cf620':'#a78bfa20')}} />
                              {i < file.entries.length-1 && (
                                <div className="w-px flex-1 mt-2" style={{background:'rgba(255,255,255,0.05)',minHeight:'40px'}} />
                              )}
                            </div>
                            {/* Right: content */}
                            <div className="flex-1 pb-2">
                              <h2 className="text-base font-semibold mb-3" style={{color:'#a5b4fc'}}>
                                {entry.title}
                              </h2>
                              {entry.bullets.length>0 ? (
                                <div className="space-y-2">
                                  {entry.bullets.map((b,j)=>{
                                    const colonIdx = b.indexOf(':')
                                    const hasLabel = colonIdx>0 && colonIdx<40
                                    return (
                                      <div key={j} className="flex gap-2">
                                        <span className="text-white/20 mt-1.5 shrink-0">·</span>
                                        <p className="text-white/70 text-sm leading-relaxed">
                                          {hasLabel ? (
                                            <>
                                              <span className="text-white font-semibold">{b.slice(0,colonIdx)}</span>
                                              <span className="text-white/40">{b.slice(colonIdx)}</span>
                                            </>
                                          ) : b}
                                        </p>
                                      </div>
                                    )
                                  })}
                                </div>
                              ) : (
                                <p className="text-white/40 text-sm leading-relaxed">{entry.body.slice(0,400)}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })()}
              </div>{/* end inner scroll div */}
              </div>{/* end right panel */}
            </div>
  )
}

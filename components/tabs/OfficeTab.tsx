'use client'
import React, { useState, useEffect } from 'react'
import AgentOffice from '@/components/AgentOffice'

function OfficeActivityPanel({ agentRunsData }: { agentRunsData: Record<string, {taskTitle:string; startedAt:string|null; status:string}> }) {
  const [runs, setRuns] = useState<any[]>([])
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    const SUPA = 'https://twthgapiouiqhavrcnry.supabase.co'
    const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
    const fetchRuns = () => {
      fetch(`${SUPA}/rest/v1/agent_runs?select=agent_id,task_title,status,started_at,tokens_used&order=started_at.desc&limit=20`, {
        headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
      }).then(r => r.json()).then(data => {
        if (Array.isArray(data)) setRuns(data)
      }).catch(() => {})
    }
    fetchRuns()
    const iv = setInterval(fetchRuns, 30000)
    return () => clearInterval(iv)
  }, [])

  const AGENT_NAMES: Record<string,{name:string;emoji:string}> = {
    main:{name:'KAOS',emoji:'🧠'}, scout:{name:'Scout',emoji:'🔍'}, ops:{name:'Ops',emoji:'⚙️'},
    'kemuni-sme':{name:'Kemuni SME',emoji:'🚀'}, 'vespera-sme':{name:'Vespera SME',emoji:'🖤'},
    builder:{name:'Builder',emoji:'🔨'}, tester:{name:'Tester',emoji:'🧪'}, deployer:{name:'Deployer',emoji:'🚀'},
  }

  const activeRuns = runs.filter(r => {
    if (r.status === 'running') return true
    if (!r.started_at) return false
    return (Date.now() - new Date(r.started_at).getTime()) < 300000 // 5 min
  })
  const completedRuns = runs.filter(r => r.status !== 'running' && (r.started_at ? (Date.now() - new Date(r.started_at).getTime()) >= 300000 : true)).slice(0, 10)
  const failedRuns = runs.filter(r => r.status === 'error')

  const fmtRuntime = (startedAt: string) => {
    const mins = Math.round((Date.now() - new Date(startedAt).getTime()) / 60000)
    return mins < 1 ? '<1m' : mins < 60 ? `${mins}m` : `${Math.floor(mins/60)}h ${mins%60}m`
  }

  return (
    <div className={`absolute top-3 right-3 z-10 rounded-xl border border-white/10/60 shadow-2xl transition-all ${collapsed ? 'w-10' : 'w-72'}`}
      style={{background:'rgba(10,10,10,0.92)', backdropFilter:'blur(12px)'}}>
      {collapsed ? (
        <button onClick={() => setCollapsed(false)} className="w-full h-10 flex items-center justify-center text-white/40 hover:text-white">
          <span className="text-xs">◀</span>
        </button>
      ) : (
        <div className="p-3 space-y-3 max-h-[60vh] overflow-y-auto">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-semibold uppercase tracking-widest text-white/50">Subagent Activity</span>
            <button onClick={() => setCollapsed(true)} className="text-white/30 hover:text-white/70 text-xs">▶</button>
          </div>

          {/* Active */}
          {activeRuns.length > 0 && (
            <div>
              <div className="text-[9px] text-emerald-400/70 uppercase tracking-widest mb-1.5 font-semibold">Active ({activeRuns.length})</div>
              {activeRuns.map((r, i) => {
                const ag = AGENT_NAMES[r.agent_id] || { name: r.agent_id, emoji: '🤖' }
                return (
                  <div key={i} className="flex items-center gap-2 py-1.5 border-b border-white/10 last:border-0">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 anim-pg shrink-0" />
                    <span className="text-xs">{ag.emoji}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-white text-[11px] font-medium truncate">{ag.name}</p>
                      <p className="text-white/50 text-[9px] truncate">{r.task_title || 'Working...'}</p>
                    </div>
                    {r.started_at && <span className="text-[9px] text-emerald-400/60 font-mono shrink-0">{fmtRuntime(r.started_at)}</span>}
                  </div>
                )
              })}
            </div>
          )}
          {activeRuns.length === 0 && (
            <div className="text-white/30 text-[10px] text-center py-2">No active subagents</div>
          )}

          {/* Failed */}
          {failedRuns.length > 0 && (
            <div>
              <div className="text-[9px] text-red-400/70 uppercase tracking-widest mb-1.5 font-semibold">Failed</div>
              {failedRuns.slice(0, 3).map((r, i) => {
                const ag = AGENT_NAMES[r.agent_id] || { name: r.agent_id, emoji: '🤖' }
                return (
                  <div key={i} className="flex items-center gap-2 py-1 border-b border-white/10 last:border-0 bg-red-500/5">
                    <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                    <span className="text-xs">{ag.emoji}</span>
                    <p className="text-red-300/80 text-[10px] truncate flex-1">{r.task_title || 'Unknown'}</p>
                  </div>
                )
              })}
            </div>
          )}

          {/* Recent completed */}
          {completedRuns.length > 0 && (
            <div>
              <div className="text-[9px] text-white/50 uppercase tracking-widest mb-1.5 font-semibold">Recent ({completedRuns.length})</div>
              {completedRuns.map((r, i) => {
                const ag = AGENT_NAMES[r.agent_id] || { name: r.agent_id, emoji: '🤖' }
                return (
                  <div key={i} className="flex items-center gap-2 py-1 border-b border-white/10/20 last:border-0">
                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.status==='error'?'bg-red-500':'bg-white/10'}`} />
                    <span className="text-[10px]">{ag.emoji}</span>
                    <p className="text-white/40 text-[10px] truncate flex-1">{r.task_title || 'Task'}</p>
                    {r.started_at && <span className="text-[9px] text-white/20 font-mono shrink-0">{fmtRuntime(r.started_at)}</span>}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function OfficeTab({
  agentRunsData,
}: {
  agentRunsData: Record<string, {taskTitle:string; startedAt:string|null; status:string}>
}) {
  return (
            <div className="h-[calc(100vh-88px)] -mx-6 -my-5 relative">
              <AgentOffice />
              {/* MC-172: Live subagent activity overlay */}
              <OfficeActivityPanel agentRunsData={agentRunsData} />
            </div>
  )
}

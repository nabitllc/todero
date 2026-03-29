'use client'
import React, { useState } from 'react'
import { AGENT_DISPLAY } from '@/lib/mc-constants'

const EmptyStateLocal = ({icon, message}: {icon: string; message: string}) => (
  <div className="text-center py-12 text-zinc-600">
    <div className="text-3xl mb-2">{icon}</div>
    <p className="text-sm">{message}</p>
  </div>
)

function AttentionAndShipped({ agents }: { agents: any[] }) {
  const [data, setData] = React.useState<{attention:any[];shipped:any[]}>({attention:[],shipped:[]})
  React.useEffect(() => {
    const SUPA_URL = 'https://twthgapiouiqhavrcnry.supabase.co'
    const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
    const h = { apikey: KEY, Authorization: `Bearer ${KEY}` }
    fetch(`${SUPA_URL}/rest/v1/issues?status=in.(in_review,open)&priority=in.(critical,high)&limit=10&select=task_key,title,status,priority,assignee,updated_at`, {headers: h as any})
      .then(r => r.json()).then(d => {
        if (Array.isArray(d)) setData(prev => ({...prev, attention: d}))
      }).catch(() => {})
    fetch(`${SUPA_URL}/rest/v1/issues?status=eq.done&limit=10&order=updated_at.desc&select=task_key,title,assignee,updated_at,resolution_type`, {headers: h as any})
      .then(r => r.json()).then(d => {
        const today = new Date(); today.setHours(0,0,0,0)
        if (Array.isArray(d)) setData(prev => ({...prev, shipped: d.filter((i: any) => new Date(i.updated_at) >= today)}))
      }).catch(() => {})
  }, [])
  if (!data.attention.length && !data.shipped.length) return null
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {data.attention.length > 0 && (
        <div className="rounded-2xl border border-zinc-800/60 overflow-hidden" style={{background:'#0f0f0f'}}>
          <div className="px-4 py-2 border-b border-zinc-800/40"><span className="text-xs font-semibold text-zinc-400">⚠️ Needs Attention</span></div>
          <div className="divide-y divide-zinc-800/30">
            {data.attention.map((i: any) => (
              <div key={i.task_key} className="px-4 py-2.5 flex items-center gap-2">
                <span className="text-[10px] font-mono text-zinc-600">{i.task_key}</span>
                <span className="text-xs text-white/70 truncate flex-1">{i.title}</span>
                <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${i.priority === 'critical' ? 'bg-red-500/20 text-red-400' : 'bg-orange-500/20 text-orange-400'}`}>{i.priority}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      {data.shipped.length > 0 && (
        <div className="rounded-2xl border border-zinc-800/60 overflow-hidden" style={{background:'#0f0f0f'}}>
          <div className="px-4 py-2 border-b border-zinc-800/40"><span className="text-xs font-semibold text-zinc-400">✅ Shipped Today</span></div>
          <div className="divide-y divide-zinc-800/30">
            {data.shipped.map((i: any) => (
              <div key={i.task_key} className="px-4 py-2.5 flex items-center gap-2">
                <span className="text-[10px] font-mono text-zinc-600">{i.task_key}</span>
                <span className="text-xs text-white/70 truncate flex-1">{i.title}</span>
                <span className="text-[9px] text-emerald-400">{AGENT_DISPLAY[i.assignee]?.emoji ?? ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

interface ActivityTabProps {
  liveStatus: any
  statusAt: number
  setLiveStatus: (d: any) => void
  setStatusAt: (t: number) => void
  issueActivity: any[]
  displayAgents: any[]
}

export default function ActivityTab({
  liveStatus, statusAt, setLiveStatus, setStatusAt, issueActivity, displayAgents
}: ActivityTabProps) {
  const [activityFilter, setActivityFilter] = useState<'all'|'issue'|'agent'|'pr'>('all')
  const [activityLimit, setActivityLimit] = useState(100)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">📡 Activity Feed</h2>
          {liveStatus?.recentActivity?.length > 0 && (
            <p className="text-xs text-zinc-500 mt-0.5">{(liveStatus.recentActivity?.length ?? 0) + issueActivity.length} entries</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {statusAt > 0 && (()=>{
            const syncAgo = Math.round((Date.now() - statusAt) / 60000)
            const isFresh = syncAgo < 2
            return (
              <span className={`text-[10px] font-mono ${isFresh ? 'text-emerald-400' : 'text-zinc-600'}`}>
                {isFresh ? '● Live' : `Synced ${syncAgo}m ago`}
              </span>
            )
          })()}
          <button
            onClick={() => {
              fetch('/api/status').then(r => r.json()).then(d => { setLiveStatus(d); setStatusAt(Date.now()) }).catch(() => {})
            }}
            className="text-[10px] px-2.5 py-1 rounded-lg border border-zinc-700 text-zinc-400 hover:text-white hover:border-zinc-500 bg-zinc-900/50 transition-all">
            Sync
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center gap-2">
        {(['all','agent','issue','pr'] as const).map(f => (
          <button key={f} onClick={() => setActivityFilter(f)}
            className={`text-[10px] font-semibold uppercase tracking-wider px-3 py-1.5 rounded-lg border transition-all ${activityFilter === f ? 'border-blue-600 bg-blue-900/30 text-blue-400' : 'border-zinc-800 bg-zinc-900/50 text-zinc-500 hover:text-zinc-300 hover:border-zinc-600'}`}>
            {f === 'all' ? '📡 All' : f === 'agent' ? '🤖 Agent Runs' : f === 'issue' ? '📋 Issue Changes' : '🔀 PR Events'}
          </button>
        ))}
      </div>

      {(()=>{
        const agentItems = (liveStatus?.recentActivity ?? []).map((e: any) => ({...e, type: e.type || 'agent'}))
        const issueItems = issueActivity
        let allItems: any[] = []
        if (activityFilter === 'all') allItems = [...agentItems, ...issueItems].sort((a,b) => (a.ago ?? 999) - (b.ago ?? 999))
        else if (activityFilter === 'agent') allItems = agentItems
        else if (activityFilter === 'issue') allItems = issueItems
        else allItems = agentItems.filter((e: any) => e.channel?.includes('PR') || e.desc?.toLowerCase().includes('pr ') || e.desc?.toLowerCase().includes('pull'))
        if(allItems.length === 0) return <EmptyStateLocal icon="📡" message={activityFilter === 'all' ? 'No activity runs recorded yet' : `No ${activityFilter} activity found`} />
        const items = allItems.slice(0, activityLimit)
        const grouped: Record<string, any[]> = {}
        for(const entry of items){
          const dateKey = entry.date || (entry.ago < 60 ? 'Today' : entry.ago < 1440 ? 'Yesterday' : 'Earlier')
          if(!grouped[dateKey]) grouped[dateKey] = []
          grouped[dateKey].push(entry)
        }
        return Object.entries(grouped).map(([date, entries])=>(
          <div key={date}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-zinc-600 text-[10px] font-semibold uppercase tracking-widest">{date}</span>
              <div className="flex-1 h-px bg-zinc-800/50" />
              <span className="text-zinc-700 text-[10px]">{entries.length}</span>
            </div>
            <div className="rounded-2xl border border-zinc-800/60 overflow-hidden" style={{background:'#0f0f0f'}}>
              {entries.map((entry:any, i:number, arr:any[])=>{
                const agoStr = entry.ago < 1 ? 'just now' : entry.ago < 60 ? `${entry.ago}m ago` : `${Math.floor(entry.ago/60)}h ago`
                const actionColor = entry.action==='cron'?'#f59e0b':entry.action==='delegate'?'#a855f7':entry.action==='issue'?'#22c55e':'#3b82f6'
                return (
                  <div key={i} className={'flex items-start gap-3 px-4 py-3 '+(i<arr.length-1?'border-b border-zinc-800/30':'')}>
                    <span className="text-base shrink-0 mt-0.5">{entry.emoji || (AGENT_DISPLAY[entry.agentId]?.emoji ?? '🤖')}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white text-xs font-medium">{entry.agentName || AGENT_DISPLAY[entry.agentId]?.name || entry.agentId}</span>
                        {entry.channel && <span className="text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0"
                          style={{background:actionColor+'20',color:actionColor}}>
                          {entry.channel}
                        </span>}
                        {entry.type === 'issue' && <span className="text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0 bg-green-500/20 text-green-400">issue</span>}
                        {entry.model && <span className="text-[9px] px-1.5 py-0.5 rounded font-mono shrink-0 bg-zinc-800 text-zinc-500">{entry.model}</span>}
                        <span className="ml-auto text-zinc-600 text-[10px] shrink-0">{agoStr}</span>
                      </div>
                      <p className="text-zinc-500 text-[10px] mt-0.5 truncate">{entry.desc}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))
      })()}

      {/* Load more */}
      {((liveStatus?.recentActivity?.length ?? 0) + issueActivity.length) > activityLimit && (
        <button onClick={() => setActivityLimit(prev => prev + 100)}
          className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300 py-2.5 rounded-lg border border-zinc-800/40 hover:border-zinc-600 transition-all"
          style={{background:'#0a0a0a'}}>
          Load 100 more
        </button>
      )}

      {/* Needs Attention + Shipped Today */}
      <AttentionAndShipped agents={displayAgents} />
    </div>
  )
}

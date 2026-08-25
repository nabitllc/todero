'use client'
import React, { useState } from 'react'
import { AGENT_DISPLAY } from '@/lib/mc-constants'
import { Button, EmptyState, Badge, PriorityBadge } from '@/components/ui'
import { Radio } from 'lucide-react'
import { dbRestBase, dbRestHeaders } from '@/lib/db/browser'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import { fetchJson, type ApiError } from '@/hooks/useApiData'

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped agent rows, unchanged from caller
function AttentionAndShipped({ agents }: { agents: any[] }) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped PostgREST rows
  const [data, setData] = React.useState<{attention:any[];shipped:any[]}>({attention:[],shipped:[]})
  const [error, setError] = React.useState<ApiError | null>(null)
  const [reload, setReload] = React.useState(0)
  React.useEffect(() => {
    const h = dbRestHeaders() as Record<string, string>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped PostgREST rows
    fetchJson<any[]>(`${dbRestBase()}/rest/v1/issues?status=in.(code_review,open)&priority=in.(critical,high)&limit=10&select=task_key,title,status,priority,assignee,updated_at`, {headers: h})
      .then(res => {
        if (!res.ok) { setError(res.error); return }
        setError(null)
        if (Array.isArray(res.data)) setData(prev => ({...prev, attention: res.data}))
      })
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped PostgREST rows
    fetchJson<any[]>(`${dbRestBase()}/rest/v1/issues?status=in.(completed,released,closed)&limit=10&order=updated_at.desc&select=task_key,title,assignee,updated_at,resolution_type`, {headers: h})
      .then(res => {
        if (!res.ok) { setError(res.error); return }
        setError(null)
        const today = new Date(); today.setHours(0,0,0,0)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped PostgREST rows
        if (Array.isArray(res.data)) setData(prev => ({...prev, shipped: res.data.filter((i: any) => new Date(i.updated_at) >= today)}))
      })
  }, [reload])
  // A refused query must be visible, not collapse this block to nothing.
  if (error) return <ApiErrorBanner error={error} onRetry={() => setReload(n => n + 1)} />
  if (!data.attention.length && !data.shipped.length) return null
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {data.attention.length > 0 && (
        <div className="rounded-xl border border-white/10 overflow-hidden bg-[#0f0f0f]">
          <div className="px-4 py-2 border-b border-white/10"><span className="text-xs font-semibold text-white/40">⚠️ Needs Attention</span></div>
          <div className="divide-y divide-white/10">
            {data.attention.map((i: any) => (
              <div key={i.task_key} className="px-4 py-2.5 flex items-center gap-2">
                <span className="text-[10px] font-mono text-white/30">{i.task_key}</span>
                <span className="text-xs text-white/70 truncate flex-1">{i.title}</span>
                <PriorityBadge value={i.priority} className="text-[9px]" />
              </div>
            ))}
          </div>
        </div>
      )}
      {data.shipped.length > 0 && (
        <div className="rounded-xl border border-white/10 overflow-hidden bg-[#0f0f0f]">
          <div className="px-4 py-2 border-b border-white/10"><span className="text-xs font-semibold text-white/40">✅ Shipped Today</span></div>
          <div className="divide-y divide-white/10">
            {data.shipped.map((i: any) => (
              <div key={i.task_key} className="px-4 py-2.5 flex items-center gap-2">
                <span className="text-[10px] font-mono text-white/30">{i.task_key}</span>
                <span className="text-xs text-white/70 truncate flex-1">{i.title}</span>
                <span className="text-[9px] text-green-400">{AGENT_DISPLAY[i.assignee]?.emoji ?? ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* eslint-disable @typescript-eslint/no-explicit-any -- feed entries are untyped JSON from several sources */
interface ActivityTabProps {
  liveStatus: any
  statusAt: number
  setLiveStatus: (d: any) => void
  setStatusAt: (t: number) => void
  /** null = the issue-activity query failed or has not finished. */
  issueActivity: any[] | null
  /** Why the issue-activity query failed, if it did. */
  activityError?: ApiError | null
  onRetryActivity?: () => void
  /** Why /api/status failed, if it did. */
  statusError?: ApiError | null
  onRetryStatus?: () => void
  displayAgents: any[]
  projectFilter?: string | null
}

export default function ActivityTab({
  liveStatus, statusAt, setLiveStatus, setStatusAt, issueActivity,
  activityError, onRetryActivity, statusError, onRetryStatus,
  displayAgents, projectFilter
}: ActivityTabProps) {
  const [activityFilter, setActivityFilter] = useState<'all'|'issue'|'agent'|'pr'>('all')
  const [activityLimit, setActivityLimit] = useState(100)
  const [syncError, setSyncError] = useState<ApiError | null>(null)
  // TOD-654: a failed load leaves this null. `?? []` is only ever applied after
  // the error branch below has already returned, never instead of it.
  const issueItemsSafe: any[] = issueActivity ?? []
  const liveStatusError = syncError ?? statusError ?? null

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-medium text-white">📡 Activity Feed</h2>
          {liveStatusError || activityError ? (
            <p className="text-xs text-red-400 mt-0.5">data unavailable</p>
          ) : liveStatus?.recentActivity?.length > 0 ? (
            <p className="text-xs text-white/50 mt-0.5">{(liveStatus.recentActivity?.length ?? 0) + issueItemsSafe.length} entries</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {statusAt > 0 && (()=>{
            const syncAgo = Math.round((Date.now() - statusAt) / 60000)
            const isFresh = syncAgo < 2
            return (
              <span className={`text-[10px] font-mono ${isFresh ? 'text-green-400' : 'text-white/30'}`}>
                {isFresh ? '● Live' : `Synced ${syncAgo}m ago`}
              </span>
            )
          })()}
          <Button variant="secondary" size="sm"
            onClick={() => {
              if (onRetryStatus) { setSyncError(null); onRetryStatus(); return }
              // eslint-disable-next-line @typescript-eslint/no-explicit-any -- wide health payload
              fetchJson<any>('/api/status').then(r => {
                if (!r.ok) { setSyncError(r.error); return }
                setSyncError(null); setLiveStatus(r.data); setStatusAt(Date.now())
              })
            }}>
            Sync
          </Button>
        </div>
      </div>

      {/* TOD-654: refused loads are stated, never rendered as an empty feed. */}
      {liveStatusError && (
        <ApiErrorBanner error={liveStatusError} onRetry={onRetryStatus ? () => { setSyncError(null); onRetryStatus() } : undefined} />
      )}
      {activityError && <ApiErrorBanner error={activityError} onRetry={onRetryActivity} />}

      {/* Filter bar */}
      <div className="flex items-center gap-2">
        {(['all','agent','issue','pr'] as const).map(f => (
          <Button key={f} variant={activityFilter === f ? 'primary' : 'secondary'} size="sm" onClick={() => setActivityFilter(f)}
            className={activityFilter === f ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30' : ''}>
            {f === 'all' ? '📡 All' : f === 'agent' ? '🤖 Agent Runs' : f === 'issue' ? '📋 Issue Changes' : '🔀 PR Events'}
          </Button>
        ))}
      </div>

      {(()=>{
        const agentItems = (liveStatus?.recentActivity ?? []).map((e: any) => ({...e, type: e.type || 'agent'}))
        const issueItems = issueItemsSafe
        let allItems: any[] = []
        if (activityFilter === 'all') allItems = [...agentItems, ...issueItems].sort((a,b) => (a.ago ?? 999) - (b.ago ?? 999))
        else if (activityFilter === 'agent') allItems = agentItems
        else if (activityFilter === 'issue') allItems = issueItems
        else allItems = agentItems.filter((e: any) => e.channel?.includes('PR') || e.desc?.toLowerCase().includes('pr ') || e.desc?.toLowerCase().includes('pull'))
        // Never claim "no activity" while a source of that activity is refused.
        if (liveStatusError || activityError) return null
        if(allItems.length === 0) return <EmptyState icon={Radio} title={activityFilter === 'all' ? 'No activity runs recorded yet' : `No ${activityFilter} activity found`} />
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
              <span className="text-white/30 text-[10px] font-semibold uppercase tracking-widest">{date}</span>
              <div className="flex-1 h-px bg-white/10" />
              <span className="text-white/20 text-[10px]">{entries.length}</span>
            </div>
            <div className="rounded-xl border border-white/10 overflow-hidden bg-[#0f0f0f]">
              {entries.map((entry:any, i:number, arr:any[])=>{
                const agoStr = entry.ago < 1 ? 'just now' : entry.ago < 60 ? `${entry.ago}m ago` : `${Math.floor(entry.ago/60)}h ago`
                const actionColor = entry.action==='cron'?'#f59e0b':entry.action==='delegate'?'#a855f7':entry.action==='issue'?'#22c55e':'#3b82f6'
                return (
                  <div key={i} className={'flex items-start gap-3 px-4 py-3 '+(i<arr.length-1?'border-b border-white/10':'')}>
                    <span className="text-base shrink-0 mt-0.5">{entry.emoji || (AGENT_DISPLAY[entry.agentId]?.emoji ?? '🤖')}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-white text-xs font-medium">{entry.agentName || AGENT_DISPLAY[entry.agentId]?.name || entry.agentId}</span>
                        {entry.channel && <span className="text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0"
                          style={{background:actionColor+'20',color:actionColor}}>
                          {entry.channel}
                        </span>}
                        {entry.type === 'issue' && <span className="text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0 bg-green-500/20 text-green-400">issue</span>}
                        {entry.model && <span className="text-[9px] px-1.5 py-0.5 rounded font-mono shrink-0 bg-white/10 text-white/50">{entry.model}</span>}
                        <span className="ml-auto text-white/30 text-[10px] shrink-0">{agoStr}</span>
                      </div>
                      <p className="text-white/50 text-[10px] mt-0.5 truncate">{entry.desc}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))
      })()}

      {/* Load more */}
      {((liveStatus?.recentActivity?.length ?? 0) + issueItemsSafe.length) > activityLimit && (
        <Button variant="secondary" size="sm" onClick={() => setActivityLimit(prev => prev + 100)} className="w-full justify-center">
          Load 100 more
        </Button>
      )}

      {/* Needs Attention + Shipped Today */}
      <AttentionAndShipped agents={displayAgents} />
    </div>
  )
}

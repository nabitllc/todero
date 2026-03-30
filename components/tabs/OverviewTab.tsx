'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { AGENT_DISPLAY, daysUntil, daysSince, miniPct, KEMUNI_DEADLINE, KEMUNI_START, VESPERA_DEADLINE, VESPERA_START } from '@/lib/mc-constants'
import { Bar, SH } from '@/lib/mc-atoms'

// INF-77: Needs-attention block (high/critical open issues)
function NeedsAttentionBlock() {
  const [items, setItems] = React.useState<any[]>([])
  React.useEffect(() => {
    const SUPA = 'https://twthgapiouiqhavrcnry.supabase.co'
    const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
    fetch(`${SUPA}/rest/v1/issues?assignee=eq.main&status=in.(open,backlog)&priority=in.(critical,high)&select=task_key,title,project,priority,blocked_by,description&order=priority.asc&limit=5`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
    }).then(r => r.json()).then(data => {
      if (Array.isArray(data)) setItems(data)
    }).catch(() => {})
  }, [])
  if (items.length === 0) return null
  return (
    <div className="rounded-2xl border border-white/10 p-4 md:p-5" style={{ background: '#0f0f0f' }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">🚨</span>
        <span className="text-xs font-semibold tracking-widest text-white/50 uppercase">Needs Your Attention</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-900/30 text-red-400 font-medium">{items.length}</span>
      </div>
      <div className="space-y-2">
        {items.slice(0, 3).map((t: any, i: number) => (
          <div key={t.task_key || i} className="flex items-start gap-3 px-3 py-2.5 rounded-xl border border-white/10" style={{ background: '#080808' }}>
            <span className="text-red-400 text-xs mt-0.5">{t.priority === 'critical' ? '🔴' : '🟠'}</span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {t.task_key && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-white/40 shrink-0">{t.task_key}</span>}
                <p className="text-white text-xs font-medium truncate">{t.title}</p>
              </div>
              <p className="text-white/30 text-[10px] mt-0.5 truncate">
                {t.blocked_by ? `Blocked by: ${t.blocked_by}` : t.project || 'Needs decision'}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// INF-76: Done-yesterday wins callout
function DoneYesterdayWins() {
  const [wins, setWins] = React.useState<any[]>([])
  React.useEffect(() => {
    const SUPA = 'https://twthgapiouiqhavrcnry.supabase.co'
    const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
    const now = new Date()
    const yStart = new Date(now); yStart.setDate(now.getDate()-1); yStart.setHours(0,0,0,0)
    const yEnd = new Date(now); yEnd.setHours(0,0,0,0)
    fetch(`${SUPA}/rest/v1/issues?status=eq.done&updated_at=gte.${yStart.toISOString()}&updated_at=lt.${yEnd.toISOString()}&select=task_key,title,project,assignee,resolution_type&limit=10`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
    }).then(r => r.json()).then(data => {
      if (Array.isArray(data) && data.length > 0) setWins(data)
    }).catch(() => {})
  }, [])
  if (wins.length === 0) return null
  const ASSIGNEE_EMOJI: Record<string,string> = { main:'🧠', builder:'🔨', tester:'🧪', scout:'🔍', ops:'⚙️', 'kemuni-sme':'🚀', 'vespera-sme':'🖤' }
  return (
    <div className="bg-[#0f0f0f] border border-white/10 rounded-xl p-4 md:p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-lg">🏆</span>
        <span className="text-xs font-semibold tracking-widest text-emerald-400 uppercase">Yesterday&apos;s Wins</span>
        <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-emerald-900/40 text-emerald-400 font-medium">{wins.length} shipped</span>
      </div>
      <div className="flex flex-wrap gap-2">
        {wins.map((w, i) => (
          <div key={w.task_key || i} className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-emerald-900/30 text-xs"
            style={{background:'#0a1f12'}}>
            {w.assignee && ASSIGNEE_EMOJI[w.assignee] && <span>{ASSIGNEE_EMOJI[w.assignee]}</span>}
            {w.task_key && <span className="font-mono text-emerald-600 text-[9px]">{w.task_key}</span>}
            <span className="text-emerald-300 truncate max-w-[180px]">{w.title}</span>
            {w.project && <span className="text-emerald-700 text-[9px]">{w.project}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

// MC-119: Risk Radar card
function RiskRadarCard({ onNavigate }: { onNavigate: (tab: string) => void }) {
  const [risks, setRisks] = React.useState<{p0Bugs: any[]; blocked: any[]; noChildren: any[]}>({ p0Bugs: [], blocked: [], noChildren: [] })
  React.useEffect(() => {
    const SUPA = 'https://twthgapiouiqhavrcnry.supabase.co'
    const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
    const h = { apikey: KEY, Authorization: `Bearer ${KEY}` }
    const since24h = new Date(Date.now() - 24 * 3600000).toISOString()
    Promise.all([
      fetch(`${SUPA}/rest/v1/issues?type=eq.bug&priority=eq.critical&status=in.(open,in_progress)&created_at=lte.${since24h}&select=task_key,title,project,assignee&limit=20`, { headers: h }).then(r => r.json()),
      fetch(`${SUPA}/rest/v1/issues?status=eq.blocked&assignee=not.is.null&select=task_key,title,project,assignee,blocked_by&limit=20`, { headers: h }).then(r => r.json()),
      fetch(`${SUPA}/rest/v1/issues?type=eq.feature&status=neq.done&status=neq.closed&select=id,task_key,title,project&limit=100`, { headers: h }).then(r => r.json()),
      fetch(`${SUPA}/rest/v1/issues?parent_id=not.is.null&select=parent_id&limit=1000`, { headers: h }).then(r => r.json()),
    ]).then(([p0, blocked, features, children]) => {
      const parentIds = new Set((Array.isArray(children) ? children : []).map((c: any) => c.parent_id))
      const noChildren = (Array.isArray(features) ? features : []).filter((f: any) => !parentIds.has(f.id))
      setRisks({ p0Bugs: Array.isArray(p0) ? p0 : [], blocked: Array.isArray(blocked) ? blocked : [], noChildren })
    }).catch(() => {})
  }, [])
  const signals = [
    { label: 'P0 Bugs (>24h)', count: risks.p0Bugs.length, items: risks.p0Bugs, icon: '\u{1F534}' },
    { label: 'Blocked Issues', count: risks.blocked.length, items: risks.blocked, icon: '\u{1F6AB}' },
    { label: 'Features (0 children)', count: risks.noChildren.length, items: risks.noChildren, icon: '\u26A0\uFE0F' },
  ]
  return (
    <div className="rounded-2xl border border-white/10 p-4 md:p-5" style={{ background: '#0f0f0f' }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">{'\u{1F6E1}\uFE0F'}</span>
        <span className="text-xs font-semibold tracking-widest text-white/50 uppercase">Risk Radar</span>
      </div>
      <div className="space-y-2.5">
        {signals.map(s => {
          const badgeClass = s.count === 0
            ? 'bg-green-500/10 text-green-400 border border-green-500/20'
            : s.count <= 3
              ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
              : 'bg-red-500/10 text-red-400 border border-red-500/20'
          return (
            <div key={s.label} className="rounded-xl border border-white/10 px-3 py-2.5 bg-[#080808]">
              <div className="flex items-center gap-2">
                <span className="text-xs">{s.icon}</span>
                <span className="text-white/40 text-xs flex-1">{s.label}</span>
                <button onClick={() => onNavigate('board')}
                  className={`text-xs font-bold px-2 py-0.5 rounded-full transition-colors hover:opacity-80 ${badgeClass}`}>
                  {s.count}
                </button>
              </div>
              {s.count > 0 && (
                <div className="mt-2 space-y-1">
                  {s.items.slice(0, 3).map((item: any, i: number) => (
                    <div key={item.task_key || i} className="flex items-center gap-2 text-[10px]">
                      {item.task_key && <span className="font-mono text-white/50">{item.task_key}</span>}
                      <span className="text-white/40 truncate">{item.title}</span>
                    </div>
                  ))}
                  {s.count > 3 && <span className="text-[9px] text-white/30">+{s.count - 3} more</span>}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// MC-120: Today's Standup card
function StandupCard() {
  const [data, setData] = React.useState<{shipped: any[]; inFlight: any[]; blockers: any[]}>({ shipped: [], inFlight: [], blockers: [] })
  React.useEffect(() => {
    const SUPA = 'https://twthgapiouiqhavrcnry.supabase.co'
    const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
    const h = { apikey: KEY, Authorization: `Bearer ${KEY}` }
    const since24h = new Date(Date.now() - 24 * 3600000).toISOString()
    Promise.all([
      fetch(`${SUPA}/rest/v1/issues?status=eq.done&updated_at=gte.${since24h}&select=task_key,title&order=updated_at.desc&limit=5`, { headers: h }).then(r => r.json()),
      fetch(`${SUPA}/rest/v1/issues?status=eq.in_progress&select=task_key,title,assignee&order=updated_at.desc&limit=5`, { headers: h }).then(r => r.json()),
      fetch(`${SUPA}/rest/v1/issues?or=(blocked_by.not.is.null,status.eq.blocked)&status=neq.done&status=neq.closed&select=task_key,title,blocked_by,assignee&limit=5`, { headers: h }).then(r => r.json()),
    ]).then(([shipped, inFlight, blockers]) => {
      setData({
        shipped: Array.isArray(shipped) ? shipped : [],
        inFlight: Array.isArray(inFlight) ? inFlight : [],
        blockers: Array.isArray(blockers) ? blockers : [],
      })
    }).catch(() => {})
  }, [])
  const sections = [
    { label: 'Shipped Yesterday', icon: '\u2705', items: data.shipped, emptyMsg: 'Nothing shipped', colorClass: 'text-green-400' },
    { label: 'In Flight Today', icon: '\u{1F527}', items: data.inFlight, emptyMsg: 'Nothing in progress', colorClass: 'text-blue-400' },
    { label: 'Blockers', icon: '\u{1F6AB}', items: data.blockers, emptyMsg: 'No blockers', colorClass: 'text-red-400' },
  ]
  return (
    <div className="rounded-2xl border border-white/10 p-4 md:p-5" style={{ background: '#0f0f0f' }}>
      <div className="flex items-center gap-2 mb-3">
        <span className="text-sm">{'\u{1F4CB}'}</span>
        <span className="text-xs font-semibold tracking-widest text-white/50 uppercase">Today&apos;s Standup</span>
      </div>
      <div className="space-y-3">
        {sections.map(s => (
          <div key={s.label}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs">{s.icon}</span>
              <span className={`text-[10px] font-semibold uppercase tracking-wider ${s.colorClass}`}>{s.label}</span>
              <span className="text-[9px] text-white/30">({s.items.length})</span>
            </div>
            {s.items.length === 0 ? (
              <p className="text-[10px] text-white/20 italic pl-5">{s.emptyMsg}</p>
            ) : (
              <div className="space-y-1 pl-5">
                {s.items.slice(0, 5).map((item: any, i: number) => (
                  <div key={item.task_key || i} className="flex items-center gap-2 text-xs">
                    {item.task_key && <span className="text-[9px] font-mono text-white/50 shrink-0">{item.task_key}</span>}
                    <span className="text-white/40 truncate">{item.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// MC-102: Sprint Progress Card
function SprintProgressCard() {
  const [sprintData, setSprintData] = useState<{total:number;done:number}|null>(null)
  const [priorData, setPriorData] = useState<{total:number;done:number}|null>(null)
  const [sprintLabel, setSprintLabel] = useState('')
  const [sprintDate, setSprintDate] = useState('')
  const [countdown, setCountdown] = useState('')

  useEffect(() => {
    const SUPA_URL = 'https://twthgapiouiqhavrcnry.supabase.co'
    const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
    const headers = { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }

    // Fetch active sprint dynamically
    fetch(`${SUPA_URL}/rest/v1/sprints?status=eq.active&select=sprint_number,start_date,end_date&limit=1`, { headers })
      .then(r => r.json())
      .then(sprints => {
        if (!Array.isArray(sprints) || sprints.length === 0) return
        const active = sprints[0]
        const num = active.sprint_number ?? '?'
        const activeDate = active.start_date
        setSprintLabel(`Sprint ${num}`)
        setSprintDate(activeDate)

        // Fetch issues for active sprint
        fetch(`${SUPA_URL}/rest/v1/issues?sprint=eq.${activeDate}&select=id,status`, { headers })
          .then(r => r.json())
          .then(data => {
            if (Array.isArray(data)) {
              setSprintData({ total: data.length, done: data.filter((i:any) => i.status === 'done').length })
            }
          }).catch(() => {})

        // Fetch prior sprint for velocity comparison
        fetch(`${SUPA_URL}/rest/v1/sprints?status=eq.closed&select=sprint_number,start_date&order=created_at.desc&limit=1`, { headers })
          .then(r => r.json())
          .then(priorSprints => {
            if (!Array.isArray(priorSprints) || priorSprints.length === 0) return
            const priorDate = priorSprints[0].start_date
            fetch(`${SUPA_URL}/rest/v1/issues?sprint=eq.${priorDate}&select=id,status`, { headers })
              .then(r => r.json())
              .then(data => {
                if (Array.isArray(data)) {
                  setPriorData({ total: data.length, done: data.filter((i:any) => i.status === 'done').length })
                }
              }).catch(() => {})
          }).catch(() => {})
      }).catch(() => {})
  }, [])

  useEffect(() => {
    const update = () => {
      const now = new Date()
      // Target: next 7am EDT (UTC-4)
      const target = new Date(now)
      target.setUTCHours(11, 0, 0, 0) // 7am EDT = 11:00 UTC
      if (target <= now) target.setDate(target.getDate() + 1)
      const diff = target.getTime() - now.getTime()
      const h = Math.floor(diff / 3600000)
      const m = Math.floor((diff % 3600000) / 60000)
      const s = Math.floor((diff % 60000) / 1000)
      setCountdown(`${h}h ${m}m ${s}s`)
    }
    update()
    const t = setInterval(update, 1000)
    return () => clearInterval(t)
  }, [])

  if (!sprintData || sprintData.total === 0) return null
  const pct = Math.round((sprintData.done / sprintData.total) * 100)
  const velocityDelta = priorData && priorData.done > 0
    ? sprintData.done - priorData.done
    : null

  return (
    <div className="rounded-2xl border border-white/10 p-4 md:p-5" style={{background:'#0f0f0f'}}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm">🏃</span>
          <span className="text-xs font-semibold tracking-widest text-white/50 uppercase">{sprintLabel || 'Sprint'}{sprintDate ? ` · ${sprintDate}` : ''}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-white/30">Next 7am EDT in</span>
          <span className="text-[11px] font-mono text-white/40">{countdown}</span>
        </div>
      </div>
      <div className="flex items-center gap-3 mb-2">
        <span className="text-white text-sm font-semibold tabular-nums">{sprintData.done}/{sprintData.total}</span>
        <span className="text-white/50 text-xs">done</span>
        {velocityDelta !== null && (
          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{
            background: velocityDelta > 0 ? '#10b98120' : velocityDelta < 0 ? '#ef444420' : '#3f3f4620',
            color: velocityDelta > 0 ? '#10b981' : velocityDelta < 0 ? '#ef4444' : '#71717a'
          }}>
            {velocityDelta > 0 ? '+' : ''}{velocityDelta} vs prior
          </span>
        )}
        <span className="ml-auto text-lg font-bold tabular-nums" style={{color: pct === 100 ? '#10b981' : pct >= 50 ? '#3b82f6' : '#f59e0b'}}>{pct}%</span>
      </div>
      <div className="w-full rounded-full h-2" style={{background:'#1a1a1a'}}>
        <div className="h-2 rounded-full transition-all duration-500" style={{width: pct+'%', background: pct === 100 ? '#10b981' : pct >= 50 ? '#3b82f6' : '#f59e0b'}} />
      </div>
    </div>
  )
}

// MC-111: Project Breakdown Bars (epic/feature/issue)
function ProjectBreakdownBars({ project }: { project: string }) {
  const [data, setData] = useState<{epics:{done:number;total:number};features:{done:number;total:number};issues:{done:number;total:number}}|null>(null)
  useEffect(() => {
    const SUPA = 'https://twthgapiouiqhavrcnry.supabase.co'
    const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
    fetch(`${SUPA}/rest/v1/issues?project=eq.${encodeURIComponent(project)}&status=neq.backlog&select=type,status&limit=500`, {
      headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }
    }).then(r => r.json()).then((rows: any[]) => {
      if (!Array.isArray(rows)) return
      const count = (type: string) => {
        const matching = rows.filter(r => r.type === type)
        return { done: matching.filter(r => r.status === 'done').length, total: matching.length }
      }
      setData({ epics: count('epic'), features: count('feature'), issues: { done: rows.filter(r => !['epic','feature'].includes(r.type) && r.status === 'done').length, total: rows.filter(r => !['epic','feature'].includes(r.type)).length } })
    }).catch(() => {})
  }, [project])
  if (!data) return null
  const rows = [
    { label: 'Epics', ...data.epics, color: '#a855f7' },
    { label: 'Features', ...data.features, color: '#3b82f6' },
    { label: 'Issues', ...data.issues, color: '#10b981' },
  ]
  return (
    <div className="mt-2 pt-2 border-t border-white/10 space-y-1.5">
      {rows.map(r => (
        <div key={r.label} className="flex items-center gap-2">
          <span className="text-[9px] text-white/50 w-12 shrink-0">{r.label}</span>
          <div className="flex-1 h-1 rounded-full" style={{background:'#1a1a1a'}}>
            <div className="h-1 rounded-full transition-all" style={{width: r.total > 0 ? (r.done/r.total*100)+'%' : '0%', background: r.color}} />
          </div>
          <span className="text-[9px] text-white/30 tabular-nums w-8 text-right">{r.done}/{r.total}</span>
        </div>
      ))}
    </div>
  )
}

export default function OverviewTab({
  globalSync,
  syncing,
  liveStatus,
  sprintProjects,
  onNavigate,
}: {
  globalSync: () => Promise<void>
  syncing: boolean
  liveStatus: any
  sprintProjects: any[]
  onNavigate: (tab: string) => void
}) {
  return (
    <>
            <div className="space-y-5">

              {/* MC-112: Sync button */}
              <div className="flex justify-end">
                <button
                  onClick={globalSync}
                  disabled={syncing}
                  className="text-[10px] px-3 py-1.5 rounded-lg border border-white/10 text-white/40 hover:text-white hover:border-white/20 bg-[#0f0f0f]/50 transition-all flex items-center gap-1.5 disabled:opacity-50">
                  {syncing ? (
                    <span className="w-3 h-3 border border-white/30 border-t-transparent rounded-full animate-spin inline-block" />
                  ) : (
                    <span>↻</span>
                  )}
                  {syncing ? 'Syncing...' : 'Sync'}
                </button>
              </div>

              {/* ── Hero Countdown Timers (INF-75) ── */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {([
                  { name: 'Vespera', emoji: '🦇', deadline: VESPERA_DEADLINE, start: VESPERA_START, totalDays: 9, color: '#a855f7', bg: 'linear-gradient(135deg, #0f0a14 0%, #1a0e24 100%)' },
                  { name: 'Kemuni', emoji: '🚀', deadline: KEMUNI_DEADLINE, start: KEMUNI_START, totalDays: 30, color: '#3b82f6', bg: 'linear-gradient(135deg, #0a0f1a 0%, #0e1a2e 100%)' },
                ] as const).map(p => {
                  const left = daysUntil(p.deadline)
                  const elap = daysSince(p.start)
                  const pct = miniPct(elap, p.totalDays)
                  const urgent = left <= 3
                  const numColor = urgent ? '#ef4444' : p.color
                  return (
                    <div key={p.name} className="rounded-2xl border border-white/10 p-5 md:p-6" style={{ background: p.bg }}>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-xl">{p.emoji}</span>
                        <span className="text-white/40 text-xs font-semibold uppercase tracking-widest">{p.name}</span>
                        {urgent && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-red-900/40 text-red-400 font-semibold animate-pulse">URGENT</span>}
                      </div>
                      <div className="flex items-baseline gap-2 mb-1">
                        <span className="text-5xl md:text-6xl font-black tabular-nums leading-none" style={{ color: numColor }}>{left}</span>
                        <span className="text-white/50 text-lg font-medium">days left</span>
                      </div>
                      <p className="text-white/30 text-xs mb-3">
                        {p.deadline.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}
                        {' · Day '}{elap}/{p.totalDays}
                      </p>
                      <div className="w-full rounded-full h-2.5" style={{ background: '#1a1a1a' }}>
                        <div className="h-2.5 rounded-full transition-all" style={{ width: pct + '%', background: numColor }} />
                      </div>
                      <div className="flex justify-between mt-1.5">
                        <span className="text-white/30 text-[10px]">{pct}% elapsed</span>
                        <span className="text-white/30 text-[10px]">{100 - pct}% remaining</span>
                      </div>
                    </div>
                  )
                })}
              </div>

              {/* ── Needs Your Attention (INF-77) ── */}
              <NeedsAttentionBlock />

              {/* MC-119: Risk Radar + MC-120: Standup */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <RiskRadarCard onNavigate={onNavigate} />
                <StandupCard />
              </div>

              {/* INF-76: Done-yesterday wins */}
              <DoneYesterdayWins />

              {/* ── Subscriptions & Balances (INF-66) ── */}
              <div className="rounded-2xl border border-white/10 p-4 md:p-5" style={{background:'#0f0f0f'}}>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm">💳</span>
                  <span className="text-xs font-semibold tracking-widest text-white/50 uppercase">Subscriptions & Balances</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { name: 'Claude Pro', type: 'subscription', note: '$20/mo · Active', color: '#a855f7', icon: '🧠' },
                    { name: 'Vercel Pro', type: 'subscription', note: '$20/mo · Renews Apr 24', color: '#ffffff', icon: '▲' },
                    { name: 'OpenRouter', type: 'balance', note: `$${(liveStatus?.openrouter?.remaining ?? 9.57).toFixed(2)} remaining`, color: liveStatus?.openrouter?.remaining < 2 ? '#ef4444' : '#10b981', icon: '🔀' },
                    { name: 'Brave Search', type: 'subscription', note: 'API · Renews Apr 21', color: '#f59e0b', icon: '🦁' },
                  ].map(s => (
                    <div key={s.name} className="rounded-xl border border-white/10 px-3 py-2.5" style={{background:'#080808'}}>
                      <div className="flex items-center gap-1.5 mb-1">
                        <span className="text-xs">{s.icon}</span>
                        <span className="text-white text-[11px] font-medium">{s.name}</span>
                      </div>
                      <p className="text-[10px]" style={{color: s.color}}>{s.note}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* ── Project Health Card ── */}
              {(()=>{
                const allProjects = sprintProjects.filter(p => p.taskCounts && p.taskCounts.total > 0)
                const sorted = [...allProjects].sort((a,b) => (a.taskProgress ?? 0) - (b.taskProgress ?? 0))
                if (!sorted.length) return null
                return (
                  <div className="rounded-2xl border border-white/10 p-4 md:p-5" style={{background:'#0f0f0f'}}>
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <span className="text-sm">📊</span>
                        <span className="text-xs font-semibold tracking-widest text-white/50 uppercase">Project Health</span>
                      </div>
                      <span className="text-white/20 text-[10px]">sorted by progress ↑</span>
                    </div>
                    <div className="space-y-3.5">
                      {sorted.map(proj => {
                        const tc = proj.taskCounts!
                        const pct = proj.taskProgress ?? 0
                        const isLow = pct < 30
                        const isMid = pct >= 30 && pct < 70
                        const barColor = isLow ? '#ef4444' : isMid ? '#f59e0b' : '#10b981'
                        const statusLabel = isLow ? 'Needs work' : isMid ? 'In progress' : 'Nearly done'
                        const statusColor = isLow ? '#ef4444' : isMid ? '#f59e0b' : '#10b981'
                        return (
                          <div key={proj.id}>
                            <div className="flex items-center justify-between mb-1.5">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-base shrink-0">{proj.emoji}</span>
                                <span className="text-white text-xs font-medium truncate">{proj.name}</span>
                                <span className="text-[9px] px-1.5 py-0.5 rounded-full shrink-0 font-medium"
                                  style={{background: statusColor+'18', color: statusColor}}>
                                  {statusLabel}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 shrink-0 ml-2">
                                <span className="text-white/40 text-xs tabular-nums font-medium">{tc.done}<span className="text-white/20">/{tc.total}</span></span>
                                <span className="text-white/30 text-[10px] tabular-nums w-8 text-right">{pct}%</span>
                              </div>
                            </div>
                            <Bar v={pct} color={barColor} bg='#1a1a1a' />
                            {/* MC-109: Status breakdown subtext */}
                            <div className="flex flex-wrap gap-x-2 gap-y-0.5 mt-1.5 text-[9px]">
                              {tc.open > 0 && <span className="text-white/50">Open: {tc.open}</span>}
                              {tc.inProgress > 0 && <span className="text-blue-400">In Progress: {tc.inProgress}</span>}
                              {(tc.inReview ?? 0) > 0 && <span className="text-amber-400">In Review: {tc.inReview}</span>}
                              {(tc.blocked ?? 0) > 0 && <span className="text-red-400 font-medium">Blocked: {tc.blocked}</span>}
                              {tc.open === 0 && tc.inProgress === 0 && !(tc.inReview ?? 0) && !(tc.blocked ?? 0) && (
                                <span className="text-white/20">All done</span>
                              )}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })()}

              {/* ── Per-Project Progress Reports (INF-65) ── */}
              <div>
                <div className="flex items-center gap-2 mb-3">
                  <span className="text-sm">📋</span>
                  <span className="text-xs font-semibold tracking-widest text-white/50 uppercase">Project Progress</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
                  {(['Vespera','Kemuni','Infrastructure','Mission Control'] as const).map(projName => {
                    const proj = sprintProjects.find((p: any) => p.supabaseProject === projName || p.name?.includes(projName))
                    if (!proj) return null
                    const tc = (proj as any).taskCounts ?? { total: 0, done: 0, inProgress: 0, open: 0 }
                    const pct = tc.total > 0 ? Math.round((tc.done / tc.total) * 100) : 0
                    const dl = new Date((proj as any).deadline)
                    const left = daysUntil(dl)
                    const blockers = (proj as any).blockerCount ?? 0
                    const lastPR = (proj as any).lastPRDate
                    const lastPRLabel = lastPR
                      ? new Date(lastPR).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                      : '—'
                    const pColor = (proj as any).color ?? '#6b7280'
                    return (
                      <div key={projName} className="rounded-2xl border border-white/10 p-4"
                        style={{ background: '#0f0f0f' }}>
                        <div className="flex items-center gap-2 mb-3">
                          <span className="text-lg">{(proj as any).emoji}</span>
                          <span className="text-white text-xs font-semibold truncate">{projName}</span>
                        </div>
                        {/* % done */}
                        <div className="flex items-baseline gap-1 mb-2">
                          <span className="text-2xl font-bold tabular-nums" style={{ color: pColor }}>{pct}%</span>
                          <span className="text-white/30 text-[10px]">done</span>
                          <span className="ml-auto text-white/50 text-[10px] tabular-nums">{tc.done}/{tc.total}</span>
                        </div>
                        <div className="w-full rounded-full h-1.5 mb-3" style={{ background: '#1a1a1a' }}>
                          <div className="h-1.5 rounded-full transition-all" style={{ width: pct + '%', background: pColor }} />
                        </div>
                        {/* Stats grid */}
                        <div className="grid grid-cols-2 gap-2 text-[10px]">
                          <div>
                            <span className="text-white/30 block">Deadline</span>
                            <span className="text-white/70 font-medium">{left}d left</span>
                          </div>
                          <div>
                            <span className="text-white/30 block">Last PR</span>
                            <span className="text-white/70 font-medium">{lastPRLabel}</span>
                          </div>
                          <div>
                            <span className="text-white/30 block">Blockers</span>
                            <span className={blockers > 0 ? 'text-red-400 font-medium' : 'text-white/50'}>{blockers}</span>
                          </div>
                          <div>
                            <span className="text-white/30 block">In Progress</span>
                            <span className="text-blue-400 font-medium">{tc.inProgress}</span>
                          </div>
                        </div>
                        {/* MC-111: Epic/Feature/Issue breakdown */}
                        <ProjectBreakdownBars project={projName} />
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Sprint Progress Card (MC-102) */}
              <SprintProgressCard />

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {sprintProjects.map(proj=>{
                  const dl=new Date(proj.deadline), st=new Date(proj.startDate)
                  const left=daysUntil(dl), elap=daysSince(st), pct=miniPct(elap,proj.totalDays)
                  const dlLabel=dl.toLocaleDateString('en-US',{month:'short',day:'numeric'})
                  const isUrgent = left<=2 && proj.color!=='#ffffff'
                  return (
                    <div key={proj.id} className={`rounded-2xl p-4 md:p-5 border ${proj.borderColor} card-glow`} style={{background:proj.bg}}>
                      <div className="flex justify-between items-start mb-4">
                        <div className="min-w-0 flex-1 mr-2">
                          <p className="text-[10px] font-semibold uppercase tracking-widest mb-1" style={{color:proj.color==='#ffffff'?'#71717a':proj.color+'b3'}}>{proj.name}</p>
                          <p className="text-white text-xs sm:text-sm font-medium truncate">{proj.desc}</p>
                        </div>
                        <span className="text-xl">{proj.emoji}</span>
                      </div>
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-3">
                        <span className="text-3xl md:text-4xl font-bold tabular-nums" style={{color:isUrgent?'#ef4444':proj.color}}>{left}</span>
                        <span className="text-white/50 text-sm"> Days</span>
                        <span className="ml-auto text-white/30 text-xs">Day {elap}/{proj.totalDays}</span>
                      </div>
                      <Bar v={pct} color={proj.color} bg={proj.color==='#ffffff'?'#1e1e1e':'#1a0a2a'} />
                      <div className="flex flex-col sm:flex-row justify-between mt-1.5 gap-0.5">
                        <span className="text-white/30 text-[10px]">{pct}% elapsed</span>
                        <span className="text-white/30 text-[10px]">{dlLabel}</span>
                      </div>
                      {proj.taskCounts && proj.taskCounts.total > 0 && (
                        <div className="mt-3 pt-3 border-t border-white/10">
                          <div className="flex justify-between mb-1.5">
                            <span className="text-white/30 text-[10px]">Issues</span>
                            <span className="text-white/50 text-[10px]">{proj.taskCounts.done}/{proj.taskCounts.total} done</span>
                          </div>
                          <Bar v={proj.taskProgress} color='#10b981' bg='#0a1a12' />
                          <div className="flex gap-3 mt-1">
                            {proj.taskCounts.inProgress > 0 && <span className="text-blue-400 text-[9px]">● {proj.taskCounts.inProgress} active</span>}
                            {proj.taskCounts.open > 0 && <span className="text-white/30 text-[9px]">○ {proj.taskCounts.open} open</span>}
                          </div>
                        </div>
                      )}
                      {proj.activeFeatures && proj.activeFeatures.length > 0 && (
                        <div className="mt-3 pt-3 border-t border-white/10">
                          <span className="text-white/30 text-[10px] font-semibold uppercase tracking-wider">Active Features</span>
                          <div className="mt-1.5 space-y-1.5">
                            {proj.activeFeatures.slice(0, 3).map((af: any) => (
                              <div key={af.id}>
                                <div className="flex items-center justify-between">
                                  <span className="text-white/40 text-[10px] truncate flex-1 min-w-0 mr-2">{af.title}</span>
                                  <span className="text-white/30 text-[9px] shrink-0">{af.done}/{af.total}</span>
                                </div>
                                <div className="w-full rounded-full h-1 mt-0.5" style={{background:'#1a1a1a'}}>
                                  <div className="h-1 rounded-full transition-all" style={{width:af.pct+'%',background:'#3b82f6'}} />
                                </div>
                              </div>
                            ))}
                          </div>
                          {proj.activeFeatures.length > 3 && (
                            <p className="text-white/30 text-[9px] mt-1">+{proj.activeFeatures.length - 3} more</p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Live Activity Feed (mini) */}
              <div>
                <SH icon="📡" sub={liveStatus?.recentActivity?.length ? '● live' : undefined}>Recent Activity</SH>
                <div className="rounded-2xl border border-white/10 overflow-hidden" style={{background:'#0f0f0f'}}>
                  {(liveStatus?.recentActivity ?? []).slice(0,5).map((entry:any, i:number, arr:any[])=>{
                    const agoStr = entry.ago < 1 ? 'just now' : entry.ago < 60 ? `${entry.ago}m ago` : `${Math.floor(entry.ago/60)}h ago`
                    const actionColor = entry.action==='cron'?'#f59e0b':entry.action==='delegate'?'#a855f7':'#3b82f6'
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
                            {entry.model && <span className="text-[9px] px-1.5 py-0.5 rounded font-mono shrink-0 bg-white/10 text-white/50">{entry.model}</span>}
                            <span className="ml-auto text-white/30 text-[10px] shrink-0">{agoStr}</span>
                          </div>
                          <p className="text-white/50 text-[10px] mt-0.5 truncate">{entry.desc}</p>
                        </div>
                      </div>
                    )
                  })}
                  {(!liveStatus?.recentActivity || liveStatus.recentActivity.length === 0) && (
                    <p className="text-white/20 text-xs px-4 py-4">No activity yet — loading...</p>
                  )}
                </div>
                {(liveStatus?.recentActivity?.length ?? 0) > 5 && (
                  <button onClick={()=> onNavigate('activity')}
                    className="mt-2 w-full text-center text-xs text-white/50 hover:text-white/70 py-2 rounded-lg border border-white/10 hover:border-white/20 transition-all"
                    style={{background:'#080808'}}>
                    View All Activity →
                  </button>
                )}
              </div>

            </div>
    </>
  )
}

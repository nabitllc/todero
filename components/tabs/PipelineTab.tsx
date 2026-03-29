'use client'
import React, { useEffect, useState, useMemo } from 'react'
import { getPipelineStage, isBlocked, nextPRWindow, type PipelineStage, STAGE_COLORS } from '@/lib/pipeline'

const SUPA_URL = 'https://twthgapiouiqhavrcnry.supabase.co'
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
const HEADERS = { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' }

const STAGES: PipelineStage[] = ["Backlog", "Definition", "Building", "Testing", "PR Queue", "Merged"]

const STAGE_HEX: Record<PipelineStage, string> = {
  Backlog: '#71717a',
  Definition: '#3b82f6',
  Building: '#f59e0b',
  Testing: '#a855f7',
  "PR Queue": '#22c55e',
  Merged: '#10b981',
}

const AGENTS = [
  { id: 'main', emoji: '🧠' },
  { id: 'builder', emoji: '🔨' },
  { id: 'tester', emoji: '🧪' },
  { id: 'scout', emoji: '🔍' },
]

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

const TYPE_COLORS: Record<string, string> = {
  feature: '#3b82f6', bug: '#ef4444', task: '#71717a', ops: '#f59e0b', epic: '#a855f7', subtask: '#6b7280'
}

type FilterMode = 'both' | 'features' | 'issues'

export default function PipelineTab() {
  const [issues, setIssues] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<FilterMode>('both')
  const [countdown, setCountdown] = useState('')

  useEffect(() => {
    fetchIssues()
  }, [])

  // PR Window countdown ticker
  useEffect(() => {
    function tick() {
      const next = nextPRWindow()
      const diff = next.getTime() - Date.now()
      const h = Math.floor(diff / (1000 * 60 * 60))
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      setCountdown(`${h}h ${m}m`)
    }
    tick()
    const iv = setInterval(tick, 60000)
    return () => clearInterval(iv)
  }, [])

  async function fetchIssues() {
    try {
      // Fetch active issues + done in last 24h
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const [activeRes, doneRes] = await Promise.all([
        fetch(`${SUPA_URL}/rest/v1/issues?status=neq.done&select=*&limit=100`, { headers: HEADERS }),
        fetch(`${SUPA_URL}/rest/v1/issues?status=eq.done&updated_at=gte.${since}&select=*&limit=50`, { headers: HEADERS }),
      ])
      const active = await activeRes.json()
      const done = await doneRes.json()
      const all = [...(Array.isArray(active) ? active : []), ...(Array.isArray(done) ? done : [])]
      setIssues(all)
    } catch (e) {
      console.error('Pipeline fetch error:', e)
    } finally {
      setLoading(false)
    }
  }

  // Derive children map for features
  const childrenMap = useMemo(() => {
    const map: Record<string, any[]> = {}
    for (const issue of issues) {
      if (issue.parent_id) {
        if (!map[issue.parent_id]) map[issue.parent_id] = []
        map[issue.parent_id].push(issue)
      }
    }
    return map
  }, [issues])

  // Classify each issue into a stage
  const stageMap = useMemo(() => {
    const map: Record<PipelineStage, { features: any[]; issues: any[] }> = {
      Backlog: { features: [], issues: [] },
      Definition: { features: [], issues: [] },
      Building: { features: [], issues: [] },
      Testing: { features: [], issues: [] },
      "PR Queue": { features: [], issues: [] },
      Merged: { features: [], issues: [] },
    }
    for (const issue of issues) {
      const children = childrenMap[issue.id]
      const stage = getPipelineStage(issue, children)
      if (issue.type === 'feature') {
        map[stage].features.push({ ...issue, _children: children || [] })
      } else {
        map[stage].issues.push(issue)
      }
    }
    // Sort by priority
    const sortByPriority = (a: any, b: any) => (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3)
    for (const stage of STAGES) {
      map[stage].features.sort(sortByPriority)
      map[stage].issues.sort(sortByPriority)
    }
    return map
  }, [issues, childrenMap])

  // Find which agents are in which stage
  const agentStageMap = useMemo(() => {
    const map: Record<PipelineStage, typeof AGENTS> = {
      Backlog: [], Definition: [], Building: [], Testing: [], "PR Queue": [], Merged: []
    }
    for (const agent of AGENTS) {
      const agentIssue = issues.find(i => i.assignee === agent.id && i.status === 'in_progress')
      if (agentIssue) {
        const children = childrenMap[agentIssue.id]
        const stage = getPipelineStage(agentIssue, children)
        map[stage].push(agent)
      }
    }
    return map
  }, [issues, childrenMap])

  const buildingWIP = stageMap.Building.features.length + stageMap.Building.issues.length

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-zinc-500 text-sm">Loading pipeline...</div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold text-white">Pipeline</span>
          <span className="text-zinc-600 text-xs">{issues.length} items</span>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-zinc-800 p-0.5" style={{ background: '#0a0a0a' }}>
          {(['both', 'features', 'issues'] as FilterMode[]).map(mode => (
            <button
              key={mode}
              onClick={() => setFilter(mode)}
              className={`text-[10px] font-medium px-2.5 py-1 rounded-md transition-colors capitalize ${
                filter === mode ? 'bg-zinc-800 text-white' : 'text-zinc-500 hover:text-zinc-300'
              }`}
            >
              {mode === 'both' ? 'Both' : mode === 'features' ? 'Features' : 'Issues'}
            </button>
          ))}
        </div>
      </div>

      {/* Stage rooms — horizontal scroll */}
      <div className="overflow-x-auto pb-2 -mx-1">
        <div className="flex gap-3 px-1" style={{ minWidth: STAGES.length * 256 }}>
          {STAGES.map(stage => {
            const data = stageMap[stage]
            const depth = data.features.length + data.issues.length
            const agents = agentStageMap[stage]
            const color = STAGE_HEX[stage]

            return (
              <div
                key={stage}
                className="flex-shrink-0 rounded-xl border border-zinc-800/60 flex flex-col"
                style={{ width: 240, background: '#0a0a0a', borderTop: `2px solid ${color}` }}
              >
                {/* Room header */}
                <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800/40">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-white">{stage}</span>
                    <span
                      className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                      style={{ background: `${color}20`, color }}
                    >
                      {depth}
                    </span>
                  </div>
                  {stage === 'Building' && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      buildingWIP >= 3 ? 'bg-red-500/20 text-red-400' : 'bg-zinc-800 text-zinc-400'
                    }`}>
                      {buildingWIP}/3 WIP
                    </span>
                  )}
                  {stage === 'PR Queue' && (
                    <span className="text-[10px] text-zinc-500">
                      {countdown}
                    </span>
                  )}
                </div>

                {/* Content area */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2" style={{ maxHeight: 520 }}>
                  {/* Features row */}
                  {filter !== 'issues' && data.features.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="text-[9px] font-medium text-zinc-600 uppercase tracking-wider px-1">Features</span>
                      {data.features.map((f: any) => (
                        <FeatureCard key={f.id} feature={f} />
                      ))}
                    </div>
                  )}

                  {/* Issues row */}
                  {filter !== 'features' && data.issues.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="text-[9px] font-medium text-zinc-600 uppercase tracking-wider px-1">Issues</span>
                      {data.issues.map((i: any) => (
                        <IssueCard key={i.id} issue={i} features={issues.filter(x => x.type === 'feature')} />
                      ))}
                    </div>
                  )}

                  {depth === 0 && (
                    <div className="flex items-center justify-center h-20 text-zinc-700 text-[10px]">
                      Empty
                    </div>
                  )}
                </div>

                {/* Agent sprites */}
                {agents.length > 0 && (
                  <div className="flex items-center gap-1 px-3 py-1.5 border-t border-zinc-800/40">
                    {agents.map(a => (
                      <span key={a.id} title={a.id} className="text-sm cursor-default">{a.emoji}</span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ── Feature Card ── */
function FeatureCard({ feature }: { feature: any }) {
  const children: any[] = feature._children || []
  const doneCount = children.filter((c: any) => c.status === 'done').length
  const total = children.length
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0
  const blocked = isBlocked(feature)

  return (
    <div
      className={`rounded-lg border p-2 transition-colors hover:border-zinc-700 ${
        blocked ? 'border-red-500/60 ring-1 ring-red-500/30' : 'border-zinc-800/60'
      }`}
      style={{ background: '#0f0f0f', minHeight: 80 }}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-[9px] px-1.5 py-0.5 rounded font-medium" style={{ background: '#3b82f620', color: '#3b82f6' }}>
          {feature.task_key}
        </span>
        {feature.project && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400">
            {feature.project}
          </span>
        )}
      </div>
      <div className="text-[11px] text-zinc-300 leading-tight mb-2 line-clamp-2">
        {feature.title}
      </div>
      {total > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 rounded-full bg-zinc-800 overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${pct}%`, background: pct === 100 ? '#10b981' : '#3b82f6' }}
            />
          </div>
          <span className="text-[9px] text-zinc-500">{doneCount}/{total}</span>
        </div>
      )}
    </div>
  )
}

/* ── Issue Card ── */
function IssueCard({ issue, features }: { issue: any; features: any[] }) {
  const blocked = isBlocked(issue)
  const parent = issue.parent_id ? features.find((f: any) => f.id === issue.parent_id) : null
  const typeColor = TYPE_COLORS[issue.type] || '#71717a'

  return (
    <div
      className={`rounded-lg border p-2 transition-colors hover:border-zinc-700 ${
        blocked ? 'border-red-500/60 ring-1 ring-red-500/30' : 'border-zinc-800/60'
      }`}
      style={{ background: '#0f0f0f', minHeight: 60 }}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] px-1.5 py-0.5 rounded font-medium" style={{ background: `${typeColor}20`, color: typeColor }}>
            {issue.task_key}
          </span>
          <span className="text-[11px] text-zinc-300 truncate max-w-[130px]">{issue.title}</span>
        </div>
        {issue.assignee && (
          <span
            className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
            style={{ background: '#27272a' }}
            title={issue.assignee}
          >
            {issue.assignee.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      {parent && (
        <div className="text-[9px] text-zinc-600 truncate">
          {parent.title}
        </div>
      )}
    </div>
  )
}

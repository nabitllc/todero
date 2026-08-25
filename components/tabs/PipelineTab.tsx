'use client'
import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { getPipelineStage, isBlocked, nextPRWindow, type PipelineStage, STAGE_COLORS } from '@/lib/pipeline'
import { EmptyState, Button } from '@/components/ui'
import { dbUrl, dbRestHeaders } from '@/lib/db/browser'

const HEADERS = { ...dbRestHeaders(), 'Content-Type': 'application/json' }

const STAGES: PipelineStage[] = ["Backlog", "Definition", "Building", "Testing", "UX Review", "PR Queue", "Merged"]

const STAGE_HEX: Record<PipelineStage, string> = {
  Backlog: '#71717a',
  Definition: '#3b82f6',
  Building: '#f59e0b',
  Testing: '#a855f7',
  "UX Review": '#ec4899',
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

// Status options for mobile action sheet
const COLUMN_OPTIONS: { label: string; status: string; color: string }[] = [
  { label: 'Backlog', status: 'backlog', color: '#71717a' },
  { label: 'Open', status: 'open', color: '#3b82f6' },
  { label: 'In Progress', status: 'in_progress', color: '#f59e0b' },
  { label: 'In Review', status: 'code_review', color: '#a855f7' },
  { label: 'SignOff', status: 'completed', color: '#14b8a6' },
  { label: 'Done', status: 'closed', color: '#10b981' },
]

export default function PipelineTab({ projectFilter }: { projectFilter?: string | null }) {
  const [issues, setIssues] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string|null>(null)
  const [filter, setFilter] = useState<FilterMode>('both')
  const [countdown, setCountdown] = useState('')
  // Mobile long-press action sheet
  const [actionSheetIssue, setActionSheetIssue] = useState<any>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleLongPressStart = useCallback((issue: any) => {
    longPressTimer.current = setTimeout(() => {
      setActionSheetIssue(issue)
      // Haptic feedback on supported devices
      if (navigator.vibrate) navigator.vibrate(50)
    }, 500)
  }, [])

  const handleLongPressEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  const moveToColumn = useCallback(async (issueId: string, newStatus: string) => {
    setActionSheetIssue(null)
    // Optimistic update
    setIssues(prev => prev.map(i => i.id === issueId ? { ...i, status: newStatus } : i))
    try {
      await fetch(dbUrl(`issues?id=eq.${issueId}`), {
        method: 'PATCH',
        headers: HEADERS,
        body: JSON.stringify({ status: newStatus }),
      })
    } catch (e) {
      console.error('Move failed:', e)
      fetchIssues() // Refetch on error
    }
  }, [])

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
      // Fetch active issues + recently finished issues under the canonical lifecycle
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
      const [activeRes, finishedRes] = await Promise.all([
        fetch(dbUrl(`issues?status=not.in.(closed,completed,released)&select=*&limit=100`), { headers: HEADERS }),
        fetch(dbUrl(`issues?status=in.(closed,completed,released)&updated_at=gte.${since}&select=*&limit=50`), { headers: HEADERS }),
      ])
      const active = await activeRes.json()
      const finished = await finishedRes.json()
      const all = [...(Array.isArray(active) ? active : []), ...(Array.isArray(finished) ? finished : [])]
      setIssues(all)
      setError(null)
    } catch (e) {
      console.error('Pipeline fetch error:', e)
      setError('Failed to load pipeline data')
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

  // MC-178: Filter by selected business
  const filteredIssues = useMemo(() => {
    if (!projectFilter) return issues
    return issues.filter(i => i.project === projectFilter)
  }, [issues, projectFilter])

  // Classify each issue into a stage
  const stageMap = useMemo(() => {
    const map: Record<PipelineStage, { features: any[]; issues: any[] }> = {
      Backlog: { features: [], issues: [] },
      Definition: { features: [], issues: [] },
      Building: { features: [], issues: [] },
      Testing: { features: [], issues: [] },
      "UX Review": { features: [], issues: [] },
      "PR Queue": { features: [], issues: [] },
      Merged: { features: [], issues: [] },
    }
    for (const issue of filteredIssues) {
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
  }, [filteredIssues, childrenMap])

  // Find which agents are in which stage
  const agentStageMap = useMemo(() => {
    const map: Record<PipelineStage, typeof AGENTS> = {
      Backlog: [], Definition: [], Building: [], Testing: [], "UX Review": [], "PR Queue": [], Merged: []
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

  // TOD-2299/TOD-2301 — aggregate pipeline health metrics strip
  type Metrics = {
    window: '7d' | '30d'
    prs_merged: number
    merge_conflicts: number
    build_failures: number
    review_rejections: number
    avg_cycle_time_hours: number | null
    cycle_sample_size: number
    generated_at: string
  }
  const [metricsWindow, setMetricsWindow] = useState<'7d' | '30d'>('7d')
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  useEffect(() => {
    let cancelled = false
    fetch(`/api/pipeline-metrics?window=${metricsWindow}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d && !d.error) setMetrics(d) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [metricsWindow])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-2 text-white/40 text-sm">
          <span className="animate-spin h-4 w-4 border-2 border-white/20 border-t-white/60 rounded-full" />
          Loading pipeline...
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-3">
        <p className="text-red-400 text-sm">{error}</p>
        <Button variant="secondary" size="sm" onClick={() => { setError(null); setLoading(true); fetchIssues() }}>
          Retry
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg font-semibold text-white">Pipeline</span>
          <span className="text-white/25 text-xs">{issues.length} items</span>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-white/10 p-0.5 bg-[#0f0f0f]">
          {(['both', 'features', 'issues'] as FilterMode[]).map(mode => (
            <Button
              key={mode}
              variant={filter === mode ? 'secondary' : 'ghost'}
              size="sm"
              onClick={() => setFilter(mode)}
              className="text-[10px] capitalize"
            >
              {mode === 'both' ? 'Both' : mode === 'features' ? 'Features' : 'Issues'}
            </Button>
          ))}
        </div>
      </div>

      {/* Aggregate pipeline health (TOD-2299) */}
      <div className="rounded-xl border border-white/10 bg-[#080808] px-3 py-2">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] uppercase tracking-wide text-white/40">
            Pipeline health · last {metricsWindow}
          </span>
          <div className="flex items-center gap-1 rounded-md border border-white/10 p-0.5 bg-[#0f0f0f]">
            {(['7d', '30d'] as const).map(w => (
              <button
                key={w}
                onClick={() => setMetricsWindow(w)}
                className={`px-1.5 py-0.5 text-[10px] rounded ${
                  metricsWindow === w ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
                }`}
              >
                {w}
              </button>
            ))}
          </div>
        </div>
        {metrics ? (
          <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-[11px]">
            {[
              { label: 'PRs merged', value: metrics.prs_merged, color: '#10b981' },
              { label: 'Conflicts', value: metrics.merge_conflicts, color: metrics.merge_conflicts > 0 ? '#f59e0b' : '#52525b' },
              { label: 'Build fails', value: metrics.build_failures, color: metrics.build_failures > 0 ? '#ef4444' : '#52525b' },
              { label: 'Rejections', value: metrics.review_rejections, color: metrics.review_rejections > 0 ? '#a855f7' : '#52525b' },
              {
                label: 'Avg cycle',
                value: metrics.avg_cycle_time_hours != null ? `${metrics.avg_cycle_time_hours}h` : '—',
                color: '#3b82f6',
              },
              { label: 'Sample', value: metrics.cycle_sample_size, color: '#71717a' },
            ].map(m => (
              <div key={m.label} className="flex flex-col">
                <span className="text-white/40 text-[10px]">{m.label}</span>
                <span className="font-semibold" style={{ color: m.color }}>{m.value}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-white/30 text-[11px]">loading…</div>
        )}
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
                className="flex-shrink-0 rounded-xl border border-white/10 flex flex-col"
                style={{ width: 240, background: '#080808', borderTop: `2px solid ${color}` }}
              >
                {/* Room header */}
                <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
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
                      buildingWIP >= 3 ? 'bg-red-500/20 text-red-400' : 'bg-white/5 text-white/40'
                    }`}>
                      {buildingWIP}/3 WIP
                    </span>
                  )}
                  {stage === 'Testing' && issues.some(i => i.assignee === 'tester' && (i.status === 'code_review' || i.status === 'in_progress')) && (
                    <span className="text-sm" title="Tester active">🧪</span>
                  )}
                  {stage === 'PR Queue' && (
                    <span className="text-[10px] text-white/40">
                      {countdown}
                    </span>
                  )}
                </div>

                {/* Content area */}
                <div className="flex-1 overflow-y-auto p-2 space-y-2" style={{ maxHeight: 520 }}>
                  {/* Features row */}
                  {filter !== 'issues' && data.features.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="text-[9px] font-medium text-white/25 uppercase tracking-wider px-1">Features</span>
                      {data.features.map((f: any) => (
                        <FeatureCard key={f.id} feature={f} onLongPressStart={() => handleLongPressStart(f)} onLongPressEnd={handleLongPressEnd} />
                      ))}
                    </div>
                  )}

                  {/* Issues row */}
                  {filter !== 'features' && data.issues.length > 0 && (
                    <div className="space-y-1.5">
                      <span className="text-[9px] font-medium text-white/25 uppercase tracking-wider px-1">Issues</span>
                      {data.issues.map((i: any) => (
                        <IssueCard key={i.id} issue={i} features={issues.filter(x => x.type === 'feature')} onLongPressStart={() => handleLongPressStart(i)} onLongPressEnd={handleLongPressEnd} />
                      ))}
                    </div>
                  )}

                  {depth === 0 && (
                    <div className="flex flex-col items-center justify-center py-6 text-center">
                      <span className="text-2xl mb-2 opacity-20">📋</span>
                      <p className="text-xs text-white/30">Nothing here yet</p>
                    </div>
                  )}
                </div>

                {/* Agent sprites */}
                {agents.length > 0 && (
                  <div className="flex items-center gap-1 px-3 py-1.5 border-t border-white/5">
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
      {/* Mobile long-press action sheet */}
      {actionSheetIssue && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/90 backdrop-blur-sm"
          onClick={() => setActionSheetIssue(null)}
        >
          <div
            className="w-full max-w-md rounded-t-2xl border border-white/10 bg-[#0f0f0f] shadow-2xl overflow-hidden"
            onClick={e => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-white/5">
              <div className="w-10 h-1 rounded-full bg-white/10 mx-auto mb-2" />
              <div className="text-xs text-white/60 font-medium truncate">
                {actionSheetIssue.task_key} — {actionSheetIssue.title}
              </div>
              <div className="text-[10px] text-white/25 mt-0.5">Move to column</div>
            </div>
            <div className="py-1">
              {COLUMN_OPTIONS.map(col => (
                <button
                  key={col.status}
                  onClick={() => moveToColumn(actionSheetIssue.id, col.status)}
                  disabled={actionSheetIssue.status === col.status}
                  className={`w-full text-left px-4 py-3 text-sm transition-all flex items-center gap-3 ${
                    actionSheetIssue.status === col.status
                      ? 'text-white/25 bg-white/3'
                      : 'text-white/60 hover:bg-white/5 active:bg-white/10'
                  }`}
                >
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: col.color }} />
                  {col.label}
                  {actionSheetIssue.status === col.status && (
                    <span className="text-[10px] text-white/25 ml-auto">Current</span>
                  )}
                </button>
              ))}
            </div>
            <div className="border-t border-white/5">
              <Button variant="ghost" size="md" onClick={() => setActionSheetIssue(null)} className="w-full justify-center py-3">
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Feature Card ── */
function FeatureCard({ feature, onLongPressStart, onLongPressEnd }: { feature: any; onLongPressStart?: () => void; onLongPressEnd?: () => void }) {
  const children: any[] = feature._children || []
  const doneCount = children.filter((c: any) => ['completed', 'released', 'closed'].includes(c.status)).length
  const total = children.length
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0
  const blocked = isBlocked(feature)

  return (
    <div
      className={`rounded-lg border p-2 transition-all hover:border-white/20 select-none ${
        blocked ? 'border-red-500/60 ring-1 ring-red-500/30' : 'border-white/10'
      }`}
      style={{ background: '#0f0f0f', minHeight: 80 }}
      onTouchStart={onLongPressStart}
      onTouchEnd={onLongPressEnd}
      onTouchCancel={onLongPressEnd}
      onContextMenu={e => { if (onLongPressStart) e.preventDefault() }}
    >
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-blue-500/20 text-blue-400">
          {feature.task_key}
        </span>
        {feature.project && (
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/5 text-white/40">
            {feature.project}
          </span>
        )}
      </div>
      <div className="text-[11px] text-white/60 leading-tight mb-2 line-clamp-2">
        {feature.title}
      </div>
      {total > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${pct === 100 ? 'bg-green-400' : 'bg-blue-400'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="text-[9px] text-white/40">{doneCount}/{total}</span>
        </div>
      )}
    </div>
  )
}

/* ── Issue Card ── */
function IssueCard({ issue, features, onLongPressStart, onLongPressEnd }: { issue: any; features: any[]; onLongPressStart?: () => void; onLongPressEnd?: () => void }) {
  const blocked = isBlocked(issue)
  const parent = issue.parent_id ? features.find((f: any) => f.id === issue.parent_id) : null
  const typeColor = TYPE_COLORS[issue.type] || '#71717a'
  const testStatus = issue.test_status as string | undefined
  const testTier = issue.test_tier as string | undefined
  const testerStatus = issue.tester_status as string | undefined
  const designerStatus = issue.designer_status as string | undefined

  const TEST_STATUS_CLASSES: Record<string, { className: string; label: string }> = {
    passed: { className: 'bg-green-500/20 text-green-400', label: 'Passed' },
    failed: { className: 'bg-red-500/20 text-red-400', label: 'Failed' },
    none:   { className: 'bg-white/5 text-white/40', label: 'Untested' },
  }
  const ts = TEST_STATUS_CLASSES[testStatus ?? 'none'] ?? TEST_STATUS_CLASSES.none

  return (
    <div
      className={`rounded-lg border p-2 transition-all hover:border-white/20 select-none ${
        blocked ? 'border-red-500/60 ring-1 ring-red-500/30'
        : testStatus === 'failed' ? 'border-red-500/40'
        : testStatus === 'passed' ? 'border-emerald-500/40'
        : 'border-white/10'
      }`}
      style={{ background: '#0f0f0f', minHeight: 60 }}
      onTouchStart={onLongPressStart}
      onTouchEnd={onLongPressEnd}
      onTouchCancel={onLongPressEnd}
      onContextMenu={e => { if (onLongPressStart) e.preventDefault() }}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[9px] px-1.5 py-0.5 rounded font-medium" style={{ background: `${typeColor}20`, color: typeColor }}>
            {issue.task_key}
          </span>
          <span className="text-[11px] text-white/60 truncate max-w-[130px]">{issue.title}</span>
        </div>
        {issue.assignee && (
          <span
            className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white flex-shrink-0"
            style={{ background: '#1a1a1a' }}
            title={issue.assignee}
          >
            {issue.assignee.charAt(0).toUpperCase()}
          </span>
        )}
      </div>
      {/* Test tier + test status badges */}
      <div className="flex items-center gap-1.5 mt-1">
        {testTier && (
          <span className="text-[8px] px-1 py-0.5 rounded font-semibold bg-white/5 text-white/40">
            {testTier}
          </span>
        )}
        {testStatus && testStatus !== 'none' && (
          <span className={`text-[8px] px-1.5 py-0.5 rounded font-semibold ${ts.className}`}>
            {ts.label}
          </span>
        )}
        {issue.status === 'code_review' && testerStatus && (
          <span className={`text-[8px] px-1 py-0.5 rounded font-semibold ${TEST_STATUS_CLASSES[testerStatus]?.className ?? 'bg-white/5 text-white/40'}`}>
            🧪 {TEST_STATUS_CLASSES[testerStatus]?.label ?? testerStatus}
          </span>
        )}
        {issue.status === 'code_review' && designerStatus && (
          <span className={`text-[8px] px-1 py-0.5 rounded font-semibold ${TEST_STATUS_CLASSES[designerStatus]?.className ?? 'bg-white/5 text-white/40'}`}>
            🎨 {TEST_STATUS_CLASSES[designerStatus]?.label ?? designerStatus}
          </span>
        )}
        {issue.assignee === 'tester' && (
          <span className="text-[10px]" title="Tester assigned">🧪</span>
        )}
        {issue.blocked_by && (
          <span className="text-[8px] px-1 py-0.5 rounded font-semibold bg-red-500/20 text-red-400" title={`Blocked by ${issue.blocked_by}`}>
            🔒 {issue.blocked_by}
          </span>
        )}
      </div>
      {parent && (
        <div className="text-[9px] text-white/25 truncate mt-1">
          {parent.title}
        </div>
      )}
    </div>
  )
}

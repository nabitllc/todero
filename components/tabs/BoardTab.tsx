'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'

function Chip({label,color}:{label:string;color?:string}) {
  return (
    <span className="inline-block text-[10px] font-medium px-2 py-0.5 rounded-full border"
      style={color
        ?{color,borderColor:color+'40',background:color+'15'}
        :{color:'rgba(255,255,255,0.5)',borderColor:'rgba(255,255,255,0.1)',background:'rgba(255,255,255,0.05)'}}>
      {label}
    </span>
  )
}

function MultiSelect({ label, options, selected, onToggle, displayFn }: {
  label: string; options: string[]; selected: string[]; onToggle: (v: string) => void; displayFn?: (v: string) => string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])
  const display = displayFn ?? ((v: string) => v)
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)}
        className="bg-transparent border border-white/10 rounded-lg px-2 py-1 text-xs text-white/40 outline-none focus:border-white/20 flex items-center gap-1">
        {selected.length > 0 ? `${label} (${selected.length})` : `All ${label}s`}
        <span className="text-white/30 text-[9px]">▾</span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 min-w-[140px] rounded-lg border border-white/10 bg-[#0f0f0f] py-1 shadow-xl">
          {options.map(opt => (
            <button key={opt} onClick={() => onToggle(opt)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-white/10 transition-colors">
              <span className={`w-3 h-3 rounded border flex items-center justify-center text-[8px] ${selected.includes(opt) ? 'bg-blue-500 border-blue-500 text-white' : 'border-white/20'}`}>
                {selected.includes(opt) ? '✓' : ''}
              </span>
              <span className="text-white/70">{display(opt)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

interface Task {
  id: string; title: string; description?: string; status: string;
  assignee?: string; project?: string; priority?: string; type?: string;
  due_date?: string; created_at?: string; updated_at?: string;
  resolution_type?: string; acceptance_criteria?: string; sprint?: string;
  steps_to_reproduce?: string; expected_behavior?: string;
  actual_behavior?: string; environment?: string;
  pr_url?: string; blocked_by?: string; parent_id?: string;
}

const RESOLUTION_OPTIONS: { value: string; label: string; emoji: string }[] = [
  { value: 'code_change',       label: 'Code Change',       emoji: '✅' },
  { value: 'config_change',     label: 'Config Change',     emoji: '⚙️' },
  { value: 'wont_fix',          label: "Won't Fix",         emoji: '🚫' },
  { value: 'canceled',          label: 'Canceled',          emoji: '❌' },
  { value: 'duplicate',         label: 'Duplicate',         emoji: '🔁' },
  { value: 'cannot_reproduce',  label: "Can't Reproduce",   emoji: '🔬' },
  { value: 'by_design',         label: 'By Design',         emoji: '🎯' },
]

const RESOLUTION_BADGE_COLORS: Record<string, string> = {
  code_change:      '#22c55e',
  config_change:    '#3b82f6',
  by_design:        '#3b82f6',
  canceled:         '#71717a',
  wont_fix:         '#71717a',
  duplicate:        '#eab308',
  cannot_reproduce: '#eab308',
}

const BOARD_COLUMNS = [
  { id:'backlog',     label:'Backlog',      color:'#3f3f46' },
  { id:'open',        label:'Open',         color:'#3b82f6' },
  { id:'in_progress', label:'In Progress',  color:'#eab308' },
  { id:'in_review',   label:'In Review',    color:'#a855f7' },
  { id:'done',        label:'Done',         color:'#22c55e' },
]

const ASSIGNEE_MAP: Record<string,{emoji:string;name:string}> = {
  main:          {emoji:'🧠', name:'KAOS'},
  scout:         {emoji:'🔍', name:'Scout'},
  ops:           {emoji:'⚙️', name:'Ops'},
  'kemuni-sme':  {emoji:'🚀', name:'Kemuni SME'},
  'vespera-sme': {emoji:'🖤', name:'Vespera SME'},
  builder:       {emoji:'🔨', name:'Builder'},
  tester:        {emoji:'🧪', name:'Tester'},
  michael:       {emoji:'👤', name:'Michael'},
}

const PRIORITY_COLORS: Record<string,string> = {
  critical:'#ef4444', high:'#f97316', medium:'#3f3f46', low:'#27272a',
}

const PROJECT_COLORS: Record<string,string> = {
  Kemuni:'#3b82f6', Vespera:'#a855f7', Ops:'#6b7280', OpenClaw:'#10b981',
}

const TYPE_COLORS: Record<string,string> = {
  feature:'#3b82f6', bug:'#ef4444', task:'#71717a', ops:'#f59e0b', epic:'#a855f7', subtask:'#64748b',
}

function KanbanBoard({ featureFilter, featureFilterName, onClearFeatureFilter, projectFilter }: { featureFilter?: string; featureFilterName?: string; onClearFeatureFilter?: () => void; projectFilter?: string | null }) {
  const [tasks, setTasks]         = useState<Task[]>([])
  const [loading, setLoading]     = useState(true)
  const [dragId, setDragId]       = useState<string|null>(null)
  const [editTask, setEditTask]   = useState<Task|null>(null)
  const [newTask, setNewTask]     = useState<Partial<Task>|null>(null)
  const [filterTypes, setFilterTypes]       = useState<string[]>(() => { try { const s = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('board-filters') ?? '{}') : {}; return s.types ?? [] } catch { return [] } })
  const [filterPriorities, setFilterPriorities] = useState<string[]>(() => { try { const s = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('board-filters') ?? '{}') : {}; return s.priorities ?? [] } catch { return [] } })
  const [filterAssignees, setFilterAssignees]   = useState<string[]>(() => { try { const s = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('board-filters') ?? '{}') : {}; return s.assignees ?? [] } catch { return [] } })
  const [filterSprint, setFilterSprint]     = useState('')
  const [quickAddCol, setQuickAddCol]       = useState<string|null>(null)
  const [quickAddTitle, setQuickAddTitle]   = useState('')
  const [confirmDelete, setConfirmDelete]   = useState<string|null>(null)
  const [mobileCol, setMobileCol] = useState('open')
  const [resolutionPending, setResolutionPending] = useState<{taskId:string;source:'drag'|'edit';editFields?:Partial<Task>}|null>(null)
  const [detailTask, setDetailTask] = useState<Task|null>(null)
  const [bugDetailsOpen, setBugDetailsOpen] = useState(false)
  const [showArchive, setShowArchive] = useState(false)
  const [archiveSearch, setArchiveSearch] = useState('')
  const [archiveProject, setArchiveProject] = useState('')
  const [closedConfirm, setClosedConfirm] = useState<string|null>(null)
  const [boardLimit, setBoardLimit] = useState(100)
  const [boardGroupBy, setBoardGroupBy] = useState<'status'|'feature'|'business'>(() => { try { return (localStorage.getItem('board-group-by') as 'status'|'feature'|'business') || 'status' } catch { return 'status' } })
  const groupByFeature = boardGroupBy === 'feature'
  const groupByBusiness = boardGroupBy === 'business'
  const [collapsedBiz, setCollapsedBiz] = useState<Record<string,boolean>>(() => { try { return JSON.parse(localStorage.getItem('board-biz-collapsed') ?? '{}') } catch { return {} } })

  // Persist multiselect filters to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('board-filters', JSON.stringify({ types: filterTypes, priorities: filterPriorities, assignees: filterAssignees }))
    }
  }, [filterTypes, filterPriorities, filterAssignees])

  const toggleFilter = (arr: string[], setArr: (v: string[]) => void, val: string) => {
    setBoardLimit(100)
    setArr(arr.includes(val) ? arr.filter(v => v !== val) : [...arr, val])
  }
  const removeFilter = (arr: string[], setArr: (v: string[]) => void, val: string) => {
    setBoardLimit(100)
    setArr(arr.filter(v => v !== val))
  }
  const clearAllFilters = () => {
    setBoardLimit(100)
    setFilterTypes([]); setFilterPriorities([]); setFilterAssignees([]); setFilterSprint('')
    if (onClearFeatureFilter) onClearFeatureFilter()
  }
  const hasAnyFilter = filterTypes.length > 0 || filterPriorities.length > 0 || filterAssignees.length > 0 || filterSprint !== '' || !!featureFilter

  const fetchTasks = useCallback(async () => {
    try {
      const res = await fetch('/api/issues')
      if (res.ok) { const d = await res.json(); setTasks(d) }
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  const createTask = async (t: Partial<Task>) => {
    const res = await fetch('/api/issues', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(t) })
    if (res.ok) { const d = await res.json(); setTasks(prev => [d, ...prev]); setNewTask(null) }
  }

  const updateTask = async (id: string, fields: Partial<Task>) => {
    const res = await fetch('/api/issues', { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id, ...fields}) })
    if (res.ok) { const d = await res.json(); setTasks(prev => prev.map(t => t.id===id ? d : t)); setEditTask(null) }
  }

  const deleteTask = async (id: string) => {
    const res = await fetch(`/api/issues?id=${id}`, { method:'DELETE' })
    if (res.ok) { setTasks(prev => prev.filter(t => t.id!==id)); setConfirmDelete(null); setEditTask(null) }
  }

  const closeTask = async (id: string) => {
    setTasks(prev => prev.map(t => t.id===id ? {...t, status:'closed'} : t))
    setClosedConfirm(id)
    setTimeout(() => setClosedConfirm(prev => prev===id ? null : prev), 2000)
    await fetch('/api/issues', { method:'PATCH', headers:{'Content-Type':'application/json'}, body:JSON.stringify({id, status:'closed'}) })
  }

  const handleDrop = (status: string) => {
    if (!dragId) return
    if (status === 'done') {
      setResolutionPending({ taskId: dragId, source: 'drag' })
      setDragId(null)
      return
    }
    updateTask(dragId, { status })
    setTasks(prev => prev.map(t => t.id===dragId ? {...t, status} : t))
    setDragId(null)
  }

  const handleResolutionSelect = (resolutionType: string) => {
    if (!resolutionPending) return
    const { taskId, source, editFields } = resolutionPending
    if (source === 'edit' && editFields) {
      updateTask(taskId, { ...editFields, status: 'done', resolution_type: resolutionType })
      setTasks(prev => prev.map(t => t.id===taskId ? { ...t, ...editFields, status: 'done', resolution_type: resolutionType } : t))
    } else {
      updateTask(taskId, { status: 'done', resolution_type: resolutionType })
      setTasks(prev => prev.map(t => t.id===taskId ? { ...t, status: 'done', resolution_type: resolutionType } : t))
    }
    setResolutionPending(null)
    setEditTask(null)
  }

  // ESC key closes detail panel
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setDetailTask(null); setBugDetailsOpen(false) }
    }
    if (detailTask) { window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey) }
  }, [detailTask])

  const sprints = Array.from(new Set(tasks.map(t=>t.sprint).filter(Boolean))).sort().reverse()
  const allFiltered = tasks.filter(t => {
    if (t.status === 'closed') return false
    if (projectFilter && (t as any).project !== projectFilter) return false
    if (filterTypes.length > 0 && !filterTypes.includes(t.type ?? '')) return false
    if (filterPriorities.length > 0 && !filterPriorities.includes(t.priority ?? '')) return false
    if (filterAssignees.length > 0 && !filterAssignees.includes(t.assignee ?? '')) return false
    if (filterSprint && t.sprint !== filterSprint) return false
    if (featureFilter && (t as any).parent_id !== featureFilter) return false
    return true
  })
  const filtered = allFiltered.slice(0, boardLimit)
  const hasMoreBoard = allFiltered.length > boardLimit

  const closedTasks = tasks.filter(t => t.status === 'closed')
  const filteredClosed = closedTasks
    .filter(t => !archiveProject || t.project === archiveProject)
    .filter(t => !archiveSearch || t.title.toLowerCase().includes(archiveSearch.toLowerCase()))
    .sort((a, b) => (b.updated_at ?? '').localeCompare(a.updated_at ?? ''))

  const projects = Array.from(new Set(tasks.map(t=>t.project).filter(Boolean)))
  const assignees = Array.from(new Set(tasks.map(t=>t.assignee).filter(Boolean)))
  const types = Array.from(new Set(tasks.map(t=>t.type).filter(Boolean)))

  const isOverdue = (d?: string) => {
    if (!d) return false
    return new Date(d) < new Date(new Date().toDateString())
  }

  const selectCls = "bg-transparent border border-white/10 rounded-lg px-2 py-1 text-xs text-white/40 outline-none focus:border-white/20"
  const inputCls = "w-full bg-transparent border border-white/10 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-white/20 placeholder-white/30"
  const labelCls = "text-[10px] uppercase tracking-widest text-white/30 mb-1"

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Toolbar — multiselect filters */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 flex-wrap">
          <MultiSelect label="Type" options={types as string[]} selected={filterTypes} onToggle={v => toggleFilter(filterTypes, setFilterTypes, v)} />
          <MultiSelect label="Priority" options={['critical','high','medium','low']} selected={filterPriorities} onToggle={v => toggleFilter(filterPriorities, setFilterPriorities, v)} />
          <MultiSelect label="Assignee" options={assignees as string[]} selected={filterAssignees} onToggle={v => toggleFilter(filterAssignees, setFilterAssignees, v)} displayFn={v => ASSIGNEE_MAP[v]?.name ?? v} />
          <select className={selectCls} value={filterSprint} onChange={e=>{setFilterSprint(e.target.value); setBoardLimit(100)}}>
            <option value="">All Sprints</option>
            {sprints.map(s=><option key={s} value={s!}>{s}</option>)}
          </select>
          {hasAnyFilter && <button onClick={clearAllFilters} className="text-[10px] text-red-400 hover:text-red-300 px-2 py-1 rounded-lg hover:bg-white/10 transition-colors">Clear all</button>}
          <div className="flex gap-0.5 p-0.5 rounded-lg border border-white/10" style={{background:'#080808'}}>
            <button onClick={() => { setBoardGroupBy('status'); localStorage.setItem('board-group-by','status') }}
              className={`text-[10px] font-medium px-2.5 py-1 rounded-md transition-colors ${boardGroupBy==='status'?'bg-white/15 text-white':'text-white/50 hover:text-white/70'}`}>
              Status
            </button>
            <button onClick={() => { setBoardGroupBy('feature'); localStorage.setItem('board-group-by','feature') }}
              className={`text-[10px] font-medium px-2.5 py-1 rounded-md transition-colors ${boardGroupBy==='feature'?'bg-white/15 text-white':'text-white/50 hover:text-white/70'}`}>
              Feature
            </button>
            <button onClick={() => { setBoardGroupBy('business'); localStorage.setItem('board-group-by','business') }}
              className={`text-[10px] font-medium px-2.5 py-1 rounded-md transition-colors ${boardGroupBy==='business'?'bg-white/15 text-white':'text-white/50 hover:text-white/70'}`}>
              Business
            </button>
          </div>
          <button onClick={() => setShowArchive(!showArchive)}
            className={`ml-auto text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${showArchive ? 'bg-white/15 text-white' : 'bg-white/10/60 text-white/50 hover:bg-white/10 hover:text-white/70'}`}>
            📦 Archive{closedTasks.length > 0 && <span className="ml-1 text-white/50">({closedTasks.length})</span>}
          </button>
          {!showArchive && <button onClick={()=>setNewTask({status:'backlog',priority:'medium'})}
            className="text-xs font-medium px-3 py-1.5 rounded-lg bg-white/10 text-white/70 hover:bg-white/15 transition-colors">
            + New Task
          </button>}
        </div>
        {/* Active filter chips */}
        {hasAnyFilter && (
          <div className="flex items-center gap-1.5 flex-wrap">
            {featureFilter && featureFilterName && (
              <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-blue-500/15 text-blue-400 border border-blue-500/30">
                Feature: {featureFilterName}
                <button onClick={onClearFeatureFilter} className="hover:text-white ml-0.5">×</button>
              </span>
            )}
            {filterTypes.map(v => (
              <span key={v} className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/10 text-white/70 border border-white/10">
                {v}
                <button onClick={() => removeFilter(filterTypes, setFilterTypes, v)} className="hover:text-white ml-0.5">×</button>
              </span>
            ))}
            {filterPriorities.map(v => (
              <span key={v} className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/10 text-white/70 border border-white/10">
                {v}
                <button onClick={() => removeFilter(filterPriorities, setFilterPriorities, v)} className="hover:text-white ml-0.5">×</button>
              </span>
            ))}
            {filterAssignees.map(v => (
              <span key={v} className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/10 text-white/70 border border-white/10">
                {ASSIGNEE_MAP[v]?.name ?? v}
                <button onClick={() => removeFilter(filterAssignees, setFilterAssignees, v)} className="hover:text-white ml-0.5">×</button>
              </span>
            ))}
          </div>
        )}
      </div>

      {/* MC-127: Michael's "Needs You" queue */}
      {!showArchive && (() => {
        const michaelTasks = tasks.filter(t => t.assignee === 'michael' && t.status !== 'done' && t.status !== 'closed')
        if (michaelTasks.length === 0) return null
        return (
          <div className="rounded-xl border-2 border-amber-500/30 p-3 mb-2" style={{background:'#1a1508'}}>
            <div className="flex items-center gap-2 mb-2">
              <span className="text-amber-400 text-sm font-semibold">👤 Needs You</span>
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-400 font-medium">{michaelTasks.length}</span>
            </div>
            <div className="space-y-1.5">
              {michaelTasks.map(t => (
                <div key={t.id}
                  onClick={() => { setDetailTask(t); setBugDetailsOpen(false) }}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-500/20 cursor-pointer hover:bg-amber-900/10 transition-colors"
                  style={{background:'#151005'}}>
                  <span className="text-amber-400 text-[10px] font-semibold shrink-0">Needs You</span>
                  <p className="text-white text-xs font-medium truncate flex-1">{t.title}</p>
                  {t.project && <Chip label={t.project} />}
                  {(t as any).task_key && <span className="text-[9px] font-mono text-white/30 shrink-0">{(t as any).task_key}</span>}
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Archive View */}
      {showArchive && (
        <div className="flex-1 flex flex-col gap-3 min-h-0">
          <div className="flex items-center gap-3 flex-wrap">
            <input type="text" placeholder="Search closed tasks..." value={archiveSearch} onChange={e => setArchiveSearch(e.target.value)}
              className="bg-transparent border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white/70 outline-none focus:border-white/20 placeholder-white/30 w-52" />
            <select className={selectCls} value={archiveProject} onChange={e => setArchiveProject(e.target.value)}>
              <option value="">All Projects</option>
              {projects.map(p => <option key={p} value={p!}>{p}</option>)}
            </select>
            <span className="text-[10px] text-white/30 ml-auto">{filteredClosed.length} closed task{filteredClosed.length !== 1 ? 's' : ''}</span>
          </div>
          <div className="flex-1 overflow-y-auto space-y-1 min-h-0">
            {filteredClosed.length === 0 && <p className="text-white/20 text-xs text-center py-8">No closed tasks</p>}
            {filteredClosed.map(t => (
              <div key={t.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl border border-white/10 hover:border-white/10 transition-colors" style={{background:'#0f0f0f'}}>
                <p className="text-sm text-white/70 flex-1 truncate">{t.title}</p>
                {t.project && <Chip label={t.project} color={PROJECT_COLORS[t.project] || undefined} />}
                {t.resolution_type && <Chip label={RESOLUTION_OPTIONS.find(r => r.value === t.resolution_type)?.label ?? t.resolution_type} color={RESOLUTION_BADGE_COLORS[t.resolution_type] ?? '#71717a'} />}
                {t.assignee && ASSIGNEE_MAP[t.assignee] && <span className="text-[10px] text-white/50 whitespace-nowrap">{ASSIGNEE_MAP[t.assignee].emoji} {ASSIGNEE_MAP[t.assignee].name}</span>}
                {t.updated_at && <span className="text-[10px] text-white/30 whitespace-nowrap">{new Date(t.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MC-87: Feature-grouped view */}
      {!showArchive && groupByFeature && (() => {
        // Group tasks by parent_id (feature)
        const features = tasks.filter(t => t.type === 'feature' || t.type === 'epic')
        const featureGroups: { feature: Task | null; label: string; children: Task[] }[] = []
        const parentIds = Array.from(new Set(filtered.map(t => (t as any).parent_id).filter(Boolean)))
        // Add features that have children in filtered set
        for (const pid of parentIds) {
          const feat = features.find(f => f.id === pid)
          featureGroups.push({
            feature: feat || null,
            label: feat?.title || 'Unknown Feature',
            children: filtered.filter(t => (t as any).parent_id === pid)
          })
        }
        // Unassigned: tasks without parent_id
        const unassigned = filtered.filter(t => !(t as any).parent_id)
        if (unassigned.length > 0) featureGroups.push({ feature: null, label: 'Unassigned', children: unassigned })
        // Sort: features with priority, then unassigned last
        featureGroups.sort((a, b) => {
          if (!a.feature && b.feature) return 1
          if (a.feature && !b.feature) return -1
          const pa = a.feature?.priority || 'low'
          const pb = b.feature?.priority || 'low'
          const po = ['critical','high','medium','low']
          return po.indexOf(pa) - po.indexOf(pb)
        })
        const [expandedFeatures, setExpandedFeaturesLocal] = [
          new Set(featureGroups.map(g => g.label)),
          (_: any) => {}
        ]
        return (
          <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
            {featureGroups.map(group => {
              const statusCounts = BOARD_COLUMNS.reduce((acc, col) => {
                acc[col.id] = group.children.filter(t => t.status === col.id).length; return acc
              }, {} as Record<string, number>)
              return (
                <div key={group.label} className="rounded-xl border border-white/10 overflow-hidden" style={{background:'#080808'}}>
                  <div className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-white/5 transition-colors"
                    style={{borderLeft: group.feature ? `3px solid ${PRIORITY_COLORS[group.feature.priority||'medium']||'#3f3f46'}` : '3px solid #27272a'}}>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-semibold text-white/70">{group.label}</span>
                      {group.feature?.project && <span className="ml-2 text-[10px] text-white/50">{group.feature.project}</span>}
                    </div>
                    <div className="flex gap-1.5 shrink-0">
                      {BOARD_COLUMNS.map(col => statusCounts[col.id] > 0 ? (
                        <span key={col.id} className="text-[9px] px-1.5 py-0.5 rounded-full font-mono"
                          style={{color: col.color, background: col.color + '18', border: `1px solid ${col.color}30`}}>
                          {statusCounts[col.id]}
                        </span>
                      ) : null)}
                    </div>
                    <span className="text-[10px] text-white/30">{group.children.length}</span>
                  </div>
                  <div className="border-t border-white/10">
                    {group.children.map(task => {
                      const col = BOARD_COLUMNS.find(c => c.id === task.status)
                      return (
                        <div key={task.id} className="flex items-center gap-3 px-4 py-2 hover:bg-white/10/20 transition-colors cursor-pointer border-b border-white/10 last:border-b-0"
                          onClick={() => { setDetailTask(task); setBugDetailsOpen(false) }}>
                          <span className="w-2 h-2 rounded-full shrink-0" style={{background: col?.color || '#3f3f46'}} />
                          <p className="text-sm text-white/70 flex-1 truncate">{task.title}</p>
                          <span className="text-[9px] px-1.5 py-0.5 rounded-full font-medium shrink-0"
                            style={{color: col?.color || '#71717a', background: (col?.color || '#71717a') + '18', border: `1px solid ${col?.color || '#71717a'}30`}}>
                            {col?.label || task.status}
                          </span>
                          {task.assignee && ASSIGNEE_MAP[task.assignee] && (
                            <span className="text-[10px] text-white/50 shrink-0">{ASSIGNEE_MAP[task.assignee].emoji}</span>
                          )}
                          {(task as any).task_key && <span className="text-[9px] font-mono text-white/30 shrink-0">{(task as any).task_key}</span>}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
            {featureGroups.length === 0 && <p className="text-white/20 text-xs text-center py-8">No tasks match filters</p>}
          </div>
        )
      })()}

      {/* Business-grouped view */}
      {!showArchive && groupByBusiness && (() => {
        const BIZ_PROJECTS: Record<string, {label: string; emoji: string; projects: string[]}> = {
          'Vespera':          { label: 'Vespera',          emoji: '🖤', projects: ['Vespera'] },
          'Kemuni':           { label: 'Kemuni',           emoji: '🚀', projects: ['Kemuni'] },
          'Mission Control':  { label: 'Mission Control',  emoji: '🧠', projects: ['Mission Control'] },
          'Infrastructure':   { label: 'Infrastructure',   emoji: '⚙️', projects: ['Infrastructure', 'KAOS'] },
        }
        const bizOrder = ['Vespera', 'Kemuni', 'Mission Control', 'Infrastructure']
        // Reverse map: project → business
        const projToBiz: Record<string, string> = {}
        for (const [biz, info] of Object.entries(BIZ_PROJECTS)) {
          for (const p of info.projects) projToBiz[p] = biz
        }
        // Group tasks by business → project
        const bizGroups: Record<string, Record<string, typeof filtered>> = {}
        for (const t of filtered) {
          const biz = projToBiz[t.project ?? ''] ?? 'Other'
          const proj = t.project ?? 'Unassigned'
          if (!bizGroups[biz]) bizGroups[biz] = {}
          if (!bizGroups[biz][proj]) bizGroups[biz][proj] = []
          bizGroups[biz][proj].push(t)
        }
        const allKeys = [...bizOrder.filter(k => bizGroups[k]), ...Object.keys(bizGroups).filter(k => !bizOrder.includes(k) && bizGroups[k])]
        return (
          <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
            {allKeys.map(bizKey => {
              const biz = BIZ_PROJECTS[bizKey] || { label: bizKey, emoji: '📁', projects: [] }
              const bizProjectGroups = bizGroups[bizKey] || {}
              const allBizTasks = Object.values(bizProjectGroups).flat()
              const isCollapsed = collapsedBiz[bizKey] ?? true
              const toggleCollapse = () => {
                const next = { ...collapsedBiz, [bizKey]: !isCollapsed }
                setCollapsedBiz(next)
                if (typeof window !== 'undefined') localStorage.setItem('board-biz-collapsed', JSON.stringify(next))
              }
              return (
                <div key={bizKey} className="rounded-xl border border-white/10 overflow-hidden" style={{background:'#080808'}}>
                  {/* Business header */}
                  <div onClick={toggleCollapse} className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/5 transition-colors select-none">
                    <span className="text-base">{biz.emoji}</span>
                    <span className="text-sm font-semibold text-white/70">{biz.label}</span>
                    <span className="text-xs text-white/50 ml-1">({allBizTasks.length} issue{allBizTasks.length !== 1 ? 's' : ''})</span>
                    <div className="flex gap-1.5 ml-2 shrink-0">
                      {BOARD_COLUMNS.map(col => { const cnt = allBizTasks.filter(t => t.status === col.id).length; return cnt > 0 ? (
                        <span key={col.id} className="text-[9px] px-1.5 py-0.5 rounded-full font-mono"
                          style={{color: col.color, background: col.color + '18', border: `1px solid ${col.color}30`}}>
                          {col.label[0]} {cnt}
                        </span>
                      ) : null })}
                    </div>
                    <span className="ml-auto text-white/30 text-xs">{isCollapsed ? '▶' : '▼'}</span>
                  </div>
                  {/* Projects nested under business */}
                  {!isCollapsed && (
                    <div className="border-t border-white/10">
                      {Object.entries(bizProjectGroups).map(([projName, projTasks]) => {
                        const projKey = `${bizKey}::${projName}`
                        const isProjCollapsed = collapsedBiz[projKey] ?? false
                        const toggleProjCollapse = () => {
                          const next = { ...collapsedBiz, [projKey]: !isProjCollapsed }
                          setCollapsedBiz(next)
                          if (typeof window !== 'undefined') localStorage.setItem('board-biz-collapsed', JSON.stringify(next))
                        }
                        return (
                          <div key={projName}>
                            {/* Project sub-header */}
                            <div onClick={toggleProjCollapse} className="flex items-center gap-2 px-6 py-2 cursor-pointer hover:bg-white/10/20 transition-colors select-none border-b border-white/10" style={{background:'#0c0c0c'}}>
                              <span className="text-white/50 text-xs">{isProjCollapsed ? '▸' : '▾'}</span>
                              <span className="text-xs font-medium text-white/40">{projName}</span>
                              <span className="text-[10px] text-white/30">({projTasks.length})</span>
                              <div className="flex gap-1 ml-auto shrink-0">
                                {BOARD_COLUMNS.map(col => { const cnt = projTasks.filter(t => t.status === col.id).length; return cnt > 0 ? (
                                  <span key={col.id} className="text-[8px] px-1 py-0.5 rounded font-mono"
                                    style={{color: col.color, background: col.color + '12'}}>
                                    {cnt}
                                  </span>
                                ) : null })}
                              </div>
                            </div>
                            {/* Issue cards for this project */}
                            {!isProjCollapsed && (
                              <div className="flex gap-3 overflow-x-auto p-3">
                                {BOARD_COLUMNS.map(col => {
                                  const colTasks = projTasks.filter(t => t.status === col.id)
                                  return (
                                    <div key={col.id}
                                      className={`flex-shrink-0 w-full md:w-52 flex flex-col rounded-xl bg-[#0f0f0f]/50 ${col.id !== mobileCol ? 'hidden md:flex' : ''}`}
                                      style={{borderTop:`2px solid ${col.color}`, minHeight: '60px'}}
                                      onDragOver={e => e.preventDefault()}
                                      onDrop={() => handleDrop(col.id)}>
                                      <div className="flex items-center gap-2 px-3 py-1.5">
                                        <span className="w-1.5 h-1.5 rounded-full" style={{background:col.color}} />
                                        <span className="text-[10px] font-semibold text-white/50">{col.label} ({colTasks.length})</span>
                                      </div>
                                      <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2 min-h-[30px]">
                                        {colTasks.length === 0 && <div className="text-[10px] text-white/20 text-center py-2">—</div>}
                                        {colTasks.map(task => (
                                          <div key={task.id}
                                            draggable
                                            onDragStart={() => setDragId(task.id)}
                                            onDragEnd={() => setDragId(null)}
                                            onClick={() => { setDetailTask(task); setBugDetailsOpen(false) }}
                                            className={`rounded-xl border p-2.5 cursor-pointer transition-colors border-l-2 ${
                                              task.priority==='critical'?'border-l-red-500':task.priority==='high'?'border-l-orange-400':task.priority==='medium'?'border-l-blue-400':'border-l-white/20'
                                            } ${dragId===task.id ? 'opacity-50' : ''}`}
                                            style={{background:'#0f0f0f', borderColor: dragId===task.id ? '#555' : '#27272a',
                                              borderLeftColor: task.priority==='critical'?'#ef4444':task.priority==='high'?'#fb923c':task.priority==='medium'?'#60a5fa':'#52525b'}}>
                                            <p className="text-white text-xs font-medium leading-snug mb-1">{task.title}</p>
                                            <div className="flex items-center gap-1.5 flex-wrap mt-1">
                                              {task.type && <span className="inline-block text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{color:TYPE_COLORS[task.type]||'#71717a',background:(TYPE_COLORS[task.type]||'#71717a')+'18'}}>{task.type}</span>}
                                              {task.assignee && ASSIGNEE_MAP[task.assignee] && <span className="text-[9px] text-white/50">{ASSIGNEE_MAP[task.assignee].emoji}</span>}
                                              {(task as any).task_key && <span className="text-[9px] font-mono text-white/20 ml-auto">{(task as any).task_key}</span>}
                                            </div>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
            {allKeys.length === 0 && <p className="text-white/20 text-xs text-center py-8">No tasks match filters</p>}
          </div>
        )
      })()}

      {/* Mobile column tabs */}
      {!showArchive && !groupByFeature && !groupByBusiness && <div className="flex md:hidden gap-1 overflow-x-auto pb-1">
        {BOARD_COLUMNS.map(col=>(
          <button key={col.id} onClick={()=>setMobileCol(col.id)}
            className={'text-xs px-3 py-1.5 rounded-lg shrink-0 transition-colors '+(mobileCol===col.id?'bg-white/10 text-white':'text-white/50 hover:text-white/70')}
            style={mobileCol===col.id?{borderBottom:`2px solid ${col.color}`}:{}}>
            {col.label} <span className="text-white/30 ml-1">{filtered.filter(t=>t.status===col.id).length}</span>
          </button>
        ))}
      </div>}

      {/* Columns */}
      {!showArchive && !groupByFeature && !groupByBusiness && <div className="flex-1 flex gap-3 overflow-x-auto pb-2 min-h-0">
        {BOARD_COLUMNS.map(col => {
          const colTasks = filtered.filter(t => t.status===col.id)
          return (
            <div key={col.id}
              className={`flex-shrink-0 w-full md:w-64 flex flex-col rounded-xl bg-[#0f0f0f]/50 ${col.id !== mobileCol ? 'hidden md:flex' : ''}`}
              style={{borderTop:`2px solid ${col.color}`}}
              onDragOver={e => e.preventDefault()}
              onDrop={() => handleDrop(col.id)}>
              {/* Column header */}
              <div className="flex items-center justify-between px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{background:col.color}} />
                  <span className="text-xs font-semibold text-white/40">{col.label} ({colTasks.length})</span>
                  {col.id === 'done' && filtered.length > 0 && (
                    <span className="text-[10px] text-white/30 font-mono">{Math.round((colTasks.length / filtered.length) * 100)}%</span>
                  )}
                </div>
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2 min-h-[60px]">
                {loading && <div className="text-white/20 text-xs text-center py-4">Loading...</div>}
                {!loading && colTasks.length === 0 && <div className="flex flex-col items-center py-6 text-white/20"><span className="text-2xl mb-1">📋</span><p className="text-[10px]">No tasks</p></div>}
                {colTasks.map(task => (
                  <div key={task.id}
                    draggable
                    onDragStart={() => setDragId(task.id)}
                    onDragEnd={() => setDragId(null)}
                    onClick={() => { setDetailTask(task); setBugDetailsOpen(false) }}
                    className={`group rounded-xl border p-3 cursor-pointer transition-colors border-l-2 ${
                      task.priority==='critical'?'border-l-red-500':task.priority==='high'?'border-l-orange-400':task.priority==='medium'?'border-l-blue-400':'border-l-white/20'
                    } ${dragId===task.id ? 'opacity-50' : ''}`}
                    style={{background:'#0f0f0f', borderColor: dragId===task.id ? '#555' : '#27272a', borderLeftColor: task.priority==='critical'?'#ef4444':task.priority==='high'?'#fb923c':task.priority==='medium'?'#60a5fa':'#52525b'}}
                    onMouseEnter={e=>{e.currentTarget.style.borderRightColor='#3f3f46';e.currentTarget.style.borderTopColor='#3f3f46';e.currentTarget.style.borderBottomColor='#3f3f46'}}
                    onMouseLeave={e=>{const bc=dragId===task.id?'#555':'#27272a';e.currentTarget.style.borderRightColor=bc;e.currentTarget.style.borderTopColor=bc;e.currentTarget.style.borderBottomColor=bc}}>
                    <div className="flex items-start justify-between gap-1">
                      <p className="text-white text-sm font-medium leading-snug mb-1">{task.title}</p>
                      {col.id === 'done' && closedConfirm === task.id && (
                        <span className="text-[10px] text-green-400 whitespace-nowrap animate-pulse">Archived ✓</span>
                      )}
                      {col.id === 'done' && closedConfirm !== task.id && (
                        <button onClick={e => { e.stopPropagation(); closeTask(task.id) }}
                          className="text-[10px] text-white/30 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all whitespace-nowrap px-1 py-0.5 rounded hover:bg-white/10">
                          × Close
                        </button>
                      )}
                    </div>
                    {/* INF-100: blocked_by flag */}
                    {task.blocked_by && (
                      <div className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold mb-1"
                        style={{background:'#2a0808',color:'#f87171',border:'1px solid #4a1010'}}>
                        🚫 Blocked
                      </div>
                    )}
                    <div className="flex items-center justify-between mb-1">
                      {task.project && <p className="text-xs text-white/50">{task.project}</p>}
                      {(task as any).task_key && <span className="text-[9px] font-mono text-white/30 bg-white/10/60 px-1.5 py-0.5 rounded">{(task as any).task_key}</span>}
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {task.project && <Chip label={task.project} color={PROJECT_COLORS[task.project]||undefined} />}
                      {task.type && <span className="inline-block text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{color:TYPE_COLORS[task.type]||'#71717a',background:(TYPE_COLORS[task.type]||'#71717a')+'18',border:`1px solid ${(TYPE_COLORS[task.type]||'#71717a')}30`}}>{task.type}</span>}
                      {task.status === 'done' && task.resolution_type && (
                        <Chip label={RESOLUTION_OPTIONS.find(r=>r.value===task.resolution_type)?.label ?? task.resolution_type}
                          color={RESOLUTION_BADGE_COLORS[task.resolution_type] ?? '#71717a'} />
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      {task.priority && (
                        <span className="w-1.5 h-1.5 rounded-full inline-block"
                          style={{background:PRIORITY_COLORS[task.priority]||'#3f3f46'}} />
                      )}
                      {task.assignee && ASSIGNEE_MAP[task.assignee] && (
                        <span className="text-[10px] text-white/50">
                          {ASSIGNEE_MAP[task.assignee].emoji} {ASSIGNEE_MAP[task.assignee].name}
                        </span>
                      )}
                      {task.due_date && (
                        <span className={`text-[10px] ml-auto ${isOverdue(task.due_date)?'text-red-500':'text-white/30'}`}>
                          {new Date(task.due_date).toLocaleDateString('en-US',{month:'short',day:'numeric'})}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Quick-add inline */}
              {quickAddCol === col.id ? (
                <form className="mx-2 mb-2 flex gap-1" onSubmit={async e=>{
                  e.preventDefault()
                  if(!quickAddTitle.trim()) return
                  await createTask({title:quickAddTitle.trim(),status:col.id,priority:'medium',project:'Infrastructure',assignee:'main',type:'feature',acceptance_criteria:'To be defined'})
                  setQuickAddTitle(''); setQuickAddCol(null)
                }}>
                  <input autoFocus value={quickAddTitle} onChange={e=>setQuickAddTitle(e.target.value)}
                    onKeyDown={e=>{ if(e.key==='Escape'){setQuickAddCol(null);setQuickAddTitle('')} }}
                    placeholder="Task title..." className="flex-1 bg-white/10 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white outline-none focus:border-white/20 placeholder-white/30" />
                  <button type="submit" className="text-[10px] px-2 py-1.5 rounded-lg bg-white/15 text-white hover:bg-white/10">Add</button>
                  <button type="button" onClick={()=>{setQuickAddCol(null);setQuickAddTitle('')}} className="text-[10px] px-1.5 text-white/50 hover:text-white/70">✕</button>
                </form>
              ) : (
                <button onClick={()=>{setQuickAddCol(col.id);setQuickAddTitle('')}}
                  className="mx-2 mb-2 text-[10px] text-white/20 hover:text-white/40 transition-colors py-1 text-left w-[calc(100%-16px)]">
                  + Add task
                </button>
              )}
            </div>
          )
        })}
      </div>}

      {/* Load more */}
      {!showArchive && hasMoreBoard && (
        <button onClick={() => setBoardLimit(prev => prev + 100)}
          className="w-full text-center text-xs text-white/50 hover:text-white/70 py-2.5 rounded-lg border border-white/10 hover:border-white/20 transition-all"
          style={{background:'#080808'}}>
          Load 100 more ({allFiltered.length - boardLimit} remaining)
        </button>
      )}

      {/* New Task Modal */}
      {newTask && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60" onClick={()=>setNewTask(null)}>
          <div className="w-full max-w-md md:rounded-2xl rounded-t-2xl border border-white/10 p-5 md:p-6 space-y-4 max-h-[90vh] overflow-y-auto" style={{background:'#080808'}} onClick={e=>e.stopPropagation()}>
            <h3 className="text-white font-semibold text-sm">New Task</h3>
            <div><p className={labelCls}>Title *</p><input className={inputCls} placeholder="Task title..." autoFocus
              value={newTask.title??''} onChange={e=>setNewTask({...newTask,title:e.target.value})} /></div>
            <div><p className={labelCls}>Description</p><textarea className={inputCls+' h-20 resize-none'} placeholder="Details..."
              value={newTask.description??''} onChange={e=>setNewTask({...newTask,description:e.target.value})} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><p className={labelCls}>Status</p>
                <select className={inputCls} value={newTask.status??'backlog'} onChange={e=>setNewTask({...newTask,status:e.target.value})}>
                  {BOARD_COLUMNS.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                </select></div>
              <div><p className={labelCls}>Priority</p>
                <select className={inputCls} value={newTask.priority??'medium'} onChange={e=>setNewTask({...newTask,priority:e.target.value})}>
                  {['critical','high','medium','low'].map(p=><option key={p} value={p}>{p}</option>)}
                </select></div>
              <div><p className={labelCls}>Project</p>
                <input className={inputCls} placeholder="e.g. Kemuni" value={newTask.project??''} onChange={e=>setNewTask({...newTask,project:e.target.value})} /></div>
              <div><p className={labelCls}>Assignee</p>
                <select className={inputCls} value={newTask.assignee??''} onChange={e=>setNewTask({...newTask,assignee:e.target.value})}>
                  <option value="">Unassigned</option>
                  {Object.entries(ASSIGNEE_MAP).map(([k,v])=><option key={k} value={k}>{v.emoji} {v.name}</option>)}
                </select></div>
              <div><p className={labelCls}>Type</p>
                <input className={inputCls} placeholder="e.g. feature, bug" value={newTask.type??''} onChange={e=>setNewTask({...newTask,type:e.target.value})} /></div>
              <div><p className={labelCls}>Due Date</p>
                <input type="date" className={inputCls} value={newTask.due_date??''} onChange={e=>setNewTask({...newTask,due_date:e.target.value})} /></div>
              {/* INF-101: Sprint field */}
              <div><p className={labelCls}>Sprint</p>
                <select className={inputCls} value={newTask.sprint??''} onChange={e=>setNewTask({...newTask,sprint:e.target.value||undefined})}>
                  <option value="">None</option>
                  {sprints.map(s=><option key={s} value={s!}>{s}</option>)}
                </select></div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={()=>setNewTask(null)} className="text-xs text-white/50 px-3 py-1.5 rounded-lg hover:bg-[#0f0f0f]">Cancel</button>
              <button onClick={()=>{if(newTask.title?.trim()) createTask(newTask)}}
                className="text-xs font-medium px-4 py-1.5 rounded-lg bg-white text-black hover:bg-white/90 disabled:opacity-30 transition-colors"
                disabled={!newTask.title?.trim()}>Create</button>
            </div>
          </div>
        </div>
      )}

      {/* Edit/Detail Modal */}
      {editTask && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60" onClick={()=>setEditTask(null)}>
          <div className="w-full max-w-md md:rounded-2xl rounded-t-2xl border border-white/10 p-5 md:p-6 space-y-4 max-h-[90vh] overflow-y-auto" style={{background:'#080808'}} onClick={e=>e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <h3 className="text-white font-semibold text-sm">Edit Task</h3>
              <button onClick={()=>setConfirmDelete(editTask.id)} className="text-[10px] text-red-500/60 hover:text-red-500 transition-colors">Delete</button>
            </div>
            <div><p className={labelCls}>Title</p><input className={inputCls}
              value={editTask.title} onChange={e=>setEditTask({...editTask,title:e.target.value})} /></div>
            <div><p className={labelCls}>Description</p><textarea className={inputCls+' h-20 resize-none'}
              value={editTask.description??''} onChange={e=>setEditTask({...editTask,description:e.target.value})} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><p className={labelCls}>Status</p>
                <select className={inputCls} value={editTask.status} onChange={e=>setEditTask({...editTask,status:e.target.value})}>
                  {BOARD_COLUMNS.map(c=><option key={c.id} value={c.id}>{c.label}</option>)}
                </select></div>
              <div><p className={labelCls}>Priority</p>
                <select className={inputCls} value={editTask.priority??'medium'} onChange={e=>setEditTask({...editTask,priority:e.target.value})}>
                  {['critical','high','medium','low'].map(p=><option key={p} value={p}>{p}</option>)}
                </select></div>
              <div><p className={labelCls}>Project</p>
                <input className={inputCls} value={editTask.project??''} onChange={e=>setEditTask({...editTask,project:e.target.value})} /></div>
              <div><p className={labelCls}>Assignee</p>
                <select className={inputCls} value={editTask.assignee??''} onChange={e=>setEditTask({...editTask,assignee:e.target.value})}>
                  <option value="">Unassigned</option>
                  {Object.entries(ASSIGNEE_MAP).map(([k,v])=><option key={k} value={k}>{v.emoji} {v.name}</option>)}
                </select></div>
              <div><p className={labelCls}>Type</p>
                <input className={inputCls} value={editTask.type??''} onChange={e=>setEditTask({...editTask,type:e.target.value})} /></div>
              <div><p className={labelCls}>Due Date</p>
                <input type="date" className={inputCls} value={editTask.due_date??''} onChange={e=>setEditTask({...editTask,due_date:e.target.value})} /></div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={()=>setEditTask(null)} className="text-xs text-white/50 px-3 py-1.5 rounded-lg hover:bg-[#0f0f0f]">Cancel</button>
              <button onClick={()=>{
                const fields = {title:editTask.title,description:editTask.description,status:editTask.status,
                  priority:editTask.priority,project:editTask.project,assignee:editTask.assignee,type:editTask.type,due_date:editTask.due_date}
                const origTask = tasks.find(t=>t.id===editTask.id)
                if (editTask.status==='done' && origTask?.status!=='done') {
                  setResolutionPending({taskId:editTask.id,source:'edit',editFields:fields})
                } else {
                  updateTask(editTask.id,fields)
                }
              }}
                className="text-xs font-medium px-4 py-1.5 rounded-lg bg-white text-black hover:bg-white/90 transition-colors">Save</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete confirm */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60" onClick={()=>setConfirmDelete(null)}>
          <div className="rounded-2xl border border-white/10 p-6 text-center space-y-4" style={{background:'#080808'}} onClick={e=>e.stopPropagation()}>
            <p className="text-white text-sm">Delete this task?</p>
            <div className="flex justify-center gap-3">
              <button onClick={()=>setConfirmDelete(null)} className="text-xs text-white/50 px-3 py-1.5 rounded-lg hover:bg-[#0f0f0f]">Cancel</button>
              <button onClick={()=>deleteTask(confirmDelete)} className="text-xs font-medium px-4 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-500 transition-colors">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Resolution Type Picker */}
      {resolutionPending && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60" onClick={()=>setResolutionPending(null)}>
          <div className="w-full max-w-sm mx-4 rounded-2xl border border-white/10 p-5 space-y-4" style={{background:'#18181b'}} onClick={e=>e.stopPropagation()}>
            <h3 className="text-white font-semibold text-sm text-center">How was this resolved?</h3>
            <div className="flex flex-wrap gap-2 justify-center">
              {RESOLUTION_OPTIONS.map(opt => (
                <button key={opt.value} onClick={() => handleResolutionSelect(opt.value)}
                  className="text-xs font-medium px-3 py-1.5 rounded-full border border-white/10 text-white/70 hover:bg-white/10 hover:border-white/20 transition-colors">
                  {opt.emoji} {opt.label}
                </button>
              ))}
            </div>
            <div className="flex justify-center pt-1">
              <button onClick={()=>setResolutionPending(null)} className="text-xs text-white/50 px-3 py-1.5 rounded-lg hover:bg-white/10 transition-colors">Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Task Detail Panel */}
      {detailTask && (() => {
        const t = tasks.find(tk => tk.id === detailTask.id) ?? detailTask
        const hasAcceptance = !!t.acceptance_criteria?.trim()
        const acLines = (t.acceptance_criteria ?? '').split('\n').filter(l => l.trim())
        const isBug = t.type === 'bug'
        const stepsLines = (t.steps_to_reproduce ?? '').split('\n').filter(l => l.trim())
        return (
          <div className="fixed inset-0 z-50 flex justify-end bg-black/50" onClick={() => { setDetailTask(null); setBugDetailsOpen(false) }}>
            <div className="w-full md:w-[480px] h-full border-l border-white/10 overflow-y-auto" style={{background:'#080808'}} onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="sticky top-0 z-10 flex items-center justify-between px-5 py-4 border-b border-white/10" style={{background:'#080808'}}>
                <div className="flex items-center gap-2">
                  <button onClick={() => { setEditTask(t); setDetailTask(null); setBugDetailsOpen(false) }}
                    className="text-[10px] text-white/50 hover:text-white/70 transition-colors px-2 py-1 rounded-lg hover:bg-white/10">Edit</button>
                </div>
                <button onClick={() => { setDetailTask(null); setBugDetailsOpen(false) }}
                  className="text-white/50 hover:text-white transition-colors text-lg leading-none">&times;</button>
              </div>

              <div className="px-5 py-5 space-y-5">
                {/* Blocked banner */}
                {t.blocked_by && (
                  <div className="rounded-xl px-4 py-2.5 border border-red-500/30 bg-red-500/10 text-red-400 text-xs font-medium">
                    🚫 Blocked by: {t.blocked_by}
                  </div>
                )}

                {/* Title */}
                {(t as any).task_key && <span className="text-[10px] font-mono text-white/30 bg-white/10 px-2 py-0.5 rounded-full">{(t as any).task_key}</span>}
                <h2 className="text-white text-lg font-semibold leading-snug">{t.title}</h2>

                {/* Status + Priority badges */}
                <div className="flex flex-wrap items-center gap-2">
                  {t.status && (() => {
                    const col = BOARD_COLUMNS.find(c => c.id === t.status)
                    return col ? <Chip label={col.label} color={col.color} /> : null
                  })()}
                  {t.priority && <Chip label={t.priority} color={PRIORITY_COLORS[t.priority]} />}
                  {t.type && <Chip label={t.type} />}
                </div>

                {/* Assignee + Project */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Assignee</p>
                    <p className="text-sm text-white/70">
                      {t.assignee && ASSIGNEE_MAP[t.assignee] ? `${ASSIGNEE_MAP[t.assignee].emoji} ${ASSIGNEE_MAP[t.assignee].name}` : 'Unassigned'}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Project</p>
                    <p className="text-sm text-white/70">{t.project || '—'}</p>
                  </div>
                </div>

                {/* Description */}
                {t.description && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2">Description</p>
                    <p className="text-sm text-white/40 leading-relaxed whitespace-pre-wrap">{t.description}</p>
                  </div>
                )}

                {/* INF-118: DoR Status Indicator */}
                {(() => {
                  const dorMissing: string[] = []
                  if (!t.acceptance_criteria?.trim()) dorMissing.push('acceptance_criteria')
                  if (!t.description?.trim()) dorMissing.push('description')
                  if (!t.sprint) dorMissing.push('sprint')
                  if (!t.assignee) dorMissing.push('assignee')
                  if (isBug && !t.steps_to_reproduce?.trim()) dorMissing.push('steps_to_reproduce')
                  const dorReady = dorMissing.length === 0
                  return (
                    <div className={`rounded-xl px-3 py-2 border ${dorReady ? 'border-green-500/30 bg-green-500/5' : 'border-yellow-500/30 bg-yellow-500/5'}`}>
                      <span className={`text-xs font-semibold ${dorReady ? 'text-green-400' : 'text-yellow-400'}`}>
                        {dorReady ? '\u2713 DoR Ready' : '\u26A0 DoR Incomplete'}
                      </span>
                      {!dorReady && <p className="text-[10px] text-yellow-400/70 mt-1">Missing: {dorMissing.join(', ')}</p>}
                    </div>
                  )
                })()}

                {/* DoR / Acceptance Criteria */}
                <div>
                  <div className="flex items-center gap-2 mb-2">
                    <p className="text-[10px] uppercase tracking-widest text-white/30">Acceptance Criteria</p>
                    {hasAcceptance
                      ? <span className="w-4 h-4 rounded-full bg-green-500/20 text-green-400 text-[10px] flex items-center justify-center">✓</span>
                      : <span className="w-4 h-4 rounded-full bg-yellow-500/20 text-yellow-400 text-[10px] flex items-center justify-center">!</span>
                    }
                  </div>
                  {hasAcceptance ? (
                    <div className="space-y-1.5">
                      {acLines.map((line, i) => (
                        <label key={i} className="flex items-start gap-2 text-sm text-white/40 cursor-default">
                          <input type="checkbox" className="mt-1 accent-green-500 pointer-events-auto" readOnly />
                          <span>{line.replace(/^[-*•]\s*/, '')}</span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-white/30 italic">No acceptance criteria defined</p>
                  )}
                </div>

                {/* Bug Details */}
                {isBug && (
                  <div className="border border-white/10 rounded-xl overflow-hidden">
                    <button onClick={() => setBugDetailsOpen(!bugDetailsOpen)}
                      className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium text-white/40 hover:bg-[#0f0f0f]/50 transition-colors">
                      <span>🐛 Bug Details</span>
                      <span className="text-white/30">{bugDetailsOpen ? '▾' : '▸'}</span>
                    </button>
                    {bugDetailsOpen && (
                      <div className="px-4 pb-4 space-y-3 border-t border-white/10">
                        {t.steps_to_reproduce && (
                          <div className="pt-3">
                            <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1.5">Steps to Reproduce</p>
                            <ol className="list-decimal list-inside text-sm text-white/40 space-y-1">
                              {stepsLines.map((s, i) => <li key={i}>{s.replace(/^\d+[.)]\s*/, '')}</li>)}
                            </ol>
                          </div>
                        )}
                        {t.expected_behavior && (
                          <div>
                            <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Expected Behavior</p>
                            <p className="text-sm text-white/40">{t.expected_behavior}</p>
                          </div>
                        )}
                        {t.actual_behavior && (
                          <div>
                            <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Actual Behavior</p>
                            <p className="text-sm text-white/40">{t.actual_behavior}</p>
                          </div>
                        )}
                        {t.environment && (
                          <div>
                            <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Environment</p>
                            <p className="text-sm text-white/40">{t.environment}</p>
                          </div>
                        )}
                        {!t.steps_to_reproduce && !t.expected_behavior && !t.actual_behavior && !t.environment && (
                          <p className="text-xs text-white/30 italic pt-3">No bug details provided</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* PR URL */}
                {t.pr_url && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Pull Request</p>
                    <a href={t.pr_url} target="_blank" rel="noopener noreferrer"
                      className="text-sm text-blue-400 hover:text-blue-300 underline break-all">{t.pr_url}</a>
                  </div>
                )}

                {/* Resolution */}
                {t.status === 'done' && t.resolution_type && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Resolution</p>
                    <Chip label={RESOLUTION_OPTIONS.find(r => r.value === t.resolution_type)?.label ?? t.resolution_type!}
                      color={RESOLUTION_BADGE_COLORS[t.resolution_type] ?? '#71717a'} />
                  </div>
                )}

                {/* Timestamps */}
                <div className="pt-4 border-t border-white/10 flex flex-wrap gap-x-6 gap-y-1">
                  {t.created_at && (
                    <p className="text-[10px] text-white/30">Created: {new Date(t.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                  )}
                  {t.updated_at && (
                    <p className="text-[10px] text-white/30">Updated: {new Date(t.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

export default function BoardTab({ featureFilter, featureFilterName, onClearFeatureFilter, projectFilter }: {
  featureFilter?: string
  featureFilterName?: string
  onClearFeatureFilter?: () => void
  projectFilter?: string | null
}) {
  return <KanbanBoard featureFilter={featureFilter} featureFilterName={featureFilterName} onClearFeatureFilter={onClearFeatureFilter} projectFilter={projectFilter} />
}

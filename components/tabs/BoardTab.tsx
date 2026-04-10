'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { Button, Input, Textarea, Select, FormGroup, EmptyState, Badge } from '@/components/ui'
import { Kanban, Search, X, ClipboardList, Bug, Wrench, SearchIcon, Lock } from 'lucide-react'
import { Chip } from '@/lib/mc-atoms'
import type { Task as SharedTask, BoardGroupBy, KanbanColumn } from '@/lib/issues'

function StartSprintBtn() {
  const [running, setRunning] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const handle = async () => {
    if (running) return
    setRunning(true)
    try {
      const res = await fetch('/api/run-sprint', { method: 'POST' })
      setToast(res.ok ? '✅ Sprint started!' : `⚠️ Error ${res.status}`)
    } catch (e: any) { setToast(`⚠️ ${e?.message ?? 'Error'}`) }
    finally { setRunning(false); setTimeout(() => setToast(null), 4000) }
  }
  return (
    <div className="relative">
      <button onClick={handle} disabled={running}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors">
        {running ? <span className="animate-spin h-3 w-3 border-2 border-white/30 border-t-white rounded-full" /> : <span>▶</span>}
        Start Sprint
      </button>
      {toast && (
        <div className="absolute top-full mt-1 left-0 z-50 bg-neutral-900 border border-white/10 text-xs text-white/80 rounded-lg px-3 py-1.5 whitespace-nowrap shadow-xl">
          {toast}
        </div>
      )}
    </div>
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
        {selected.length > 0 ? `${label} (${selected.length})` : label}
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

// Task type imported from @/lib/issues as SharedTask
type Task = SharedTask

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

// 3-column board (TOD-XXX simplification 2026-04-10):
// Queue   = ready to be picked up (defined + open)
// Ongoing = active work (in_progress + both review states)
// Achieved= shipped or ready to ship (approved + completed + released)
// Backlog and closed are NOT columns — they surface as count chips in the header.
const BOARD_COLUMNS = [
  { id:'queue',    label:'Queue',    color:'#3b82f6', statuses:['defined','open'] },
  { id:'ongoing',  label:'Ongoing',  color:'#818cf8', statuses:['in_progress','code_review','product_review'] },
  { id:'achieved', label:'Achieved', color:'#22c55e', statuses:['approved','completed','released'] },
]

// Statuses that get a small count chip but no column
const OFF_BOARD_STATUSES = [
  { id:'backlog', label:'Backlog', color:'#71717a', statuses:['backlog'] },
  { id:'closed',  label:'Closed',  color:'#475569', statuses:['closed'] },
]

const EXCLUDED_BOARD_TYPES = ['epic', 'feature']

const TYPE_ICONS: Record<string, React.ReactNode> = {
  task: <ClipboardList size={10} />,
  bug: <Bug size={10} />,
  ops: <Wrench size={10} />,
  research: <SearchIcon size={10} />,
}

const PRIORITY_DOT_COLORS: Record<string, string> = {
  critical: '#ef4444',
  high: '#f97316',
  medium: '#eab308',
  low: '#71717a',
}

const SEVERITY_CHIP_STYLES: Record<string, string> = {
  S0: 'bg-red-500/20 text-red-400 border-red-500/30',
  S1: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  S2: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  S3: 'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
}

const ASSIGNEE_DOT_COLORS: Record<string, string> = {
  main: '#818cf8',
  scout: '#3b82f6',
  ops: '#f59e0b',
  'kemuni-sme': '#3b82f6',
  'vespera-sme': '#a855f7',
  builder: '#f97316',
  tester: '#22c55e',
  michael: '#6b7280',
  designer: '#ec4899',
  auditor: '#14b8a6',
  growth: '#10b981',
  po: '#6366f1',
  ux: '#ec4899',
}

const STATUS_CHIP_COLORS: Record<string,string> = {
  backlog:         'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  open:            'bg-blue-500/20 text-blue-400 border-blue-500/30',
  in_progress:     'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  code_review:     'bg-orange-500/20 text-orange-400 border-orange-500/30',
  product_review:  'bg-orange-500/20 text-orange-400 border-orange-500/30',
  approved:        'bg-green-500/20 text-green-400 border-green-500/30',
  released:        'bg-teal-500/20 text-teal-400 border-teal-500/30',
  completed:       'bg-green-600/20 text-green-400 border-green-600/30',
  closed:          'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
}

const ALL_STATUSES = [
  { value:'backlog',         label:'Backlog' },
  { value:'open',            label:'Open' },
  { value:'in_progress',     label:'In Progress' },
  { value:'code_review',     label:'Code Review' },
  { value:'product_review',  label:'Product Review' },
  { value:'approved',        label:'Approved' },
  { value:'completed',       label:'Completed' },
  { value:'released',        label:'Released' },
  { value:'closed',          label:'Closed' },
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
  designer:      {emoji:'🎨', name:'Designer'},
  auditor:       {emoji:'🔎', name:'Auditor'},
  growth:        {emoji:'📈', name:'Growth'},
  po:            {emoji:'📋', name:'PO'},
  ux:            {emoji:'🎨', name:'Designer'}, // legacy alias → same display name as designer
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
  const [loadError, setLoadError] = useState<string|null>(null)
  const [dragId, setDragId]       = useState<string|null>(null)
  const [editTask, setEditTask]   = useState<Task|null>(null)
  const [newTask, setNewTask]     = useState<Partial<Task>|null>(null)
  const [filterTypes, setFilterTypes]       = useState<string[]>(() => { try { const s = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('board-filters') ?? '{}') : {}; return s.types ?? [] } catch { return [] } })
  const [filterPriorities, setFilterPriorities] = useState<string[]>(() => { try { const s = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('board-filters') ?? '{}') : {}; return s.priorities ?? [] } catch { return [] } })
  const [filterAssignees, setFilterAssignees]   = useState<string[]>(() => { try { const s = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('board-filters') ?? '{}') : {}; return s.assignees ?? [] } catch { return [] } })
  // Sprint is now multiselect. Default is an empty array = "Active Sprint(s)" which
  // is computed below from tasks that share today's sprint date(s).
  const [filterSprints, setFilterSprints]   = useState<string[]>(() => { try { const s = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('board-filters') ?? '{}') : {}; return s.sprints ?? [] } catch { return [] } })
  const [filterHubs, setFilterHubs]         = useState<string[]>(() => { try { const s = typeof window !== 'undefined' ? JSON.parse(localStorage.getItem('board-filters') ?? '{}') : {}; return s.hubs ?? [] } catch { return [] } })
  const [quickAddCol, setQuickAddCol]       = useState<string|null>(null)
  const [quickAddTitle, setQuickAddTitle]   = useState('')
  const [confirmDelete, setConfirmDelete]   = useState<string|null>(null)
  const [mobileCol, setMobileCol] = useState('open')
  const [resolutionPending, setResolutionPending] = useState<{taskId:string;source:'drag'|'edit';editFields?:Partial<Task>}|null>(null)
  const [detailTask, setDetailTask] = useState<Task|null>(null)
  const [bugDetailsOpen, setBugDetailsOpen] = useState(false)
  const [closedConfirm, setClosedConfirm] = useState<string|null>(null)
  // Status filter: 'all' by default. Header count chips can switch to 'backlog',
  // 'future-sprint', or 'closed' scopes (toggle off → 'all').
  // 'active' is retained for backward compat but no longer surfaced in UI.
  const [statusFilter, setStatusFilter] = useState<'all'|'active'|'closed'|'backlog'|'future-sprint'>('all')
  const [boardSearch, setBoardSearch] = useState('')
  const [boardLimit, setBoardLimit] = useState(100)
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false)
  const searchInputRef = useRef<HTMLInputElement>(null)
  // Swimlane selector: together | business | feature | sprint
  // Replaces the old Status/Feature/Business group-by pills.
  type Swimlane = 'together' | 'business' | 'feature' | 'sprint'
  const [swimlane, setSwimlane] = useState<Swimlane>(() => {
    try { return (localStorage.getItem('board-swimlane') as Swimlane) || 'together' }
    catch { return 'together' }
  })
  const groupByFeature = swimlane === 'feature'
  const groupByBusiness = swimlane === 'business'
  const groupBySprint = swimlane === 'sprint'
  const [collapsedBiz, setCollapsedBiz] = useState<Record<string,boolean>>(() => { try { return JSON.parse(localStorage.getItem('board-biz-collapsed') ?? '{}') } catch { return {} } })

  // Persist multiselect filters to localStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('board-filters', JSON.stringify({
        types: filterTypes, priorities: filterPriorities, assignees: filterAssignees,
        sprints: filterSprints, hubs: filterHubs,
      }))
    }
  }, [filterTypes, filterPriorities, filterAssignees, filterSprints, filterHubs])

  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem('board-swimlane', swimlane)
  }, [swimlane])

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
    setFilterTypes([]); setFilterPriorities([]); setFilterAssignees([])
    setFilterSprints([]); setFilterHubs([])
    if (onClearFeatureFilter) onClearFeatureFilter()
  }
  const hasAnyFilter = filterTypes.length > 0 || filterPriorities.length > 0 || filterAssignees.length > 0 || filterSprints.length > 0 || filterHubs.length > 0 || !!featureFilter

  const fetchTasks = useCallback(async () => {
    setLoadError(null)
    try {
      const params = new URLSearchParams()
      if (projectFilter) params.set('project', projectFilter)
      const qs = params.toString()
      const res = await fetch(`/api/issues${qs ? `?${qs}` : ''}`)
      if (res.ok) {
        const d = await res.json()
        setTasks(d)
      } else {
        let msg = `Failed to load issues (HTTP ${res.status})`
        try { const e = await res.json(); if (e?.error) msg = e.error } catch {}
        setLoadError(msg)
      }
    } catch (e: any) {
      setLoadError(e?.message ?? 'Network error — could not reach /api/issues')
    } finally {
      setLoading(false)
    }
  }, [projectFilter])

  useEffect(() => { fetchTasks() }, [fetchTasks])

  // Auto-refresh Board every 30s so overnight changes appear without manual reload
  useEffect(() => {
    const iv = setInterval(() => { fetchTasks() }, 30_000)
    return () => clearInterval(iv)
  }, [fetchTasks])

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

  const handleDrop = (colId: string) => {
    if (!dragId) return
    const col = BOARD_COLUMNS.find(c => c.id === colId)
    const status = col?.statuses[0] ?? colId
    updateTask(dragId, { status })
    setTasks(prev => prev.map(t => t.id===dragId ? {...t, status} : t))
    setDragId(null)
  }

  const handleResolutionSelect = (resolutionType: string) => {
    if (!resolutionPending) return
    const { taskId, source, editFields } = resolutionPending
    if (source === 'edit' && editFields) {
      updateTask(taskId, { ...editFields, status: 'completed', resolution_type: resolutionType })
      setTasks(prev => prev.map(t => t.id===taskId ? { ...t, ...editFields, status: 'completed', resolution_type: resolutionType } : t))
    } else {
      updateTask(taskId, { status: 'completed', resolution_type: resolutionType })
      setTasks(prev => prev.map(t => t.id===taskId ? { ...t, status: 'completed', resolution_type: resolutionType } : t))
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

  // Sprint classification:
  // - "active" sprints = sprint date(s) covering today (ET local)
  // - "future" sprints = sprint dates strictly after today
  // - "closed" sprints = past dates, hidden from the multiselect
  // Convention: issues.sprint is stored as a YYYY-MM-DD date string (not a UUID).
  const todayISO = new Date().toISOString().slice(0, 10)
  const allSprintDatesRaw = Array.from(new Set(tasks.map(t => t.sprint).filter(Boolean))) as string[]
  const activeSprintDates = allSprintDatesRaw.filter(s => s === todayISO)
  // If no sprint matches exactly today, fall back to the latest non-future date as "active"
  if (activeSprintDates.length === 0) {
    const pastDates = allSprintDatesRaw.filter(s => s <= todayISO).sort()
    if (pastDates.length > 0) activeSprintDates.push(pastDates[pastDates.length - 1])
  }
  const futureSprintDates = allSprintDatesRaw.filter(s => s > todayISO).sort()
  const isFutureSprint = (s?: string | null) => !!s && s > todayISO
  // Dropdown options: active + future only, hide closed/past. Sort newest-first.
  const sprints = [...activeSprintDates, ...futureSprintDates]
  // Legacy alias: older code paths still reference `filterSprint` as a single string.
  // Treat the multiselect's first entry (or empty) as the legacy value for compatibility.
  const filterSprint = filterSprints[0] ?? ''
  const allFiltered = tasks.filter(t => {
    // Filter out epics and features — they are organizational containers, not work items
    if (EXCLUDED_BOARD_TYPES.includes(t.type ?? '')) return false
    // Default: show everything except closed. Status chips (backlog/closed) can
    // switch the scope when clicked, which is now represented by statusFilter.
    if (statusFilter === 'all' && t.status === 'closed') return false
    if (statusFilter === 'closed' && t.status !== 'closed') return false
    if (statusFilter === 'backlog' && t.status !== 'backlog') return false
    if (statusFilter === 'future-sprint' && !isFutureSprint(t.sprint)) return false
    if (statusFilter === 'active' && !['open', 'in_progress', 'code_review', 'product_review', 'approved', 'released'].includes(t.status)) return false
    // projectFilter is now applied server-side via /api/issues?project=
    if (filterTypes.length > 0 && !filterTypes.includes(t.type ?? '')) return false
    if (filterPriorities.length > 0 && !filterPriorities.includes(t.priority ?? '')) return false
    if (filterAssignees.length > 0 && !filterAssignees.includes(t.assignee?.toLowerCase() ?? '')) return false
    // Sprint multiselect: empty = Active Sprint(s) (today's sprint date)
    if (filterSprints.length === 0) {
      // Default scope = active sprints only
      if (t.sprint && !activeSprintDates.includes(t.sprint)) return false
    } else if (!filterSprints.includes(t.sprint ?? '')) {
      return false
    }
    // Hub filter (project name) — only effective in All-hub view
    if (filterHubs.length > 0 && !filterHubs.includes(t.project ?? '')) return false
    if (featureFilter && (t as any).parent_id !== featureFilter) return false
    if (boardSearch.trim()) {
      const q = boardSearch.trim().toLowerCase()
      const matchTitle = t.title.toLowerCase().includes(q)
      const matchKey = (t.task_key || '').toLowerCase().includes(q)
      const matchAssignee = (ASSIGNEE_MAP[t.assignee?.toLowerCase() ?? '']?.name ?? t.assignee ?? '').toLowerCase().includes(q)
      if (!matchTitle && !matchKey && !matchAssignee) return false
    }
    return true
  })
  const filtered = allFiltered.slice(0, boardLimit)
  const hasMoreBoard = allFiltered.length > boardLimit

  const projects = Array.from(new Set(tasks.map(t=>t.project).filter(Boolean)))
  const assignees = (() => {
    const seenKeys = new Set<string>()
    const seenDisplayNames = new Set<string>()
    const result: string[] = []
    for (const t of tasks) {
      if (!t.assignee) continue
      const key = t.assignee.toLowerCase()
      const displayName = ASSIGNEE_MAP[key]?.name ?? key
      if (!seenKeys.has(key) && !seenDisplayNames.has(displayName)) {
        seenKeys.add(key)
        seenDisplayNames.add(displayName)
        result.push(key)
      }
    }
    return result.sort((a, b) => {
      const da = ASSIGNEE_MAP[a]?.name ?? a
      const db = ASSIGNEE_MAP[b]?.name ?? b
      return da.localeCompare(db)
    })
  })()
  const types = Array.from(new Set(tasks.map(t=>t.type).filter(Boolean)))

  const isOverdue = (d?: string) => {
    if (!d) return false
    return new Date(d) < new Date(new Date().toDateString())
  }

  return (
    <div className="h-full flex flex-col gap-4">
      {/* Swimlane indicator banner (only when a non-default swimlane is active) */}
      {swimlane !== 'together' && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-white/10 bg-[#0a0a0a]">
          <span className="text-xs text-white/40">Swimlane:</span>
          <span className="text-xs font-semibold text-white/80 capitalize">{swimlane}</span>
        </div>
      )}
      {/* Toolbar — multiselect filters (no-wrap, horizontal scroll if too wide) */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar">
          <MultiSelect label="Type" options={types as string[]} selected={filterTypes} onToggle={v => toggleFilter(filterTypes, setFilterTypes, v)} />
          <MultiSelect label="Priority" options={['critical','high','medium','low']} selected={filterPriorities} onToggle={v => toggleFilter(filterPriorities, setFilterPriorities, v)} />
          <MultiSelect label="Assignee" options={assignees as string[]} selected={filterAssignees} onToggle={v => toggleFilter(filterAssignees, setFilterAssignees, v)} displayFn={v => ASSIGNEE_MAP[v]?.name ?? v} />
          <MultiSelect
            label="Sprint"
            options={sprints as string[]}
            selected={filterSprints}
            onToggle={v => toggleFilter(filterSprints, setFilterSprints, v)}
            displayFn={v => (activeSprintDates.includes(v) ? `${v} (active)` : v)}
          />
          {/* Hub filter — only meaningful in the All-hub view */}
          {!projectFilter && (
            <MultiSelect
              label="Hub"
              options={projects as string[]}
              selected={filterHubs}
              onToggle={v => toggleFilter(filterHubs, setFilterHubs, v)}
            />
          )}
          {/* Swimlane dropdown — Jira-style grouping */}
          <Select
            value={swimlane}
            onChange={e => setSwimlane(e.target.value as Swimlane)}
            className="w-auto text-xs py-1"
            title="Swimlane: how the board groups issues"
          >
            <option value="together" className="bg-[#0f0f0f] text-white">Swimlane: Together</option>
            {!projectFilter && (
              <option value="business" className="bg-[#0f0f0f] text-white">Swimlane: Business</option>
            )}
            <option value="feature" className="bg-[#0f0f0f] text-white">Swimlane: Feature</option>
            <option value="sprint" className="bg-[#0f0f0f] text-white">Swimlane: Sprint</option>
          </Select>
          {hasAnyFilter && <Button variant="ghost" size="sm" onClick={clearAllFilters} className="text-red-400 hover:text-red-300">Clear all</Button>}
          {/* Search bar — collapses to icon on mobile */}
          <div className="relative flex items-center">
            <button onClick={() => { setMobileSearchOpen(v => !v); setTimeout(() => searchInputRef.current?.focus(), 50) }}
              className="md:hidden text-white/40 hover:text-white/70 p-1 rounded transition-colors">
              <Search size={14} />
            </button>
            <div className={`${mobileSearchOpen ? 'flex' : 'hidden'} md:flex items-center relative`}>
              <Search size={12} className="absolute left-2 text-white/30 pointer-events-none" />
              <input
                ref={searchInputRef}
                placeholder="Search title, key, assignee…"
                value={boardSearch}
                onChange={e => setBoardSearch(e.target.value)}
                className="w-48 bg-transparent border border-white/10 rounded-lg text-xs text-white py-1 pl-7 pr-6 outline-none focus:border-white/20 placeholder-white/30"
              />
              {boardSearch && (
                <button onClick={() => setBoardSearch('')} className="absolute right-2 text-white/30 hover:text-white/70">
                  <X size={12} />
                </button>
              )}
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {/* Off-board status chips: backlog, future sprints, closed — counts only.
                Click to filter the board to that scope. */}
            {(() => {
              const scopedTasks = tasks.filter(t => !EXCLUDED_BOARD_TYPES.includes(t.type ?? ''))
              const backlogCount = scopedTasks.filter(t => t.status === 'backlog').length
              const futureCount = scopedTasks.filter(t => isFutureSprint(t.sprint) && t.status !== 'closed').length
              const closedCount = scopedTasks.filter(t => t.status === 'closed').length
              const chips: Array<{id: typeof statusFilter; label: string; color: string; count: number; title: string}> = [
                { id: 'backlog',       label: 'Backlog',        color: '#71717a', count: backlogCount, title: 'Backlog issues (not yet scheduled)' },
                { id: 'future-sprint', label: 'Future Sprints', color: '#a855f7', count: futureCount,  title: 'Issues scheduled for a future sprint' },
                { id: 'closed',        label: 'Closed',         color: '#475569', count: closedCount,  title: 'Closed issues' },
              ]
              return chips.map(c => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setStatusFilter(statusFilter === c.id ? 'all' : c.id)}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] transition-colors ${statusFilter === c.id ? 'bg-white/15 text-white' : 'bg-white/5 hover:bg-white/10 text-white/60'}`}
                  title={c.title}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.color }} />
                  {c.label}
                  <span className="font-mono text-white/90">{c.count}</span>
                </button>
              ))
            })()}
            <Button variant="secondary" size="sm" onClick={() => setNewTask({ status: 'backlog', priority: 'medium', sprint: new Date().toISOString().split('T')[0], project: projectFilter ?? undefined, assignee: 'builder', type: 'task' })}>
              + New Task
            </Button>
          </div>
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

      {/* TOD-654: Truthful error state — never silently show empty board on fetch failure */}
      {loadError && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/8 px-4 py-3 flex items-start gap-3">
          <span className="text-red-400 text-sm shrink-0">⚠️</span>
          <div className="flex-1 min-w-0">
            <p className="text-red-400 text-sm font-medium">Failed to load issues</p>
            <p className="text-red-400/70 text-xs mt-0.5 break-all">{loadError}</p>
          </div>
          <button onClick={fetchTasks}
            className="shrink-0 text-xs px-2.5 py-1 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-400 font-medium transition-colors">
            Retry
          </button>
        </div>
      )}

      {/* MC-127: Michael's "Needs You" queue */}
      {(() => {
        const michaelTasks = tasks.filter(t => t.assignee === 'michael' && !['completed', 'released', 'closed'].includes(t.status))
        if (michaelTasks.length === 0) return null
        return (
          <div className="rounded-xl border-2 border-amber-500/30 p-3 mb-2 bg-amber-500/5">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-amber-400 text-sm font-semibold">👤 Needs You</span>
              <Badge label={String(michaelTasks.length)} className="bg-amber-500/20 text-amber-400 text-[9px]" />
            </div>
            <div className="space-y-1.5">
              {michaelTasks.map(t => (
                <div key={t.id}
                  onClick={() => { setDetailTask(t); setBugDetailsOpen(false) }}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-500/20 cursor-pointer hover:bg-amber-900/10 transition-colors bg-amber-500/5">
                  <span className="text-amber-400 text-[10px] font-semibold shrink-0">Needs You</span>
                  <p className="text-white text-xs font-medium truncate flex-1">{t.title}</p>
                  {t.project && <Chip label={t.project} />}
                  {t.task_key && <span className="text-[9px] font-mono text-white/30 shrink-0">{t.task_key}</span>}
                </div>
              ))}
            </div>
          </div>
        )
      })()}

      {/* Feature-grouped swimlane — each feature is a collapsible 3-column kanban */}
      {groupByFeature && (() => {
        // TOD-XXX (Q4): pull features from the FULL tasks array (not filtered)
        // so parent lookups don't fail when a parent feature isn't in the current
        // status-filtered view. Previously caused "Unknown Feature" groups.
        const features = tasks.filter(t => t.type === 'feature' || t.type === 'epic')
        const featureById: Record<string, Task> = {}
        for (const f of features) featureById[f.id] = f

        const featureGroups: { feature: Task | null; label: string; children: Task[]; pct: number; key: string }[] = []
        const parentIds = Array.from(new Set(filtered.map(t => (t as any).parent_id).filter(Boolean)))
        for (const pid of parentIds) {
          const feat = featureById[pid]
          const children = filtered.filter(t => (t as any).parent_id === pid)
          // Hide feature groups that have NO children in any visible column.
          // These are usually features whose children are all backlog/closed and
          // thus invisible in the current scope — showing an empty feature card
          // is noise.
          const visibleInColumns = children.some(t => BOARD_COLUMNS.some(col => col.statuses.includes(t.status)))
          if (!visibleInColumns) continue
          const done = children.filter(t => ['completed', 'released', 'closed'].includes(t.status)).length
          const pct = children.length > 0 ? Math.round((done / children.length) * 100) : 0
          featureGroups.push({
            feature: feat || null,
            // Fallback label is a short UUID prefix, not "Unknown Feature".
            label: feat?.title || `Feature ${String(pid).slice(0, 8)}`,
            children,
            pct,
            key: `feature::${pid}`,
          })
        }
        const unassigned = filtered.filter(t => !(t as any).parent_id && BOARD_COLUMNS.some(col => col.statuses.includes(t.status)))
        if (unassigned.length > 0) {
          featureGroups.push({ feature: null, label: 'No parent feature', children: unassigned, pct: 0, key: 'feature::none' })
        }
        // Sort: by priority (critical first), then by completion % ascending (least done first)
        featureGroups.sort((a, b) => {
          if (!a.feature && b.feature) return 1
          if (a.feature && !b.feature) return -1
          const po = ['critical', 'high', 'medium', 'low']
          const pa = po.indexOf(a.feature?.priority || 'medium')
          const pb = po.indexOf(b.feature?.priority || 'medium')
          if (pa !== pb) return pa - pb
          return a.pct - b.pct
        })
        return (
          <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
            {featureGroups.map(group => {
              const groupKey = group.key
              const isCollapsed = collapsedBiz[groupKey] ?? false
              const toggleCollapse = () => {
                const next = { ...collapsedBiz, [groupKey]: !isCollapsed }
                setCollapsedBiz(next)
                if (typeof window !== 'undefined') localStorage.setItem('board-biz-collapsed', JSON.stringify(next))
              }
              return (
                <div key={groupKey} className="rounded-xl border border-white/10 overflow-hidden" style={{ background: '#080808' }}>
                  {/* Feature header */}
                  <div onClick={toggleCollapse} className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/5 transition-colors select-none"
                    style={{ borderLeft: group.feature ? `3px solid ${PRIORITY_COLORS[group.feature.priority || 'medium'] || '#3f3f46'}` : '3px solid #27272a' }}>
                    {group.feature?.task_key && (
                      <span className="text-[10px] font-mono font-bold text-white/40 shrink-0">{group.feature.task_key}</span>
                    )}
                    <span className="text-sm font-semibold text-white/70 flex-1 min-w-0 truncate">{group.label}</span>
                    {group.feature?.project && <span className="text-[10px] text-white/40">{group.feature.project}</span>}
                    <span className="text-[10px] text-white/60 font-mono">{group.pct}% done</span>
                    <span className="text-xs text-white/50">({group.children.length} issue{group.children.length !== 1 ? 's' : ''})</span>
                    <span className="text-white/30 text-xs">{isCollapsed ? '▶' : '▼'}</span>
                  </div>
                  {/* 3-column kanban inside the feature */}
                  {!isCollapsed && (
                    <div className="border-t border-white/10 flex gap-3 overflow-x-auto p-3">
                      {BOARD_COLUMNS.map(col => {
                        const colTasks = group.children.filter(t => col.statuses.includes(t.status))
                        return (
                          <div key={col.id}
                            className="flex-1 min-w-[240px] flex flex-col rounded-xl bg-[#0f0f0f]/50"
                            style={{ borderTop: `2px solid ${col.color}`, minHeight: '60px' }}
                            onDragOver={e => e.preventDefault()}
                            onDrop={() => handleDrop(col.id)}>
                            <div className="flex items-center gap-2 px-3 py-1.5">
                              <span className="w-1.5 h-1.5 rounded-full" style={{ background: col.color }} />
                              <span className="text-[10px] font-semibold text-white/60">{col.label}</span>
                              <span className="text-[10px] font-mono text-white/40">{colTasks.length}</span>
                            </div>
                            <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2 min-h-[30px]">
                              {colTasks.length === 0 && <div className="text-[10px] text-white/20 text-center py-2">—</div>}
                              {colTasks.map(task => {
                                const aKey = task.assignee?.toLowerCase() ?? ''
                                const aName = ASSIGNEE_MAP[aKey]?.name ?? task.assignee ?? ''
                                const aLetter = aName.charAt(0).toUpperCase()
                                const aDotColor = ASSIGNEE_DOT_COLORS[aKey] ?? '#6b7280'
                                return (
                                  <div key={task.id}
                                    draggable
                                    onDragStart={() => setDragId(task.id)}
                                    onDragEnd={() => setDragId(null)}
                                    onClick={() => { setDetailTask(task); setBugDetailsOpen(false) }}
                                    className={`rounded-lg border cursor-pointer transition-colors relative ${dragId === task.id ? 'opacity-50' : ''}`}
                                    style={{ background: '#0f0f0f', borderColor: dragId === task.id ? '#555' : '#27272a' }}>
                                    <div className="px-2 pt-1.5 pb-1.5">
                                      {task.task_key && <span className="text-[9px] font-mono font-bold text-white/40">{task.task_key}</span>}
                                      <p className="text-white text-[11px] font-medium leading-snug line-clamp-2 mb-1">{task.title}</p>
                                      <div className="flex items-center gap-1 flex-wrap">
                                        {task.type && TYPE_ICONS[task.type] && <span className="text-white/40 shrink-0">{TYPE_ICONS[task.type]}</span>}
                                        {task.priority && <span className="w-1.5 h-1.5 rounded-full inline-block shrink-0" style={{ background: PRIORITY_DOT_COLORS[task.priority] ?? '#71717a' }} />}
                                        {(task.is_blocked || task.blocked_by) && (
                                          <Lock size={9} className="text-red-400 shrink-0" aria-label={task.blocked_by ? `blocked by ${task.blocked_by}` : 'blocked'} />
                                        )}
                                      </div>
                                    </div>
                                    {aLetter && (
                                      <div className="absolute bottom-1 right-1 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
                                        style={{ background: aDotColor }} title={aName}>
                                        {aLetter}
                                      </div>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
            {featureGroups.length === 0 && <EmptyState icon={Kanban} title="No tasks match filters" />}
          </div>
        )
      })()}

      {/* Sprint-grouped swimlane — active + future + "No Sprint" lane at end */}
      {groupBySprint && (() => {
        const NO_SPRINT_KEY = '__no_sprint__'
        const sprintGroups: Record<string, typeof filtered> = {}
        for (const t of filtered) {
          const s = t.sprint
          // Skip past sprints — only show active, future, or no-sprint.
          // Past sprints exist only to surface past work when someone clicks
          // the Closed chip; by default we hide them here.
          if (s && s < todayISO && !activeSprintDates.includes(s)) continue
          const k = s || NO_SPRINT_KEY
          if (!sprintGroups[k]) sprintGroups[k] = []
          sprintGroups[k].push(t)
        }
        // Sort: active sprint(s) first, then future ascending, then No Sprint at the end
        const sorted = Object.keys(sprintGroups).sort((a, b) => {
          if (a === NO_SPRINT_KEY) return 1
          if (b === NO_SPRINT_KEY) return -1
          const aActive = activeSprintDates.includes(a)
          const bActive = activeSprintDates.includes(b)
          if (aActive && !bActive) return -1
          if (!aActive && bActive) return 1
          return a < b ? -1 : a > b ? 1 : 0
        })
        return (
          <div className="flex-1 overflow-y-auto space-y-3 min-h-0">
            {sorted.map(sprintKey => {
              const tasks = sprintGroups[sprintKey]
              const groupKey = `sprint::${sprintKey}`
              const isCollapsed = collapsedBiz[groupKey] ?? false
              const toggleCollapse = () => {
                const next = { ...collapsedBiz, [groupKey]: !isCollapsed }
                setCollapsedBiz(next)
                if (typeof window !== 'undefined') localStorage.setItem('board-biz-collapsed', JSON.stringify(next))
              }
              const isActive = sprintKey !== NO_SPRINT_KEY && activeSprintDates.includes(sprintKey)
              const isNoSprint = sprintKey === NO_SPRINT_KEY
              const done = tasks.filter(t => ['completed', 'released', 'closed'].includes(t.status)).length
              const pct = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0
              return (
                <div key={groupKey} className="rounded-xl border border-white/10 overflow-hidden" style={{ background: '#080808' }}>
                  <div onClick={toggleCollapse} className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-white/5 transition-colors select-none"
                    style={{ borderLeft: isActive ? '3px solid #22c55e' : isNoSprint ? '3px solid #71717a' : '3px solid #3f3f46' }}>
                    <span className="text-sm font-semibold text-white/70">{isNoSprint ? 'No Sprint' : sprintKey}</span>
                    {isActive && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/20 text-green-400 border border-green-500/30">active</span>}
                    {!isActive && !isNoSprint && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-purple-500/20 text-purple-400 border border-purple-500/30">future</span>}
                    <span className="text-[10px] text-white/60 font-mono ml-auto">{pct}% done</span>
                    <span className="text-xs text-white/50">({tasks.length} issue{tasks.length !== 1 ? 's' : ''})</span>
                    <span className="text-white/30 text-xs">{isCollapsed ? '▶' : '▼'}</span>
                  </div>
                  {!isCollapsed && (
                    <div className="border-t border-white/10 flex gap-3 overflow-x-auto p-3">
                      {BOARD_COLUMNS.map(col => {
                        const colTasks = tasks.filter(t => col.statuses.includes(t.status))
                        return (
                          <div key={col.id}
                            className="flex-1 min-w-[240px] flex flex-col rounded-xl bg-[#0f0f0f]/50"
                            style={{ borderTop: `2px solid ${col.color}`, minHeight: '60px' }}
                            onDragOver={e => e.preventDefault()}
                            onDrop={() => handleDrop(col.id)}>
                            <div className="flex items-center gap-2 px-3 py-1.5">
                              <span className="w-1.5 h-1.5 rounded-full" style={{ background: col.color }} />
                              <span className="text-[10px] font-semibold text-white/60">{col.label}</span>
                              <span className="text-[10px] font-mono text-white/40">{colTasks.length}</span>
                            </div>
                            <div className="flex-1 px-2 pb-2 space-y-2 min-h-[30px]">
                              {colTasks.length === 0 && <div className="text-[10px] text-white/20 text-center py-2">—</div>}
                              {colTasks.map(task => (
                                <div key={task.id}
                                  onClick={() => { setDetailTask(task); setBugDetailsOpen(false) }}
                                  className="rounded-lg border cursor-pointer transition-colors"
                                  style={{ background: '#0f0f0f', borderColor: '#27272a' }}>
                                  <div className="px-2 py-1.5">
                                    {task.task_key && <span className="text-[9px] font-mono font-bold text-white/40">{task.task_key}</span>}
                                    <p className="text-white text-[11px] font-medium leading-snug line-clamp-2">{task.title}</p>
                                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                                      {task.priority && <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ background: PRIORITY_DOT_COLORS[task.priority] ?? '#71717a' }} />}
                                      {(task.is_blocked || task.blocked_by) && <Lock size={9} className="text-red-400 shrink-0" />}
                                    </div>
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
        )
      })()}

      {/* Business-grouped view */}
      {groupByBusiness && (() => {
        const BIZ_PROJECTS: Record<string, {label: string; emoji: string; projects: string[]}> = {
          'Vespera':          { label: 'Vespera',          emoji: '🖤', projects: ['Vespera'] },
          'Kemuni':           { label: 'Kemuni',           emoji: '🚀', projects: ['Kemuni'] },
          'Mission Control':  { label: 'Mission Control',  emoji: '🧠', projects: ['Mission Control'] },
          'Todero':          { label: 'Todero',          emoji: '🧠', projects: ['Todero'] },
          'Infrastructure':   { label: 'Infrastructure',   emoji: '⚙️', projects: ['Infrastructure', 'KAOS'] },
        }
        const bizOrder = ['Vespera', 'Kemuni', 'Mission Control', 'Todero', 'Infrastructure']
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
                      {BOARD_COLUMNS.map(col => { const cnt = allBizTasks.filter(t => col.statuses.includes(t.status)).length; return cnt > 0 ? (
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
                                {BOARD_COLUMNS.map(col => { const cnt = projTasks.filter(t => col.statuses.includes(t.status)).length; return cnt > 0 ? (
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
                                  const colTasks = projTasks.filter(t => col.statuses.includes(t.status))
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
                                        {colTasks.map(task => {
                                          const aKey = task.assignee?.toLowerCase() ?? ''
                                          const aName = ASSIGNEE_MAP[aKey]?.name ?? task.assignee ?? ''
                                          const aLetter = aName.charAt(0).toUpperCase()
                                          const aDotColor = ASSIGNEE_DOT_COLORS[aKey] ?? '#6b7280'
                                          return (
                                          <div key={task.id}
                                            draggable
                                            onDragStart={() => setDragId(task.id)}
                                            onDragEnd={() => setDragId(null)}
                                            onClick={() => { setDetailTask(task); setBugDetailsOpen(false) }}
                                            className={`rounded-lg border cursor-pointer transition-colors relative ${dragId===task.id ? 'opacity-50' : ''}`}
                                            style={{background:'#0f0f0f', borderColor: dragId===task.id ? '#555' : '#27272a'}}>
                                            <div className="px-2 pt-1.5 pb-1.5">
                                              {task.task_key && <span className="text-[9px] font-mono font-bold text-white/40">{task.task_key}</span>}
                                              <p className="text-white text-[11px] font-medium leading-snug line-clamp-2 mb-1">{task.title}</p>
                                              <div className="flex items-center gap-1 flex-wrap">
                                                {task.type && TYPE_ICONS[task.type] && <span className="text-white/40 shrink-0">{TYPE_ICONS[task.type]}</span>}
                                                {task.priority && <span className="w-1.5 h-1.5 rounded-full inline-block shrink-0" style={{background: PRIORITY_DOT_COLORS[task.priority] ?? '#71717a'}} />}
                                                {(task.is_blocked || task.blocked_by) && (
                                                  <Lock
                                                    size={9}
                                                    className="text-red-400 shrink-0"
                                                    aria-label={task.blocked_by ? `blocked by ${task.blocked_by}` : 'blocked'}
                                                  />
                                                )}
                                              </div>
                                            </div>
                                            {aLetter && (
                                              <div className="absolute bottom-1 right-1 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
                                                style={{background: aDotColor}} title={aName}>
                                                {aLetter}
                                              </div>
                                            )}
                                          </div>
                                          )
                                        })}
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
            {allKeys.length === 0 && <EmptyState icon={Kanban} title="No tasks match filters" />}
          </div>
        )
      })()}

      {/* Mobile column tabs */}
      {!groupByFeature && !groupByBusiness && <div className="flex md:hidden gap-1 overflow-x-auto pb-1">
        {BOARD_COLUMNS.map(col=>(
          <button key={col.id} onClick={()=>setMobileCol(col.id)}
            className={'text-xs px-3 py-1.5 rounded-lg shrink-0 transition-colors '+(mobileCol===col.id?'bg-white/10 text-white':'text-white/50 hover:text-white/70')}
            style={mobileCol===col.id?{borderBottom:`2px solid ${col.color}`}:{}}>
            {col.label} <span className="text-white/30 ml-1">{filtered.filter(t=>col.statuses.includes(t.status)).length}</span>
          </button>
        ))}
      </div>}

      {/* Columns — 3-col layout fills viewport (TOD-XXX Board simplification) */}
      {!groupByFeature && !groupByBusiness && <div className="flex-1 flex gap-3 overflow-x-auto pb-2 min-h-0">
        {BOARD_COLUMNS.map(col => {
          const colTasks = filtered.filter(t => col.statuses.includes(t.status))
          return (
            <div key={col.id}
              className={`flex-1 min-w-0 md:min-w-[280px] flex flex-col rounded-xl bg-[#0f0f0f]/50 ${col.id !== mobileCol ? 'hidden md:flex' : ''}`}
              style={{borderTop:`2px solid ${col.color}`}}
              onDragOver={e => e.preventDefault()}
              onDrop={() => handleDrop(col.id)}>
              {/* Column header */}
              <div className="flex items-center justify-between px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full" style={{background:col.color}} />
                  <span className="text-xs font-semibold text-white/60">{col.label}</span>
                  <span className="text-xs font-mono text-white/40">{colTasks.length}</span>
                  {col.id === 'achieved' && filtered.length > 0 && (
                    <span className="text-[10px] text-white/30 font-mono">({Math.round((colTasks.length / filtered.length) * 100)}%)</span>
                  )}
                </div>
              </div>

              {/* Cards */}
              <div className="flex-1 overflow-y-auto px-2 pb-2 space-y-2 min-h-[60px]">
                {loading && <div className="flex items-center justify-center py-4 gap-2 text-white/40 text-xs"><span className="animate-spin h-3 w-3 border-2 border-white/20 border-t-white/60 rounded-full" />Loading...</div>}
                {!loading && colTasks.length === 0 && <EmptyState icon={Kanban} title="No tasks" className="py-6" />}
                {colTasks.map(task => {
                  const assigneeKey = task.assignee?.toLowerCase() ?? ''
                  const assigneeName = ASSIGNEE_MAP[assigneeKey]?.name ?? task.assignee ?? ''
                  const assigneeLetter = assigneeName.charAt(0).toUpperCase()
                  const assigneeDotColor = ASSIGNEE_DOT_COLORS[assigneeKey] ?? '#6b7280'
                  return (
                  <div key={task.id}
                    draggable
                    onDragStart={() => setDragId(task.id)}
                    onDragEnd={() => setDragId(null)}
                    onClick={() => { setDetailTask(task); setBugDetailsOpen(false) }}
                    className={`group rounded-lg border cursor-pointer transition-colors relative ${dragId===task.id ? 'opacity-50' : ''}`}
                    style={{background:'#0f0f0f', borderColor: dragId===task.id ? '#555' : '#27272a'}}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor='#3f3f46'}}
                    onMouseLeave={e=>{e.currentTarget.style.borderColor=dragId===task.id?'#555':'#27272a'}}>
                    <div className="px-2.5 pt-2 pb-2">
                      {/* Top row: task_key */}
                      <div className="flex items-center justify-between mb-1">
                        {task.task_key && <span className="text-[10px] font-mono font-bold text-white/40">{task.task_key}</span>}
                        {col.id === 'signoff' && closedConfirm === task.id && (
                          <span className="text-[10px] text-green-400 whitespace-nowrap animate-pulse">Archived</span>
                        )}
                        {col.id === 'signoff' && closedConfirm !== task.id && (
                          <button onClick={e => { e.stopPropagation(); closeTask(task.id) }}
                            className="text-[10px] text-white/30 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all whitespace-nowrap px-1 py-0.5 rounded hover:bg-white/10">
                            x
                          </button>
                        )}
                      </div>
                      {/* Middle: title — 2 lines max */}
                      <p className="text-white text-xs font-medium leading-snug line-clamp-2 mb-2">{task.title}</p>
                      {/* Bottom row: chips and icons */}
                      <div className="flex items-center gap-1 flex-wrap">
                        {task.project && <span className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-white/5 text-white/40 border border-white/10 shrink-0">{task.project}</span>}
                        {task.type && TYPE_ICONS[task.type] && <span className="text-white/40 shrink-0" title={task.type}>{TYPE_ICONS[task.type]}</span>}
                        {task.status && <span className={`inline-block text-[8px] font-medium px-1.5 py-0.5 rounded-full border shrink-0 ${STATUS_CHIP_COLORS[task.status] ?? 'bg-white/5 text-white/50 border-white/10'}`}>{task.status.replace(/_/g,' ')}</span>}
                        {task.priority && <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{background: PRIORITY_DOT_COLORS[task.priority] ?? '#71717a'}} title={task.priority} />}
                        {task.severity && SEVERITY_CHIP_STYLES[task.severity] && (
                          <span className={`inline-block text-[8px] font-bold px-1 py-0 rounded border shrink-0 ${SEVERITY_CHIP_STYLES[task.severity]}`}>{task.severity}</span>
                        )}
                        {(task.is_blocked || task.blocked_by) && <Lock size={10} className="text-red-400 shrink-0" />}
                      </div>
                    </div>
                    {/* Assignee dot — bottom-right */}
                    {assigneeLetter && (
                      <div className="absolute bottom-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white"
                        style={{background: assigneeDotColor}} title={assigneeName}>
                        {assigneeLetter}
                      </div>
                    )}
                  </div>
                  )
                })}
              </div>

            </div>
          )
        })}
      </div>}

      {/* Load more */}
      {hasMoreBoard && (
        <Button variant="secondary" size="sm" onClick={() => setBoardLimit(prev => prev + 100)} className="w-full justify-center">
          Load 100 more ({allFiltered.length - boardLimit} remaining)
        </Button>
      )}

      {/* New Task Modal */}
      {newTask && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60" onClick={()=>setNewTask(null)}>
          <div className="w-full max-w-lg md:rounded-2xl rounded-t-2xl border border-white/10 p-5 md:p-6 space-y-4 max-h-[90vh] overflow-y-auto" style={{background:'#080808'}} onClick={e=>e.stopPropagation()}>
            <h3 className="text-white font-semibold text-sm">New Task</h3>
            <FormGroup label="Title" required>
              <Input placeholder="Task title..." autoFocus
                value={newTask.title??''} onChange={e=>setNewTask({...newTask,title:e.target.value})} />
            </FormGroup>
            <FormGroup label="Description">
              <Textarea placeholder="Details..." rows={3}
                value={newTask.description??''} onChange={e=>setNewTask({...newTask,description:e.target.value})} />
            </FormGroup>
            <div className="grid grid-cols-2 gap-3">
              <FormGroup label="Status">
                <Select value={newTask.status??'backlog'} onChange={e=>setNewTask({...newTask,status:e.target.value})}>
                  {ALL_STATUSES.map(s=><option key={s.value} value={s.value} className="bg-[#0f0f0f] text-white">{s.label}</option>)}
                </Select>
              </FormGroup>
              <FormGroup label="Priority">
                <Select value={newTask.priority??'medium'} onChange={e=>setNewTask({...newTask,priority:e.target.value})}>
                  {['critical','high','medium','low'].map(p=><option key={p} value={p} className="bg-[#0f0f0f] text-white">{p}</option>)}
                </Select>
              </FormGroup>
              <FormGroup label="Project">
                <Input placeholder="e.g. Kemuni" value={newTask.project??''} onChange={e=>setNewTask({...newTask,project:e.target.value})} />
              </FormGroup>
              <FormGroup label="Assignee">
                <Select value={newTask.assignee??''} onChange={e=>{
                  const assignee = e.target.value
                  setNewTask({...newTask, assignee})
                }}>
                  <option value="" className="bg-[#0f0f0f] text-white">Unassigned</option>
                  {Object.entries(ASSIGNEE_MAP).map(([k,v])=><option key={k} value={k} className="bg-[#0f0f0f] text-white">{v.emoji} {v.name}</option>)}
                </Select>
              </FormGroup>
              <FormGroup label="Type">
                <Select value={newTask.type??''} onChange={e=>{
                  const t = e.target.value
                  // Feature 4: auto-set assignee to builder for task/bug
                  const autoAssignee = (t === 'task' || t === 'bug') ? 'builder' : newTask.assignee
                  setNewTask({...newTask, type: t, assignee: autoAssignee ?? ''})
                }}>
                  <option value="" className="bg-[#0f0f0f] text-white">Select type</option>
                  {['feature','task','bug','ops','epic','subtask'].map(t=><option key={t} value={t} className="bg-[#0f0f0f] text-white">{t}</option>)}
                </Select>
              </FormGroup>
              <FormGroup label="Due Date">
                <Input type="date" value={newTask.due_date??''} onChange={e=>setNewTask({...newTask,due_date:e.target.value})} />
              </FormGroup>
              {/* Sprint field — defaults to today */}
              <FormGroup label="Sprint">
                <Select value={newTask.sprint??''} onChange={e=>setNewTask({...newTask,sprint:e.target.value||undefined})}>
                  <option value="" className="bg-[#0f0f0f] text-white">None</option>
                  {(() => { const today = new Date().toISOString().split('T')[0]; const opts = sprints.includes(today) ? sprints : [today, ...sprints]; return opts.map(s=><option key={s} value={s!} className="bg-[#0f0f0f] text-white">{s}</option>) })()}
                </Select>
              </FormGroup>
              {/* Feature 1: Severity */}
              <FormGroup label="Severity">
                <Select value={(newTask as any).severity??''} onChange={e=>setNewTask({...newTask, severity: e.target.value||undefined} as any)}>
                  <option value="" className="bg-[#0f0f0f] text-white">None</option>
                  {['S0','S1','S2','S3'].map(s=><option key={s} value={s} className="bg-[#0f0f0f] text-white">{s}</option>)}
                </Select>
              </FormGroup>
              {/* Feature 1: Owner */}
              <FormGroup label="Owner">
                <Select value={(newTask as any).owner??''} onChange={e=>setNewTask({...newTask, owner: e.target.value||undefined} as any)}>
                  <option value="" className="bg-[#0f0f0f] text-white">None</option>
                  {Object.entries(ASSIGNEE_MAP).map(([k,v])=><option key={k} value={k} className="bg-[#0f0f0f] text-white">{v.emoji} {v.name}</option>)}
                </Select>
              </FormGroup>
              {/* Feature 1: Reviewer */}
              <FormGroup label="Reviewer">
                <Select value={(newTask as any).reviewer??''} onChange={e=>setNewTask({...newTask, reviewer: e.target.value||undefined} as any)}>
                  <option value="" className="bg-[#0f0f0f] text-white">None</option>
                  {Object.entries(ASSIGNEE_MAP).map(([k,v])=><option key={k} value={k} className="bg-[#0f0f0f] text-white">{v.emoji} {v.name}</option>)}
                </Select>
              </FormGroup>
            </div>
            {/* Feature 1: Acceptance Criteria */}
            <FormGroup label="Acceptance Criteria">
              <Textarea placeholder="Done when..." rows={3}
                value={(newTask as any).acceptance_criteria??''} onChange={e=>setNewTask({...newTask, acceptance_criteria: e.target.value} as any)} />
            </FormGroup>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={()=>setNewTask(null)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={()=>{if(newTask.title?.trim()) createTask(newTask)}}
                disabled={!newTask.title?.trim()}>Create</Button>
            </div>
          </div>
        </div>
      )}

      {/* Edit/Detail Modal */}
      {editTask && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/60" onClick={()=>setEditTask(null)}>
          <div className="w-full max-w-lg md:rounded-2xl rounded-t-2xl border border-white/10 p-5 md:p-6 space-y-4 max-h-[90vh] overflow-y-auto" style={{background:'#080808'}} onClick={e=>e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <h3 className="text-white font-semibold text-sm">Edit Task</h3>
              <Button variant="danger" size="sm" onClick={()=>setConfirmDelete(editTask.id)}>Delete</Button>
            </div>
            <FormGroup label="Title">
              <Input value={editTask.title} onChange={e=>setEditTask({...editTask,title:e.target.value})} />
            </FormGroup>
            <FormGroup label="Description">
              <Textarea rows={3} value={editTask.description??''} onChange={e=>setEditTask({...editTask,description:e.target.value})} />
            </FormGroup>
            <div className="grid grid-cols-2 gap-3">
              <FormGroup label="Status">
                <Select value={editTask.status} onChange={e=>setEditTask({...editTask,status:e.target.value})}>
                  {ALL_STATUSES.map(s=><option key={s.value} value={s.value} className="bg-[#0f0f0f] text-white">{s.label}</option>)}
                </Select>
              </FormGroup>
              <FormGroup label="Priority">
                <Select value={editTask.priority??'medium'} onChange={e=>setEditTask({...editTask,priority:e.target.value})}>
                  {['critical','high','medium','low'].map(p=><option key={p} value={p} className="bg-[#0f0f0f] text-white">{p}</option>)}
                </Select>
              </FormGroup>
              <FormGroup label="Project">
                <Input value={editTask.project??''} onChange={e=>setEditTask({...editTask,project:e.target.value})} />
              </FormGroup>
              <FormGroup label="Assignee">
                <Select value={editTask.assignee??''} onChange={e=>setEditTask({...editTask,assignee:e.target.value})}>
                  <option value="" className="bg-[#0f0f0f] text-white">Unassigned</option>
                  {Object.entries(ASSIGNEE_MAP).map(([k,v])=><option key={k} value={k} className="bg-[#0f0f0f] text-white">{v.emoji} {v.name}</option>)}
                </Select>
              </FormGroup>
              <FormGroup label="Type">
                <Input value={editTask.type??''} onChange={e=>setEditTask({...editTask,type:e.target.value})} />
              </FormGroup>
              <FormGroup label="Due Date">
                <Input type="date" value={editTask.due_date??''} onChange={e=>setEditTask({...editTask,due_date:e.target.value})} />
              </FormGroup>
              {/* Feature 1: Severity */}
              <FormGroup label="Severity">
                <Select value={(editTask as any).severity??''} onChange={e=>setEditTask({...editTask, severity: e.target.value||undefined} as any)}>
                  <option value="" className="bg-[#0f0f0f] text-white">None</option>
                  {['S0','S1','S2','S3'].map(s=><option key={s} value={s} className="bg-[#0f0f0f] text-white">{s}</option>)}
                </Select>
              </FormGroup>
              {/* Feature 1: Owner */}
              <FormGroup label="Owner">
                <Select value={(editTask as any).owner??''} onChange={e=>setEditTask({...editTask, owner: e.target.value||undefined} as any)}>
                  <option value="" className="bg-[#0f0f0f] text-white">None</option>
                  {Object.entries(ASSIGNEE_MAP).map(([k,v])=><option key={k} value={k} className="bg-[#0f0f0f] text-white">{v.emoji} {v.name}</option>)}
                </Select>
              </FormGroup>
              {/* Feature 1: Reviewer */}
              <FormGroup label="Reviewer">
                <Select value={(editTask as any).reviewer??''} onChange={e=>setEditTask({...editTask, reviewer: e.target.value||undefined} as any)}>
                  <option value="" className="bg-[#0f0f0f] text-white">None</option>
                  {Object.entries(ASSIGNEE_MAP).map(([k,v])=><option key={k} value={k} className="bg-[#0f0f0f] text-white">{v.emoji} {v.name}</option>)}
                </Select>
              </FormGroup>
            </div>
            {/* Feature 1: Acceptance Criteria */}
            <FormGroup label="Acceptance Criteria">
              <Textarea rows={3} placeholder="Done when..."
                value={(editTask as any).acceptance_criteria??''} onChange={e=>setEditTask({...editTask, acceptance_criteria: e.target.value} as any)} />
            </FormGroup>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={()=>setEditTask(null)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={()=>{
                const fields = {title:editTask.title,description:editTask.description,status:editTask.status,
                  priority:editTask.priority,project:editTask.project,assignee:editTask.assignee,type:editTask.type,due_date:editTask.due_date,
                  severity:(editTask as any).severity,owner:(editTask as any).owner,reviewer:(editTask as any).reviewer,
                  acceptance_criteria:(editTask as any).acceptance_criteria}
                const origTask = tasks.find(t=>t.id===editTask.id)
                if (editTask.status==='completed' && origTask?.status!=='completed') {
                  setResolutionPending({taskId:editTask.id,source:'edit',editFields:fields})
                } else {
                  updateTask(editTask.id,fields)
                }
              }}
              >Save</Button>
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
              <Button variant="ghost" size="sm" onClick={()=>setConfirmDelete(null)}>Cancel</Button>
              <Button variant="danger" size="sm" onClick={()=>deleteTask(confirmDelete)}>Delete</Button>
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
                <Button key={opt.value} variant="secondary" size="sm" onClick={() => handleResolutionSelect(opt.value)}
                  className="rounded-full">
                  {opt.emoji} {opt.label}
                </Button>
              ))}
            </div>
            <div className="flex justify-center pt-1">
              <Button variant="ghost" size="sm" onClick={()=>setResolutionPending(null)}>Cancel</Button>
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
                  <Button variant="ghost" size="sm" onClick={() => { setEditTask(t); setDetailTask(null); setBugDetailsOpen(false) }}>Edit</Button>
                </div>
                <Button variant="icon" onClick={() => { setDetailTask(null); setBugDetailsOpen(false) }}>&times;</Button>
              </div>

              <div className="px-5 py-5 space-y-5">
                {/* Blocked banner */}
                {t.blocked_by && (
                  <div className="rounded-xl px-4 py-2.5 border border-red-500/30 bg-red-500/10 text-red-400 text-xs font-medium">
                    🚫 Blocked by: {t.blocked_by}
                  </div>
                )}

                {/* Title */}
                {t.task_key && <span className="text-[10px] font-mono text-white/30 bg-white/10 px-2 py-0.5 rounded-full">{t.task_key}</span>}
                <h2 className="text-white text-lg font-semibold leading-snug">{t.title}</h2>

                {/* Status + Priority badges */}
                <div className="flex flex-wrap items-center gap-2">
                  {t.status && (
                    <span className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded-full border ${STATUS_CHIP_COLORS[t.status] ?? 'bg-white/5 text-white/50 border-white/10'}`}>
                      {t.status.replace(/_/g,' ')}
                    </span>
                  )}
                  {t.priority && <Chip label={t.priority} color={PRIORITY_COLORS[t.priority]} />}
                  {t.type && <Chip label={t.type} />}
                </div>

                {/* Severity + Sprint (inline badges) */}
                <div className="flex flex-wrap items-center gap-2">
                  {t.severity && (
                    <span className="inline-block text-[10px] font-medium px-2 py-0.5 rounded-full border bg-white/5 text-white/60 border-white/10">
                      Severity: {t.severity}
                    </span>
                  )}
                  {t.sprint && (
                    <span className="inline-block text-[10px] font-medium px-2 py-0.5 rounded-full border bg-white/5 text-white/60 border-white/10">
                      Sprint: {t.sprint}
                    </span>
                  )}
                  {t.is_blocked && (
                    <span className="inline-block text-[10px] font-medium px-2 py-0.5 rounded-full border bg-red-500/10 text-red-400 border-red-500/30">
                      🔒 Blocked
                    </span>
                  )}
                </div>

                {/* People grid: Assignee / Owner / Reviewer / Worked By */}
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Assignee</p>
                    <p className="text-sm text-white/70">
                      {t.assignee && ASSIGNEE_MAP[t.assignee] ? `${ASSIGNEE_MAP[t.assignee].emoji} ${ASSIGNEE_MAP[t.assignee].name}` : (t.assignee || 'Unassigned')}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Owner</p>
                    <p className="text-sm text-white/70">{t.owner || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Reviewer</p>
                    <p className="text-sm text-white/70">{t.reviewer || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Worked By</p>
                    <p className="text-sm text-white/70">{t.worked_by || '—'}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Project</p>
                    <p className="text-sm text-white/70">{t.project || '—'}</p>
                  </div>
                  {t.parent_id && (
                    <div>
                      <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Parent</p>
                      <p className="text-sm text-white/70 font-mono text-xs">{String(t.parent_id).slice(0,8)}</p>
                    </div>
                  )}
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

                {/* Dual Review Status */}
                {(t.tester_status || t.designer_status) && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-white/30 mb-2">Review Status</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                        <p className="text-[9px] text-white/30 uppercase">Tester</p>
                        <p className={`text-xs font-medium ${t.tester_status === 'passed' || t.tester_status === 'approved' ? 'text-green-400' : t.tester_status === 'failed' ? 'text-red-400' : 'text-white/40'}`}>
                          {t.tester_status || 'pending'}
                        </p>
                      </div>
                      <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                        <p className="text-[9px] text-white/30 uppercase">Designer</p>
                        <p className={`text-xs font-medium ${t.designer_status === 'passed' || t.designer_status === 'approved' || t.designer_status === 'ux_approved' ? 'text-green-400' : t.designer_status === 'failed' ? 'text-red-400' : 'text-white/40'}`}>
                          {t.designer_status || 'pending'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Implementation Notes */}
                {t.implementation_notes && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Implementation Notes</p>
                    <p className="text-sm text-white/40 whitespace-pre-wrap">{t.implementation_notes}</p>
                  </div>
                )}

                {/* Reviewer Notes */}
                {t.reviewer_notes && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Reviewer Notes</p>
                    <p className="text-sm text-white/40 whitespace-pre-wrap">{t.reviewer_notes}</p>
                  </div>
                )}

                {/* Regression Test */}
                {t.regression_test && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Regression Test</p>
                    <p className="text-xs text-white/40 font-mono bg-white/[0.02] rounded px-2 py-1.5 whitespace-pre-wrap">{t.regression_test}</p>
                  </div>
                )}

                {/* Git info */}
                {(t.feature_branch || t.commit_sha) && (
                  <div className="grid grid-cols-2 gap-3">
                    {t.feature_branch && (
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Branch</p>
                        <p className="text-xs text-white/50 font-mono break-all">{t.feature_branch}</p>
                      </div>
                    )}
                    {t.commit_sha && (
                      <div>
                        <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Commit</p>
                        <p className="text-xs text-white/50 font-mono">{String(t.commit_sha).slice(0,8)}</p>
                      </div>
                    )}
                  </div>
                )}

                {/* Rejection Count */}
                {t.rejection_count && t.rejection_count > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Rejections</p>
                    <p className="text-sm text-red-400">{t.rejection_count} {t.rejection_count === 1 ? 'rejection' : 'rejections'}</p>
                    {t.last_rejection_reason && (
                      <p className="text-xs text-white/40 mt-1 italic">"{t.last_rejection_reason}"</p>
                    )}
                  </div>
                )}

                {/* Test Status */}
                {t.test_status && t.test_status !== 'none' && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Test Status</p>
                    <span className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded-full border ${t.test_status === 'passed' ? 'bg-green-500/10 text-green-400 border-green-500/30' : t.test_status === 'failed' ? 'bg-red-500/10 text-red-400 border-red-500/30' : 'bg-white/5 text-white/40 border-white/10'}`}>
                      {t.test_status}
                    </span>
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
                {['completed','released'].includes(t.status) && t.resolution_type && (
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-white/30 mb-1">Resolution</p>
                    <Chip label={RESOLUTION_OPTIONS.find(r => r.value === t.resolution_type)?.label ?? t.resolution_type!}
                      color={RESOLUTION_BADGE_COLORS[t.resolution_type] ?? '#71717a'} />
                  </div>
                )}

                {/* Timestamps */}
                <div className="pt-4 border-t border-white/10 space-y-1">
                  {t.created_at && (
                    <p className="text-[10px] text-white/30">Created: {new Date(t.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                  )}
                  {t.updated_at && (
                    <p className="text-[10px] text-white/30">Updated: {new Date(t.updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                  )}
                  {t.started_at && (
                    <p className="text-[10px] text-white/30">Started: {new Date(t.started_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                  )}
                  {t.completed_at && (
                    <p className="text-[10px] text-white/30">Completed: {new Date(t.completed_at).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
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

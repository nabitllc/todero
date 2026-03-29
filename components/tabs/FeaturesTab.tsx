'use client'
import React, { useEffect, useState, useRef } from 'react'
import FeatureCard from './FeatureCard'

interface Issue {
  id: string; title: string; description?: string; status: string;
  assignee?: string; project?: string; priority?: string; type?: string;
  parent_id?: string; task_key?: string; acceptance_criteria?: string;
}

const PROJECTS = ['Vespera', 'Kemuni', 'Mission Control', 'Infrastructure']
const STATUSES = ['open', 'in_progress', 'done', 'backlog', 'in_review']

function FeaturesMultiSelect({ label, options, selected, onToggle, displayFn }: {
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
        className="text-xs bg-zinc-900 border border-zinc-700 text-zinc-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-zinc-500 flex items-center gap-1">
        {selected.length > 0 ? `${label} (${selected.length})` : `All ${label}s`}
        <span className="text-zinc-600 text-[9px]">▾</span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 min-w-[140px] rounded-lg border border-zinc-700 bg-zinc-900 py-1 shadow-xl">
          {options.map(opt => (
            <button key={opt} onClick={() => onToggle(opt)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-zinc-800 transition-colors">
              <span className={`w-3 h-3 rounded border flex items-center justify-center text-[8px] ${selected.includes(opt) ? 'bg-blue-500 border-blue-500 text-white' : 'border-zinc-600'}`}>
                {selected.includes(opt) ? '✓' : ''}
              </span>
              <span className="text-zinc-300">{display(opt)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function FeaturesTab({ onViewIssues, projectFilter }: { onViewIssues?: (featureId: string, featureName: string) => void; projectFilter?: string | null }) {
  const [issues, setIssues] = useState<Issue[]>([])
  const [loading, setLoading] = useState(true)
  const [projFilters, setProjFilters] = useState<string[]>([])
  const [statusFilters, setStatusFilters] = useState<string[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [limit, setLimit] = useState(100)

  useEffect(() => {
    fetch('/api/issues').then(r => r.json()).then(d => {
      if (Array.isArray(d)) setIssues(d)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const features = issues.filter(i => i.type === 'feature')
  const allFiltered = features.filter(f => {
    if (projectFilter && f.project !== projectFilter) return false
    if (projFilters.length > 0 && !projFilters.includes(f.project ?? '')) return false
    if (statusFilters.length > 0 && !statusFilters.includes(f.status)) return false
    return true
  })
  const filtered = allFiltered.slice(0, limit)
  const hasMore = allFiltered.length > limit

  const toggleProj = (v: string) => { setLimit(100); setProjFilters(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]) }
  const toggleStatus = (v: string) => { setLimit(100); setStatusFilters(prev => prev.includes(v) ? prev.filter(x => x !== v) : [...prev, v]) }
  const hasAnyFilter = projFilters.length > 0 || statusFilters.length > 0
  const clearAll = () => { setProjFilters([]); setStatusFilters([]); setLimit(100) }

  // Group by project
  const grouped: Record<string, typeof filtered> = {}
  for (const f of filtered) {
    const p = f.project || 'Unknown'
    if (!grouped[p]) grouped[p] = []
    grouped[p].push(f)
  }

  const childrenOf = (fid: string) => issues.filter(i => i.parent_id === fid)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-zinc-500 text-sm">Loading features...</span>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Features</h2>
          <p className="text-xs text-zinc-500 mt-0.5">{filtered.length} feature{filtered.length !== 1 ? 's' : ''} across projects</p>
        </div>
        <div className="flex items-center gap-2">
          <FeaturesMultiSelect label="Project" options={PROJECTS} selected={projFilters} onToggle={toggleProj} />
          <FeaturesMultiSelect label="Status" options={STATUSES} selected={statusFilters} onToggle={toggleStatus} displayFn={s => s.replace('_', ' ')} />
          {hasAnyFilter && <button onClick={clearAll} className="text-[10px] text-red-400 hover:text-red-300 px-2 py-1 rounded-lg hover:bg-zinc-800 transition-colors">Clear all</button>}
        </div>
      </div>

      {/* Active filter chips */}
      {hasAnyFilter && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {projFilters.map(v => (
            <span key={v} className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700">
              {v}
              <button onClick={() => toggleProj(v)} className="hover:text-white ml-0.5">×</button>
            </span>
          ))}
          {statusFilters.map(v => (
            <span key={v} className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-zinc-800 text-zinc-300 border border-zinc-700">
              {v.replace('_', ' ')}
              <button onClick={() => toggleStatus(v)} className="hover:text-white ml-0.5">×</button>
            </span>
          ))}
        </div>
      )}

      {Object.keys(grouped).length === 0 && (
        <div className="rounded-xl border border-zinc-800/60 px-6 py-12 text-center" style={{ background: '#0f0f0f' }}>
          <p className="text-zinc-600 text-sm">No features yet</p>
        </div>
      )}

      {Object.entries(grouped).map(([project, feats]) => (
        <div key={project} className="space-y-2">
          <h3 className="text-xs font-semibold tracking-widest text-zinc-500 uppercase flex items-center gap-2">
            <span>{project}</span>
            <span className="text-zinc-700">({feats.length})</span>
            <div className="flex-1 h-px bg-zinc-800/70" />
          </h3>
          <div className="space-y-2">
            {feats.map(f => (
              <FeatureCard key={f.id}
                feature={{ ...f, children: childrenOf(f.id), acceptance_criteria: f.acceptance_criteria }}
                expanded={!!expanded[f.id]}
                onToggle={() => setExpanded(prev => ({ ...prev, [f.id]: !prev[f.id] }))}
                onViewIssues={onViewIssues ? () => onViewIssues(f.id, f.title) : undefined}
              />
            ))}
          </div>
        </div>
      ))}

      {/* Load more */}
      {hasMore && (
        <button onClick={() => setLimit(prev => prev + 100)}
          className="w-full text-center text-xs text-zinc-500 hover:text-zinc-300 py-2.5 rounded-lg border border-zinc-800/40 hover:border-zinc-600 transition-all"
          style={{background:'#0a0a0a'}}>
          Load 100 more ({allFiltered.length - limit} remaining)
        </button>
      )}
    </div>
  )
}

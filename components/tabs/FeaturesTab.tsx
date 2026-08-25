'use client'
import React, { useEffect, useMemo, useState, useRef } from 'react'
import FeatureCard from './FeatureCard'
import { Button, EmptyState, Badge } from '@/components/ui'
import { Map } from 'lucide-react'
import { useApiList } from '@/hooks/useApiData'
import ApiErrorBanner from '@/components/ApiErrorBanner'

interface Issue {
  id: string; title: string; description?: string; status: string;
  assignee?: string; project?: string; priority?: string; type?: string;
  parent_id?: string; task_key?: string; acceptance_criteria?: string;
}

const PROJECTS = ['Vespera', 'Kemuni', 'Todero', 'Infrastructure']
const STATUSES = ['backlog', 'open', 'in_progress', 'code_review', 'product_review', 'approved', 'completed', 'released', 'closed']

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
        className="text-sm bg-white/10 text-white px-4 py-2 rounded-lg hover:bg-white/15 transition-all flex items-center gap-1">
        {selected.length > 0 ? `${label} (${selected.length})` : `All ${label}s`}
        <span className="text-white/25 text-[9px]">▾</span>
      </button>
      {open && (
        <div className="absolute z-50 mt-1 min-w-[140px] rounded-lg border border-white/10 bg-[#0f0f0f] py-1 shadow-xl">
          {options.map(opt => (
            <button key={opt} onClick={() => onToggle(opt)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left hover:bg-white/5 transition-all">
              <span className={`w-3 h-3 rounded border flex items-center justify-center text-[8px] ${selected.includes(opt) ? 'bg-blue-500 border-blue-500 text-white' : 'border-white/10'}`}>
                {selected.includes(opt) ? '✓' : ''}
              </span>
              <span className="text-white/60">{display(opt)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export default function FeaturesTab({ onViewIssues, projectFilter }: { onViewIssues?: (featureId: string, featureName: string) => void; projectFilter?: string | null }) {
  const endpoint = useMemo(() => {
    const params = new URLSearchParams()
    if (projectFilter) params.set('project', projectFilter)
    params.set('limit', '0')
    return `/api/issues?${params.toString()}`
  }, [projectFilter])
  const { items, error: fetchError, loading, refetch } = useApiList<Issue>(endpoint)
  const issues = items ?? []
  const [projFilters, setProjFilters] = useState<string[]>([])
  const [statusFilters, setStatusFilters] = useState<string[]>([])
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [limit, setLimit] = useState(100)

  const features = issues.filter(i => i.type === 'feature')
  const allFiltered = features.filter(f => {
    // projectFilter is now applied server-side via /api/issues?project=
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
        <div className="flex items-center gap-2 text-white/40 text-sm">
          <span className="animate-spin h-4 w-4 border-2 border-white/20 border-t-white/60 rounded-full" />
          Loading features...
        </div>
      </div>
    )
  }

  if (fetchError) {
    return (
      <div className="space-y-5">
        <div>
          <h2 className="text-base font-medium text-white">Features</h2>
          <p className="text-xs text-white/40 mt-0.5">data unavailable</p>
        </div>
        <ApiErrorBanner error={fetchError} onRetry={refetch} />
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-base font-medium text-white">Features</h2>
          <p className="text-xs text-white/40 mt-0.5">{filtered.length} feature{filtered.length !== 1 ? 's' : ''} across projects</p>
        </div>
        <div className="flex items-center gap-2">
          <FeaturesMultiSelect label="Project" options={PROJECTS} selected={projFilters} onToggle={toggleProj} />
          <FeaturesMultiSelect label="Status" options={STATUSES} selected={statusFilters} onToggle={toggleStatus} displayFn={s => s.replace('_', ' ')} />
          {hasAnyFilter && (
            <Button variant="ghost" size="sm" onClick={clearAll} className="text-red-400 hover:text-red-300">
              Clear all
            </Button>
          )}
        </div>
      </div>

      {/* Active filter chips */}
      {hasAnyFilter && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {projFilters.map(v => (
            <span key={v} className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/5 text-white/60 border border-white/10">
              {v}
              <button onClick={() => toggleProj(v)} className="hover:text-white ml-0.5">×</button>
            </span>
          ))}
          {statusFilters.map(v => (
            <span key={v} className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/5 text-white/60 border border-white/10">
              {v.replace('_', ' ')}
              <button onClick={() => toggleStatus(v)} className="hover:text-white ml-0.5">×</button>
            </span>
          ))}
        </div>
      )}

      {Object.keys(grouped).length === 0 && (
        <div className="bg-[#0f0f0f] border border-white/10 rounded-xl">
          <EmptyState
            icon={Map}
            title="No features yet"
            description={hasAnyFilter ? 'Try clearing your filters' : 'Features will appear here once created'}
            action={hasAnyFilter ? { label: 'Clear filters', onClick: clearAll } : undefined}
          />
        </div>
      )}

      {Object.entries(grouped).map(([project, feats]) => (
        <div key={project} className="space-y-2">
          <h3 className="text-xs font-semibold tracking-widest text-white/40 uppercase flex items-center gap-2">
            <span>{project}</span>
            <span className="text-white/25">({feats.length})</span>
            <div className="flex-1 h-px bg-white/10" />
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
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setLimit(prev => prev + 100)}
          className="w-full justify-center"
        >
          Load 100 more ({allFiltered.length - limit} remaining)
        </Button>
      )}
    </div>
  )
}

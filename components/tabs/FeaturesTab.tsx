'use client'
import React, { useEffect, useState } from 'react'
import FeatureCard from './FeatureCard'

interface Issue {
  id: string; title: string; description?: string; status: string;
  assignee?: string; project?: string; priority?: string; type?: string;
  parent_id?: string; task_key?: string;
}

const PROJECTS = ['All', 'Vespera', 'Kemuni', 'Mission Control', 'Infrastructure']
const STATUSES = ['all', 'open', 'in_progress', 'done']

export default function FeaturesTab() {
  const [issues, setIssues] = useState<Issue[]>([])
  const [loading, setLoading] = useState(true)
  const [projFilter, setProjFilter] = useState('All')
  const [statusFilter, setStatusFilter] = useState('all')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  useEffect(() => {
    fetch('/api/issues').then(r => r.json()).then(d => {
      if (Array.isArray(d)) setIssues(d)
    }).catch(() => {}).finally(() => setLoading(false))
  }, [])

  const features = issues.filter(i => i.type === 'feature')
  const filtered = features.filter(f => {
    if (projFilter !== 'All' && f.project !== projFilter) return false
    if (statusFilter !== 'all' && f.status !== statusFilter) return false
    return true
  })

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
          <select value={projFilter} onChange={e => setProjFilter(e.target.value)}
            className="text-xs bg-zinc-900 border border-zinc-700 text-zinc-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-zinc-500">
            {PROJECTS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="text-xs bg-zinc-900 border border-zinc-700 text-zinc-300 rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-zinc-500">
            {STATUSES.map(s => (
              <option key={s} value={s}>{s === 'all' ? 'All statuses' : s.replace('_', ' ')}</option>
            ))}
          </select>
        </div>
      </div>

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
                feature={{ ...f, children: childrenOf(f.id) }}
                expanded={!!expanded[f.id]}
                onToggle={() => setExpanded(prev => ({ ...prev, [f.id]: !prev[f.id] }))}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

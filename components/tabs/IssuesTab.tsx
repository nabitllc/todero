'use client'
import React, { useEffect, useState, useMemo } from 'react'
import { Search, ChevronUp, ChevronDown } from 'lucide-react'
import { Button, Input, Select } from '@/components/ui'
import { TypeBadge, PriorityBadge, StatusBadge, Badge } from '@/components/ui'

interface Issue {
  id: string; title: string; description?: string; status: string;
  assignee?: string; project?: string; priority?: string; type?: string;
  parent_id?: string; task_key?: string; acceptance_criteria?: string;
  sprint?: string; due_date?: string; created_at?: string; updated_at?: string;
  resolution_type?: string;
}

const STATUS_OPTIONS = ['backlog','open','in_progress','in_review','done']
const PRIORITY_OPTIONS = ['critical','high','medium','low']
const ASSIGNEE_OPTIONS = ['main','builder','tester','scout','ops','kemuni-sme','vespera-sme']

const ASSIGNEE_MAP: Record<string,{emoji:string;name:string}> = {
  main:{emoji:'🧠',name:'KAOS'}, builder:{emoji:'🔨',name:'Builder'},
  tester:{emoji:'🧪',name:'Tester'}, scout:{emoji:'🔍',name:'Scout'},
  ops:{emoji:'⚙️',name:'Ops'}, 'kemuni-sme':{emoji:'🚀',name:'Kemuni SME'},
  'vespera-sme':{emoji:'🖤',name:'Vespera SME'},
}

type SortKey = 'task_key'|'type'|'title'|'status'|'priority'|'assignee'|'sprint'
type SortDir = 'asc'|'desc'

export default function IssuesTab({ projectFilter }: { projectFilter?: string | null }) {
  const [issues, setIssues] = useState<Issue[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('task_key')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [expandedId, setExpandedId] = useState<string|null>(null)
  const [editFields, setEditFields] = useState<Partial<Issue>>({})
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkStatus, setBulkStatus] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)

  useEffect(() => {
    fetch('/api/issues').then(r=>r.json()).then(d => {
      setIssues(Array.isArray(d) ? d : d.data ?? d)
    }).catch(()=>{}).finally(()=>setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    let list = issues
    if (projectFilter) list = list.filter(i => i.project === projectFilter)
    if (q) list = list.filter(i => i.title.toLowerCase().includes(q) || (i.task_key??'').toLowerCase().includes(q))
    list = [...list].sort((a,b) => {
      const av = (a[sortKey]??'') as string
      const bv = (b[sortKey]??'') as string
      if (sortKey === 'task_key') {
        const an = parseInt((av).replace(/\D/g,'')) || 0
        const bn = parseInt((bv).replace(/\D/g,'')) || 0
        return sortDir === 'asc' ? an - bn : bn - an
      }
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    })
    return list
  }, [issues, search, sortKey, sortDir, projectFilter])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const handleExpand = (id: string) => {
    if (expandedId === id) { setExpandedId(null); return }
    const issue = issues.find(i => i.id === id)
    if (issue) setEditFields({ status: issue.status, assignee: issue.assignee??'', sprint: issue.sprint??'', priority: issue.priority??'' })
    setExpandedId(id)
  }

  const handleSave = async () => {
    if (!expandedId) return
    setSaving(true)
    try {
      const res = await fetch('/api/issues', {
        method: 'PATCH',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify({ id: expandedId, ...editFields })
      })
      if (res.ok) {
        const updated = await res.json()
        setIssues(prev => prev.map(i => i.id === expandedId ? updated : i))
        setExpandedId(null)
      }
    } catch { /* ignore */ }
    finally { setSaving(false) }
  }

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const selectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set())
    else setSelected(new Set(filtered.map(i => i.id)))
  }

  const handleBulkStatusChange = async () => {
    if (!bulkStatus || selected.size === 0) return
    setBulkSaving(true)
    try {
      const promises = Array.from(selected).map(id =>
        fetch('/api/issues', {
          method: 'PATCH',
          headers: {'Content-Type':'application/json'},
          body: JSON.stringify({ id, status: bulkStatus })
        }).then(r => r.ok ? r.json() : null)
      )
      const results = await Promise.all(promises)
      setIssues(prev => prev.map(i => {
        const updated = results.find((r: any) => r && r.id === i.id)
        return updated ? updated : i
      }))
      setSelected(new Set())
      setBulkStatus('')
    } catch { /* ignore */ }
    finally { setBulkSaving(false) }
  }

  const sprints = useMemo(() => Array.from(new Set(issues.map(i=>i.sprint).filter(Boolean))).sort().reverse(), [issues])

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <span className="text-white/10 ml-0.5"><ChevronUp size={10} /></span>
    return sortDir === 'asc'
      ? <span className="text-white/40 ml-0.5"><ChevronUp size={10} /></span>
      : <span className="text-white/40 ml-0.5"><ChevronDown size={10} /></span>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-medium text-white">Issues</h2>
            {projectFilter && (
              <Badge label={projectFilter} className="bg-blue-500/20 text-blue-400 border border-blue-500/30" />
            )}
          </div>
          <p className="text-xs text-white/40 mt-0.5">{filtered.length} issues{selected.size > 0 ? ` · ${selected.size} selected` : ''}</p>
        </div>
        <div className="relative max-w-xs flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25 z-10" />
          <Input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by title or key..."
            className="pl-9 pr-3 rounded-xl text-xs"
          />
        </div>
      </div>

      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-blue-500/20 bg-blue-500/5">
          <span className="text-xs text-blue-400 font-medium">{selected.size} selected</span>
          <Select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)} className="text-xs rounded-lg px-2 py-1.5">
            <option value="">Change status to…</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s} className="bg-[#0f0f0f] text-white">{s.replace(/_/g,' ')}</option>)}
          </Select>
          <Button variant="primary" size="sm" onClick={handleBulkStatusChange} disabled={!bulkStatus || bulkSaving} loading={bulkSaving}>
            Apply
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setSelected(new Set())} className="ml-auto">
            Clear
          </Button>
        </div>
      )}

      <div className="rounded-xl border border-white/10 overflow-hidden bg-[#0f0f0f]">
        {loading && <div className="text-white/25 text-xs text-center py-8">Loading issues...</div>}

        {!loading && (
          <div className="overflow-x-auto">
            {/* Header */}
            <div className="hidden md:grid md:grid-cols-[32px_80px_70px_1fr_100px_80px_90px_90px] gap-2 px-4 py-2.5 border-b border-white/10 bg-white/3">
              <button onClick={selectAll} className="flex items-center justify-center">
                <span className={`w-3.5 h-3.5 rounded border text-[8px] flex items-center justify-center ${selected.size === filtered.length && filtered.length > 0 ? 'bg-blue-500 border-blue-500 text-white' : 'border-white/10 text-transparent'}`}>
                  ✓
                </span>
              </button>
              {([['task_key','Key'],['type','Type'],['title','Title'],['status','Status'],['priority','Pri'],['assignee','Assignee'],['sprint','Sprint']] as [SortKey,string][]).map(([key,label]) => (
                <button key={key} onClick={() => handleSort(key)}
                  className="flex items-center text-[10px] font-semibold uppercase tracking-wider text-white/40 hover:text-white/60 transition-all text-left">
                  {label}<SortIcon col={key} />
                </button>
              ))}
            </div>

            {/* Mobile header */}
            <div className="md:hidden grid grid-cols-[70px_1fr_80px] gap-2 px-3 py-2 border-b border-white/10 bg-white/3">
              {([['task_key','Key'],['title','Title'],['status','Status']] as [SortKey,string][]).map(([key,label]) => (
                <button key={key} onClick={() => handleSort(key)}
                  className="flex items-center text-[10px] font-semibold uppercase tracking-wider text-white/40 hover:text-white/60 text-left">
                  {label}<SortIcon col={key} />
                </button>
              ))}
            </div>

            {/* Rows */}
            {filtered.map(issue => (
              <React.Fragment key={issue.id}>
                {/* Desktop row */}
                <div
                  onClick={() => handleExpand(issue.id)}
                  className={'hidden md:grid md:grid-cols-[32px_80px_70px_1fr_100px_80px_90px_90px] gap-2 px-4 py-2.5 cursor-pointer transition-all border-b border-white/10 ' +
                    (expandedId === issue.id ? 'bg-white/5' : selected.has(issue.id) ? 'bg-blue-500/5' : 'hover:bg-white/3')}
                >
                  <span className="flex items-center justify-center" onClick={e => toggleSelect(issue.id, e)}>
                    <span className={`w-3.5 h-3.5 rounded border text-[8px] flex items-center justify-center cursor-pointer ${selected.has(issue.id) ? 'bg-blue-500 border-blue-500 text-white' : 'border-white/10 text-transparent hover:border-white/30'}`}>
                      ✓
                    </span>
                  </span>
                  <span className="text-[11px] font-mono px-1.5 py-0.5 rounded-lg bg-white/5 text-white/40 w-fit">{issue.task_key??'—'}</span>
                  <TypeBadge value={issue.type ?? 'task'} />
                  <span className="text-xs text-white/60 truncate">{issue.title}</span>
                  <StatusBadge value={issue.status} />
                  <PriorityBadge value={issue.priority ?? ''} />
                  <span className="text-[10px] text-white/40">
                    {issue.assignee ? (ASSIGNEE_MAP[issue.assignee]?.emoji??'') + ' ' + (ASSIGNEE_MAP[issue.assignee]?.name??issue.assignee) : '—'}
                  </span>
                  <span className="text-[10px] text-white/40 font-mono">{issue.sprint??'—'}</span>
                </div>

                {/* Mobile row */}
                <div
                  onClick={() => handleExpand(issue.id)}
                  className={'md:hidden grid grid-cols-[70px_1fr_80px] gap-2 px-3 py-2.5 cursor-pointer transition-all border-b border-white/10 ' +
                    (expandedId === issue.id ? 'bg-white/5' : 'hover:bg-white/3')}
                >
                  <span className="text-[10px] font-mono px-1 py-0.5 rounded-lg bg-white/5 text-white/40 w-fit">{issue.task_key??'—'}</span>
                  <span className="text-[11px] text-white/60 truncate">{issue.title}</span>
                  <StatusBadge value={issue.status} />
                </div>

                {/* Inline edit row */}
                {expandedId === issue.id && (
                  <div className="px-4 py-3 border-b border-white/10 bg-white/3">
                    <div className="flex flex-wrap gap-3 items-end">
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold">Status</span>
                        <Select value={editFields.status??''} onChange={e => setEditFields(f=>({...f,status:e.target.value}))} className="text-xs rounded-lg px-2 py-1.5">
                          {STATUS_OPTIONS.map(s => <option key={s} value={s} className="bg-[#0f0f0f] text-white">{s.replace(/_/g,' ')}</option>)}
                        </Select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold">Assignee</span>
                        <Select value={editFields.assignee??''} onChange={e => setEditFields(f=>({...f,assignee:e.target.value}))} className="text-xs rounded-lg px-2 py-1.5">
                          <option value="" className="bg-[#0f0f0f] text-white">Unassigned</option>
                          {ASSIGNEE_OPTIONS.map(a => <option key={a} value={a} className="bg-[#0f0f0f] text-white">{ASSIGNEE_MAP[a]?.name??a}</option>)}
                        </Select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold">Sprint</span>
                        <Select value={editFields.sprint??''} onChange={e => setEditFields(f=>({...f,sprint:e.target.value}))} className="text-xs rounded-lg px-2 py-1.5">
                          <option value="" className="bg-[#0f0f0f] text-white">None</option>
                          {sprints.map(s => <option key={s} value={s!} className="bg-[#0f0f0f] text-white">{s}</option>)}
                        </Select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold">Priority</span>
                        <Select value={editFields.priority??''} onChange={e => setEditFields(f=>({...f,priority:e.target.value}))} className="text-xs rounded-lg px-2 py-1.5">
                          {PRIORITY_OPTIONS.map(p => <option key={p} value={p} className="bg-[#0f0f0f] text-white">{p}</option>)}
                        </Select>
                      </label>
                      <Button variant="primary" size="sm" onClick={handleSave} disabled={saving} loading={saving}>
                        {saving ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                  </div>
                )}
              </React.Fragment>
            ))}

            {!loading && filtered.length === 0 && (
              <div className="text-white/25 text-xs text-center py-8">
                {search ? 'No issues match your search' : 'No issues found'}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

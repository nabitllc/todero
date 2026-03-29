'use client'
import React, { useEffect, useState, useMemo, useRef } from 'react'
import { Search, ChevronUp, ChevronDown } from 'lucide-react'

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

const TYPE_COLORS: Record<string,string> = {
  feature:'#3b82f6', bug:'#ef4444', task:'#71717a', ops:'#f59e0b', epic:'#a855f7', subtask:'#64748b'
}
const PRIORITY_COLORS: Record<string,string> = {
  critical:'#ef4444', high:'#f97316', medium:'#3b82f6', low:'#27272a'
}
const STATUS_COLORS: Record<string,{bg:string;text:string}> = {
  open:{bg:'#27272a',text:'#a1a1aa'},
  backlog:{bg:'#27272a',text:'#a1a1aa'},
  in_progress:{bg:'#1e3a5f',text:'#60a5fa'},
  in_review:{bg:'#312e81',text:'#a78bfa'},
  done:{bg:'#064e3b',text:'#34d399'},
}
const ASSIGNEE_MAP: Record<string,{emoji:string;name:string}> = {
  main:{emoji:'🧠',name:'KAOS'}, builder:{emoji:'🔨',name:'Builder'},
  tester:{emoji:'🧪',name:'Tester'}, scout:{emoji:'🔍',name:'Scout'},
  ops:{emoji:'⚙️',name:'Ops'}, 'kemuni-sme':{emoji:'🚀',name:'Kemuni SME'},
  'vespera-sme':{emoji:'🖤',name:'Vespera SME'},
}

type SortKey = 'task_key'|'type'|'title'|'status'|'priority'|'assignee'|'sprint'
type SortDir = 'asc'|'desc'

export default function IssuesTab() {
  const [issues, setIssues] = useState<Issue[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('task_key')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [expandedId, setExpandedId] = useState<string|null>(null)
  const [editFields, setEditFields] = useState<Partial<Issue>>({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetch('/api/issues').then(r=>r.json()).then(d => {
      setIssues(Array.isArray(d) ? d : d.data ?? d)
    }).catch(()=>{}).finally(()=>setLoading(false))
  }, [])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    let list = issues
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
  }, [issues, search, sortKey, sortDir])

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

  const sprints = useMemo(() => Array.from(new Set(issues.map(i=>i.sprint).filter(Boolean))).sort().reverse(), [issues])

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <span className="text-zinc-700 ml-0.5"><ChevronUp size={10} /></span>
    return sortDir === 'asc'
      ? <span className="text-zinc-400 ml-0.5"><ChevronUp size={10} /></span>
      : <span className="text-zinc-400 ml-0.5"><ChevronDown size={10} /></span>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">Issues</h2>
          <p className="text-xs text-zinc-500 mt-0.5">{filtered.length} issues</p>
        </div>
        <div className="relative max-w-xs flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by title or key..."
            className="w-full pl-9 pr-3 py-2 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-300 placeholder:text-zinc-600 focus:outline-none focus:border-zinc-600"
          />
        </div>
      </div>

      <div className="rounded-2xl border border-zinc-800/60 overflow-hidden" style={{background:'#0f0f0f'}}>
        {loading && <div className="text-zinc-600 text-xs text-center py-8">Loading issues...</div>}

        {!loading && (
          <div className="overflow-x-auto">
            {/* Header */}
            <div className="hidden md:grid md:grid-cols-[80px_70px_1fr_100px_80px_90px_90px] gap-2 px-4 py-2.5 border-b border-zinc-800/60 bg-zinc-900/50">
              {([['task_key','Key'],['type','Type'],['title','Title'],['status','Status'],['priority','Pri'],['assignee','Assignee'],['sprint','Sprint']] as [SortKey,string][]).map(([key,label]) => (
                <button key={key} onClick={() => handleSort(key)}
                  className="flex items-center text-[10px] font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-300 transition-colors text-left">
                  {label}<SortIcon col={key} />
                </button>
              ))}
            </div>

            {/* Mobile header */}
            <div className="md:hidden grid grid-cols-[70px_1fr_80px] gap-2 px-3 py-2 border-b border-zinc-800/60 bg-zinc-900/50">
              {([['task_key','Key'],['title','Title'],['status','Status']] as [SortKey,string][]).map(([key,label]) => (
                <button key={key} onClick={() => handleSort(key)}
                  className="flex items-center text-[10px] font-semibold uppercase tracking-wider text-zinc-500 hover:text-zinc-300 text-left">
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
                  className={'hidden md:grid md:grid-cols-[80px_70px_1fr_100px_80px_90px_90px] gap-2 px-4 py-2.5 cursor-pointer transition-colors border-b border-zinc-800/30 ' +
                    (expandedId === issue.id ? 'bg-zinc-800/40' : 'hover:bg-zinc-900/80')}
                >
                  <span className="text-[11px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 w-fit">{issue.task_key??'—'}</span>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full w-fit border"
                    style={{background:(TYPE_COLORS[issue.type??'']??'#71717a')+'18', color:TYPE_COLORS[issue.type??'']??'#71717a', borderColor:(TYPE_COLORS[issue.type??'']??'#71717a')+'40'}}>
                    {issue.type??'task'}
                  </span>
                  <span className="text-xs text-zinc-300 truncate">{issue.title}</span>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full w-fit"
                    style={{background:(STATUS_COLORS[issue.status]?.bg??'#27272a'), color:(STATUS_COLORS[issue.status]?.text??'#a1a1aa')}}>
                    {(issue.status??'').replace(/_/g,' ')}
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2 h-2 rounded-full" style={{background:PRIORITY_COLORS[issue.priority??'']??'#3f3f46'}} />
                    <span className="text-[10px] text-zinc-500">{issue.priority??'—'}</span>
                  </span>
                  <span className="text-[10px] text-zinc-400">
                    {issue.assignee ? (ASSIGNEE_MAP[issue.assignee]?.emoji??'') + ' ' + (ASSIGNEE_MAP[issue.assignee]?.name??issue.assignee) : '—'}
                  </span>
                  <span className="text-[10px] text-zinc-500 font-mono">{issue.sprint??'—'}</span>
                </div>

                {/* Mobile row */}
                <div
                  onClick={() => handleExpand(issue.id)}
                  className={'md:hidden grid grid-cols-[70px_1fr_80px] gap-2 px-3 py-2.5 cursor-pointer transition-colors border-b border-zinc-800/30 ' +
                    (expandedId === issue.id ? 'bg-zinc-800/40' : 'hover:bg-zinc-900/80')}
                >
                  <span className="text-[10px] font-mono px-1 py-0.5 rounded bg-zinc-800 text-zinc-400 w-fit">{issue.task_key??'—'}</span>
                  <span className="text-[11px] text-zinc-300 truncate">{issue.title}</span>
                  <span className="text-[10px] font-medium px-2 py-0.5 rounded-full w-fit"
                    style={{background:(STATUS_COLORS[issue.status]?.bg??'#27272a'), color:(STATUS_COLORS[issue.status]?.text??'#a1a1aa')}}>
                    {(issue.status??'').replace(/_/g,' ')}
                  </span>
                </div>

                {/* Inline edit row */}
                {expandedId === issue.id && (
                  <div className="px-4 py-3 border-b border-zinc-800/30 bg-zinc-900/50">
                    <div className="flex flex-wrap gap-3 items-end">
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] text-zinc-500 uppercase font-semibold">Status</span>
                        <select value={editFields.status??''} onChange={e => setEditFields(f=>({...f,status:e.target.value}))}
                          className="bg-zinc-800 text-zinc-300 text-xs rounded-lg px-2 py-1.5 border border-zinc-700 focus:outline-none focus:border-zinc-500">
                          {STATUS_OPTIONS.map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] text-zinc-500 uppercase font-semibold">Assignee</span>
                        <select value={editFields.assignee??''} onChange={e => setEditFields(f=>({...f,assignee:e.target.value}))}
                          className="bg-zinc-800 text-zinc-300 text-xs rounded-lg px-2 py-1.5 border border-zinc-700 focus:outline-none focus:border-zinc-500">
                          <option value="">Unassigned</option>
                          {ASSIGNEE_OPTIONS.map(a => <option key={a} value={a}>{ASSIGNEE_MAP[a]?.name??a}</option>)}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] text-zinc-500 uppercase font-semibold">Sprint</span>
                        <select value={editFields.sprint??''} onChange={e => setEditFields(f=>({...f,sprint:e.target.value}))}
                          className="bg-zinc-800 text-zinc-300 text-xs rounded-lg px-2 py-1.5 border border-zinc-700 focus:outline-none focus:border-zinc-500">
                          <option value="">None</option>
                          {sprints.map(s => <option key={s} value={s!}>{s}</option>)}
                        </select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] text-zinc-500 uppercase font-semibold">Priority</span>
                        <select value={editFields.priority??''} onChange={e => setEditFields(f=>({...f,priority:e.target.value}))}
                          className="bg-zinc-800 text-zinc-300 text-xs rounded-lg px-2 py-1.5 border border-zinc-700 focus:outline-none focus:border-zinc-500">
                          {PRIORITY_OPTIONS.map(p => <option key={p} value={p}>{p}</option>)}
                        </select>
                      </label>
                      <button onClick={handleSave} disabled={saving}
                        className="px-4 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors disabled:opacity-50">
                        {saving ? 'Saving...' : 'Save'}
                      </button>
                    </div>
                  </div>
                )}
              </React.Fragment>
            ))}

            {!loading && filtered.length === 0 && (
              <div className="text-zinc-600 text-xs text-center py-8">
                {search ? 'No issues match your search' : 'No issues found'}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

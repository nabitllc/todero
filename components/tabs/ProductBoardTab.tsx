'use client'

import React, { useEffect, useState, useCallback } from 'react'
import type { Task } from '@/lib/issues'

// ── Constants ──────────────────────────────────────────────────────────────────

const STATUS_CHIP: Record<string, string> = {
  backlog:        'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  open:           'bg-blue-500/20 text-blue-400 border-blue-500/30',
  in_progress:    'bg-indigo-500/20 text-indigo-400 border-indigo-500/30',
  code_review:    'bg-orange-500/20 text-orange-400 border-orange-500/30',
  product_review: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  approved:       'bg-green-500/20 text-green-400 border-green-500/30',
  released:       'bg-teal-500/20 text-teal-400 border-teal-500/30',
  completed:      'bg-green-600/20 text-green-400 border-green-600/30',
  closed:         'bg-zinc-500/20 text-zinc-400 border-zinc-500/30',
  cancelled:      'bg-red-500/20 text-red-400 border-red-500/30',
}

const STATUS_ORDER = [
  'open','in_progress','code_review','product_review',
  'approved','released','completed','closed','cancelled','backlog',
]

const DONE_STATUSES = new Set(['completed','released','closed','cancelled'])

const TYPE_EMOJI: Record<string, string> = {
  feature:'✨', task:'🔧', bug:'🐛', ops:'⚙️', epic:'🎯', subtask:'↩️',
}

const ASSIGNEE_EMOJI: Record<string, string> = {
  main:'🧠', scout:'🔍', ops:'⚙️', 'kemuni-sme':'🚀', 'vespera-sme':'🖤',
  builder:'🔨', tester:'🧪', michael:'👤', designer:'🎨', auditor:'🔎',
  growth:'📈', po:'📋', ux:'🎨',
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function IssueRow({ task }: { task: Task }) {
  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-white/5 last:border-b-0 hover:bg-white/5 transition-colors">
      <span className="text-sm shrink-0">{TYPE_EMOJI[task.type ?? ''] ?? '📋'}</span>
      {task.task_key && (
        <span className="text-[9px] font-mono text-white/30 bg-white/10 px-1.5 py-0.5 rounded shrink-0">{task.task_key}</span>
      )}
      <p className="text-xs text-white/70 flex-1 truncate">{task.title}</p>
      <span className={`inline-block text-[9px] font-medium px-1.5 py-0.5 rounded-full border shrink-0 ${STATUS_CHIP[task.status] ?? 'bg-white/5 text-white/50 border-white/10'}`}>
        {task.status.replace(/_/g, ' ')}
      </span>
      {task.assignee && (
        <span className="text-[10px] text-white/40 shrink-0">{ASSIGNEE_EMOJI[task.assignee] ?? '👤'}</span>
      )}
    </div>
  )
}

function SprintSection({ sprint, issues, defaultOpen = true }: {
  sprint: string | null
  issues: Task[]
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  const done = issues.filter(t => DONE_STATUSES.has(t.status)).length
  const total = issues.length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0

  const label = sprint ? `Sprint ${sprint}` : '🗂 Backlog (No Sprint)'

  // Group by status order
  const grouped = STATUS_ORDER.flatMap(s => issues.filter(t => t.status === s))
  const ungrouped = issues.filter(t => !STATUS_ORDER.includes(t.status))
  const sorted = [...grouped, ...ungrouped]

  return (
    <div className="rounded-xl border border-white/10 overflow-hidden" style={{ background: '#080808' }}>
      {/* Header */}
      <button
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-white/5 transition-colors select-none text-left"
      >
        <span className="text-white/30 text-xs">{open ? '▾' : '▸'}</span>
        <span className="text-sm font-semibold text-white/80 flex-1">{label}</span>
        <span className="text-[10px] text-white/40 shrink-0">{total} issue{total !== 1 ? 's' : ''}</span>
        <span className="text-[10px] font-mono text-white/50 shrink-0">{done}/{total} done</span>
        <div className="w-20 h-1.5 rounded-full bg-white/10 overflow-hidden shrink-0">
          <div className="h-full rounded-full bg-green-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
        <span className="text-[10px] text-white/40 w-8 text-right shrink-0">{pct}%</span>
      </button>

      {/* Issue list */}
      {open && (
        <div className="border-t border-white/10">
          {sorted.length === 0 ? (
            <p className="text-xs text-white/30 px-4 py-3 italic">No issues</p>
          ) : (
            sorted.map(t => <IssueRow key={t.id} task={t} />)
          )}
        </div>
      )}
    </div>
  )
}

// ── Start Sprint Button ────────────────────────────────────────────────────────

export function StartSprintButton({ className = '' }: { className?: string }) {
  const [running, setRunning] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  const handleClick = async () => {
    if (running) return
    setRunning(true)
    try {
      const res = await fetch('/api/run-sprint', { method: 'POST' })
      if (res.ok) {
        setToast('✅ Sprint started!')
      } else {
        const txt = await res.text()
        setToast(`⚠️ ${txt.slice(0, 60)}`)
      }
    } catch (e: any) {
      setToast(`⚠️ ${e?.message ?? 'Error'}`)
    } finally {
      setRunning(false)
      setTimeout(() => setToast(null), 4000)
    }
  }

  return (
    <div className={`relative ${className}`}>
      <button
        onClick={handleClick}
        disabled={running}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-semibold transition-colors"
      >
        {running ? (
          <span className="animate-spin h-3 w-3 border-2 border-white/30 border-t-white rounded-full" />
        ) : (
          <span>▶</span>
        )}
        Start Sprint
      </button>
      {toast && (
        <div className="absolute top-full mt-2 left-0 z-50 bg-neutral-900 border border-white/10 text-xs text-white/80 rounded-lg px-3 py-2 whitespace-nowrap shadow-xl">
          {toast}
        </div>
      )}
    </div>
  )
}

// ── Main Tab ───────────────────────────────────────────────────────────────────

export default function ProductBoardTab() {
  const [issues, setIssues] = useState<Task[]>([])
  const [loading, setLoading] = useState(true)

  const fetchIssues = useCallback(async () => {
    try {
      const res = await fetch('/api/issues')
      if (res.ok) setIssues(await res.json())
    } catch { /* ignore */ }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { fetchIssues() }, [fetchIssues])

  // Next sprint time: 7am tomorrow (or today if it's before 7am)
  const nextSprintLabel = (() => {
    const now = new Date()
    const next = new Date(now)
    if (now.getHours() >= 7) next.setDate(next.getDate() + 1)
    next.setHours(7, 0, 0, 0)
    const diff = Math.round((next.getTime() - now.getTime()) / 60000)
    const h = Math.floor(diff / 60); const m = diff % 60
    return `Next: ${h > 0 ? `${h}h ` : ''}${m}m`
  })()

  // Group by sprint descending, null sprint last
  const sprintMap = new Map<string | null, Task[]>()
  for (const issue of issues) {
    const s = issue.sprint ?? null
    if (!sprintMap.has(s)) sprintMap.set(s, [])
    sprintMap.get(s)!.push(issue)
  }

  const sprintKeys = Array.from(sprintMap.keys())
  const sprints: (string | null)[] = sprintKeys
    .filter((s): s is string => s !== null)
    .sort()
    .reverse()

  if (sprintMap.has(null)) sprints.push(null)

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-white/30 text-sm gap-2">
        <span className="animate-spin h-4 w-4 border-2 border-white/20 border-t-white/60 rounded-full" />
        Loading sprints…
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Page header */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-white font-semibold text-base">Product Board</h1>
          <p className="text-white/30 text-xs mt-0.5">{sprints.filter(Boolean).length} sprint{sprints.filter(Boolean).length !== 1 ? 's' : ''} · {issues.length} total issues</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-[10px] text-white/30">{nextSprintLabel}</span>
          <StartSprintButton />
        </div>
      </div>

      {/* Sprint sections */}
      {sprints.length === 0 ? (
        <div className="rounded-xl border border-white/10 px-4 py-8 text-center text-white/30 text-sm" style={{ background: '#080808' }}>
          No issues found
        </div>
      ) : (
        sprints.map((sprint, i) => (
          <SprintSection
            key={sprint ?? '__backlog__'}
            sprint={sprint}
            issues={sprintMap.get(sprint) ?? []}
            defaultOpen={i === 0}
          />
        ))
      )}
    </div>
  )
}

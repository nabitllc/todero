import React from 'react'

export interface Issue {
  id: string
  task_key?: string
  title: string
  status: string
  priority?: string
  type?: string
  project?: string
  updated_at?: string
}

export interface ActivityItem {
  id: string
  task_key?: string
  title: string
  status: string
  project?: string
  updated_at?: string
}

export function statusColor(s: string) {
  if (s === 'in_progress') return 'text-amber-400'
  if (s === 'code_review' || s === 'product_review') return 'text-purple-400'
  if (s === 'open') return 'text-blue-400'
  if (['closed', 'completed', 'released', 'done'].includes(s)) return 'text-emerald-400'
  if (s === 'backlog') return 'text-white/30'
  return 'text-white/50'
}

export function priorityBadge(p: string | undefined) {
  if (!p) return null
  const cls = p === 'critical' ? 'bg-red-500/20 text-red-400 border-red-500/30'
    : p === 'high' ? 'bg-orange-500/20 text-orange-400 border-orange-500/30'
    : p === 'medium' ? 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
    : 'bg-white/5 text-white/40 border-white/10'
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded-full border font-semibold uppercase ${cls}`}>
      {p}
    </span>
  )
}

export function relTime(iso: string | undefined): string {
  if (!iso) return '—'
  const diff = Math.round((Date.now() - new Date(iso).getTime()) / 60000)
  if (diff < 1) return 'Just now'
  if (diff < 60) return `${diff}m ago`
  if (diff < 1440) return `${Math.round(diff / 60)}h ago`
  return `${Math.round(diff / 1440)}d ago`
}

export function statusVerb(s: string): string {
  const map: Record<string, string> = {
    open: 'opened', in_progress: 'started', code_review: 'sent for review',
    product_review: 'in product review', approved: 'approved',
    completed: 'completed', released: 'released', closed: 'closed',
    backlog: 'in backlog', defined: 'defined', cancelled: 'cancelled',
  }
  return map[s] ?? s.replace('_', ' ')
}

'use client'
import React from 'react'
import { Lock } from 'lucide-react'
import type { Task } from '@/lib/issues'

// ─── color maps ────────────────────────────────────────────────────────────────

const PRIORITY_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  critical: { bg: 'bg-red-500/20',    text: 'text-red-400',    label: 'Critical' },
  high:     { bg: 'bg-orange-500/20', text: 'text-orange-400', label: 'High'     },
  medium:   { bg: 'bg-yellow-500/20', text: 'text-yellow-400', label: 'Medium'   },
  low:      { bg: 'bg-zinc-500/20',   text: 'text-zinc-400',   label: 'Low'      },
}

const TYPE_BADGE: Record<string, { bg: string; text: string }> = {
  task:    { bg: 'bg-zinc-600/30',    text: 'text-zinc-300'   },
  bug:     { bg: 'bg-red-500/20',     text: 'text-red-400'    },
  feature: { bg: 'bg-blue-500/20',    text: 'text-blue-400'   },
  ops:     { bg: 'bg-amber-500/20',   text: 'text-amber-400'  },
  epic:    { bg: 'bg-purple-500/20',  text: 'text-purple-400' },
  subtask: { bg: 'bg-slate-600/30',   text: 'text-slate-300'  },
}

// no-invented-projects-sweep: 'kemuni-sme' (#3b82f6) and 'vespera-sme'
// (#a855f7) were entries in this map and in ASSIGNEE_INITIALS below. Neither
// agent exists. Both maps are keyed lookups with a fallback, so an id that is
// absent simply renders as the neutral unknown-assignee avatar.
const ASSIGNEE_COLORS: Record<string, string> = {
  main:         '#818cf8',
  scout:        '#3b82f6',
  ops:          '#f59e0b',
  builder:      '#f97316',
  tester:       '#22c55e',
  michael:      '#6b7280',
  designer:     '#ec4899',
  auditor:      '#14b8a6',
  growth:       '#10b981',
  po:           '#6366f1',
  ux:           '#ec4899',
}

const ASSIGNEE_INITIALS: Record<string, string> = {
  main:         'K',
  scout:        'S',
  ops:          'O',
  builder:      'B',
  tester:       'T',
  michael:      'M',
  designer:     'D',
  auditor:      'A',
  growth:       'G',
  po:           'P',
  ux:           'D',
}

// ─── helpers ───────────────────────────────────────────────────────────────────

function truncate(s: string, max = 60): string {
  return s.length > max ? s.slice(0, max).trimEnd() + '…' : s
}

// ─── component ─────────────────────────────────────────────────────────────────

export interface KanbanCardProps {
  task: Task
  dragging?: boolean
  onClick?: (task: Task) => void
  onDragStart?: (task: Task) => void
  onDragEnd?: (task: Task) => void
}

export function KanbanCard({ task, dragging, onClick, onDragStart, onDragEnd }: KanbanCardProps) {
  const assigneeKey = task.assignee?.toLowerCase() ?? ''
  const dotColor    = ASSIGNEE_COLORS[assigneeKey] ?? '#6b7280'
  const initials    = ASSIGNEE_INITIALS[assigneeKey]
    ?? (task.assignee?.slice(0, 2).toUpperCase() || '?')

  const priority = task.priority?.toLowerCase() ?? ''
  const pb       = PRIORITY_BADGE[priority]

  const type = task.type?.toLowerCase() ?? ''
  const tb   = TYPE_BADGE[type]

  return (
    <div
      draggable
      onDragStart={() => onDragStart?.(task)}
      onDragEnd={() => onDragEnd?.(task)}
      onClick={() => onClick?.(task)}
      className={[
        'group relative rounded-lg border cursor-pointer transition-colors bg-[#0f0f0f]',
        dragging ? 'opacity-50 border-zinc-600' : 'border-zinc-800 hover:border-zinc-700',
      ].join(' ')}
    >
      <div className="px-2.5 pt-2 pb-2 pr-8">
        {/* task key */}
        {task.task_key && (
          <div className="mb-1">
            <span className="text-[10px] font-mono font-bold text-white/40">{task.task_key}</span>
          </div>
        )}

        {/* title */}
        <p className="text-white text-xs font-medium leading-snug mb-2">
          {truncate(task.title)}
        </p>

        {/* badges row */}
        <div className="flex items-center gap-1 flex-wrap">
          {/* priority badge */}
          {pb && (
            <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${pb.bg} ${pb.text}`}>
              {pb.label}
            </span>
          )}

          {/* type badge */}
          {tb && (
            <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${tb.bg} ${tb.text} capitalize`}>
              {type}
            </span>
          )}

          {/* blocked indicator */}
          {(task.is_blocked || task.blocked_by) && (
            <Lock size={10} className="text-red-400 shrink-0" />
          )}
        </div>
      </div>

      {/* assignee avatar — bottom-right */}
      <div
        className="absolute bottom-1.5 right-1.5 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
        style={{ background: dotColor }}
        title={task.assignee ?? ''}
      >
        {initials}
      </div>
    </div>
  )
}

export default KanbanCard

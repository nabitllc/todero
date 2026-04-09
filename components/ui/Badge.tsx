'use client'
import React from 'react'

type PriorityVariant = 'critical' | 'high' | 'medium' | 'low'
type TypeVariant = 'feature' | 'task' | 'bug' | 'ops'
type StatusVariant = 'open' | 'in_progress' | 'code_review' | 'done' | 'backlog'

const priorityClasses: Record<PriorityVariant, string> = {
  critical: 'bg-red-500/20 text-red-400',
  high:     'bg-orange-500/20 text-orange-400',
  medium:   'bg-yellow-500/20 text-yellow-400',
  low:      'bg-green-500/20 text-green-400',
}

const typeClasses: Record<TypeVariant, string> = {
  feature: 'bg-purple-500/20 text-purple-400',
  task:    'bg-blue-500/20 text-blue-400',
  bug:     'bg-red-500/20 text-red-400',
  ops:     'bg-zinc-500/20 text-zinc-400',
}

const statusClasses: Record<StatusVariant, string> = {
  open:        'bg-white/10 text-white/60',
  in_progress: 'bg-blue-500/20 text-blue-400',
  code_review: 'bg-yellow-500/20 text-yellow-400',
  done:        'bg-green-500/20 text-green-400',
  backlog:     'bg-white/5 text-white/40',
}

interface BadgeProps {
  priority?: PriorityVariant
  type?: TypeVariant
  status?: StatusVariant
  label?: string
  className?: string
}

export function Badge({ priority, type, status, label, className = '' }: BadgeProps) {
  let colorClass = 'bg-white/10 text-white/70'
  let text = label || ''

  if (priority) {
    colorClass = priorityClasses[priority] || colorClass
    text = label || priority
  } else if (type) {
    colorClass = typeClasses[type] || colorClass
    text = label || type
  } else if (status) {
    colorClass = statusClasses[status] || colorClass
    text = label || status.replace(/_/g, ' ')
  }

  return (
    <span className={['text-xs px-2 py-0.5 rounded-full', colorClass, className].join(' ')}>
      {text}
    </span>
  )
}

// Convenience components
export function PriorityBadge({ value, className }: { value: string; className?: string }) {
  const v = value?.toLowerCase() as PriorityVariant
  return <Badge priority={v} className={className} />
}

export function TypeBadge({ value, className }: { value: string; className?: string }) {
  const v = value?.toLowerCase() as TypeVariant
  return <Badge type={v} className={className} />
}

export function StatusBadge({ value, className }: { value: string; className?: string }) {
  const v = value?.toLowerCase() as StatusVariant
  return <Badge status={v} className={className} />
}

export default Badge

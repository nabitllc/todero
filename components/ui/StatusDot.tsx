'use client'
import React from 'react'

type DotVariant = 'active' | 'idle' | 'warning' | 'error'

const dotClasses: Record<DotVariant, string> = {
  active:  'bg-green-400 animate-pulse',
  idle:    'bg-white/20',
  warning: 'bg-amber-400',
  error:   'bg-red-400',
}

interface StatusDotProps {
  variant?: DotVariant
  /** @deprecated use variant instead */
  status?: 'green' | 'amber' | 'grey' | 'active' | 'idle' | 'warning' | 'error'
  sm?: boolean
  className?: string
}

export function StatusDot({ variant, status, sm, className = '' }: StatusDotProps) {
  // Support legacy status prop used in page.tsx (dot: 'green'|'amber'|'grey')
  let resolvedVariant: DotVariant = variant || 'idle'
  if (!variant && status) {
    const map: Record<string, DotVariant> = {
      green: 'active', amber: 'warning', grey: 'idle', red: 'error',
      active: 'active', idle: 'idle', warning: 'warning', error: 'error',
    }
    resolvedVariant = map[status] || 'idle'
  }

  const size = sm ? 'w-1.5 h-1.5' : 'w-2 h-2'

  return (
    <span
      className={['rounded-full shrink-0', size, dotClasses[resolvedVariant], className].join(' ')}
    />
  )
}

export default StatusDot

'use client'
import React from 'react'
import { CheckCircle2, ExternalLink } from 'lucide-react'
import { Issue, statusColor, priorityBadge } from '@/lib/member-utils'

interface AssignedPanelProps {
  issues: Issue[]
  loading: boolean
  onNavigate?: (id: string) => void
}

export default function AssignedPanel({ issues, loading, onNavigate }: AssignedPanelProps) {
  if (loading) return (
    <p
      className="text-white/20 text-xs"
      aria-busy="true"
      aria-label="Loading assigned issues"
    >
      Loading…
    </p>
  )
  if (issues.length === 0) return (
    <p className="text-white/20 text-xs italic">No active issues assigned.</p>
  )

  return (
    <div className="space-y-2">
      {issues.slice(0, 15).map(issue => (
        <div
          key={issue.id}
          className="flex items-center gap-3 rounded-lg px-3 py-2 border border-white/10 bg-[#0f0f0f] group"
        >
          <CheckCircle2 size={12} className={statusColor(issue.status)} />
          <div className="flex-1 min-w-0">
            <p className="text-white/70 text-xs truncate">{issue.title}</p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {issue.task_key && (
                <span className="text-[9px] text-white/30 font-mono">{issue.task_key}</span>
              )}
              <span className={`text-[9px] ${statusColor(issue.status)}`}>
                {issue.status.replace('_', ' ')}
              </span>
              {issue.project && (
                <span className="text-[9px] text-white/20">{issue.project}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {priorityBadge(issue.priority)}
            {onNavigate && (
              <button
                onClick={() => onNavigate(issue.id)}
                className="opacity-0 group-hover:opacity-100 transition-opacity"
                title="View on board"
                aria-label={`View issue ${issue.task_key ?? issue.title} on board`}
              >
                <ExternalLink size={11} className="text-white/40 hover:text-white/70" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )
}

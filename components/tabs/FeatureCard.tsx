'use client'
import React from 'react'
import { Badge, PriorityBadge, StatusBadge } from '@/components/ui'

const PROJECT_COLORS: Record<string, string> = {
  Vespera: '#a855f7', Kemuni: '#3b82f6', 'Mission Control': '#10b981', Infrastructure: '#6b7280',
}

const ASSIGNEE_EMOJI: Record<string, string> = {
  builder: '🔨', kaos: '🧠', scout: '🔍', tester: '🧪', ops: '⚙️', nabit: '👤',
}

interface Issue {
  id: string; title: string; status: string; assignee?: string;
  task_key?: string; priority?: string;
  status_category?: 'Planned' | 'Ongoing' | 'SignOff' | 'Done' | null;
}

interface Feature {
  id: string; title: string; description?: string; project?: string;
  priority?: string; status: string; children: Issue[];
  acceptance_criteria?: string;
}

interface Props {
  feature: Feature
  expanded: boolean
  onToggle: () => void
  onViewIssues?: () => void
}

export default function FeatureCard({ feature, expanded, onToggle, onViewIssues }: Props) {
  const done = feature.children.filter(c => c.status_category === 'SignOff' || c.status_category === 'Done').length
  const total = feature.children.length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const projColor = PROJECT_COLORS[feature.project ?? ''] ?? '#6b7280'
  const acPending = 'Acceptance criteria pending — update before sprint.'
  const isReady = !!(feature.acceptance_criteria?.trim()) && feature.acceptance_criteria.trim() !== acPending

  return (
    <div className="rounded-xl border border-white/10 overflow-hidden bg-[#0f0f0f]">
      <button onClick={onToggle} className="w-full text-left px-4 py-3 hover:bg-white/5 transition-all">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-white text-sm font-medium truncate flex-1 min-w-0">{feature.title}</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0"
            style={{ background: projColor + '20', color: projColor, border: `1px solid ${projColor}30` }}>
            {feature.project}
          </span>
          {feature.priority && (
            <PriorityBadge value={feature.priority} />
          )}
          <StatusBadge value={feature.status} />
          <Badge
            label={isReady ? 'Ready' : 'Not Ready'}
            className={isReady
              ? 'bg-green-500/20 text-green-400 border border-green-500/30'
              : 'bg-amber-500/20 text-amber-400 border border-amber-500/30'}
          />
        </div>
        {feature.description && (
          <p className="text-white/40 text-xs mt-1.5 line-clamp-2">{feature.description}</p>
        )}
        <div className="mt-2.5 flex items-center gap-3">
          <div className="flex-1 rounded-full h-1.5 bg-white/5">
            <div className="h-1.5 rounded-full transition-all bg-green-400" style={{ width: pct + '%' }} />
          </div>
          <span className="text-white/40 text-[10px] shrink-0">{done}/{total}</span>
          {onViewIssues && (
            <button onClick={e => { e.stopPropagation(); onViewIssues() }}
              className="text-[10px] text-blue-400 hover:text-blue-300 px-1.5 py-0.5 rounded-lg hover:bg-white/5 transition-all shrink-0">
              View Issues →
            </button>
          )}
          <span className="text-white/25 text-[10px] shrink-0">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && feature.children.length > 0 && (
        <div className="border-t border-white/10 px-4 py-2 space-y-1.5">
          {feature.children.map(child => (
            <div key={child.id} className="flex items-center gap-2 py-1">
              {child.task_key && (
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-lg bg-white/5 text-white/40 shrink-0">
                  {child.task_key}
                </span>
              )}
              <span className="text-white/60 text-xs truncate flex-1 min-w-0">{child.title}</span>
              {child.assignee && (
                <span className="text-sm shrink-0" title={child.assignee}>
                  {ASSIGNEE_EMOJI[child.assignee.toLowerCase()] ?? '👤'}
                </span>
              )}
              <StatusBadge value={child.status} />
            </div>
          ))}
        </div>
      )}

      {expanded && feature.children.length === 0 && (
        <div className="border-t border-white/10 px-4 py-3">
          <p className="text-white/25 text-xs">No child issues</p>
        </div>
      )}
    </div>
  )
}

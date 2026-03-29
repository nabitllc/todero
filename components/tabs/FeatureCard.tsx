'use client'
import React from 'react'

const STATUS_COLORS: Record<string, { bg: string; text: string }> = {
  open: { bg: '#27272a', text: '#a1a1aa' },
  backlog: { bg: '#27272a', text: '#a1a1aa' },
  in_progress: { bg: '#1e3a5f', text: '#60a5fa' },
  in_review: { bg: '#312e81', text: '#a78bfa' },
  done: { bg: '#064e3b', text: '#34d399' },
  closed: { bg: '#064e3b', text: '#34d399' },
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#ef4444', high: '#f59e0b', medium: '#3b82f6', low: '#6b7280',
}

const PROJECT_COLORS: Record<string, string> = {
  Vespera: '#a855f7', Kemuni: '#3b82f6', 'Mission Control': '#10b981', Infrastructure: '#6b7280',
}

const ASSIGNEE_EMOJI: Record<string, string> = {
  builder: '🔨', kaos: '🧠', scout: '🔍', tester: '🧪', ops: '⚙️', nabit: '👤',
}

interface Issue {
  id: string; title: string; status: string; assignee?: string;
  task_key?: string; priority?: string;
}

interface Feature {
  id: string; title: string; description?: string; project?: string;
  priority?: string; status: string; children: Issue[];
}

interface Props {
  feature: Feature
  expanded: boolean
  onToggle: () => void
}

export default function FeatureCard({ feature, expanded, onToggle }: Props) {
  const done = feature.children.filter(c => c.status === 'done' || c.status === 'closed').length
  const total = feature.children.length
  const pct = total > 0 ? Math.round((done / total) * 100) : 0
  const sc = STATUS_COLORS[feature.status] ?? STATUS_COLORS.open
  const projColor = PROJECT_COLORS[feature.project ?? ''] ?? '#6b7280'

  return (
    <div className="rounded-xl border border-zinc-800/60 overflow-hidden" style={{ background: '#0f0f0f' }}>
      <button onClick={onToggle} className="w-full text-left px-4 py-3 hover:bg-zinc-800/30 transition-colors">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-white text-sm font-medium truncate flex-1 min-w-0">{feature.title}</span>
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0"
            style={{ background: projColor + '20', color: projColor, border: `1px solid ${projColor}30` }}>
            {feature.project}
          </span>
          {feature.priority && (
            <span className="w-2 h-2 rounded-full shrink-0"
              style={{ background: PRIORITY_COLORS[feature.priority] ?? '#6b7280' }} />
          )}
          <span className="text-[10px] px-2 py-0.5 rounded font-medium shrink-0"
            style={{ background: sc.bg, color: sc.text }}>
            {feature.status.replace('_', ' ')}
          </span>
        </div>
        {feature.description && (
          <p className="text-zinc-500 text-xs mt-1.5 line-clamp-2">{feature.description}</p>
        )}
        <div className="mt-2.5 flex items-center gap-3">
          <div className="flex-1 rounded-full h-1.5" style={{ background: '#1a1a1a' }}>
            <div className="h-1.5 rounded-full transition-all" style={{ width: pct + '%', background: '#10b981' }} />
          </div>
          <span className="text-zinc-500 text-[10px] shrink-0">{done}/{total}</span>
          <span className="text-zinc-600 text-[10px] shrink-0">{expanded ? '▲' : '▼'}</span>
        </div>
      </button>

      {expanded && feature.children.length > 0 && (
        <div className="border-t border-zinc-800/40 px-4 py-2 space-y-1.5">
          {feature.children.map(child => {
            const csc = STATUS_COLORS[child.status] ?? STATUS_COLORS.open
            return (
              <div key={child.id} className="flex items-center gap-2 py-1">
                {child.task_key && (
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 shrink-0">
                    {child.task_key}
                  </span>
                )}
                <span className="text-zinc-300 text-xs truncate flex-1 min-w-0">{child.title}</span>
                {child.assignee && (
                  <span className="text-sm shrink-0" title={child.assignee}>
                    {ASSIGNEE_EMOJI[child.assignee.toLowerCase()] ?? '👤'}
                  </span>
                )}
                <span className="text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0"
                  style={{ background: csc.bg, color: csc.text }}>
                  {child.status.replace('_', ' ')}
                </span>
              </div>
            )
          })}
        </div>
      )}

      {expanded && feature.children.length === 0 && (
        <div className="border-t border-zinc-800/40 px-4 py-3">
          <p className="text-zinc-600 text-xs">No child issues</p>
        </div>
      )}
    </div>
  )
}

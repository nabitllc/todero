'use client'

import React, { useState, useEffect } from 'react'

interface ActivityEvent {
  id: string
  icon: string
  actor_name: string
  actor_type: 'agent' | 'human' | 'system'
  description: string
  task_key: string | null
  issue_id: string
  timestamp: string
  ago_min: number
  event_type: string
  project: string | null
}

function agoLabel(min: number): string {
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m ago`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

const ACTOR_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  agent:  { bg: 'bg-purple-900/30', text: 'text-purple-300', border: 'border-purple-800/40' },
  human:  { bg: 'bg-blue-900/30',   text: 'text-blue-300',   border: 'border-blue-800/40'   },
  system: { bg: 'bg-white/10',      text: 'text-white/50',   border: 'border-white/20'       },
}

function ActorBadge({ type }: { type: 'agent' | 'human' | 'system' }) {
  const c = ACTOR_COLORS[type]
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0 border ${c.bg} ${c.text} ${c.border}`}>
      {type}
    </span>
  )
}

function EventRow({ event, isLast }: { event: ActivityEvent; isLast: boolean }) {
  const isAgent = event.actor_type === 'agent'
  return (
    <div className={`flex items-start gap-3 px-4 py-3 ${!isLast ? 'border-b border-white/10' : ''} ${isAgent ? 'bg-purple-950/10' : ''}`}>
      <span className="text-base shrink-0 mt-0.5">{event.icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-white text-xs font-medium">{event.actor_name}</span>
          <ActorBadge type={event.actor_type} />
          {event.task_key && (
            <a
              href={`/?issue=${event.task_key}`}
              className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/10 text-white/40 hover:text-white/70 hover:bg-white/15 transition-colors shrink-0"
              onClick={e => e.stopPropagation()}
            >
              {event.task_key}
            </a>
          )}
          <span className="ml-auto text-white/30 text-[10px] shrink-0">{agoLabel(event.ago_min)}</span>
        </div>
        <p className="text-white/50 text-[10px] mt-0.5 truncate">{event.description}</p>
      </div>
    </div>
  )
}

interface ActivityFeedProps {
  limit?: number
  projectFilter?: string | null
  onNavigate?: (tab: string) => void
  /** If provided, renders the feed inside a fixed-height scrollable container */
  maxHeight?: string
}

export default function ActivityFeed({ limit = 10, projectFilter, onNavigate, maxHeight }: ActivityFeedProps) {
  const [events, setEvents] = useState<ActivityEvent[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const params = new URLSearchParams({ limit: String(limit) })
    if (projectFilter) params.set('project', projectFilter)
    fetch(`/api/activity-feed?${params}`)
      .then(r => r.json())
      .then(data => { if (Array.isArray(data)) setEvents(data) })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [limit, projectFilter])

  const shown = events.slice(0, limit)

  return (
    <div>
      <div
        className="rounded-2xl border border-white/10 overflow-hidden bg-[#0f0f0f]"
        style={maxHeight ? { maxHeight, overflowY: 'auto' } : undefined}
      >
        {loading && (
          <p className="text-white/20 text-xs px-4 py-4">Loading activity...</p>
        )}
        {!loading && shown.length === 0 && (
          <p className="text-white/20 text-xs px-4 py-4">No recent activity</p>
        )}
        {shown.map((event, i) => (
          <EventRow key={event.id} event={event} isLast={i === shown.length - 1} />
        ))}
      </div>
      {!loading && events.length > limit && onNavigate && (
        <button
          onClick={() => onNavigate('activity')}
          className="mt-2 w-full text-center text-xs text-white/50 hover:text-white/70 py-2 rounded-lg border border-white/10 hover:border-white/20 transition-all bg-[#080808]"
        >
          View All Activity →
        </button>
      )}
    </div>
  )
}

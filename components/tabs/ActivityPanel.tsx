'use client'
import React from 'react'
import { Activity } from 'lucide-react'
import { ActivityItem, statusColor, statusVerb, relTime } from '@/lib/member-utils'

interface ActivityPanelProps {
  items: ActivityItem[]
  loading: boolean
}

export default function ActivityPanel({ items, loading }: ActivityPanelProps) {
  if (loading) return (
    <p
      className="text-white/20 text-xs"
      aria-busy="true"
      aria-label="Loading activity feed"
    >
      Loading…
    </p>
  )
  if (items.length === 0) return (
    <p className="text-white/20 text-xs italic">No recent activity.</p>
  )

  return (
    <div className="space-y-2">
      {items.map(item => (
        <div key={item.id} className="flex gap-3 rounded-lg px-3 py-2 border border-white/10 bg-[#0f0f0f]">
          <Activity size={12} className={`${statusColor(item.status)} mt-0.5 shrink-0`} />
          <div className="flex-1 min-w-0">
            <p className="text-white/70 text-xs truncate">
              {item.task_key && <span className="text-white/30 font-mono mr-1.5">{item.task_key}</span>}
              {item.title} → <span className={statusColor(item.status)}>{statusVerb(item.status)}</span>
            </p>
            <div className="flex items-center gap-1.5 mt-0.5">
              {item.project && <span className="text-[9px] text-white/20">{item.project}</span>}
              <span className="text-[9px] text-white/25">{relTime(item.updated_at)}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

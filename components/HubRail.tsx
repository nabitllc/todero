'use client'
// TOD-723: Left-rail circular hub icons with active indicator

import React, { useEffect, useState } from 'react'
import { fetchJson } from '@/hooks/useApiData'

interface Business { id: string; name: string; type: string; status: string }

const HUB_EMOJI: Record<string, string> = {
  'Vespera': '🖤', 'Kemuni': '🚀', 'Mission Control': '🧠', 'Todero': '🧠',
  'Infrastructure': '⚙️', 'KAOS': '🤖',
}

interface HubRailProps {
  selected: string | null
  onSelect: (name: string | null) => void
  refreshKey?: number
}

export default function HubRail({ selected, onSelect, refreshKey }: HubRailProps) {
  const [businesses, setBusinesses] = useState<Business[]>([])

  useEffect(() => {
    fetchJson<Business[]>('/api/businesses').then(r => {
      // TOD-654: never clear the rail on a refused request — keep what we had.
      if (r.ok && Array.isArray(r.data)) setBusinesses(r.data.filter((b: Business) => b.status === 'active'))
    })
  }, [refreshKey])

  return (
    <div className="py-2.5 px-3 border-b border-white/[0.07] flex items-center gap-1.5 overflow-x-auto scrollbar-none">
      {/* All hubs */}
      <button
        onClick={() => onSelect(null)}
        aria-label="All hubs"
        aria-pressed={selected === null}
        title="All hubs"
        className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm transition-all ${
          selected === null
            ? 'ring-2 ring-blue-500 bg-white/10'
            : 'bg-white/[0.05] hover:bg-white/10 ring-2 ring-transparent'
        }`}
      >
        🌐
      </button>

      {businesses.map(b => {
        const isActive = selected === b.name
        return (
          <button
            key={b.id}
            onClick={() => onSelect(b.name)}
            aria-label={b.name}
            aria-pressed={isActive}
            title={b.name}
            className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm transition-all ${
              isActive
                ? 'ring-2 ring-blue-500 bg-white/10'
                : 'bg-white/[0.05] hover:bg-white/10 ring-2 ring-transparent'
            }`}
          >
            {HUB_EMOJI[b.name] || '🏢'}
          </button>
        )
      })}
    </div>
  )
}

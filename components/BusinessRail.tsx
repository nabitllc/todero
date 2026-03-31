'use client'
import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'

interface Business { id: string; name: string; type: string; status: string }

const EMOJI: Record<string, string> = {
  'Vespera': '🖤', 'Kemuni': '🚀', 'Mission Control': '🧠', 'Todero': '🧠',
  'Infrastructure': '⚙️', 'KAOS': '🤖'
}

function getInitials(name: string) {
  return name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase()
}

interface Props {
  selected: string | null
  onSelect: (name: string | null) => void
  onNew: () => void
  refreshKey?: number
}

export default function BusinessRail({ selected, onSelect, onNew, refreshKey }: Props) {
  const [businesses, setBusinesses] = useState<Business[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)

  useEffect(() => {
    setLoading(true)
    setFetchError(false)
    fetch('/api/businesses')
      .then(r => r.json())
      .then(setBusinesses)
      .catch(() => setFetchError(true))
      .finally(() => setLoading(false))
  }, [refreshKey])

  return (
    <div className="flex flex-col items-center gap-2 w-14 min-h-screen bg-[#080808] border-r border-white/5 py-3 shrink-0 overflow-y-auto overflow-x-hidden">
      {/* MC-522: overflow-y-auto — rail scrolls on small phones instead of clipping under fixed nav */}
      {/* All */}
      <button
        onClick={() => onSelect(null)}
        title="All Businesses"
        aria-label="All Businesses"
        className={`w-10 h-10 rounded-full flex items-center justify-center text-xs font-bold transition-all focus:outline-none focus:ring-2 focus:ring-white/30
          ${selected === null ? 'bg-white text-black ring-2 ring-white' : 'bg-white/10 text-white/60 hover:bg-white/20'}`}
      >
        All
      </button>

      {/* Divider */}
      <div className="w-6 h-px bg-white/10 my-1" />

      {/* Loading skeleton */}
      {loading && (
        <>
          <div className="w-10 h-10 rounded-full bg-white/5 animate-pulse" />
          <div className="w-10 h-10 rounded-full bg-white/5 animate-pulse" />
          <div className="w-10 h-10 rounded-full bg-white/5 animate-pulse" />
        </>
      )}

      {/* Error state */}
      {!loading && fetchError && (
        <div className="w-10 h-10 rounded-full bg-white/5 flex items-center justify-center text-white/20 text-xs" title="Failed to load businesses">!</div>
      )}

      {/* Business list */}
      {!loading && businesses.filter(b => b.status === 'active').map(b => {
        const emoji = EMOJI[b.name]
        const isSelected = selected === b.name
        return (
          <div key={b.id} className="relative group">
            <button
              onClick={() => onSelect(b.name)}
              title={b.name}
              aria-label={b.name}
              className={`w-10 h-10 rounded-full flex items-center justify-center text-lg transition-all focus:outline-none focus:ring-2 focus:ring-white/30
                ${isSelected ? 'ring-2 ring-white rounded-2xl bg-[#1a1a1a]' : 'bg-[#0f0f0f] hover:rounded-2xl'}`}
            >
              {emoji || <span className="text-xs font-bold text-white/60">{getInitials(b.name)}</span>}
            </button>
            {/* Tooltip */}
            <div className="absolute left-14 top-1/2 -translate-y-1/2 bg-[#080808] text-white text-xs px-2 py-1 rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none z-50 border border-white/10">
              {b.name}
            </div>
          </div>
        )
      })}

      {/* Spacer */}
      <div className="flex-1" />

      {/* New business */}
      <button
        onClick={onNew}
        title="Add Business"
        aria-label="Add Business"
        className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/15 flex items-center justify-center text-white/40 hover:text-white transition-all focus:outline-none focus:ring-2 focus:ring-white/30"
      >
        <Plus size={18} />
      </button>
    </div>
  )
}

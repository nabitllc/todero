'use client'
// TOD-1035/TOD-1197: Hub switcher — select active business context
// Desktop: rendered in SidebarNav below wordmark
// Mobile: rendered in More menu (TOD-1197)

import React, { useState, useEffect, useRef } from 'react'
import { ChevronDown, Plus, Check } from 'lucide-react'

interface Business { id: string; name: string; type: string; status: string }

const HUB_EMOJI: Record<string, string> = {
  'Vespera': '🖤', 'Kemuni': '🚀', 'Mission Control': '🧠', 'Todero': '🧠',
  'Infrastructure': '⚙️', 'KAOS': '🤖',
}

interface HubSwitcherProps {
  selected: string | null
  onSelect: (name: string | null) => void
  onNew: () => void
  refreshKey?: number
}

export default function HubSwitcher({ selected, onSelect, onNew, refreshKey }: HubSwitcherProps) {
  const [open, setOpen] = useState(false)
  const [businesses, setBusinesses] = useState<Business[]>([])
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/businesses')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setBusinesses(data.filter((b: Business) => b.status === 'active'))
      })
      .catch(() => {})
  }, [refreshKey])

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const label = selected
    ? (HUB_EMOJI[selected] ? `${HUB_EMOJI[selected]} ${selected}` : selected)
    : 'All hubs'

  return (
    <div ref={ref} className="relative px-2">
      <button
        onClick={() => setOpen(v => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Hub: ${label}`}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left transition-all hover:bg-white/[0.05] border border-white/[0.06]"
      >
        <span className="text-xs font-medium flex-1 truncate text-white/60">{label}</span>
        <ChevronDown
          size={12}
          className={`shrink-0 text-white/30 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="Select hub"
          className="absolute left-2 right-2 bottom-full mb-1.5 bg-[#111] border border-white/10 rounded-xl shadow-2xl z-50 overflow-hidden"
        >
          {/* All hubs */}
          <button
            role="option"
            aria-selected={selected === null}
            onClick={() => { onSelect(null); setOpen(false) }}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-xs hover:bg-white/[0.05] transition-colors"
          >
            <span className="text-base leading-none">🌐</span>
            <span className="flex-1 text-left text-white/70">All hubs</span>
            {selected === null && <Check size={11} className="text-white/50 shrink-0" />}
          </button>

          {/* Business list */}
          {businesses.map(b => (
            <button
              key={b.id}
              role="option"
              aria-selected={selected === b.name}
              onClick={() => { onSelect(b.name); setOpen(false) }}
              className="w-full flex items-center gap-2 px-3 py-2.5 text-xs hover:bg-white/[0.05] transition-colors"
            >
              <span className="text-base leading-none">{HUB_EMOJI[b.name] || '🏢'}</span>
              <span className="flex-1 text-left text-white/70 truncate">{b.name}</span>
              {selected === b.name && <Check size={11} className="text-white/50 shrink-0" />}
            </button>
          ))}

          {/* New hub */}
          <div className="border-t border-white/[0.07] mt-0.5" />
          <button
            onClick={() => { onNew(); setOpen(false) }}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-xs hover:bg-white/[0.05] transition-colors text-white/35 hover:text-white/55"
          >
            <Plus size={12} className="shrink-0" />
            <span>New hub</span>
          </button>
        </div>
      )}
    </div>
  )
}

'use client'
// components/nav/MobileNav.tsx — TOD-2381 (nav-six-destinations)
// Mobile bottom bar: exactly the six destinations, no "more" menu — six is
// the number that finally fits (nav-six-destinations piece, build
// instruction 6). Chat is reached via the TopBar chat icon / QuickActionFab,
// not a bottom-bar slot, because it is an overlay, not a destination.

import React from 'react'
import { Home, Kanban, Users2, ListTree, Brain, Settings as SettingsIcon } from 'lucide-react'
import type { DestinationId } from './config'
import { DESTINATIONS } from './config'

const ICONS: Record<DestinationId, React.ElementType> = {
  now: Home,
  work: Kanban,
  fleet: Users2,
  runs: ListTree,
  memory: Brain,
  settings: SettingsIcon,
}

interface Props {
  destination: DestinationId
  onSelectDestination: (id: DestinationId) => void
  /** Real /api/inbox?status=pending count, shown on Now only when > 0. */
  needsYou: number | null
}

export default function MobileNav({ destination, onSelectDestination, needsYou }: Props) {
  return (
    <nav
      className="lg:hidden fixed bottom-0 pb-[env(safe-area-inset-bottom,16px)] left-0 right-0 z-50 bg-neutral-950 border-t border-white/10 grid grid-cols-6"
    >
      {DESTINATIONS.map(d => {
        const Icon = ICONS[d.id]
        const active = destination === d.id
        const showBadge = d.id === 'now' && needsYou !== null && needsYou > 0
        return (
          <button
            key={d.id}
            onClick={() => onSelectDestination(d.id)}
            aria-label={d.label}
            aria-current={active ? 'page' : undefined}
            className={'relative flex flex-col items-center justify-center gap-0.5 py-2 min-w-0 text-xs transition-colors min-h-[44px] ' + (active ? 'text-white' : 'text-white/70')}
          >
            <Icon size={18} />
            <span className="text-xs">{d.label}</span>
            {showBadge && (
              <span className="absolute top-1 right-1/4 font-mono text-xs font-bold bg-amber-500 text-black rounded-full px-1 leading-tight">
                {needsYou! > 9 ? '9+' : needsYou}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}

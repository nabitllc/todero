'use client'
// components/nav/PrimaryNav.tsx — TOD-2381 (nav-six-destinations)
// Desktop sidebar: six destinations + Chat entry (opens the overlay, never
// navigates). Replaces the old flat 20-item SidebarNav for the primary nav
// role. CLAUDE.md "Layout Integrity" invariant: `hidden lg:flex` here pairs
// with the `lg:hidden` phone nav in MobileNav.tsx — the two must switch over
// at the same breakpoint or a tablet-width viewport shows both at once. See
// the builder report for why this piece keeps the existing `lg:` breakpoint
// pair instead of CLAUDE.md's literal `md:flex` text.

import React from 'react'
import { Home, Kanban, Users2, ListTree, Brain, Settings as SettingsIcon, MessageSquare } from 'lucide-react'
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

export interface NavBadges {
  /** Real /api/inbox?status=pending count — Now absorbs Inbox. Never shown as 0. */
  needsYou: number | null
  /** Real count of liveAgents with liveness === 'live'. null = roster not loaded yet. */
  fleetLive: number | null
  /** Real issue total (project-scoped when a project is selected, else global). */
  workIssues: number | null
  /** Real memFiles.length. null = not loaded / refused. */
  memoryFiles: number | null
}

interface Props {
  destination: DestinationId
  onSelectDestination: (id: DestinationId) => void
  onOpenChat: () => void
  badges: NavBadges
  /** Real /api/status ollama block — never a fabricated "Dispatch on/off" pill. */
  ollama: { running: boolean; model: string | null } | null
  clock?: string
}

function badgeFor(destId: DestinationId, badges: NavBadges): { text: string; tone: 'amber' | 'dim' } | null {
  if (destId === 'now') return badges.needsYou && badges.needsYou > 0 ? { text: String(badges.needsYou), tone: 'amber' } : null
  if (destId === 'fleet') return badges.fleetLive !== null ? { text: String(badges.fleetLive), tone: 'dim' } : null
  if (destId === 'work') return badges.workIssues !== null ? { text: String(badges.workIssues), tone: 'dim' } : null
  if (destId === 'memory') return badges.memoryFiles !== null ? { text: String(badges.memoryFiles), tone: 'dim' } : null
  if (destId === 'runs') return { text: 'new', tone: 'dim' }
  return null
}

export default function PrimaryNav({ destination, onSelectDestination, onOpenChat, badges, ollama, clock }: Props) {
  return (
    <aside className="w-52 shrink-0 hidden lg:flex flex-col border-r border-white/[0.07] sticky top-0 h-screen bg-[#080808]">
      <div className="h-12 flex items-center border-b border-white/[0.07] shrink-0 px-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center text-sm font-bold text-white shrink-0">T</div>
          <div className="min-w-0">
            <p className="text-white text-xs font-semibold leading-tight tracking-wide">Todero</p>
            <p className="text-white/25 text-[9px] leading-tight">Mission Control</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
        <p className="px-2 mb-1 text-[9px] font-semibold uppercase tracking-widest text-white/20 select-none">Primary</p>
        {DESTINATIONS.map(d => {
          const Icon = ICONS[d.id]
          const active = destination === d.id
          const badge = badgeFor(d.id, badges)
          return (
            <button
              key={d.id}
              onClick={() => onSelectDestination(d.id)}
              aria-label={d.label}
              aria-current={active ? 'page' : undefined}
              className={[
                'w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left transition-colors',
                active ? 'bg-blue-500/10 border border-blue-500/25 text-white' : 'text-white/60 hover:text-white hover:bg-white/[0.05] border border-transparent',
              ].join(' ')}
            >
              <Icon size={16} className={active ? 'text-blue-400' : 'text-white/45'} />
              <span className="text-[13px] font-medium flex-1 truncate">{d.label}</span>
              {badge && (
                <span
                  className={[
                    'text-[10px] font-mono font-medium rounded-full px-1.5 py-0.5 leading-none',
                    badge.tone === 'amber' ? 'bg-amber-500 text-black' : 'text-white/40',
                  ].join(' ')}
                >
                  {badge.text}
                </span>
              )}
            </button>
          )
        })}

        <div className="h-px bg-white/[0.08] mx-1.5 my-3" />

        <button
          onClick={onOpenChat}
          aria-label="Chat (⌘J)"
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left border border-dashed border-white/15 text-white/55 hover:text-white hover:bg-white/[0.05] transition-colors"
        >
          <MessageSquare size={15} className="text-white/45" />
          <span className="text-[12.5px] font-medium flex-1 truncate">Chat</span>
          <kbd className="text-[9.5px] font-mono text-white/35 border border-white/15 rounded px-1 py-0.5">⌘J</kbd>
        </button>
        <p className="px-2.5 pt-1.5 text-[9.5px] leading-snug text-white/30">opens over whatever you are looking at, and carries it as context</p>
      </nav>

      <div className="px-3 py-3 border-t border-white/[0.07] shrink-0 space-y-1">
        {ollama ? (
          <div className="flex items-center gap-1.5" title="From /api/status">
            <span className={`w-1.5 h-1.5 rounded-full ${ollama.running ? 'bg-emerald-500' : 'bg-zinc-500'}`} />
            <span className="text-white/40 text-[10px] font-mono truncate">
              {ollama.running ? (ollama.model ?? 'ollama running') : 'ollama offline'}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
            <span className="text-white/30 text-[10px] font-mono">status unknown</span>
          </div>
        )}
        {clock && <p className="text-white/20 text-[10px] font-mono">{clock}</p>}
      </div>
    </aside>
  )
}

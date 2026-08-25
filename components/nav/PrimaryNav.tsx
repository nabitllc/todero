'use client'
// components/nav/PrimaryNav.tsx — TOD-2381 (nav-six-destinations)
// Desktop sidebar: six destinations + Chat entry (opens the overlay, never
// navigates). Replaces the old flat 20-item SidebarNav for the primary nav
// role. CLAUDE.md "Layout Integrity" invariant: `hidden lg:flex` here pairs
// with the `lg:hidden` phone nav in MobileNav.tsx — the two must switch over
// at the same breakpoint or a tablet-width viewport shows both at once. See
// the builder report for why this piece keeps the existing `lg:` breakpoint
// pair instead of CLAUDE.md's literal `md:flex` text.

import React, { useEffect, useRef, useState } from 'react'
import { Home, Kanban, Users2, ListTree, Brain, Settings as SettingsIcon, MessageSquare, ChevronDown } from 'lucide-react'
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

interface HubRow { id: string; name: string }

interface Props {
  destination: DestinationId
  onSelectDestination: (id: DestinationId) => void
  onOpenChat: () => void
  badges: NavBadges
  /** Real /api/status ollama block — never a fabricated "Dispatch on/off" pill. */
  ollama: { running: boolean; model: string | null } | null
  clock?: string
  /**
   * cards-and-identity piece (Wave 6, owner correction): the current HUB —
   * Slack-workspace equivalent, per the owner's own words ("Left pane has
   * 'Workspace'... Todero 'Hub' should be similar to Slack 'Workspace'").
   * Real name (e.g. "Limiglow"), or null before the app has resolved one.
   * This is the SAME scope value the rest of the app calls `selectedProject`
   * — there is exactly one hub-selection entry point (app/page.tsx's
   * `selectProject`), and this header and the rail (BusinessRail.tsx) are
   * its two on-screen affordances, not two independent switchers.
   */
  hub: string | null
  /** Real hub rows this account can switch between. null = not loaded yet. Today this is always length 1 (Limiglow) — multi-hub membership is explicitly post-MVP; this list is what makes "a second hub would simply appear" true without new UI later. */
  hubs: HubRow[] | null
  onSelectHub: (name: string) => void
}

function badgeFor(destId: DestinationId, badges: NavBadges): { text: string; tone: 'amber' | 'dim' } | null {
  if (destId === 'now') return badges.needsYou && badges.needsYou > 0 ? { text: String(badges.needsYou), tone: 'amber' } : null
  if (destId === 'fleet') return badges.fleetLive !== null ? { text: String(badges.fleetLive), tone: 'dim' } : null
  if (destId === 'work') return badges.workIssues !== null ? { text: String(badges.workIssues), tone: 'dim' } : null
  if (destId === 'memory') return badges.memoryFiles !== null ? { text: String(badges.memoryFiles), tone: 'dim' } : null
  if (destId === 'runs') return { text: 'new', tone: 'dim' }
  return null
}

export default function PrimaryNav({ destination, onSelectDestination, onOpenChat, badges, ollama, clock, hub, hubs, onSelectHub }: Props) {
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const switcherRef = useRef<HTMLDivElement>(null)
  const canSwitch = !!hubs && hubs.length > 1

  useEffect(() => {
    if (!switcherOpen) return
    const onClick = (e: MouseEvent) => {
      if (switcherRef.current && !switcherRef.current.contains(e.target as Node)) setSwitcherOpen(false)
    }
    document.addEventListener('mousedown', onClick)
    return () => document.removeEventListener('mousedown', onClick)
  }, [switcherOpen])

  return (
    <aside className="w-52 shrink-0 hidden lg:flex flex-col border-r border-white/[0.07] sticky top-0 h-screen bg-[#080808]">
      {/*
        cards-and-identity piece (Wave 6, owner correction): this used to be
        a second, redundant "Todero" wordmark — TopBar (out of this piece's
        ownership) already carries that brand, top-left, and never changes.
        This slot is the HUB — the current workspace ("Limiglow"), with a
        switcher when the account belongs to more than one. Todero the tool
        is not a hub and does not belong here.
      */}
      <div ref={switcherRef} className="h-12 flex items-center border-b border-white/[0.07] shrink-0 px-3 relative">
        <button
          onClick={() => canSwitch && setSwitcherOpen(o => !o)}
          aria-haspopup="listbox"
          aria-expanded={switcherOpen}
          aria-label={hub ? `Hub: ${hub}${canSwitch ? ' — switch hub' : ''}` : 'Hub — resolving'}
          className={`flex items-center gap-2.5 min-w-0 w-full text-left ${canSwitch ? 'cursor-pointer' : 'cursor-default'}`}
        >
          <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center text-sm font-bold text-white shrink-0">
            {hub ? hub.charAt(0).toUpperCase() : '—'}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-white text-xs font-semibold leading-tight tracking-wide truncate">{hub ?? 'Resolving hub…'}</p>
            <p className="text-white/60 text-xs leading-tight">Hub</p>
          </div>
          {canSwitch && <ChevronDown size={14} className="text-white/40 shrink-0" />}
        </button>
        {switcherOpen && hubs && (
          <div role="listbox" aria-label="Switch hub" className="absolute left-2 right-2 top-full mt-1 z-30 rounded-lg border border-white/10 bg-[#0f0f0f] shadow-xl overflow-hidden">
            {hubs.map(h => (
              <button
                key={h.id}
                role="option"
                aria-selected={h.name === hub}
                onClick={() => { onSelectHub(h.name); setSwitcherOpen(false) }}
                className={`w-full text-left px-3 py-2 text-xs font-medium transition-colors ${h.name === hub ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/[0.06] hover:text-white'}`}
              >
                {h.name}
              </button>
            ))}
          </div>
        )}
      </div>

      <nav className="flex-1 py-3 px-2 space-y-1 overflow-y-auto">
        <p className="px-2 mb-1 text-xs font-semibold uppercase tracking-widest text-white/60 select-none">Primary</p>
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
                    'text-xs font-mono font-medium rounded-full px-1.5 py-0.5 leading-none',
                    badge.tone === 'amber' ? 'bg-amber-500 text-black' : 'text-white/75',
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
          className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left border border-dashed border-white/15 text-white/70 hover:text-white hover:bg-white/[0.05] transition-colors"
        >
          <MessageSquare size={15} className="text-white/45" />
          <span className="text-[12.5px] font-medium flex-1 truncate">Chat</span>
          <kbd className="text-xs font-mono text-white/60 border border-white/15 rounded px-1 py-0.5">⌘J</kbd>
        </button>
        <p className="px-2.5 pt-1.5 text-xs leading-snug text-white/60">opens over whatever you are looking at, and carries it as context</p>
      </nav>

      <div className="px-3 py-3 border-t border-white/[0.07] shrink-0 space-y-1">
        {ollama ? (
          <div className="flex items-center gap-1.5" title="From /api/status">
            <span className={`w-1.5 h-1.5 rounded-full ${ollama.running ? 'bg-emerald-500' : 'bg-zinc-500'}`} />
            <span className="text-white/75 text-xs font-mono truncate">
              {ollama.running ? (ollama.model ?? 'ollama running') : 'ollama offline'}
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
            <span className="text-white/60 text-xs font-mono">status unknown</span>
          </div>
        )}
        {clock && <p className="text-white/60 text-xs font-mono">{clock}</p>}
      </div>
    </aside>
  )
}

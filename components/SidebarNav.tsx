'use client'
// TOD-538: Grouped sidebar navigation — replaces flat NAV list in page.tsx

import React from 'react'
import {
  LayoutDashboard, Activity, Users, CalendarDays, Building2, Brain,
  Kanban, Map, List, FileStack, GitBranch,
  Zap, MessageSquare, Server, Settings,
} from 'lucide-react'
import { Dot } from '@/lib/mc-atoms'
import HubSwitcher from '@/components/HubSwitcher'

// ── Nav group definition ────────────────────────────────────────────────────
interface NavItem {
  id: string
  label: string
  icon: React.ElementType
}
interface NavGroup {
  label: string
  items: NavItem[]
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Monitor',
    items: [
      { id: 'overview',  label: 'Overview',  icon: LayoutDashboard },
      { id: 'activity',  label: 'Activity',  icon: Activity },
    ],
  },
  {
    label: 'Team',
    items: [
      { id: 'team',      label: 'Team',      icon: Users },
      { id: 'office',    label: 'Office',    icon: Building2 },
      { id: 'calendar',  label: 'Calendar',  icon: CalendarDays },
    ],
  },
  {
    label: 'Work',
    items: [
      { id: 'board',         label: 'Board',         icon: Kanban },
      { id: 'features',      label: 'Features',      icon: Map },
      { id: 'issues',        label: 'Issues',        icon: List },
      { id: 'product-board', label: 'Product',       icon: FileStack },
      { id: 'pipeline',      label: 'Pipeline',      icon: GitBranch },
    ],
  },
  {
    label: 'Intel',
    items: [
      { id: 'memory',  label: 'Memory',  icon: Brain },
      { id: 'chat',    label: 'Chat',    icon: MessageSquare },
    ],
  },
  {
    label: 'System',
    items: [
      { id: 'automations', label: 'Automations', icon: Zap },
      { id: 'infra',       label: 'Infra',       icon: Server },
      { id: 'settings',    label: 'Settings',    icon: Settings },
    ],
  },
]

// ── Props ───────────────────────────────────────────────────────────────────
interface SidebarNavProps {
  tab: string
  navigate: (tab: string) => void
  unreadChat?: boolean
  setUnreadChat?: (v: boolean) => void
  clock?: string
  onSearchOpen?: () => void
  // TOD-1035: Hub switcher props
  selectedBusiness?: string | null
  onSelectBusiness?: (name: string | null) => void
  onNewBusiness?: () => void
  businessRailRefresh?: number
}

// ── Component ────────────────────────────────────────────────────────────────
export default function SidebarNav({
  tab,
  navigate,
  unreadChat = false,
  setUnreadChat,
  clock,
  selectedBusiness,
  onSelectBusiness,
  onNewBusiness,
  businessRailRefresh,
}: SidebarNavProps) {
  return (
    <aside className="w-52 shrink-0 hidden lg:flex flex-col border-r border-white/[0.07] sticky top-0 h-screen bg-[#080808]">
      {/* Wordmark */}
      <div className="px-4 h-12 flex items-center border-b border-white/[0.07] shrink-0">
        <div className="flex items-center gap-2.5">
          <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center text-sm font-bold text-white">N</div>
          <div>
            <p className="text-white text-xs font-semibold leading-tight tracking-wide">Todero</p>
            <p className="text-white/25 text-[9px] leading-tight">Mission Control</p>
          </div>
        </div>
      </div>

      {/* TOD-1035: Hub switcher — desktop */}
      {onSelectBusiness !== undefined && onNewBusiness !== undefined && (
        <div className="py-2 border-b border-white/[0.07]">
          <HubSwitcher
            selected={selectedBusiness ?? null}
            onSelect={onSelectBusiness}
            onNew={onNewBusiness}
            refreshKey={businessRailRefresh}
          />
        </div>
      )}

      {/* Nav groups */}
      <nav className="flex-1 py-3 px-2 space-y-4 overflow-y-auto">
        {NAV_GROUPS.map(group => (
          <div key={group.label}>
            {/* Section label */}
            <p className="px-3 mb-1 text-[9px] font-semibold uppercase tracking-widest text-white/20 select-none">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map(item => {
                const isActive = tab === item.id
                const Icon = item.icon
                const isChat = item.id === 'chat'
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      navigate(item.id)
                      if (isChat && setUnreadChat) setUnreadChat(false)
                    }}
                    className={
                      'w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-left transition-all duration-150 ' +
                      (isActive
                        ? 'bg-white/10 text-white'
                        : 'text-white/40 hover:text-white/70 hover:bg-white/[0.05]')
                    }
                  >
                    <Icon
                      size={14}
                      className={`shrink-0 ${isActive ? 'text-white' : 'text-white/35'}`}
                    />
                    <span className={`text-xs font-medium ${isActive ? 'text-white' : ''}`}>
                      {item.label}
                    </span>
                    {/* Unread chat dot */}
                    {isChat && unreadChat && !isActive && (
                      <span className="ml-auto w-1.5 h-1.5 rounded-full bg-red-500 shrink-0 animate-pulse" />
                    )}
                    {/* Active indicator */}
                    {isActive && (
                      <span className="ml-auto w-1 h-4 rounded-full bg-white/60 shrink-0" />
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-white/[0.07] space-y-1 shrink-0">
        <div className="flex items-center gap-1.5">
          <Dot status="active" sm />
          <span className="text-white/25 text-[10px]">All nominal</span>
        </div>
        {clock && <p className="text-white/20 text-[10px] font-mono">{clock}</p>}
      </div>
    </aside>
  )
}

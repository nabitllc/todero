'use client'
// TOD-538: Grouped sidebar navigation — replaces flat NAV list in page.tsx
// TOD-2234: Collapsible icon-only mode, active accent, section collapse, Inbox badge

import React, { useState, useEffect, useCallback } from 'react'
import {
  LayoutDashboard, Activity, Users, CalendarDays, Building2, Brain,
  Kanban, Map, List, FileStack, GitBranch,
  Zap, MessageSquare, Server, Settings, Inbox,
  ChevronLeft, ChevronRight, ChevronDown, ChevronUp,
} from 'lucide-react'
import { Dot } from '@/lib/mc-atoms'

// ── Nav group definition ────────────────────────────────────────────────────
interface NavItem {
  id: string
  label: string
  icon: React.ElementType
  isInbox?: boolean
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
      { id: 'inbox',   label: 'Inbox',   icon: Inbox, isInbox: true },
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

// ── localStorage helpers ─────────────────────────────────────────────────────
const LS_COLLAPSED = 'sidebar_collapsed'
const LS_SECTIONS  = 'sidebar_sections_collapsed'

function readLSBool(key: string, fallback: boolean): boolean {
  if (typeof window === 'undefined') return fallback
  const v = localStorage.getItem(key)
  return v === null ? fallback : v === 'true'
}

function readLSSections(): Record<string, boolean> {
  if (typeof window === 'undefined') return {}
  try { return JSON.parse(localStorage.getItem(LS_SECTIONS) || '{}') }
  catch { return {} }
}

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

// ── Tooltip (icon-only mode) ─────────────────────────────────────────────────
function NavTooltip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="relative group/tip">
      {children}
      <div className="pointer-events-none absolute left-full top-1/2 -translate-y-1/2 ml-2 z-50 px-2 py-1 rounded-md bg-neutral-800 border border-white/10 text-white text-xs whitespace-nowrap opacity-0 group-hover/tip:opacity-100 transition-opacity duration-100">
        {label}
      </div>
    </div>
  )
}

// ── Component ────────────────────────────────────────────────────────────────
export default function SidebarNav({
  tab,
  navigate,
  unreadChat = false,
  setUnreadChat,
  clock,
}: SidebarNavProps) {
  const [collapsed, setCollapsed]               = useState(false)
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>({})
  const [inboxCount, setInboxCount]             = useState(0)
  const [mounted, setMounted]                   = useState(false)

  // Hydrate persisted state after mount to avoid SSR mismatch
  useEffect(() => {
    setCollapsed(readLSBool(LS_COLLAPSED, false))
    setCollapsedSections(readLSSections())
    setMounted(true)
  }, [])

  // Poll inbox pending count
  const fetchInboxCount = useCallback(async () => {
    try {
      const res = await fetch('/api/inbox?status=pending')
      if (res.ok) {
        const data = await res.json()
        setInboxCount(Array.isArray(data) ? data.length : 0)
      }
    } catch { /* non-blocking */ }
  }, [])

  useEffect(() => {
    fetchInboxCount()
    const iv = setInterval(fetchInboxCount, 30000)
    return () => clearInterval(iv)
  }, [fetchInboxCount])

  const toggleCollapsed = () => {
    const next = !collapsed
    setCollapsed(next)
    localStorage.setItem(LS_COLLAPSED, String(next))
  }

  const toggleSection = (label: string) => {
    const next = { ...collapsedSections, [label]: !collapsedSections[label] }
    setCollapsedSections(next)
    localStorage.setItem(LS_SECTIONS, JSON.stringify(next))
  }

  // Width determined by collapsed state (only after mount to avoid hydration flash)
  const sidebarWidth = !mounted ? 'w-52' : collapsed ? 'w-14' : 'w-52'

  return (
    <aside className={`${sidebarWidth} shrink-0 hidden lg:flex flex-col border-r border-white/[0.07] sticky top-0 h-screen bg-[#080808] transition-[width] duration-200`}>
      {/* Wordmark */}
      <div className="h-12 flex items-center border-b border-white/[0.07] shrink-0 overflow-hidden px-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-white/10 flex items-center justify-center text-sm font-bold text-white shrink-0">N</div>
          {!collapsed && (
            <div className="min-w-0">
              <p className="text-white text-xs font-semibold leading-tight tracking-wide">Todero</p>
              <p className="text-white/25 text-[9px] leading-tight">Mission Control</p>
            </div>
          )}
        </div>
      </div>

      {/* Nav groups */}
      <nav className="flex-1 py-3 px-2 space-y-4 overflow-y-auto overflow-x-hidden">
        {NAV_GROUPS.map(group => {
          const isSectionCollapsed = collapsedSections[group.label] ?? false

          return (
            <div key={group.label}>
              {/* Section label — hidden in icon-only mode */}
              {!collapsed && (
                <button
                  onClick={() => toggleSection(group.label)}
                  aria-expanded={!isSectionCollapsed}
                  className="w-full px-3 mb-1 flex items-center justify-between group/sec"
                >
                  <p className="text-[9px] font-semibold uppercase tracking-widest text-white/20 select-none group-hover/sec:text-white/40 transition-colors">
                    {group.label}
                  </p>
                  {isSectionCollapsed
                    ? <ChevronDown size={10} className="text-white/20 group-hover/sec:text-white/40 transition-colors shrink-0" />
                    : <ChevronUp   size={10} className="text-white/20 group-hover/sec:text-white/40 transition-colors shrink-0" />
                  }
                </button>
              )}

              {/* Items — always visible in icon-only mode; respect section collapse otherwise */}
              {(collapsed || !isSectionCollapsed) && (
                <div className="space-y-0.5">
                  {group.items.map(item => {
                    const isActive        = tab === item.id
                    const Icon            = item.icon
                    const isChat          = item.id === 'chat'
                    const showInboxBadge  = item.isInbox && inboxCount > 0

                    const btn = (
                      <button
                        aria-label={item.label}
                        onClick={() => {
                          navigate(item.id)
                          if (isChat && setUnreadChat) setUnreadChat(false)
                        }}
                        className={[
                          'relative w-full flex items-center gap-2.5 py-2 rounded-lg text-left transition-all duration-150',
                          // border-l-4 always present (transparent when inactive) to prevent layout shift
                          'border-l-4',
                          collapsed ? 'justify-center px-0' : 'pl-2 pr-3',
                          isActive
                            ? 'bg-white/10 text-white border-white/70'
                            : 'text-white/40 hover:text-white/70 hover:bg-white/[0.05] border-transparent',
                        ].join(' ')}
                      >
                        <Icon
                          size={14}
                          className={`shrink-0 ${isActive ? 'text-white' : 'text-white/35'}`}
                        />
                        {!collapsed && (
                          <span className={`text-xs font-medium ${isActive ? 'text-white' : ''}`}>
                            {item.label}
                          </span>
                        )}
                        {/* Unread chat dot */}
                        {!collapsed && isChat && unreadChat && !isActive && (
                          <span className="ml-auto w-1.5 h-1.5 rounded-full bg-red-500 shrink-0 animate-pulse" />
                        )}
                        {/* Inbox badge */}
                        {showInboxBadge && (
                          <span className={[
                            'min-w-[16px] h-4 flex items-center justify-center rounded-full',
                            'bg-amber-500 text-[9px] font-bold text-black px-1 shrink-0',
                            collapsed ? 'absolute -top-0.5 -right-0.5 z-10' : 'ml-auto',
                          ].join(' ')}>
                            {inboxCount > 99 ? '99+' : inboxCount}
                          </span>
                        )}
                      </button>
                    )

                    return collapsed
                      ? <NavTooltip key={item.id} label={item.label}>{btn}</NavTooltip>
                      : <React.Fragment key={item.id}>{btn}</React.Fragment>
                  })}
                </div>
              )}
            </div>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-3 py-3 border-t border-white/[0.07] shrink-0">
        {/* Collapse toggle */}
        <button
          onClick={toggleCollapsed}
          className="w-full flex items-center justify-center gap-2 py-1.5 rounded-lg text-white/30 hover:text-white/60 hover:bg-white/[0.05] transition-all mb-1"
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed
            ? <ChevronRight size={14} />
            : <><ChevronLeft size={14} /><span className="text-[10px]">Collapse</span></>
          }
        </button>
        {!collapsed && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5">
              <Dot status="active" sm />
              <span className="text-white/25 text-[10px]">All nominal</span>
            </div>
            {clock && <p className="text-white/20 text-[10px] font-mono">{clock}</p>}
          </div>
        )}
      </div>
    </aside>
  )
}

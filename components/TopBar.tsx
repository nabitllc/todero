'use client'
// TOD-630: Top bar — Todero logo left, search center, actions right

import React from 'react'
import {
  Search, MessageSquare, Inbox, User, Play, Pause,
} from 'lucide-react'
import NotificationBell from './NotificationBell'

interface TopBarProps {
  tab: string
  selectedBusiness: string | null
  onSearchOpen: () => void
  onNavigate: (tab: string) => void
  agentRunsData: Record<string, { taskTitle: string; startedAt: string | null; status: string }>
  unreadChat?: boolean
  inboxPendingCount?: number
  onOpenInbox?: () => void
  hubPaused?: boolean
  onTogglePause?: () => void
}

export default function TopBar({
  tab,
  selectedBusiness,
  onSearchOpen,
  onNavigate,
  agentRunsData,
  unreadChat = false,
  inboxPendingCount = 0,
  onOpenInbox,
  hubPaused = false,
  onTogglePause,
}: TopBarProps) {
  const activeAgentCount = Object.values(agentRunsData).filter(
    a => a.status === 'running'
  ).length

  return (
    <header className="border-b border-white/[0.07] px-3 md:px-5 h-11 grid grid-cols-[auto_1fr_auto] items-center shrink-0 sticky top-0 z-20 bg-[#080808]">
      {/* LEFT — Todero logo (text placeholder for SVG) */}
      <div className="flex items-center gap-2 min-w-0 shrink-0">
        <div className="w-6 h-6 rounded-md bg-white/10 flex items-center justify-center text-[11px] font-bold text-white">T</div>
        <span className="text-white text-sm font-semibold tracking-wide">Todero</span>
      </div>

      {/* CENTER — Global search bar (triggers Cmd+K) */}
      <div className="flex justify-center px-4">
        <button
          onClick={onSearchOpen}
          className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg border border-white/[0.07] bg-white/[0.03] hover:bg-white/[0.06] transition-colors max-w-[320px] w-full"
        >
          <Search size={13} className="text-white/30 shrink-0" />
          <span className="text-white/25 text-xs flex-1 text-left">Search issues...</span>
          <kbd className="text-[10px] text-white/20 border border-white/[0.07] rounded px-1 py-0.5 font-mono">⌘K</kbd>
        </button>
        {/* Mobile search icon */}
        <button
          onClick={onSearchOpen}
          className="sm:hidden p-2 rounded-md hover:bg-white/[0.05] text-white/40 hover:text-white/60 transition-colors"
          title="Search (⌘K)"
        >
          <Search size={15} />
        </button>
      </div>

      {/* RIGHT — My Tasks + Agent Chat + Notifications + Profile */}
      <div className="flex items-center gap-1">
        {onTogglePause && (
          <button
            onClick={onTogglePause}
            className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md transition-colors ${
              hubPaused
                ? 'bg-red-500/10 hover:bg-red-500/20 text-red-400'
                : 'hover:bg-white/[0.05] text-white/40 hover:text-white/60'
            }`}
            title={hubPaused ? 'Hub paused — click to resume agents' : 'Pause all agents'}
          >
            {hubPaused ? (
              <>
                <Play size={14} className="text-red-400" />
                <span className="hidden sm:inline text-[10px] font-medium">Paused</span>
              </>
            ) : (
              <Pause size={14} />
            )}
          </button>
        )}

        {activeAgentCount > 0 && (
          <button
            onClick={() => onNavigate('team')}
            className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-white/[0.05] transition-colors"
            title={`${activeAgentCount} agent${activeAgentCount > 1 ? 's' : ''} running`}
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="text-[10px] text-emerald-400 font-medium">{activeAgentCount}</span>
          </button>
        )}

        <button
          onClick={onOpenInbox}
          className="relative flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-white/[0.05] text-white/40 hover:text-white/60 transition-colors"
          title="Inbox (⌘[)"
        >
          <Inbox size={15} />
          {inboxPendingCount > 0 && (
            <span className="text-[10px] font-bold bg-amber-500 text-black rounded-full px-1.5 py-0.5 leading-none min-w-[18px] text-center">
              {inboxPendingCount}
            </span>
          )}
        </button>

        <button
          onClick={() => onNavigate('chat')}
          className="relative p-2 rounded-md hover:bg-white/[0.05] text-white/40 hover:text-white/60 transition-colors"
          title="Agent Chat"
        >
          <MessageSquare size={15} />
          {unreadChat && (
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
          )}
        </button>

        <NotificationBell />

        <button
          onClick={() => onNavigate('settings')}
          className="ml-1 w-7 h-7 rounded-full bg-white/10 flex items-center justify-center hover:bg-white/[0.15] transition-colors"
          title="Profile & Settings"
        >
          <User size={13} className="text-white/50" />
        </button>
      </div>
    </header>
  )
}

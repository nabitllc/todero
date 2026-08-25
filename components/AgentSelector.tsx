'use client'
// Agent picker for the Chat tab.
//
// The options come from GET /api/agents (the host's AGENTS.md) and from
// nowhere else. This component used to import a 13-entry hardcoded `AGENTS`
// array, so it offered "Infra SME" and "Todero SME" — agents no roster on any
// host declares — and defaulted to `AGENTS[0]` whenever the selected id was
// unknown, which meant a host with no roster at all still rendered a confident
// "🧠 KAOS". There is now no list to fall back to: an empty roster renders a
// disabled trigger saying so, and a failed fetch renders the same error banner
// every other data surface in the app uses.

import React, { useRef, useState, useEffect } from 'react'
import { useAgentRoster, rosterEmptyReason } from '@/hooks/useAgentRoster'
import { formatApiError } from '@/hooks/useApiData'
import { agentDisplay } from '@/lib/agents-config'

interface AgentSelectorProps {
  value: string
  onChange: (agentId: string) => void
  disabled?: boolean
}

const TRIGGER_CLASS =
  'flex items-center gap-1 px-2 py-1 rounded-lg bg-[#0f0f0f] border border-white/10 text-[10px] text-white/50 hover:text-white/70 hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors outline-none focus-visible:border-white/30'

export default function AgentSelector({ value, onChange, disabled }: AgentSelectorProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { agents, rosterWarning, error, loading } = useAgentRoster()

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // The request failed. Say which request and why, in the same words as every
  // other tab — never quietly substitute a default agent.
  if (error) {
    return (
      <div
        role="alert"
        data-testid="agent-selector-error"
        title={formatApiError(error)}
        className="shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg border border-red-500/40 bg-red-500/10 text-[10px] text-red-400 max-w-[14rem]"
      >
        <span aria-hidden="true">⚠️</span>
        <span className="truncate">{formatApiError(error)}</span>
      </div>
    )
  }

  if (loading) {
    return (
      <button type="button" disabled className={`${TRIGGER_CLASS} shrink-0`}>
        <span>⏳</span>
        <span className="hidden sm:inline">Loading agents…</span>
      </button>
    )
  }

  // A host with no AGENTS.md has no agents. That is a configuration fact with a
  // fix attached, so the warning naming the searched path is the tooltip.
  if (agents.length === 0) {
    return (
      <button
        type="button"
        disabled
        data-testid="agent-selector-empty"
        title={rosterEmptyReason({ rosterWarning })}
        className={`${TRIGGER_CLASS} shrink-0`}
      >
        <span aria-hidden="true">🚫</span>
        <span className="hidden sm:inline">No agents configured</span>
      </button>
    )
  }

  // Only ever an agent the roster named. When `value` is a stale id (an old
  // chat pinned to an agent since removed from AGENTS.md) the trigger shows
  // that id rather than silently retargeting the chat at somebody else.
  const selected = agents.find(a => a.id === value)
  const fallback = agentDisplay(value)
  const triggerEmoji = selected?.emoji ?? fallback.emoji
  const triggerName = selected?.name ?? fallback.name

  return (
    <div ref={ref} className="relative shrink-0">
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        title={selected ? 'Select agent' : `"${value}" is not in this host's roster`}
        className={TRIGGER_CLASS}
      >
        <span>{triggerEmoji}</span>
        <span className={`hidden sm:inline ${selected ? '' : 'text-amber-400/70'}`}>{triggerName}</span>
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute bottom-full mb-1 right-0 w-52 rounded-lg border border-white/10 bg-[#111] shadow-xl z-50 overflow-hidden">
          <div className="max-h-64 overflow-y-auto py-1">
            {agents.map(agent => (
              <button
                key={agent.id}
                type="button"
                onClick={() => { onChange(agent.id); setOpen(false) }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-white/5 transition-colors ${agent.id === value ? 'bg-white/5' : ''}`}
              >
                <span className="text-base leading-none">{agent.emoji}</span>
                <div className="min-w-0">
                  <div className={`text-[11px] font-medium truncate ${agent.id === value ? 'text-white' : 'text-white/70'}`}>
                    {agent.name}
                  </div>
                  <div className="text-[9px] text-white/30 truncate">{agent.role}</div>
                </div>
                {agent.id === value && (
                  <svg className="w-3 h-3 text-white/50 ml-auto shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

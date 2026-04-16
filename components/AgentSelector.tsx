'use client'
import React, { useRef, useState, useEffect } from 'react'
import { AGENTS, AGENT_MAP } from '@/lib/agents-config'

interface AgentSelectorProps {
  value: string
  onChange: (agentId: string) => void
  disabled?: boolean
}

export default function AgentSelector({ value, onChange, disabled }: AgentSelectorProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const selected = AGENT_MAP[value] ?? AGENTS[0]

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  return (
    <div ref={ref} className="relative shrink-0">
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(o => !o)}
        title="Select agent"
        className="flex items-center gap-1 px-2 py-1 rounded-lg bg-[#0f0f0f] border border-white/10 text-[10px] text-white/50 hover:text-white/70 hover:border-white/20 disabled:opacity-50 disabled:cursor-not-allowed transition-colors outline-none focus-visible:border-white/30"
      >
        <span>{selected.emoji}</span>
        <span className="hidden sm:inline">{selected.name}</span>
        <svg className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute bottom-full mb-1 right-0 w-52 rounded-lg border border-white/10 bg-[#111] shadow-xl z-50 overflow-hidden">
          <div className="max-h-64 overflow-y-auto py-1">
            {AGENTS.map(agent => (
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

'use client'
// TOD-2233: Extracted from TopBar — standalone active agents indicator

import React from 'react'

interface ActiveAgentsIndicatorProps {
  agentRunsData: Record<string, { taskTitle: string; startedAt: string | null; status: string }>
  onNavigate: (tab: string) => void
}

export default function ActiveAgentsIndicator({ agentRunsData, onNavigate }: ActiveAgentsIndicatorProps) {
  const activeAgentCount = Object.values(agentRunsData).filter(
    a => a.status === 'running'
  ).length

  if (activeAgentCount === 0) return null

  const label = `${activeAgentCount} agent${activeAgentCount > 1 ? 's' : ''} running`

  return (
    <button
      onClick={() => onNavigate('team')}
      className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-white/[0.05] transition-colors"
      title={label}
      aria-label={`${label} — click to view team`}
    >
      <span className="relative flex h-2 w-2" aria-hidden="true">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
      </span>
      <span className="text-[10px] text-emerald-400 font-medium">{activeAgentCount}</span>
    </button>
  )
}

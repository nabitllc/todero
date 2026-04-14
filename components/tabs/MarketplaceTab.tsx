'use client'
import React from 'react'
import { SH } from '@/lib/mc-atoms'
import AgentsTab from '@/components/tabs/AgentsTab'
import SkillsCatalog from '@/components/tabs/SkillsCatalog'

export default function MarketplaceTab({
  displayAgents,
  agentLiveStatus,
  agentRunsData,
  liveAgents,
  act,
  agentModal,
  setAgentModal,
  projectFilter,
}: {
  displayAgents: any[]
  agentLiveStatus: (agentId: string) => { dot: 'green'|'amber'|'grey'; label: string }
  agentRunsData: Record<string, {taskTitle:string; startedAt:string|null; status:string}>
  liveAgents: any[] | null
  act: (id: string) => string
  agentModal: any
  setAgentModal: (a: any) => void
  projectFilter?: string | null
}) {
  return (
    <div className="space-y-10">
      <AgentsTab
        displayAgents={displayAgents}
        agentLiveStatus={agentLiveStatus}
        agentRunsData={agentRunsData}
        liveAgents={liveAgents}
        act={act}
        agentModal={agentModal}
        setAgentModal={setAgentModal}
        projectFilter={projectFilter}
      />

      <div className="flex justify-center">
        <div className="w-3/4 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent" />
      </div>

      <div>
        <SH icon="🛠️">Skills</SH>
        <SkillsCatalog />
      </div>
    </div>
  )
}

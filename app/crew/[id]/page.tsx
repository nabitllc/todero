// TOD-1598: /crew/[id] — renders AgentDetailView for agent IDs, human view otherwise
import { isAgent } from '@/lib/agents-config'
import AgentDetailView from '@/components/crew/AgentDetailView'

interface Props {
  params: { id: string }
}

export default function CrewMemberPage({ params }: Props) {
  const { id } = params

  if (isAgent(id)) {
    return <AgentDetailView agentId={id} />
  }

  // Human member placeholder — extend when MemberDetailView exists
  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="rounded-2xl border border-white/10 bg-[#0f0f0f] p-8 text-center">
        <p className="text-white/50 text-sm">Human member profile</p>
        <p className="text-white/30 text-xs mt-1 font-mono">{id}</p>
      </div>
    </div>
  )
}

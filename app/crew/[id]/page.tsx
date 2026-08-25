// TOD-1598: /crew/[id] — renders AgentDetailView for agent IDs, human view otherwise.
//
// The agent/human split used to be decided by `isAgent()`, which tested a
// 13-entry array hardcoded in lib/agents-config.ts. Two of those ids —
// `infra-sme` and `todero-sme` — are declared by no AGENTS.md on any host, so
// /crew/todero-sme rendered a full agent dashboard for an agent that does not
// exist, while /crew/security (which every host's roster does declare) fell
// through to the human placeholder. The question "is this an agent?" now has
// exactly one answer on the server, the same one GET /api/agents serves.
import { loadAgentRoster } from '@/lib/agent-roster'
import AgentDetailView from '@/components/crew/AgentDetailView'

// The roster is a host file that an operator can edit while the server runs,
// and AGENTS_MD_PATH is read at request time, so this must not be baked into a
// static shell at build.
export const dynamic = 'force-dynamic'

interface Props {
  params: { id: string }
}

export default function CrewMemberPage({ params }: Props) {
  const { id } = params

  // A host with no roster has no agents, so every id here is a human member —
  // which is the honest fallthrough, not a reason to guess.
  const isRosteredAgent = loadAgentRoster().agents.some(a => a.id === id)

  if (isRosteredAgent) {
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

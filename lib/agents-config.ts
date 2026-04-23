// Static agent roster — source of truth for UI agent selectors
// Mirrors the agent roster in AGENTS.md

export interface AgentConfig {
  id: string
  emoji: string
  name: string
  role: string
}

export const AGENTS: AgentConfig[] = [
  { id: 'main',        emoji: '🧠', name: 'KAOS',        role: 'Chief of Staff' },
  { id: 'builder',     emoji: '🔨', name: 'Builder',     role: 'Code Implementation' },
  { id: 'tester',      emoji: '🧪', name: 'Tester',      role: 'QA Review' },
  { id: 'designer',    emoji: '🎨', name: 'Designer',    role: 'UI/UX Review' },
  { id: 'po',          emoji: '📋', name: 'PO',          role: 'Product Owner' },
  { id: 'scout',       emoji: '🔍', name: 'Scout',       role: 'Research Agent' },
  { id: 'ops',         emoji: '⚙️', name: 'Ops',         role: 'Infrastructure' },
  { id: 'deployer',    emoji: '🚀', name: 'Deployer',    role: 'Release Coordination' },
  { id: 'auditor',     emoji: '🔎', name: 'Auditor',     role: 'Audit & Review' },
  { id: 'kemuni-sme',  emoji: '🚀', name: 'Kemuni SME',  role: 'Kemuni Specialist' },
  { id: 'vespera-sme', emoji: '🖤', name: 'Vespera SME', role: 'Vespera Specialist' },
  { id: 'infra-sme',   emoji: '🏗️', name: 'Infra SME',   role: 'Infrastructure Specialist' },
  { id: 'todero-sme',  emoji: '🛠️', name: 'Todero SME',  role: 'Todero Platform Specialist' },
]

export const AGENT_MAP = Object.fromEntries(AGENTS.map(a => [a.id, a])) as Record<string, AgentConfig>

// TOD-1598: Agent detection for /crew/[id] routing
export function isAgent(id: string): boolean {
  return id in AGENT_MAP
}

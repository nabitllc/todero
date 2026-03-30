// INF-236: Agent capability registry — types and data layer

export interface AgentCapability {
  id: string
  name: string
  emoji: string
  role: string
  color: string
  description: string
  capabilities: string[]
  floor: boolean
  modelShort?: string
}

export type AgentId =
  | 'main' | 'scout' | 'ops' | 'builder' | 'tester' | 'deployer'
  | 'kemuni-sme' | 'vespera-sme' | 'ux' | 'designer' | 'po'
  | 'growth' | 'security' | 'community' | 'content' | 'auditor'

export const AGENT_REGISTRY: Record<AgentId, AgentCapability> = {
  main:          { id: 'main',        name: 'KAOS',           emoji: '🧠', role: 'Chief Orchestrator',     color: '#6b7280', description: 'Main orchestrator. Strategy, memory, delegation, comms.', capabilities: ['Orchestration', 'Memory', 'Strategy', 'Comms', 'Delegation'], floor: true },
  scout:         { id: 'scout',       name: 'Scout',          emoji: '🔍', role: 'Research Agent',          color: '#a855f7', description: 'Morning scan: goth scene, competitors, PropTech trends.', capabilities: ['Web Research', 'Summarization', 'Trends'], floor: true },
  ops:           { id: 'ops',         name: 'Ops',            emoji: '⚙️', role: 'Infrastructure Watchdog', color: '#10b981', description: 'Infrastructure monitoring, deployment ops, system health.', capabilities: ['Infrastructure', 'Monitoring', 'Alerts'], floor: true },
  'kemuni-sme':  { id: 'kemuni-sme',  name: 'Kemuni SME',     emoji: '🚀', role: 'Kemuni Product Expert',  color: '#3b82f6', description: 'Domain expert for Kemuni platform. PropTech strategy & features.', capabilities: ['Product Strategy', 'Kemuni', 'PropTech'], floor: true },
  'vespera-sme': { id: 'vespera-sme', name: 'Vespera SME',    emoji: '🖤', role: 'Vespera Product Expert', color: '#ec4899', description: 'Domain expert for Vespera. Goth community, events, culture.', capabilities: ['Product Strategy', 'Vespera', 'Community'], floor: true },
  builder:       { id: 'builder',     name: 'Builder',        emoji: '🔨', role: 'Coding Agent',            color: '#f59e0b', description: 'On-demand coding. Next.js, Supabase, Vespera and Kemuni builds.', capabilities: ['Coding', 'PRs', 'Refactoring', 'Next.js', 'Supabase'], floor: true },
  tester:        { id: 'tester',      name: 'Tester',         emoji: '🧪', role: 'QA Agent',                color: '#06b6d4', description: 'Code review, QA, test suites, DoD enforcement.', capabilities: ['Code Review', 'QA', 'Test Suites', 'DoD Enforcement'], floor: true },
  deployer:      { id: 'deployer',    name: 'Deployer',       emoji: '🚀', role: 'Deploy Agent',            color: '#8b5cf6', description: 'Deployments, webhooks, release notes.', capabilities: ['Deployments', 'Webhooks', 'Release Notes'], floor: true },
  ux:            { id: 'ux',          name: 'UX Designer',    emoji: '🎨', role: 'UX & Design Agent',       color: '#ec4899', description: 'UI review, mobile UX, design system, accessibility.', capabilities: ['UI Review', 'Mobile UX', 'Design System', 'Accessibility'], floor: false },
  designer:      { id: 'designer',    name: 'Designer',       emoji: '🖌️', role: 'Design Review Agent',    color: '#d946ef', description: 'Design system, UI review, visual QA, accessibility.', capabilities: ['Design System', 'UI Review', 'Visual QA', 'Accessibility'], floor: false },
  po:            { id: 'po',          name: 'Product Owner',  emoji: '📋', role: 'Product Owner',           color: '#f59e0b', description: 'PRDs, backlog grooming, sprint facilitation, DoR.', capabilities: ['PRDs', 'Backlog Grooming', 'Sprint Facilitation', 'DoR'], floor: false },
  growth:        { id: 'growth',      name: 'Growth',         emoji: '📈', role: 'Growth Strategist',       color: '#10b981', description: 'Monetization, GTM, pricing, LATAM market.', capabilities: ['Monetization', 'GTM', 'Pricing', 'LATAM'], floor: false },
  security:      { id: 'security',    name: 'Security',       emoji: '🔐', role: 'Security Auditor',        color: '#ef4444', description: 'OWASP, auth review, RLS audit, CVE scanning.', capabilities: ['OWASP', 'Auth Review', 'RLS Audit', 'CVE Scanning'], floor: false },
  community:     { id: 'community',   name: 'Community Mgr',  emoji: '🖤', role: 'Community Manager',       color: '#a78bfa', description: 'Social content, brand voice, Colombia goth scene.', capabilities: ['Social Content', 'Brand Voice', 'Colombia Goth'], floor: false },
  content:       { id: 'content',     name: 'Content Creator',emoji: '✍️', role: 'Content Creator',        color: '#60a5fa', description: 'Blog, SEO, email, help docs.', capabilities: ['Blog', 'SEO', 'Email', 'Help Docs'], floor: false },
  auditor:       { id: 'auditor',     name: 'Auditor',        emoji: '🔎', role: 'System Truth Enforcer',   color: '#ef4444', description: 'Drift detection, config audit, task hygiene.', capabilities: ['Drift Detection', 'Config Audit', 'Task Hygiene'], floor: true },
}

export function getAgent(id: string): AgentCapability | undefined {
  return AGENT_REGISTRY[id as AgentId]
}

export function getFloorAgents(): AgentCapability[] {
  return Object.values(AGENT_REGISTRY).filter(a => a.floor)
}

export function getPlannedAgents(): AgentCapability[] {
  return Object.values(AGENT_REGISTRY).filter(a => !a.floor)
}

// INF-237: Core logic for agent capability registry operations

export function getAgentCapabilities(id: string): string[] {
  return AGENT_REGISTRY[id as AgentId]?.capabilities ?? []
}

export function hasCapability(agentId: string, capability: string): boolean {
  const caps = getAgentCapabilities(agentId)
  return caps.some(c => c.toLowerCase() === capability.toLowerCase())
}

export function findAgentsByCapability(capability: string): AgentCapability[] {
  return Object.values(AGENT_REGISTRY).filter(a =>
    a.capabilities.some(c => c.toLowerCase().includes(capability.toLowerCase()))
  )
}

export function getRegistrySummary(): { total: number; floor: number; planned: number; capabilities: string[] } {
  const all = Object.values(AGENT_REGISTRY)
  const allCaps = new Set(all.flatMap(a => a.capabilities))
  return {
    total: all.length,
    floor: all.filter(a => a.floor).length,
    planned: all.filter(a => !a.floor).length,
    capabilities: Array.from(allCaps).sort(),
  }
}

// Persist capability update to API
export async function updateAgentCapability(agentId: string, updates: { capabilities?: string[]; role?: string; description?: string; floor?: boolean }): Promise<boolean> {
  try {
    const res = await fetch('/api/agents', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent_id: agentId, ...updates }),
    })
    return res.ok
  } catch {
    return false
  }
}

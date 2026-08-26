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
  type?: 'consultant' | 'permanent'
}

// no-invented-projects-sweep: 'kemuni-sme' and 'vespera-sme' were members of
// this union and of AGENT_REGISTRY below. Neither agent exists on any host, and
// neither of the projects they claimed to be domain experts for (Kemuni,
// Vespera) is a project this installation has. They are removed rather than
// disabled: a union member is what lets a caller write the id at all, and
// AGENT_REGISTRY was read by components/crew/AgentDetailView.tsx to render a
// detail page for whatever id the URL carried. Restoring either is a
// regression, not a fix — scripts/no-invented-projects.mjs enforces it.
export type AgentId =
  | 'main' | 'scout' | 'ops' | 'builder' | 'tester' | 'deployer'
  | 'ux' | 'designer' | 'po'
  | 'growth' | 'security' | 'community' | 'content' | 'auditor'

export const AGENT_REGISTRY: Record<AgentId, AgentCapability> = {
  main:          { id: 'main',        name: 'KAOS',           emoji: '🧠', role: 'Chief Orchestrator',     color: '#6b7280', description: 'Main orchestrator. Strategy, memory, delegation, comms.', capabilities: ['Orchestration', 'Memory', 'Strategy', 'Comms', 'Delegation'], floor: true },
  scout:         { id: 'scout',       name: 'Scout',          emoji: '🔍', role: 'Research Agent',          color: '#a855f7', description: 'Morning scan: goth scene, competitors, PropTech trends.', capabilities: ['Web Research', 'Summarization', 'Trends'], floor: true },
  ops:           { id: 'ops',         name: 'Ingo',            emoji: '⚙️', role: 'Infrastructure Watchdog', color: '#10b981', description: 'Infrastructure monitoring, deployment ops, system health.', capabilities: ['Infrastructure', 'Monitoring', 'Alerts'], floor: true },
  builder:       { id: 'builder',     name: 'Builder',        emoji: '🔨', role: 'Coding Agent',            color: '#f59e0b', description: 'On-demand coding. Next.js, Supabase, TypeScript.', capabilities: ['Coding', 'PRs', 'Refactoring', 'Next.js', 'Supabase'], floor: true },
  tester:        { id: 'tester',      name: 'Tester',         emoji: '🧪', role: 'QA Agent',                color: '#06b6d4', description: 'Code review, QA, test suites, DoD enforcement.', capabilities: ['Code Review', 'QA', 'Test Suites', 'DoD Enforcement'], floor: true },
  deployer:      { id: 'deployer',    name: 'Deployer',       emoji: '🚀', role: 'Deploy Agent',            color: '#8b5cf6', description: 'Deployments, webhooks, release notes.', capabilities: ['Deployments', 'Webhooks', 'Release Notes'], floor: true },
  ux:            { id: 'ux',          name: 'UX Designer',    emoji: '🎨', role: 'UX & Design Agent',       color: '#ec4899', description: 'UI review, mobile UX, design system, accessibility.', capabilities: ['UI Review', 'Mobile UX', 'Design System', 'Accessibility'], floor: false, type: 'consultant' },
  designer:      { id: 'designer',    name: 'Designer',       emoji: '🖌️', role: 'Design Review Agent',    color: '#d946ef', description: 'Design system, UI review, visual QA, accessibility.', capabilities: ['Design System', 'UI Review', 'Visual QA', 'Accessibility'], floor: false, type: 'consultant' },
  po:            { id: 'po',          name: 'Product Owner',  emoji: '📋', role: 'Product Owner',           color: '#f59e0b', description: 'PRDs, backlog grooming, sprint facilitation, DoR.', capabilities: ['PRDs', 'Backlog Grooming', 'Sprint Facilitation', 'DoR'], floor: false, type: 'consultant' },
  growth:        { id: 'growth',      name: 'Growth',         emoji: '📈', role: 'Growth Strategist',       color: '#10b981', description: 'Monetization, GTM, pricing, LATAM market.', capabilities: ['Monetization', 'GTM', 'Pricing', 'LATAM'], floor: false, type: 'consultant' },
  security:      { id: 'security',    name: 'Security',       emoji: '🔐', role: 'Security Auditor',        color: '#ef4444', description: 'OWASP, auth review, RLS audit, CVE scanning.', capabilities: ['OWASP', 'Auth Review', 'RLS Audit', 'CVE Scanning'], floor: false, type: 'consultant' },
  community:     { id: 'community',   name: 'Community Mgr',  emoji: '🖤', role: 'Community Manager',       color: '#a78bfa', description: 'Social content, brand voice, Colombia goth scene.', capabilities: ['Social Content', 'Brand Voice', 'Colombia Goth'], floor: false, type: 'consultant' },
  content:       { id: 'content',     name: 'Content Creator',emoji: '✍️', role: 'Content Creator',        color: '#60a5fa', description: 'Blog, SEO, email, help docs.', capabilities: ['Blog', 'SEO', 'Email', 'Help Docs'], floor: false, type: 'consultant' },
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

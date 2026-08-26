// Agent roster
// The roster is read from AGENTS.md when the host has one, and falls back to
// the built-in registry below when it does not. Kept out of the route file so
// the parsing is unit-testable: a Next.js route module may only export the
// HTTP verbs.
//
// SERVER ONLY: reads the filesystem.

import { readFileSync } from 'fs'
import { agentsMdCandidates, firstExistingPath, resolveAgentsMdPath } from './paths'

export interface AgentMeta {
  name: string
  emoji: string
  role: string
  color: string
  capabilities: string[]
  floor: boolean
  model: string
  queue_filter: string[]
}

export interface ParsedAgent {
  id: string
  name: string
  role: string
  model: string
}

// Maps agent IDs to UI display metadata — emoji, color, capabilities, floor, queue_filter
// model and role are sourced from AGENTS.md; values here serve as fallback only
export const AGENT_META: Record<string, AgentMeta> = {
  'main':        { name: 'KAOS',        emoji: '🧠', role: 'Chief Orchestrator',   color: '#6b7280', capabilities: ['Orchestration', 'Memory', 'Strategy', 'Comms', 'Delegation'], floor: true,  model: 'claude-sonnet-4-6', queue_filter: [] },
  'scout':       { name: 'Scout',       emoji: '🔍', role: 'Research Agent',        color: '#a855f7', capabilities: ['Web Research', 'Summarization', 'Trends'], floor: true,                   model: 'claude-sonnet-4-6', queue_filter: ['open'] },
  'ops':         { name: 'Ingo',        emoji: '⚙️', role: 'Infrastructure Watchdog', color: '#10b981', capabilities: ['Infrastructure', 'Monitoring', 'Alerts'], floor: true,                  model: 'claude-haiku-4-5',  queue_filter: ['open'] },
  // no-invented-projects-sweep: 'kemuni-sme' and 'vespera-sme' were entries here.
  // Removing them from AGENT_META only stopped either id picking up an emoji,
  // colour, capability list or `floor: true` from code; it could not stop the
  // roster NAMING them, because loadAgentRoster() reads AGENTS.md.
  //
  // agent-visualization-fidelity, 2026-08-26: AGENTS.md has since been fixed
  // too. Both rows now sit inside a blockquote (AGENTS.md:89-90, each line
  // prefixed `> ` and wrapped in backticks) under a heading that says they were
  // removed, so parseAgentsFromMd() stops at the blank line after :86 and never
  // reaches them. Measured today against the running server: GET /api/agents
  // returns 28 agents and neither 'kemuni-sme' nor 'vespera-sme' is among them.
  //
  // An earlier revision of this comment asserted "AGENTS.md:87-88 still lists
  // both rows". That was true when written and is not true now — which is why
  // this note carries the date and the command whose output it is describing.
  'builder':     { name: 'Builder',     emoji: '🔨', role: 'Coding Agent',           color: '#f59e0b', capabilities: ['Coding', 'PRs', 'Refactoring', 'Next.js', 'Supabase'], floor: true,     model: 'claude-sonnet-4-6', queue_filter: ['open'] },
  'tester':      { name: 'Tester',      emoji: '🧪', role: 'QA Agent',               color: '#06b6d4', capabilities: ['Code Review', 'QA', 'Test Suites', 'DoD Enforcement'], floor: true,     model: 'claude-haiku-4-5',  queue_filter: ['code_review'] },
  'deployer':    { name: 'Deployer',    emoji: '🚀', role: 'Deploy Agent',            color: '#8b5cf6', capabilities: ['Deployments', 'Webhooks', 'Release Notes'], floor: true,                model: 'claude-haiku-4-5',  queue_filter: ['approved'] },
  'ux':          { name: 'UX Designer',     emoji: '🎨', role: 'UX & Design Agent',       color: '#ec4899', capabilities: ['UI Review', 'Mobile UX', 'Design System', 'Accessibility'], floor: false, model: 'claude-sonnet-4-6', queue_filter: [] },
  'designer':    { name: 'Designer',        emoji: '🖌️', role: 'Design Review Agent',     color: '#d946ef', capabilities: ['Design System', 'UI Review', 'Visual QA', 'Accessibility'], floor: false, model: 'claude-haiku-4-5',  queue_filter: ['code_review'] },
  'po':          { name: 'Product Owner',   emoji: '📋', role: 'Product Owner',            color: '#f59e0b', capabilities: ['PRDs', 'Backlog Grooming', 'Sprint Facilitation', 'DoR'], floor: false,  model: 'claude-sonnet-4-6', queue_filter: ['defined'] },
  'growth':      { name: 'Growth',          emoji: '📈', role: 'Growth Strategist',        color: '#10b981', capabilities: ['Monetization', 'GTM', 'Pricing', 'LATAM'], floor: false,           model: 'claude-sonnet-4-6', queue_filter: [] },
  'security':    { name: 'Security',        emoji: '🔐', role: 'Security Auditor',         color: '#ef4444', capabilities: ['OWASP', 'Auth Review', 'RLS Audit', 'CVE Scanning'], floor: false,   model: 'claude-sonnet-4-6', queue_filter: [] },
  'community':   { name: 'Community Mgr',   emoji: '🖤', role: 'Community Manager',        color: '#a78bfa', capabilities: ['Social Content', 'Brand Voice', 'Colombia Goth'], floor: false,      model: 'claude-sonnet-4-6', queue_filter: [] },
  'content':     { name: 'Content Creator', emoji: '✍️', role: 'Content Creator',          color: '#60a5fa', capabilities: ['Blog', 'SEO', 'Email', 'Help Docs'], floor: false,                  model: 'claude-sonnet-4-6', queue_filter: [] },
  'auditor':     { name: 'Auditor',     emoji: '🔎', role: 'System Truth Enforcer',  color: '#ef4444', capabilities: ['Drift Detection', 'Config Audit', 'Task Hygiene'], floor: true,            model: 'claude-sonnet-4-6', queue_filter: ['released'] },
}

// Reverse lookup so a roster that lists an agent by display name ("Ingo")
// still resolves to the canonical id ("ops").
const NAME_TO_ID: Record<string, string> = Object.fromEntries(
  Object.entries(AGENT_META).map(([id, meta]) => [meta.name.toLowerCase(), id])
)

function normalizeId(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '-')
}

/**
 * "main (KAOS)" and "KAOS (main)" are both in the wild, so try the inner and
 * the outer token against the known registry before falling back to the outer.
 */
export function resolveAgentIdentity(agentCol: string): { id: string; name: string } {
  const parenMatch = agentCol.match(/^(.+?)\s*\((.+?)\)$/)
  const outer = (parenMatch ? parenMatch[1] : agentCol).trim()
  const inner = parenMatch ? parenMatch[2].trim() : ''
  for (const candidate of [outer, inner]) {
    if (!candidate) continue
    const slug = normalizeId(candidate)
    if (AGENT_META[slug]) return { id: slug, name: AGENT_META[slug].name }
    const byName = NAME_TO_ID[candidate.toLowerCase()]
    if (byName) return { id: byName, name: AGENT_META[byName].name }
  }
  const display = inner || outer
  return {
    id: normalizeId(outer),
    name: display.charAt(0).toUpperCase() + display.slice(1),
  }
}

// Parse the Agent Roster table from AGENTS.md at request time. This is the
// authoritative source for id, name, role and model when the file exists.
// The file lives in a host-dependent place, so the path comes from lib/paths
// (TODERO_AGENTS_MD) rather than one developer's home directory.
//
// Three column layouts are supported because all three ship in the wild:
//   | Agent | Model | Notes |                (legacy kaos-config roster)
//   | Agent | Role  | Model | Status |       (older Todero AGENTS.md)
//   | Id | Agent | Role | Model | Status |   (current Todero AGENTS.md)
// When an explicit `Id` column is present it wins: guessing the canonical id
// from a display name ("Ingo" -> ops) only works for names the code already
// knows, so a roster that means to add a new agent has no way to say its id.
export function parseAgentsFromMd(mdPathArg?: string): ParsedAgent[] {
  const mdPath = mdPathArg ?? resolveAgentsMdPath()
  if (!mdPath) throw new Error(`No AGENTS.md found on this host (looked in: ${agentsMdCandidates().join(', ')})`)

  const lines = readFileSync(mdPath, 'utf-8').split('\n')
  const headerIdx = lines.findIndex(l => {
    if (!/^\s*\|/.test(l)) return false
    const cols = l.split('|').map(c => c.trim()).filter(Boolean)
    return cols.some(c => /^agent$/i.test(c)) && cols.some(c => /^(model|role|notes)$/i.test(c))
  })
  if (headerIdx === -1) throw new Error(`Agent Roster table not found in ${mdPath}`)

  const header = lines[headerIdx].split('|').map(c => c.trim()).filter(Boolean)
  const agentIdx = header.findIndex(c => /^agent$/i.test(c))
  const modelIdx = header.findIndex(c => /^model$/i.test(c))
  // "Notes" in the legacy layout carries the role description.
  const roleIdx = header.findIndex(c => /^(role|notes)$/i.test(c))
  const idIdx = header.findIndex(c => /^id$/i.test(c))

  const agents: ParsedAgent[] = []
  // Skip header + separator
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line.startsWith('|')) break
    const cols = line.split('|').map(c => c.trim()).filter(Boolean)
    if (cols.length < header.length) continue
    const resolved = resolveAgentIdentity(cols[agentIdx] ?? '')
    const explicitId = idIdx >= 0 ? normalizeId(cols[idIdx] ?? '') : ''
    const id = explicitId || resolved.id
    if (!id) continue
    agents.push({
      id,
      // The file is the source of truth for the display name too; the built-in
      // registry only fills in for a row that gave an id and no readable name.
      name: resolved.name || AGENT_META[id]?.name || id,
      role: roleIdx >= 0 ? cols[roleIdx] ?? '' : '',
      model: modelIdx >= 0 ? cols[modelIdx] ?? '' : '',
    })
  }
  if (agents.length === 0) throw new Error(`No agents parsed from the roster table in ${mdPath}`)
  return agents
}

/** What the roster loader found, and — when it found nothing — why. */
export interface RosterLoad {
  agents: ParsedAgent[]
  /** The file the roster was read from, or null when none was readable. */
  path: string | null
  /** Operator-facing reason the roster is empty. Names the path(s) searched. */
  warning: string | null
}

/**
 * Load the roster without throwing.
 *
 * A missing or unparseable AGENTS.md is a *configuration* fact, not a server
 * fault: the route answers 200 with `agents: []` and this warning, so the UI
 * can say "no agents configured, looked in <path>". It deliberately does NOT
 * substitute AGENT_META for the roster — standing in a built-in list of 16
 * agents for a roster the host does not have is the fiction this endpoint
 * exists to stop. AGENT_META is display metadata (emoji/colour/capabilities)
 * for agents the roster actually declares, and nothing more.
 */
export function loadAgentRoster(): RosterLoad {
  const candidates = agentsMdCandidates()
  const mdPath = firstExistingPath(candidates)
  if (!mdPath) {
    return {
      agents: [],
      path: null,
      warning: `No AGENTS.md found on this host — looked in: ${candidates.join(', ')}. Set AGENTS_MD_PATH to point at a roster file.`,
    }
  }
  try {
    return { agents: parseAgentsFromMd(mdPath), path: mdPath, warning: null }
  } catch (e) {
    return { agents: [], path: mdPath, warning: e instanceof Error ? e.message : String(e) }
  }
}

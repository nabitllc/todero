// Client-safe DISPLAY metadata for agents — not a roster.
//
// This file used to export an `AGENTS` array of 13 hand-written entries and an
// `isAgent()` built from it. That array was a second copy of the fiction
// /api/agents was rewritten to stop telling: it invented `infra-sme` and
// `todero-sme`, which no AGENTS.md on any host declares, and omitted ux,
// security, growth, content and community, which every host's does. It fed the
// Chat tab's agent picker and the /crew/[id] router, so Todero offered chats
// with agents that do not exist and rendered detail pages for them.
//
// Who exists is now answered in exactly two places, both reading AGENTS.md:
//   - server: `loadAgentRoster()` in lib/agent-roster.ts
//   - client: `useAgentRoster()` in hooks/useAgentRoster.ts (GET /api/agents)
//
// What survives here is presentation only, keyed by id, for the rare client
// component that has an agent id in hand and no roster row to go with it (a
// stored `agent_id` on an old chat, for instance). A miss returns undefined —
// it must never conjure an agent, and it is never the source of a list.

export interface AgentDisplay {
  emoji: string
  name: string
  /** Short role label for a dropdown line. The roster's own Role column wins. */
  role: string
}

/**
 * Keys are the ids in the repo's AGENTS.md. If a host's roster names an agent
 * that is missing here, the UI falls back to the id and a neutral 🤖 — which is
 * why a roster can add an agent without a code change, and why this map may
 * never be iterated to answer "which agents are there?".
 */
export const AGENT_MAP: Record<string, AgentDisplay> = {
  'main':        { emoji: '🧠', name: 'KAOS',            role: 'Chief of Staff' },
  'builder':     { emoji: '🔨', name: 'Builder',         role: 'Coding Agent' },
  'tester':      { emoji: '🧪', name: 'Tester',          role: 'QA Reviewer' },
  'designer':    { emoji: '🖌️', name: 'Designer',        role: 'Design Review' },
  'ux':          { emoji: '🎨', name: 'UX Designer',     role: 'UX & Design' },
  'po':          { emoji: '📋', name: 'Product Owner',   role: 'Backlog & PRDs' },
  'deployer':    { emoji: '🚀', name: 'Deployer',        role: 'Release Coordination' },
  'auditor':     { emoji: '🔎', name: 'Auditor',         role: 'Drift & Config Audit' },
  'ops':         { emoji: '⚙️', name: 'Ingo',            role: 'Infrastructure' },
  'scout':       { emoji: '🔍', name: 'Scout',           role: 'Research Agent' },
  'security':    { emoji: '🔐', name: 'Security',        role: 'Security Auditor' },
  'growth':      { emoji: '📈', name: 'Growth',          role: 'Growth Strategist' },
  'content':     { emoji: '✍️', name: 'Content Creator', role: 'Content & SEO' },
  'community':   { emoji: '🖤', name: 'Community Mgr',   role: 'Community' },
  // no-invented-projects-sweep: 'kemuni-sme' and 'vespera-sme' were the last two
  // entries here. The header above already explains that this map is presentation
  // only and may never be iterated to answer "which agents are there?" — but a
  // presentation entry is still a claim that an id is meaningful, and these two
  // ids name agents no host declares, for projects this installation does not
  // have. A miss now returns the neutral 🤖 fallback via agentDisplay(), which is
  // the correct answer for an id nothing else recognises.
}

/** Display fields for an id, or neutral placeholders when it is unknown. */
export function agentDisplay(id: string): AgentDisplay {
  return AGENT_MAP[id] ?? { emoji: '🤖', name: id, role: '' }
}

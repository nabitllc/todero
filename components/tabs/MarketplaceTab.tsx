'use client'
import React from 'react'

const SKILLS_CATALOG = [
  {
    slug: 'issue-routing',
    name: 'Issue Routing',
    emoji: '🗺️',
    description: 'Determines correct type, assignee, and hierarchy for any issue based on what needs to be done, who can do it, and where it is in the pipeline.',
    triggers: 'Before creating any issue; when unsure of type, parent, or assignee.',
    agents: ['all agents'],
    source: 'local',
  },
  {
    slug: 'bug-report',
    name: 'Bug Report',
    emoji: '🐛',
    description: 'Report bugs to the Mission Control issue board. Use this before giving up on a task — report the blocker, then continue with other work.',
    triggers: 'Command fails 3×; unexpected API error; task is blocked by defect.',
    agents: ['builder', 'ops', 'all pipeline agents'],
    source: 'local',
  },
  {
    slug: 'agent-creation',
    name: 'Agent Creation',
    emoji: '🤖',
    description: 'Create a new agent for the Todero platform. No OpenClaw dependency. Creates workspace files and registers in AGENTS.md.',
    triggers: 'When adding a new agent role (builder, tester, scout, etc.).',
    agents: ['main (KAOS)'],
    source: 'local',
  },
  {
    slug: 'agent-setup',
    name: 'Agent Setup',
    emoji: '⚙️',
    description: 'Set up a new agent — creates workspace context files and registers agent in queue config.',
    triggers: 'Creating a new agent role; activating agent with no queue config; adding new agent identity.',
    agents: ['main (KAOS)'],
    source: 'local',
  },
  {
    slug: 'self-improving',
    name: 'Self-Improving',
    emoji: '🧠',
    description: 'Self-reflection + self-criticism + self-learning + self-organizing memory. Agent evaluates its own work, catches mistakes, and improves permanently.',
    triggers: 'Command/tool fails; user corrects output; knowledge is outdated; better approach discovered.',
    agents: ['all agents'],
    source: 'registry',
    version: '1.2.16',
  },
  {
    slug: 'proactivity',
    name: 'Proactivity',
    emoji: '⚡',
    description: 'Anticipates needs, keeps work moving, and improves through use so the agent gets more proactive over time.',
    triggers: 'Always active — shapes default behavior across all sessions.',
    agents: ['all agents'],
    source: 'registry',
    version: '1.0.1',
  },
  {
    slug: 'nano-pdf',
    name: 'nano-pdf',
    emoji: '📄',
    description: 'Edit PDFs with natural-language instructions using the nano-pdf CLI.',
    triggers: 'When editing or modifying PDF files.',
    agents: ['main (KAOS)', 'ops (Ingo)'],
    source: 'registry',
    version: '1.0.0',
  },
  {
    slug: 'blogwatcher',
    name: 'blogwatcher',
    emoji: '📰',
    description: 'Monitor blogs and RSS/Atom feeds for updates using the blogwatcher CLI.',
    triggers: 'When tracking external content sources or monitoring blog/feed updates.',
    agents: ['scout', 'main (KAOS)'],
    source: 'registry',
    version: '1.0.0',
  },
]

const AGENT_CATALOG = [
  {
    id: 'main',
    label: 'KAOS',
    emoji: '🤖',
    model: 'claude-sonnet-4-6',
    role: 'Orchestrator',
    description: 'Main session orchestrator. Delegates non-trivial work to subagents, handles strategy, routing, and sprint windows.',
    queueFilter: null,
  },
  {
    id: 'builder',
    label: 'Builder',
    emoji: '🔨',
    model: 'claude-sonnet-4-6',
    role: 'Code implementation',
    description: 'Implements tasks, writes and edits code, commits locally with [skip ci], runs npm run build before every commit.',
    queueFilter: 'type=task&status=open&assignee=builder',
  },
  {
    id: 'tester',
    label: 'Tester',
    emoji: '🧪',
    model: 'claude-haiku-4-5',
    role: 'QA review',
    description: 'Reviews code in code_review status. Only acts on P0/P1 priority issues, skips P2/P3. PATCHes to approved or rejected.',
    queueFilter: 'status=code_review',
  },
  {
    id: 'designer',
    label: 'Designer',
    emoji: '🎨',
    model: 'claude-haiku-4-5',
    role: 'UI/UX review',
    description: 'Reviews UI and visual hierarchy for issues in code_review. Checks card layout, spacing, and responsive behavior.',
    queueFilter: 'status=code_review',
  },
  {
    id: 'scout',
    label: 'Scout',
    emoji: '🔭',
    model: 'claude-sonnet-4-6',
    role: 'Research',
    description: 'Evaluates technologies, APIs, and approaches. Handles research tasks before implementation begins.',
    queueFilter: 'type=task&assignee=scout&status=open',
  },
  {
    id: 'ops',
    label: 'Ingo',
    emoji: '🛠️',
    model: 'claude-haiku-4-5',
    role: 'Infrastructure',
    description: 'Handles config, infra, and setup tasks. Works in a worktree like Builder. Display name Ingo, internal ID ops.',
    queueFilter: 'type=ops&status=open',
  },
  {
    id: 'po',
    label: 'PO',
    emoji: '📋',
    model: 'claude-sonnet-4-6',
    role: 'Product owner',
    description: 'Tier-2 decomposer. Picks up backlog features and writes 1–5 child tasks sized 1–2 days each. Fills DoR fields before moving to open.',
    queueFilter: 'type=feature&status=backlog',
  },
  {
    id: 'kemuni-sme',
    label: 'Kemuni SME',
    emoji: '🚀',
    model: 'claude-sonnet-4-6',
    role: 'Kemuni specialist (Tier-1 decomposer)',
    description: 'Decomposes Kemuni-project epics into features. Produces features with title, AC, priority, and parent_id.',
    queueFilter: 'type=epic&project=Kemuni&status=backlog',
  },
  {
    id: 'vespera-sme',
    label: 'Vespera SME',
    emoji: '🖤',
    model: 'claude-sonnet-4-6',
    role: 'Vespera specialist (Tier-1 decomposer)',
    description: 'Decomposes Vespera-project epics into features. Focuses on Vespera domain knowledge and acceptance criteria.',
    queueFilter: 'type=epic&project=Vespera&status=backlog',
  },
  {
    id: 'todero-sme',
    label: 'Todero SME',
    emoji: '🧭',
    model: 'claude-sonnet-4-6',
    role: 'Todero platform specialist (Tier-1 decomposer)',
    description: 'Decomposes Todero-project epics into features. Understands the MC API, agent pipeline, and board architecture.',
    queueFilter: 'type=epic&project=Todero&status=backlog',
  },
  {
    id: 'infra-sme',
    label: 'Infra SME',
    emoji: '🛠️',
    model: 'claude-sonnet-4-6',
    role: 'Infrastructure specialist (Tier-1 decomposer)',
    description: 'Decomposes Infrastructure-project epics into features. Handles LaunchAgents, watchdogs, and pipeline config.',
    queueFilter: 'type=epic&project=Infrastructure&status=backlog',
  },
  {
    id: 'auditor',
    label: 'Auditor',
    emoji: '🔍',
    model: 'claude-sonnet-4-6',
    role: 'Audit/review',
    description: 'Performs cross-cutting audits of the codebase, agent behavior, and issue lifecycle. Reports findings.',
    queueFilter: null,
  },
  {
    id: 'deployer',
    label: 'Deployer',
    emoji: '🚢',
    model: 'claude-haiku-4-5',
    role: 'Deploy coordination',
    description: 'Coordinates the PR window (7am/7pm ET). Rebases branches on main, creates batched PRs, triggers auto-merge.',
    queueFilter: null,
  },
]

const MODEL_COLOR: Record<string, string> = {
  'claude-sonnet-4-6': 'text-violet-400 bg-violet-400/10',
  'claude-haiku-4-5': 'text-sky-400 bg-sky-400/10',
}

const SOURCE_STYLE: Record<string, string> = {
  local: 'text-amber-400 bg-amber-400/10',
  registry: 'text-emerald-400 bg-emerald-400/10',
}

export default function MarketplaceTab() {
  return (
    <div className="space-y-10">
      {/* Skills Section */}
      <div className="space-y-4">
        <div>
          <h2 className="text-white text-lg font-semibold">Skills Catalog</h2>
          <p className="text-white/40 text-sm mt-0.5">
            Behavioral skills available to agents in the Todero pipeline — view only.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {SKILLS_CATALOG.map(skill => (
            <div
              key={skill.slug}
              className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col gap-3"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xl">{skill.emoji}</span>
                  <div>
                    <div className="text-white font-medium text-sm leading-tight">{skill.name}</div>
                    <div className="text-white/40 text-xs font-mono">{skill.slug}</div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span
                    className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${SOURCE_STYLE[skill.source] ?? 'text-white/40 bg-white/5'}`}
                  >
                    {skill.source}
                  </span>
                  {skill.version && (
                    <span className="text-white/25 text-[10px] font-mono">v{skill.version}</span>
                  )}
                </div>
              </div>

              {/* Description */}
              <p className="text-white/60 text-xs leading-relaxed flex-1">{skill.description}</p>

              {/* Triggers */}
              <div className="border-t border-white/5 pt-2 space-y-2">
                <div>
                  <div className="text-white/30 text-[10px] uppercase tracking-wide mb-0.5">Trigger conditions</div>
                  <p className="text-white/50 text-[10px] leading-relaxed">{skill.triggers}</p>
                </div>
                <div>
                  <div className="text-white/30 text-[10px] uppercase tracking-wide mb-1">Applies to</div>
                  <div className="flex flex-wrap gap-1">
                    {skill.agents.map(agent => (
                      <span
                        key={agent}
                        className="text-white/50 text-[10px] bg-white/5 px-1.5 py-0.5 rounded"
                      >
                        {agent}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Agent Catalog */}
      <div className="space-y-4">
      <div>
        <h2 className="text-white text-lg font-semibold">Agent Catalog</h2>
        <p className="text-white/40 text-sm mt-0.5">
          All available agent types in the Todero pipeline — view only.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {AGENT_CATALOG.map(agent => (
          <div
            key={agent.id}
            className="bg-white/5 border border-white/10 rounded-xl p-4 flex flex-col gap-3"
          >
            {/* Header */}
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-xl">{agent.emoji}</span>
                <div>
                  <div className="text-white font-medium text-sm leading-tight">{agent.label}</div>
                  <div className="text-white/40 text-xs">{agent.id}</div>
                </div>
              </div>
              <span
                className={`text-[10px] font-mono px-2 py-0.5 rounded-full shrink-0 ${MODEL_COLOR[agent.model] ?? 'text-white/40 bg-white/5'}`}
              >
                {agent.model.replace('claude-', '')}
              </span>
            </div>

            {/* Role badge */}
            <div className="flex items-center gap-1.5">
              <span className="text-white/50 text-[10px] uppercase tracking-wide font-medium bg-white/5 px-2 py-0.5 rounded">
                {agent.role}
              </span>
            </div>

            {/* Description */}
            <p className="text-white/60 text-xs leading-relaxed flex-1">{agent.description}</p>

            {/* Queue filter */}
            {agent.queueFilter ? (
              <div className="border-t border-white/5 pt-2">
                <div className="text-white/30 text-[10px] mb-1 uppercase tracking-wide">Queue filter</div>
                <code className="text-white/50 text-[10px] font-mono break-all">{agent.queueFilter}</code>
              </div>
            ) : (
              <div className="border-t border-white/5 pt-2">
                <span className="text-white/20 text-[10px] font-mono">no queue filter — triggered manually</span>
              </div>
            )}
          </div>
        ))}
      </div>
      </div>
    </div>
  )
}

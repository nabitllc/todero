import { NextRequest, NextResponse } from 'next/server'

// TOD-1332: Static agent configuration data
// Queue pickup filters and escalation triggers sourced from AGENTS.md

export interface AgentConfig {
  id: string
  name: string
  model: string
  systemPromptSource: string
  queueFilter: string | null
  skills: string[]
  escalationTriggers: string[]
}

const MODEL_MAP: Record<string, string> = {
  main:          'claude-sonnet-4-6',
  scout:         'claude-sonnet-4-6',
  ops:           'claude-haiku-4-5',
  'kemuni-sme':  'claude-sonnet-4-6',
  'vespera-sme': 'claude-sonnet-4-6',
  'todero-sme':  'claude-sonnet-4-6',
  'infra-sme':   'claude-sonnet-4-6',
  builder:       'claude-sonnet-4-6',
  tester:        'claude-haiku-4-5',
  deployer:      'claude-haiku-4-5',
  ux:            'claude-haiku-4-5',
  designer:      'claude-haiku-4-5',
  po:            'claude-sonnet-4-6',
  growth:        'claude-sonnet-4-6',
  security:      'claude-sonnet-4-6',
  community:     'claude-sonnet-4-6',
  content:       'claude-sonnet-4-6',
  auditor:       'claude-sonnet-4-6',
}

const QUEUE_FILTER_MAP: Record<string, string> = {
  'todero-sme':  'type=epic&project=Todero&status=backlog',
  'kemuni-sme':  'type=epic&project=Kemuni&status=backlog',
  'vespera-sme': 'type=epic&project=Vespera&status=backlog',
  'infra-sme':   'type=epic&project=Infrastructure&status=backlog',
  builder:       'type=task,bug&status=open&assignee=builder',
  tester:        'type=task,bug&status=code_review',
  po:            'type=feature,task,bug&status=backlog',
  ops:           'type=ops&status=open&assignee=ops',
  scout:         'type=task&status=open&assignee=scout',
  deployer:      'type=task&status=approved&assignee=deployer',
  auditor:       'type=task,ops&status=open&assignee=auditor',
}

const ESCALATION_MAP: Record<string, string[]> = {
  main:          ['Task involves >3 interdependent systems', 'Prior attempt failed', 'Michael explicitly requests deeper analysis', 'Context >60k tokens'],
  builder:       ['Task too large mid-execution (file Inbox TOD-792)', 'Build fails after 3 retries', 'Schema change required', 'Cross-project dependency'],
  tester:        ['P0/P1 defect found', 'AC not verifiable', 'Security concern detected'],
  ops:           ['Infrastructure down', 'Deployment failure', 'Health check failing >15m'],
  scout:         ['Source unreachable', 'Conflicting findings require judgment', 'Competitive signal requires strategy discussion'],
  po:            ['Feature scope too large for 1-5 tasks', 'Missing parent epic', 'Cross-SME dependency'],
  deployer:      ['PR not merged', 'CI failing', 'Rollback required'],
  'kemuni-sme':  ['UX/design heavy → designer review required', 'Security concern in AC', 'Cross-project dependency'],
  'vespera-sme': ['UX/design heavy → designer review required', 'Security concern in AC', 'Cross-project dependency'],
  'todero-sme':  ['UX/design heavy → designer review required', 'Security concern in AC', 'Cross-project dependency'],
  'infra-sme':   ['UX/design heavy → designer review required', 'Security concern in AC', 'Cross-project dependency'],
  auditor:       ['Drift found in production', 'Config mismatch detected', 'Task hygiene violations >3'],
  designer:      ['Brand inconsistency', 'Accessibility failure', 'Mobile layout broken'],
  ux:            ['Brand inconsistency', 'Accessibility failure', 'Mobile layout broken'],
}

const SKILLS_MAP: Record<string, string[]> = {
  main:          ['Orchestration', 'Memory', 'Strategy', 'Comms', 'Delegation'],
  scout:         ['Web Research', 'Summarization', 'Trends'],
  ops:           ['Infrastructure', 'Monitoring', 'Alerts'],
  'kemuni-sme':  ['Product Strategy', 'Kemuni', 'PropTech'],
  'vespera-sme': ['Product Strategy', 'Vespera', 'Community'],
  'todero-sme':  ['Product Strategy', 'Todero', 'Platform'],
  'infra-sme':   ['Infrastructure', 'DevOps', 'Security'],
  builder:       ['Coding', 'PRs', 'Refactoring', 'Next.js', 'Supabase'],
  tester:        ['Code Review', 'QA', 'Test Suites', 'DoD Enforcement'],
  deployer:      ['Deployments', 'Webhooks', 'Release Notes'],
  ux:            ['UI Review', 'Mobile UX', 'Design System', 'Accessibility'],
  designer:      ['Design System', 'UI Review', 'Visual QA', 'Accessibility'],
  po:            ['PRDs', 'Backlog Grooming', 'Sprint Facilitation', 'DoR'],
  growth:        ['Monetization', 'GTM', 'Pricing', 'LATAM'],
  security:      ['OWASP', 'Auth Review', 'RLS Audit', 'CVE Scanning'],
  community:     ['Social Content', 'Brand Voice', 'Colombia Goth'],
  content:       ['Blog', 'SEO', 'Email', 'Help Docs'],
  auditor:       ['Drift Detection', 'Config Audit', 'Task Hygiene'],
}

// Context is now loaded from Supabase agent_documents table (AGENT_CONTEXT_SOURCE=db).
// These labels are display-only strings shown in the Agent Config UI panel.
const DB_SOURCE = 'Supabase: agent_documents (soul + agents handbook + skills)'

const SYSTEM_PROMPT_MAP: Record<string, string> = {
  main:          DB_SOURCE,
  builder:       `${DB_SOURCE}, worktree CLAUDE.md`,
  tester:        DB_SOURCE,
  ops:           DB_SOURCE,
  scout:         DB_SOURCE,
  po:            DB_SOURCE,
  deployer:      DB_SOURCE,
  'kemuni-sme':  DB_SOURCE,
  'vespera-sme': DB_SOURCE,
  'todero-sme':  DB_SOURCE,
  'infra-sme':   DB_SOURCE,
  designer:      DB_SOURCE,
  ux:            DB_SOURCE,
  auditor:       DB_SOURCE,
  growth:        DB_SOURCE,
  security:      DB_SOURCE,
  community:     DB_SOURCE,
  content:       DB_SOURCE,
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const agentId = searchParams.get('id')

  const buildConfig = (id: string): AgentConfig => ({
    id,
    name: id,
    model: MODEL_MAP[id] ?? 'claude-sonnet-4-6',
    systemPromptSource: SYSTEM_PROMPT_MAP[id] ?? DB_SOURCE,
    queueFilter: QUEUE_FILTER_MAP[id] ?? null,
    skills: SKILLS_MAP[id] ?? [],
    escalationTriggers: ESCALATION_MAP[id] ?? [],
  })

  if (agentId) {
    if (!MODEL_MAP[agentId] && !SKILLS_MAP[agentId]) {
      return NextResponse.json({ error: 'Unknown agent id' }, { status: 404 })
    }
    return NextResponse.json(buildConfig(agentId))
  }

  // Return all agents
  const all = Object.keys(MODEL_MAP).map(buildConfig)
  return NextResponse.json(all)
}

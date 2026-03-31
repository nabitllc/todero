// TOD-576: Per-agent autonomous queue configuration
// Defines selection criteria, WIP limits, blocked-item handling, and
// status transitions for each agent's one-at-a-time queue lane.

export interface AgentQueueConfig {
  agentId: string
  /** Supabase filter for which issues this agent picks up */
  pickupStatus: string
  /** Additional Supabase query filters (appended to URL) */
  extraFilters: string
  /** Fields required for Definition of Ready — skip issues missing these */
  dorFields: string[]
  /** Max concurrent in_progress (WIP limit) */
  wipLimit: number
  /** Status to set when agent starts working */
  workingStatus: string
  /** Status to set when agent completes work */
  completionStatus: string
  /** Whether to check blocked_by dependencies */
  checkBlocking: boolean
  /** Sort order — Supabase order param */
  sortOrder: string
  /** Max issues to fetch per tick */
  fetchLimit: number
  /** Prompt template prefix for the agent */
  promptPrefix: string
}

export const AGENT_QUEUE_CONFIGS: Record<string, AgentQueueConfig> = {
  builder: {
    agentId: 'builder',
    pickupStatus: 'open',
    extraFilters: 'description=not.is.null&test_tier=not.is.null',
    dorFields: ['description', 'acceptance_criteria', 'test_tier'],
    wipLimit: 3,
    workingStatus: 'in_progress',
    completionStatus: 'in_review',
    checkBlocking: true,
    sortOrder: 'priority.asc,due_date.asc.nullslast',
    fetchLimit: 50,
    promptPrefix: 'You are Builder. Implement the following task. Run npm run build to verify. Commit with [skip ci].',
  },

  tester: {
    agentId: 'tester',
    pickupStatus: 'in_review',
    extraFilters: '',
    dorFields: ['acceptance_criteria'],
    wipLimit: 5,
    workingStatus: 'in_review', // tester doesn't change status on pickup
    completionStatus: 'done',   // or back to open on failure
    checkBlocking: false,
    sortOrder: 'priority.asc',
    fetchLimit: 5,
    promptPrefix: 'You are Tester. Review this issue against its acceptance criteria. Verify the code changes and run npm run build.',
  },

  scout: {
    agentId: 'scout',
    pickupStatus: 'open',
    extraFilters: '',
    dorFields: ['description', 'acceptance_criteria'],
    wipLimit: 2,
    workingStatus: 'in_progress',
    completionStatus: 'in_review',
    checkBlocking: true,
    sortOrder: 'priority.asc,due_date.asc.nullslast',
    fetchLimit: 10,
    promptPrefix: 'You are Scout. Research the following task. Summarize findings, cite sources, and provide actionable recommendations.',
  },

  security: {
    agentId: 'security',
    pickupStatus: 'open',
    extraFilters: '',
    dorFields: ['description', 'acceptance_criteria'],
    wipLimit: 2,
    workingStatus: 'in_progress',
    completionStatus: 'in_review',
    checkBlocking: true,
    sortOrder: 'priority.asc',
    fetchLimit: 10,
    promptPrefix: 'You are Security Auditor. Audit the following against OWASP top 10, auth review, RLS policies, and CVE exposure.',
  },

  community: {
    agentId: 'community',
    pickupStatus: 'open',
    extraFilters: '',
    dorFields: ['description', 'acceptance_criteria'],
    wipLimit: 2,
    workingStatus: 'in_progress',
    completionStatus: 'in_review',
    checkBlocking: false,
    sortOrder: 'priority.asc',
    fetchLimit: 10,
    promptPrefix: 'You are Community Manager. Execute the following community or social content task with brand voice consistency.',
  },

  content: {
    agentId: 'content',
    pickupStatus: 'open',
    extraFilters: '',
    dorFields: ['description', 'acceptance_criteria'],
    wipLimit: 2,
    workingStatus: 'in_progress',
    completionStatus: 'in_review',
    checkBlocking: false,
    sortOrder: 'priority.asc',
    fetchLimit: 10,
    promptPrefix: 'You are Content Creator. Produce the following content (blog, SEO, email, or help docs) per the acceptance criteria.',
  },
}

export function getQueueConfig(agentId: string): AgentQueueConfig | undefined {
  return AGENT_QUEUE_CONFIGS[agentId]
}

export function getAllQueueAgentIds(): string[] {
  return Object.keys(AGENT_QUEUE_CONFIGS)
}

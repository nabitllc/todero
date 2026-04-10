// TOD-576: Per-agent autonomous queue configuration
// Defines selection criteria, WIP limits, blocked-item handling, and
// status transitions for each agent's one-at-a-time queue lane.

export interface AgentQueueConfig {
  agentId: string
  /** Claude model alias: 'opus', 'sonnet', or 'haiku' */
  model: 'opus' | 'sonnet' | 'haiku'
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
  /**
   * Extra Supabase filter appended to the WIP count query only.
   * Used when pickupStatus === workingStatus (e.g. deployer) to
   * distinguish "claimed" issues (started_at set) from the full queue.
   */
  wipExtraFilter?: string
}

export const AGENT_QUEUE_CONFIGS: Record<string, AgentQueueConfig> = {
  builder: {
    agentId: 'builder',
    model: 'sonnet',
    pickupStatus: 'open',
    extraFilters: '',
    dorFields: ['description', 'acceptance_criteria'],
    wipLimit: 1,
    workingStatus: 'in_progress',
    completionStatus: 'code_review',
    checkBlocking: true,
    sortOrder: 'priority.asc,due_date.asc.nullslast',
    fetchLimit: 50,
    promptPrefix: 'You are Builder. Implement the following task. Run npm run build to verify. Commit with [skip ci]. Add [skip ci] to ALL commits.',
  },

  ops: {
    agentId: 'ops',
    model: 'sonnet',
    pickupStatus: 'open',
    extraFilters: '',
    dorFields: ['description', 'acceptance_criteria'],
    wipLimit: 1,
    workingStatus: 'in_progress',
    completionStatus: 'code_review',
    checkBlocking: true,
    sortOrder: 'priority.asc,due_date.asc.nullslast',
    fetchLimit: 20,
    promptPrefix: 'You are Ops. Handle this infrastructure/config task. Verify changes work. Commit with [skip ci].',
  },

  tester: {
    agentId: 'tester',
    model: 'haiku',
    pickupStatus: 'code_review',
    extraFilters: '',
    dorFields: ['acceptance_criteria'],
    wipLimit: 1,
    workingStatus: 'code_review',
    completionStatus: 'approved',
    checkBlocking: false,
    sortOrder: 'priority.asc',
    fetchLimit: 5,
    promptPrefix: 'You are Tester. Review this issue against its acceptance criteria. Verify code changes, run npm run build. If passes: PATCH to approved with test_status=passed + reviewer_notes. If fails: PATCH back to open with reviewer_notes explaining what failed.',
  },

  designer: {
    agentId: 'designer',
    model: 'haiku',
    pickupStatus: 'code_review',
    extraFilters: '',
    dorFields: ['acceptance_criteria'],
    wipLimit: 1,
    workingStatus: 'code_review',
    completionStatus: 'approved',
    checkBlocking: false,
    sortOrder: 'priority.asc',
    fetchLimit: 5,
    promptPrefix: 'You are Designer. Review this issue for UX/design quality. Check responsive layout, accessibility, design system compliance. If passes: PATCH designer_status=ux_approved. If fails: PATCH back to open with designer_notes.',
  },

  po: {
    agentId: 'po',
    model: 'sonnet',
    pickupStatus: 'backlog',
    extraFilters: 'type=in.(feature,task,bug)',
    dorFields: ['title'],
    wipLimit: 3,
    workingStatus: 'defined',
    completionStatus: 'open',
    checkBlocking: false,
    sortOrder: 'priority.asc,created_at.asc',
    fetchLimit: 10,
    promptPrefix: 'You are Product Owner. Refine this issue: add description, acceptance criteria, set priority, severity, reviewer, owner. For FEATURES: create child tasks (each 1-2 days of work) before moving to defined. For EPICS: verify child features exist and have AC. When all DoR fields are set, PATCH to defined. Then check defined issues — if they have sprint, assignee, reviewer, owner, PATCH to open. Self-chain: after finishing, call POST /api/run-agent?agent=po to claim next.',
  },

  scout: {
    agentId: 'scout',
    model: 'sonnet',
    pickupStatus: 'open',
    extraFilters: '',
    dorFields: ['description', 'acceptance_criteria'],
    wipLimit: 1,
    workingStatus: 'in_progress',
    completionStatus: 'product_review',
    checkBlocking: true,
    sortOrder: 'priority.asc,due_date.asc.nullslast',
    fetchLimit: 10,
    promptPrefix: 'You are Scout. Research the following task. Summarize findings, cite sources, provide actionable recommendations.',
  },

  auditor: {
    agentId: 'auditor',
    model: 'haiku',
    pickupStatus: 'released',
    extraFilters: '',
    dorFields: ['implementation_notes'],
    wipLimit: 1,
    workingStatus: 'released',
    completionStatus: 'closed',
    checkBlocking: false,
    sortOrder: 'priority.asc',
    fetchLimit: 5,
    promptPrefix: 'You are Auditor. Verify this released issue: check PR was merged, build passes, acceptance criteria met, no regressions. If all good: PATCH to closed. If issues found: create a new bug issue, then PATCH current to closed.',
  },

  deployer: {
    agentId: 'deployer',
    model: 'haiku',
    pickupStatus: 'approved',
    extraFilters: '',
    // implementation_notes + commit_sha required: both must exist before deployer picks up
    dorFields: ['implementation_notes', 'commit_sha'],
    // TOD-784: deployer stays in 'approved' while working (no separate deploying status).
    // wipExtraFilter restricts WIP count to claimed issues only (started_at set),
    // preventing the full queue length from being mis-counted as active WIP.
    wipLimit: 3,
    workingStatus: 'approved',
    completionStatus: 'released',
    checkBlocking: false,
    sortOrder: 'priority.asc',
    fetchLimit: 20,
    wipExtraFilter: 'started_at=not.is.null',
    promptPrefix: 'You are Deployer. For the assigned issue: verify implementation_notes, commit_sha, and regression_test are all present. PATCH it to released. Then self-chain: POST /api/run-agent?agent=deployer to claim the next approved issue.',
  },
}

export function getQueueConfig(agentId: string): AgentQueueConfig | undefined {
  return AGENT_QUEUE_CONFIGS[agentId]
}

export function getAllQueueAgentIds(): string[] {
  return Object.keys(AGENT_QUEUE_CONFIGS)
}

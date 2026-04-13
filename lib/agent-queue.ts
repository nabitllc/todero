// TOD-576: Per-agent autonomous queue configuration
// Defines selection criteria, WIP limits, blocked-item handling, and
// status transitions for each agent's one-at-a-time queue lane.

/**
 * Runtime-agnostic model alias. Each runtime adapter maps this to its own
 * provider-specific model (e.g. claude-sonnet-4-6, gpt-5, gpt-4o).
 */
export type ModelAlias = 'opus' | 'sonnet' | 'haiku'

/**
 * A model binding specifies which runtime + which alias to try.
 * Example: { runtime: 'claude-code', alias: 'sonnet' } → Claude Sonnet
 *          { runtime: 'codex',       alias: 'opus'   } → GPT-5 via Codex CLI
 */
export interface ModelBinding {
  runtime: 'claude-code' | 'codex' | 'cursor' | 'openai-api'
  alias: ModelAlias
}

export interface AgentQueueConfig {
  agentId: string
  /** Primary model alias (legacy — used when runtime is current default) */
  model: ModelAlias
  /** Supabase filter for which issues this agent picks up */
  pickupStatus: string
  /** Additional Supabase query filters (appended to URL) */
  extraFilters: string
  /** Optional extra filter appended to WIP-count query when pickupStatus === workingStatus (deployer). */
  wipExtraFilter?: string
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
   * TOD-XXX: Main + fallback chain. The dispatcher tries each binding in order
   * until one is `available` (runtime installed + API reachable). First binding
   * wins on a fresh spawn; when one fails mid-task, the chain IS NOT re-evaluated
   * for that in-flight spawn — failover happens only on the next claim.
   *
   * If undefined, dispatcher falls back to { runtime: <default>, alias: model }.
   */
  modelChain?: ModelBinding[]
}

export const AGENT_QUEUE_CONFIGS: Record<string, AgentQueueConfig> = {
  builder: {
    agentId: 'builder',
    model: 'sonnet',
    pickupStatus: 'open',
    extraFilters: '',
    dorFields: ['description', 'acceptance_criteria'],
    // TOD-XXX (2026-04-10, Michael approved): bumped from 1 to 2 for parallel
    // builds. Safe now that each spawn runs in its own isolated git worktree
    // (TOD-806) so two concurrent Builders can't collide on branch state.
    wipLimit: 2,
    workingStatus: 'in_progress',
    completionStatus: 'code_review',
    checkBlocking: true,
    sortOrder: 'priority.asc,due_date.asc.nullslast',
    fetchLimit: 50,
    promptPrefix: 'You are Builder. Implement the following task. Run npm run build to verify. Commit with [skip ci]. Add [skip ci] to ALL commits.',
    modelChain: [
      { runtime: 'claude-code', alias: 'sonnet' },  // primary: Claude Sonnet 4.6
      { runtime: 'codex',       alias: 'sonnet' },  // fallback 1: Codex o4-mini
      { runtime: 'cursor',      alias: 'sonnet' },  // fallback 2: Cursor w/ Sonnet
    ],
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
    promptPrefix: 'You are Ingo (Infrastructure Agent). Handle this infrastructure/config task. Verify changes work. Commit with [skip ci].',
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

  // TOD-XXX (2026-04-10): PO promptPrefix updated to fix sprint-date hygiene.
  // Before: PO was creating child tasks with sprint='2026-04-01' (a closed sprint),
  // making them invisible on the Board. Backend guard in /api/issues also
  // auto-corrects wrong dates, but telling PO directly prevents the mistake.
  po: {
    agentId: 'po',
    model: 'sonnet',
    pickupStatus: 'backlog',
    extraFilters: 'type=in.(feature,task,bug)',
    // CRITICAL: pickupStatus !== workingStatus but PO leaves items in 'defined'
    // as a staging area. Without this filter, ALL defined items count as WIP,
    // permanently locking PO at 23/3. Only count items PO has actively claimed.
    // This line has been reverted 3 times by linters/agents — DO NOT REMOVE.
    wipExtraFilter: 'started_at=not.is.null',
    dorFields: ['title'],
    wipLimit: 3,
    workingStatus: 'defined',
    completionStatus: 'open',
    checkBlocking: false,
    sortOrder: 'priority.asc,created_at.asc',
    fetchLimit: 10,
    promptPrefix: 'You are Product Owner. Refine this issue: add description, acceptance criteria, set priority, severity, reviewer, owner. For FEATURES: create child tasks (each 1-2 days of work) before moving to defined. For EPICS: verify child features exist and have AC. When all DoR fields are set, PATCH to defined. Then check defined issues — if they have sprint, assignee, reviewer, owner, PATCH to open. **SPRINT DATE HYGIENE (2026-04-10): whenever you create a new child task, ALWAYS set sprint to today\'s date in YYYY-MM-DD format (America/New_York timezone). Never use a past date. The backend auto-corrects wrong dates but you should set it right the first time.** Self-chain: after finishing, call POST /api/run-agent?agent=po to claim next.',
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
    // pickupStatus === workingStatus → same deadlock as PO/deployer.
    // DO NOT REMOVE — has been reverted 3 times.
    wipExtraFilter: 'started_at=not.is.null',
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
    // pickupStatus === workingStatus → same deadlock as PO/auditor.
    // DO NOT REMOVE — has been reverted 3 times.
    wipExtraFilter: 'started_at=not.is.null',
    dorFields: ['implementation_notes'],
    wipLimit: 5,
    workingStatus: 'approved',
    completionStatus: 'released',
    checkBlocking: false,
    sortOrder: 'priority.asc',
    fetchLimit: 20,
    promptPrefix: 'You are Deployer. Verify all approved issues have required fields (implementation_notes, commit_sha, regression_test). Prepare for PR window.',
  },
}

export function getQueueConfig(agentId: string): AgentQueueConfig | undefined {
  return AGENT_QUEUE_CONFIGS[agentId]
}

export function getAllQueueAgentIds(): string[] {
  return Object.keys(AGENT_QUEUE_CONFIGS)
}
// test

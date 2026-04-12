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

  // TOD-XXX (2026-04-11): PO is now the Tier-2 decomposer (Feature → Tasks).
  // Tier-1 decomposition (Epic → Features) is owned by a separate pickup
  // agent per hub: todero-sme, kemuni-sme, vespera-sme, infra-sme.
  // Because pickupStatus === workingStatus for po (`defined`), the WIP filter
  // must look at started_at to avoid counting unclaimed backlog as active WIP.
  po: {
    agentId: 'po',
    model: 'sonnet',
    pickupStatus: 'backlog',
    extraFilters: 'type=in.(feature,task,bug)',
    wipExtraFilter: 'started_at=not.is.null',
    dorFields: ['title'],
    wipLimit: 3,
    workingStatus: 'defined',
    completionStatus: 'open',
    checkBlocking: false,
    sortOrder: 'priority.asc,created_at.asc',
    fetchLimit: 10,
    promptPrefix: `You are Product Owner (PO). Tier-2 decomposer: Feature → Tasks.

RESPONSIBILITY BOUNDARY: You ONLY work on features/tasks/bugs. You do NOT decompose epics. Epic → Feature decomposition is owned by the domain SME (todero-sme / kemuni-sme / vespera-sme / infra-sme) depending on the epic's project field.

Refine this issue: add description, acceptance criteria, set priority, severity, reviewer, owner.
- For FEATURES: create 1-5 child tasks (each 1-2 days of work) before moving to defined. Each child must have sprint set to today's date (YYYY-MM-DD, America/New_York).
- For TASKS/BUGS: no further decomposition needed. When all DoR fields are set, PATCH to defined. Then check defined issues — if they have sprint, assignee, reviewer, owner, PATCH to open.

SPRINT DATE HYGIENE: whenever you create a new child task, ALWAYS set sprint to today's date in YYYY-MM-DD format (America/New_York timezone). Never use a past date.

Self-chain: after finishing, call POST /api/run-agent?agent=po to claim next.`,
  },

  // ── Tier-1 decomposers (Epic → Features), one per domain ────────────────
  // Each picks up epics from backlog by project, writes 1-5 child features,
  // and leaves the epic in draft. The validator enforces children_exist on
  // draft → active (≥1 child, no maximum), so small epics that only need 1
  // feature still progress normally.

  'todero-sme': {
    agentId: 'todero-sme',
    model: 'sonnet',
    pickupStatus: 'backlog',
    extraFilters: 'type=eq.epic&project=eq.Todero',
    wipExtraFilter: 'started_at=not.is.null',
    dorFields: ['title'],
    wipLimit: 2,
    workingStatus: 'draft',
    completionStatus: 'draft',
    checkBlocking: false,
    sortOrder: 'priority.asc,created_at.asc',
    fetchLimit: 5,
    promptPrefix: `You are the Todero SME. Tier-1 decomposer for the Todero platform — pipeline, agents, MC API, runtime adapters, workflow validator, board UI, observability.

RESPONSIBILITY: Take a Todero epic from backlog → draft. Write 1-5 child features that together satisfy the epic's intent. Each feature must include:
- title (action-oriented, ≤ 80 chars)
- description (what + why)
- acceptance_criteria (numbered list)
- priority (critical/high/medium/low)
- parent_id (this epic's id)
- project: 'Todero'
- sprint: today's date (YYYY-MM-DD America/New_York)
- type: 'feature'
- assignee: 'po'

DO NOT decompose features into tasks — that's PO's job. Your output is features only. If the epic's scope is small enough to fit in one feature, create exactly one — don't pad.

Consult other agents when relevant:
- UX/design heavy → add 'designer review required' to AC
- Infra heavy → PATCH the epic with implementation_notes='Needs Infra SME routing' and stop
- Security → explicit security-review AC item

Self-chain: after finishing, call POST /api/run-agent?agent=todero-sme.`,
  },

  'kemuni-sme': {
    agentId: 'kemuni-sme',
    model: 'sonnet',
    pickupStatus: 'backlog',
    extraFilters: 'type=eq.epic&project=eq.Kemuni',
    wipExtraFilter: 'started_at=not.is.null',
    dorFields: ['title'],
    wipLimit: 2,
    workingStatus: 'draft',
    completionStatus: 'draft',
    checkBlocking: false,
    sortOrder: 'priority.asc,created_at.asc',
    fetchLimit: 5,
    promptPrefix: `You are the Kemuni SME. Tier-1 decomposer for the Kemuni platform — HOA management, resident experience, dues collection, community features, PropTech LATAM context.

RESPONSIBILITY: Take a Kemuni epic from backlog → draft. Write 1-5 child features. Each feature must have: title, description, acceptance_criteria, priority, parent_id, project='Kemuni', sprint (today), type='feature', assignee='po'.

If the epic fits in one feature, create exactly one. Brand context: Spanish-first UX, Colombia HOA regulatory compliance, Stripe integration for dues.

Self-chain: after finishing, call POST /api/run-agent?agent=kemuni-sme.`,
  },

  'vespera-sme': {
    agentId: 'vespera-sme',
    model: 'sonnet',
    pickupStatus: 'backlog',
    extraFilters: 'type=eq.epic&project=eq.Vespera',
    wipExtraFilter: 'started_at=not.is.null',
    dorFields: ['title'],
    wipLimit: 2,
    workingStatus: 'draft',
    completionStatus: 'draft',
    checkBlocking: false,
    sortOrder: 'priority.asc,created_at.asc',
    fetchLimit: 5,
    promptPrefix: `You are the Vespera SME. Tier-1 decomposer for Vespera — Colombia goth community platform, events, user-to-user messaging, check-ins, community safety.

RESPONSIBILITY: Take a Vespera epic from backlog → draft. Write 1-5 child features. Each feature must have: title, description, acceptance_criteria, priority, parent_id, project='Vespera', sprint (today), type='feature', assignee='po'.

If the epic fits in one feature, create exactly one. Brand context: goth aesthetic, Spanish-first UX, Colombia cultural context, harassment-prevention patterns for community features.

Self-chain: after finishing, call POST /api/run-agent?agent=vespera-sme.`,
  },

  'infra-sme': {
    agentId: 'infra-sme',
    model: 'sonnet',
    pickupStatus: 'backlog',
    extraFilters: 'type=eq.epic&project=eq.Infrastructure',
    wipExtraFilter: 'started_at=not.is.null',
    dorFields: ['title'],
    wipLimit: 2,
    workingStatus: 'draft',
    completionStatus: 'draft',
    checkBlocking: false,
    sortOrder: 'priority.asc,created_at.asc',
    fetchLimit: 5,
    promptPrefix: `You are the Infra SME. Tier-1 decomposer for the Infrastructure project — LaunchAgents, runtime adapters, observability, deployment, self-healing scripts, TCC grants, system hygiene.

RESPONSIBILITY: Take an Infrastructure epic from backlog → draft. Write 1-5 child features. Each feature must have: title, description, acceptance_criteria, priority, parent_id, project='Infrastructure', sprint (today), type='feature', assignee='po'.

If the epic fits in one feature, create exactly one. Focus areas: monitoring (monitor-stale, monitor-pr-merge, plist-drift-check), build reliability (start.sh, ensure-deps, worktree GC), observability (agent_runs, token ledger, Discord notifications), TCC permissions.

Self-chain: after finishing, call POST /api/run-agent?agent=infra-sme.`,
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
    // pickupStatus === workingStatus → unclaimed queue items would otherwise
    // count as active WIP and lock the lane against its own backlog.
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
    // pickupStatus === workingStatus → same deadlock as auditor. Unclaimed
    // approved items (waiting for pr-window.py) shouldn't count as active WIP.
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

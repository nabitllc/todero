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
  /** Primary status this agent picks up. Use pickupStatuses (array) for multi-status lanes. */
  pickupStatus: string
  /** Optional additional statuses to pick up (e.g. PO handles both backlog + feature_review). */
  pickupStatuses?: string[]
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
    extraFilters: 'type=in.(task,bug)&project=eq.Todero',  // Todero-only focus, tasks/bugs only
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
    promptPrefix: `You are Builder. Implement the following task.

Rules:
- Run npm run build before committing. Zero TypeScript errors required.
- Add [skip ci] to ALL commits (format: "feat(TOD-XXX): description [skip ci]").
- NEVER use gh pr create or create GitHub PRs. Deployer handles that.
- Push your feature branch: git push origin <branch>.
- When done, PATCH the issue to code_review via the MC API:
  PATCH /api/issues { task_key, status: "code_review", implementation_notes: "...", commit_sha: "...", regression_test: "..." }
- implementation_notes: what you built and how.
- commit_sha: the full SHA of your final commit (git rev-parse HEAD).
- regression_test: describe what to manually test to verify it works.
- Self-chain: after the PATCH succeeds, call POST /api/run-agent?agent=builder to claim your next task immediately.`,
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
    promptPrefix: 'You are Ingo (Infrastructure Agent). Handle this infrastructure/config task. Verify changes work. Commit with [skip ci]. When done, PATCH to code_review with implementation_notes + commit_sha + regression_test. Self-chain: call POST /api/run-agent?agent=ops to claim next.',
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
    pickupStatuses: ['backlog', 'feature_review'],  // also handles feature_review confirmation
    extraFilters: 'type=in.(feature,task,bug,ops,research)',
    // CRITICAL: pickupStatus !== workingStatus but PO leaves items in 'defined'
    // as a staging area. Without this filter, ALL defined items count as WIP,
    // permanently locking PO at 23/3. Only count items PO has actively claimed.
    // This line has been reverted 3 times by linters/agents — DO NOT REMOVE.
    wipExtraFilter: 'started_at=not.is.null',
    dorFields: ['title'],
    wipLimit: 3,
    workingStatus: 'refined',
    completionStatus: 'open',
    checkBlocking: false,
    sortOrder: 'priority.asc,created_at.asc',
    fetchLimit: 10,
    promptPrefix: `You are Product Owner. You handle two types of work:

## 1. REFINEMENT (backlog/defined issues)
Refine this issue: add description, acceptance criteria, set priority, severity, assignee, owner.
- TASKS/BUGS/OPS/RESEARCH: PATCH status to "refined" (not "defined").
- FEATURES: create child tasks (each 1-2 days of work) before moving to "defined".
- EPICS: verify child features exist and have AC.
Then check refined/defined issues — if they have priority, severity, assignee, owner, PATCH to "open" (tasks/bugs/ops/research) or "underway" (features). Sprint is auto-set on transition.

## 2. FEATURE REVIEW (feature_review issues)
When a feature is in feature_review, your job is to confirm it is actually done.

Steps:
1. Read the feature's description and acceptance_criteria carefully.
2. Check all child issues: GET /api/issues?parent_id={feature_id}
3. Assess: are ALL acceptance criteria met by the closed child issues?

If YES (feature is done — all children closed, all AC met):
- PATCH the feature: { status: "closed", resolution_type: "completed", implementation_notes: "Feature complete. All AC met: [brief summary]" }

If NO (children still open, OR gaps in AC coverage):
- If children are already open: PATCH the feature back to underway: { status: "underway", reviewer_notes: "Feature reverted — child [TOD-XXX] still open: [title]" }
- If new gaps found (no existing child covers them): create a new child task first. The feature will auto-revert to "underway" when the child is created (no manual PATCH needed for that case).
- Always explain in reviewer_notes what criteria are not yet met.

## Self-chain
After finishing, call POST /api/run-agent?agent=po to claim next.`,
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
    promptPrefix: 'You are Scout. Research the following task. Summarize findings, cite sources, provide actionable recommendations. When done, PATCH to product_review with implementation_notes. Self-chain: call POST /api/run-agent?agent=scout to claim next.',
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
    promptPrefix: `You are Deployer. Your job is to prepare approved branches for a clean, conflict-free PR window merge.

For EACH approved issue (process one at a time, sequentially):

1. VERIFY required fields exist: implementation_notes, commit_sha, regression_test, feature_branch.
   - If any are missing: PATCH status back to in_progress with a note listing what is missing. Skip to next issue.

2. REBASE the branch onto current main:
   cd ~/todero
   git fetch origin
   git checkout <feature_branch>
   git rebase origin/main

3. IF rebase conflicts occur: read config/skills/resolve-conflicts/SKILL.md and follow it exactly.
   - Resolve each conflict keeping both intents where possible.
   - Run npm run build after resolving to verify no compile errors.
   - If conflict is unresolvable: git rebase --abort, PATCH issue back to in_progress with detailed conflict notes, move to next issue.

4. IF rebase succeeds: run npm run build to verify the branch compiles cleanly on its own.
   - If build fails: PATCH back to in_progress with the build error. Move to next issue.

5. IF build passes: git push --force-with-lease origin <feature_branch> to update the remote branch.
   Log: "✓ TOD-XXX ready for PR window — rebased cleanly onto main"

6. Move to the next approved issue. Never process two branches simultaneously.

After all approved issues are processed: summarize what is ready for the PR window and what was sent back to in_progress and why.

NEVER run git push to main directly. NEVER create a PR. NEVER merge to main yourself. Your job ends at rebasing and validating each branch.`,
  },
}

export function getQueueConfig(agentId: string): AgentQueueConfig | undefined {
  return AGENT_QUEUE_CONFIGS[agentId]
}

export function getAllQueueAgentIds(): string[] {
  return Object.keys(AGENT_QUEUE_CONFIGS)
}
// test

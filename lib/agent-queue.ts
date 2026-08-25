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
  /** Primary status this agent picks up. null = no status filter (e.g. main triage agent). */
  pickupStatus: string | null
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
  /** Status to set when agent starts working. null = don't change status on pickup. */
  workingStatus: string | null
  /** Status to set when agent completes work. null = agent manages its own completion. */
  completionStatus: string | null
  /** Whether to check blocked_by dependencies */
  checkBlocking: boolean
  /** Sort order — Supabase order param */
  sortOrder: string
  /** Max issues to fetch per tick */
  fetchLimit: number
  /** Prompt template prefix for the agent */
  promptPrefix: string
  /** Skip the assignee=eq.agentId filter — used by triage agents that pick up any assignee */
  skipAssigneeFilter?: boolean
  /**
   * TOD-XXX: Main + fallback chain. The dispatcher tries each binding in order
   * until one is `available` (runtime installed + API reachable). First binding
   * wins on a fresh spawn; when one fails mid-task, the chain IS NOT re-evaluated
   * for that in-flight spawn — failover happens only on the next claim.
   *
   * If undefined, dispatcher falls back to { runtime: <default>, alias: model }.
   */
  modelChain?: ModelBinding[]
  /**
   * registry-reaches-dispatch piece: a concrete model id — e.g.
   * "qwen2.5-coder:14b" — from a Brain2 vault manifest's `model.fallback_local`,
   * present only when that manifest also set `local_eligible: true`. POST
   * /api/run-agent passes it as `AgentSpawnOptions.modelOverride` so a
   * local-eligible vault agent actually runs against it instead of only
   * being labelled local-eligible; `lib/runtimes/openai-api.ts`'s mapModel()
   * still checks it against the endpoint's own live model roster before
   * trusting it, so a stale manifest naming a model this host never pulled
   * falls through to the ordinary alias resolution rather than being
   * dispatched anyway. Undefined for every agent defined in this file.
   */
  localFallbackModel?: string
  /**
   * agent-config-panel-truth piece: the manifest's raw `model.preferred`
   * display name (e.g. "claude-opus-5") — never dispatched to directly (it
   * is not a runtime binding, just a human-facing label), but named here so
   * a caller building an honest "alternatives, and why each was not
   * selected" list can say what it is and why it never runs, instead of
   * either hiding it or — the defect this piece exists to fix — printing it
   * as if it were the model that would actually be used. Undefined for
   * every agent defined in this file (Todero's own lanes have no manifest).
   */
  preferred?: string
  /** 'todero' for every entry below; 'vault' for a config derived from a
   *  Brain2 manifest by lib/agent-manifests.ts. Read by callers that need to
   *  tell "one of our own lanes" apart from "a vault agent we made
   *  dispatchable by giving it Todero's own default queue behaviour". */
  source?: 'todero' | 'vault'
}

export const AGENT_QUEUE_CONFIGS: Record<string, AgentQueueConfig> = {
  builder: {
    agentId: 'builder',
    model: 'sonnet',
    pickupStatus: 'open',
    extraFilters: 'type=in.(task,bug)&project=eq.Todero',  // Todero-only focus, tasks/bugs only
    dorFields: ['description', 'acceptance_criteria', 'test_tier'],
    // TOD-XXX (2026-04-10, Michael approved): bumped from 1 to 2 for parallel
    // builds. Safe now that each spawn runs in its own isolated git worktree
    // (TOD-806) so two concurrent Builders can't collide on branch state.
    wipLimit: 2,
    workingStatus: 'in_progress',
    completionStatus: 'code_review',
    checkBlocking: true,
    sortOrder: 'priority.asc,due_date.asc.nullslast,created_at.asc',
    fetchLimit: 50,
    promptPrefix: `You are Builder. Implement the following task.

Rules:
- Run npm run build before committing. Zero TypeScript errors required.
- Add [skip ci] to ALL commits (format: "feat(TOD-XXX): description [skip ci]").
- NEVER run git push, git push origin, or any variant. You do NOT push branches. Ever.
- NEVER run gh pr create, gh pr merge, gh pr close, gh pr edit, or ANY gh command. You have no GitHub access. Deployer and KAOS handle all GitHub operations at PR windows (7am/7pm ET).
- After committing, the ONLY allowed next actions are: (1) PATCH the issue to code_review, then (2) exit. Nothing else.
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
    extraFilters: 'type=eq.ops',  // Ops only handles ops-type issues (infra, config, tooling)
    dorFields: ['description', 'acceptance_criteria', 'test_tier'],
    wipLimit: 1,
    workingStatus: 'in_progress',
    completionStatus: 'code_review',
    checkBlocking: true,
    sortOrder: 'priority.asc,due_date.asc.nullslast,created_at.asc',
    fetchLimit: 20,
    promptPrefix: 'You are Ingo (Infrastructure Agent). Handle this infrastructure/config task. Verify changes work. Commit with [skip ci]. When done, PATCH to code_review with implementation_notes + commit_sha + regression_test. Self-chain: call POST /api/run-agent?agent=ops to claim next.',
    modelChain: [
      { runtime: 'claude-code', alias: 'sonnet' },  // primary: heavy ops/infra reasoning
      { runtime: 'codex',       alias: 'sonnet' },  // fallback: Codex o4-mini
    ],
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
    promptPrefix: 'You are Tester. Review this issue against its acceptance criteria. Check resolution_type to understand what kind of change was made (code_change = code diff to verify; config_change = config/env change; research_completed = document review; etc.). Run npm run build. If passes: PATCH to approved with test_status=passed + reviewer_notes. If fails: PATCH back to open with reviewer_notes explaining what failed.',
    modelChain: [
      { runtime: 'claude-code', alias: 'haiku' },
    ],
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
    promptPrefix: 'You are Designer. Review this issue for UX/design quality. Check resolution_type to understand what changed (code_change = UI code touched; config_change = settings only, less visual review needed). Check responsive layout, accessibility, design system compliance. If passes: PATCH designer_status=ux_approved. If fails: PATCH back to open with designer_notes.',
    modelChain: [
      { runtime: 'claude-code', alias: 'haiku' },
    ],
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
    completionStatus: 'refined',  // PO's job ends at refined. queue-refill cron promotes to open.
    checkBlocking: false,
    sortOrder: 'priority.asc,created_at.asc',
    fetchLimit: 10,
    promptPrefix: `You are Product Owner. You handle two types of work:

## 1. REFINEMENT (backlog/defined issues)
Refine this issue: add description, acceptance criteria, set priority, severity, assignee, owner.
- TASKS/BUGS/OPS/RESEARCH: PATCH status to "refined" (not "defined", not "open").
- FEATURES: create child tasks (each 1-2 days of work) before moving to "defined".
- EPICS: verify child features exist and have AC.

CRITICAL — assignee rules when creating or refining child tasks:
- Todero tasks/bugs → assignee: "builder"
- Ops tasks (any project) → assignee: "ops"
- Kemuni tasks → assignee: "kemuni-sme"
- Vespera tasks → assignee: "vespera-sme"
- NEVER set assignee to "po" — PO only refines, never implements.

REQUIRED — test_tier must be set on every task, bug, and ops issue before moving to refined:
- "smoke"       → config change, tiny fix, no new code paths (tester: build + spot check)
- "integration" → new API route, component, or DB query (tester: check the integration end-to-end)
- "e2e"         → user-facing flow, auth path, or anything touching sprint/issue lifecycle (tester: walk full flow)
Research issues do NOT need test_tier (they go to product_review, not code_review).

Do NOT move refined issues to open yourself — queue-refill runs hourly and promotes refined → open automatically. Your job is backlog → refined only.

## 2. FEATURE REVIEW (feature_review issues)
When a feature is in feature_review, your job is to confirm it is actually done.

Steps:
1. Read the feature's description and acceptance_criteria carefully.
2. Check all child issues: GET /api/issues?parent_id={feature_id}
3. Assess: are ALL acceptance criteria met by the closed child issues?

If YES (feature is done — all children closed, all AC met):
- PATCH the feature: { status: "closed", resolution_type: "completed", implementation_notes: "Feature complete. All AC met: [brief summary]", closing_notes: "All child issues closed. AC verified: [brief]" }
- resolution_type is REQUIRED to close — always include it. "completed" is correct for features.

If NO (children still open, OR gaps in AC coverage):
- If children are already open: PATCH the feature back to underway: { status: "underway", reviewer_notes: "Feature reverted — child [TOD-XXX] still open: [title]" }
- If new gaps found (no existing child covers them): create a new child task first. The feature will auto-revert to "underway" when the child is created (no manual PATCH needed for that case).
- Always explain in reviewer_notes what criteria are not yet met.

## Self-chain
After finishing, call POST /api/run-agent?agent=po to claim next.`,
    modelChain: [
      { runtime: 'claude-code', alias: 'sonnet' },
      { runtime: 'codex',       alias: 'sonnet' },
    ],
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
    sortOrder: 'priority.asc,due_date.asc.nullslast,created_at.asc',
    fetchLimit: 10,
    promptPrefix: 'You are Scout. Research the following task. Summarize findings, cite sources, provide actionable recommendations. When done, PATCH to product_review with implementation_notes. Self-chain: call POST /api/run-agent?agent=scout to claim next.',
    modelChain: [
      { runtime: 'claude-code', alias: 'sonnet' },
      { runtime: 'codex',       alias: 'sonnet' },
    ],
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
    promptPrefix: 'You are Auditor. Verify this released issue: check PR was merged, build passes, acceptance criteria met, no regressions. Check resolution_type — it tells you what to verify (code_change = check the diff/build; config_change = check config; research_completed = check docs). When closing: PATCH { status: "closed", resolution_type: "<keep existing or correct it>", closing_notes: "Audit outcome: ..." }. resolution_type is REQUIRED to close — the API will reject without it. If issues found: create a new bug issue, then PATCH current to closed with closing_notes explaining what was found.',
    modelChain: [
      { runtime: 'claude-code', alias: 'haiku' },  // lightweight audit work
    ],
  },

  deployer: {
    agentId: 'deployer',
    model: 'haiku',
    pickupStatus: 'approved',
    // Only issues with a feature_branch set (no branch = nothing to rebase).
    // Skip issues already prepped (deployer_status=ready) — don't re-process a clean branch.
    extraFilters: 'feature_branch=not.is.null&or=(deployer_status.is.null,deployer_status.eq.failed)',
    // pickupStatus === workingStatus → same deadlock as PO/auditor.
    // DO NOT REMOVE — has been reverted 3 times.
    // Exclude deployer_status=ready from WIP — deployer is done with those; they're just waiting for human merge.
    wipExtraFilter: 'started_at=not.is.null&or=(deployer_status.is.null,deployer_status.eq.failed)',
    dorFields: ['implementation_notes'],
    // wipLimit=1 — deployer runs in ~/todero (shared repo, no worktree isolation).
    // Concurrent instances would conflict on git checkout. One session at a time.
    wipLimit: 1,
    workingStatus: 'approved',
    // Deployer never patches status to released — PR Window owns that transition.
    // null here suppresses the transitionGate curl command in run-agent prompt.
    completionStatus: null,
    checkBlocking: false,
    sortOrder: 'priority.asc',
    fetchLimit: 20,
    promptPrefix: `You are Deployer. Your job is to prepare ONE approved branch per session, then self-chain for the next.

Process the single issue assigned to you:

1. VERIFY required fields exist: implementation_notes, commit_sha, regression_test, feature_branch.
   - If any are missing: PATCH status back to open, assignee to owner, with a note listing what is missing. Done — self-chain.

2. REBASE the branch onto current main:
   cd ~/todero
   git fetch origin
   git checkout <feature_branch>
   git rebase main

3. IF rebase conflicts occur: load the resolve-conflicts skill from DB (slug: resolve-conflicts) and follow it exactly.
   - Resolve each conflict keeping both intents where possible.
   - Run npm run build after resolving to verify no compile errors.
   - If conflict is unresolvable: git rebase --abort, then git checkout main. PATCH issue back to open, assign to the issue's owner, write conflict details to deployer_notes:
     PATCH /api/issues { "id": "<id>", "status": "open", "assignee": "<owner field value>", "deployer_notes": "Rebase conflict on <feature_branch>:\n<conflict details>\nPlease resolve conflicts, rebuild, and resubmit to code_review.", "transitioned_by": "deployer" }
     Done — self-chain.

4. IF rebase succeeds: run npm run build to verify the branch compiles cleanly.
   - If build fails: git checkout main, then PATCH issue back to open, assign to owner, write error to deployer_notes:
     PATCH /api/issues { "id": "<id>", "status": "open", "assignee": "<owner field value>", "deployer_notes": "Build failed after rebase on <feature_branch>:\n<error output>\nPlease fix the build errors and resubmit to code_review.", "transitioned_by": "deployer" }
     Done — self-chain.

5. IF build passes:
   a. git push --force-with-lease origin <feature_branch>
   b. PATCH deployer_status=ready and clear started_at:
      PATCH /api/issues { "id": "<issue_id>", "deployer_status": "ready", "started_at": null, "transitioned_by": "deployer" }
   c. git checkout main
   Log: "✓ TOD-XXX ready for PR window — rebased cleanly onto main"
   Done — self-chain.

NEVER run git push to main directly. NEVER create a PR. NEVER merge to main yourself.`,
    modelChain: [
      { runtime: 'claude-code', alias: 'haiku' },
    ],
  },

  // ── SME agents: Epic decomposition only ──────────────────────────────────
  // Each SME picks epics for their hub, creates 1-5 child features, moves
  // epic to 'draft'. They do NOT implement code — no code access required.
  // workingStatus === pickupStatus (backlog), so wipExtraFilter guards WIP count.
  // DO NOT REMOVE wipExtraFilter — without it all backlog epics count as WIP.

  'todero-sme': {
    agentId: 'todero-sme',
    model: 'sonnet',
    pickupStatus: 'backlog',
    extraFilters: 'type=eq.epic&project=eq.Todero',
    wipExtraFilter: 'started_at=not.is.null',
    dorFields: ['description', 'acceptance_criteria'],
    wipLimit: 1,
    workingStatus: 'backlog',
    completionStatus: 'draft',
    checkBlocking: false,
    sortOrder: 'priority.asc,created_at.asc',
    fetchLimit: 5,
    promptPrefix: `You are Todero SME. Decompose Todero epics into child features.
Steps: (1) Read epic description + AC. (2) Create 1-5 child features via POST /api/issues (type:feature, project:Todero, parent_id:<epic_id>, assignee:po, priority:<inherit>). (3) PATCH epic to draft: {"id":"<id>","status":"draft","transitioned_by":"todero-sme","implementation_notes":"Decomposed into N features: [titles]"}. NEVER assign features to anyone other than "po". Self-chain: POST /api/run-agent?agent=todero-sme.`,
    modelChain: [
      { runtime: 'claude-code', alias: 'sonnet' },
      { runtime: 'codex',       alias: 'sonnet' },
    ],
  },

  'kemuni-sme': {
    agentId: 'kemuni-sme',
    model: 'sonnet',
    pickupStatus: 'backlog',
    extraFilters: 'type=eq.epic&project=eq.Kemuni',
    wipExtraFilter: 'started_at=not.is.null',
    dorFields: ['description', 'acceptance_criteria'],
    wipLimit: 1,
    workingStatus: 'backlog',
    completionStatus: 'draft',
    checkBlocking: false,
    sortOrder: 'priority.asc,created_at.asc',
    fetchLimit: 5,
    promptPrefix: `You are Kemuni SME. Decompose Kemuni epics into child features.
Steps: (1) Read epic description + AC. (2) Create 1-5 child features via POST /api/issues (type:feature, project:Kemuni, parent_id:<epic_id>, assignee:po, priority:<inherit>). (3) PATCH epic to draft: {"id":"<id>","status":"draft","transitioned_by":"kemuni-sme","implementation_notes":"Decomposed into N features: [titles]"}. NEVER assign features to anyone other than "po". Self-chain: POST /api/run-agent?agent=kemuni-sme.`,
    modelChain: [
      { runtime: 'claude-code', alias: 'sonnet' },
      { runtime: 'codex',       alias: 'sonnet' },
    ],
  },

  'vespera-sme': {
    agentId: 'vespera-sme',
    model: 'sonnet',
    pickupStatus: 'backlog',
    extraFilters: 'type=eq.epic&project=eq.Vespera',
    wipExtraFilter: 'started_at=not.is.null',
    dorFields: ['description', 'acceptance_criteria'],
    wipLimit: 1,
    workingStatus: 'backlog',
    completionStatus: 'draft',
    checkBlocking: false,
    sortOrder: 'priority.asc,created_at.asc',
    fetchLimit: 5,
    promptPrefix: `You are Vespera SME. Decompose Vespera epics into child features.
Steps: (1) Read epic description + AC. (2) Create 1-5 child features via POST /api/issues (type:feature, project:Vespera, parent_id:<epic_id>, assignee:po, priority:<inherit>). (3) PATCH epic to draft: {"id":"<id>","status":"draft","transitioned_by":"vespera-sme","implementation_notes":"Decomposed into N features: [titles]"}. NEVER assign features to anyone other than "po". Self-chain: POST /api/run-agent?agent=vespera-sme.`,
    modelChain: [
      { runtime: 'claude-code', alias: 'sonnet' },
      { runtime: 'codex',       alias: 'sonnet' },
    ],
  },

  'infra-sme': {
    agentId: 'infra-sme',
    model: 'sonnet',
    pickupStatus: 'backlog',
    extraFilters: 'type=eq.epic&project=eq.Infrastructure',
    wipExtraFilter: 'started_at=not.is.null',
    dorFields: ['description', 'acceptance_criteria'],
    wipLimit: 1,
    workingStatus: 'backlog',
    completionStatus: 'draft',
    checkBlocking: false,
    sortOrder: 'priority.asc,created_at.asc',
    fetchLimit: 5,
    promptPrefix: `You are Infrastructure SME. Decompose Infrastructure epics into child features.
Steps: (1) Read epic description + AC. (2) Create 1-5 child features via POST /api/issues (type:feature, project:Infrastructure, parent_id:<epic_id>, assignee:po, priority:<inherit>). (3) PATCH epic to draft: {"id":"<id>","status":"draft","transitioned_by":"infra-sme","implementation_notes":"Decomposed into N features: [titles]"}. NEVER assign features to anyone other than "po". Self-chain: POST /api/run-agent?agent=infra-sme.`,
    modelChain: [
      { runtime: 'claude-code', alias: 'sonnet' },
      { runtime: 'codex',       alias: 'sonnet' },
    ],
  },

  // ── Main (triage/orchestrator) ───────────────────────────────────────────
  // Picks up ANY is_blocked issue regardless of status or assignee.
  // Does NOT change status on pickup — it resolves the block and hands back.
  main: {
    agentId: 'main',
    model: 'opus',
    pickupStatus: null,                  // no status filter — blocked issues span all statuses
    extraFilters: 'is_blocked=eq.true',  // only blocked issues
    skipAssigneeFilter: true,            // pick up regardless of current assignee
    dorFields: [],                       // no DoR gate — all blocked issues need triage
    wipLimit: 2,
    workingStatus: null,                 // don't change status on pickup
    completionStatus: null,              // main manages its own completion via PATCH
    checkBlocking: false,
    sortOrder: 'updated_at.asc',
    fetchLimit: 5,
    promptPrefix: `You are KAOS (main orchestrator). Your job is to triage blocked issues and unblock them.

For each blocked issue:

1. Read \`blocked_by\` to understand WHY it's blocked:
   - \`"system:rejection_loop"\` → Rejected 3+ times. Read tester_notes, designer_notes, and rejection history to understand what's wrong. Options: clarify requirements via implementation_notes, break into smaller issues, or escalate to michael with a clear summary of the impasse.
   - A UUID → Dependency block. Verify if the blocking issue is actually complete (GET /api/issues?id=<uuid>). If done: PATCH this issue { is_blocked: false, blocked_by: null, transitioned_by: "main" }.
   - null/other → Manual or unknown block. Read implementation_notes + tester_notes for context.

2. Resolve the block:
   - Dependency resolved: unblock via PATCH { is_blocked: false, blocked_by: null, transitioned_by: "main" }.
   - Rejection loop: add clarifying implementation_notes, then PATCH { is_blocked: false, blocked_by: null, transitioned_by: "main" } to let the agent retry, OR escalate to michael if the issue is fundamentally unclear.
   - Unknown block: investigate and either unblock or add a comment explaining the block.

3. NEVER mark an issue completed or change its status lane — your job is unblocking only.

Self-chain: POST /api/run-agent?agent=main`,
    modelChain: [
      { runtime: 'claude-code', alias: 'opus' },
      { runtime: 'claude-code', alias: 'sonnet' },
    ],
  },
}

// ── vault-derived configs (registry-reaches-dispatch piece) ─────────────────
//
// This file stays free of any `fs`/`db` import on purpose — components/tabs
// import it directly (see getQueueConfig() call sites in ChatTab.tsx and
// IssuesTab.tsx) and a Node-only import here would break their client
// bundle. `lib/agent-manifests.ts` (server-only) does the actual vault scan
// + persistence and hands its results to this in-memory cache through
// `registerManifestQueueConfigs()`; this file only ever reads/writes plain
// data. Populated by app/api/agents/route.ts and app/api/run-agent/route.ts
// before either one calls getQueueConfig()/getAllQueueAgentIds() — a vault
// agent dispatched before either route has run in this process still works,
// because `ensureVaultDispatchConfigs()` is called at the top of every
// run-agent request too, not just opportunistically from the roster route.
let manifestQueueConfigs: Record<string, AgentQueueConfig> = {}

/** Replaces the vault-derived config cache. Server-only callers only. */
export function registerManifestQueueConfigs(configs: Record<string, AgentQueueConfig>): void {
  manifestQueueConfigs = configs
}

/** IDs currently backed by a vault manifest, not Todero's own hardcoded table. */
export function getManifestQueueAgentIds(): string[] {
  return Object.keys(manifestQueueConfigs)
}

export function getQueueConfig(agentId: string): AgentQueueConfig | undefined {
  return AGENT_QUEUE_CONFIGS[agentId] ?? manifestQueueConfigs[agentId]
}

export function getAllQueueAgentIds(): string[] {
  const ids = new Set(Object.keys(AGENT_QUEUE_CONFIGS))
  for (const id of Object.keys(manifestQueueConfigs)) ids.add(id)
  return Array.from(ids)
}

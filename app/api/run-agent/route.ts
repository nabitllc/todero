// TOD-576: Unified per-agent autonomous queue movement endpoint
// POST /api/run-agent?agent=builder (or tester, scout, security, community, content)
//
// One-at-a-time lane enforcement:
//   1. Check WIP limit for the agent
//   2. Fetch eligible issues matching the agent's queue config
//   3. Apply DoR gate (skip issues missing required fields)
//   4. Apply blocked-item skip (if enabled)
//   5. Pick the top-priority issue
//   6. Move it to workingStatus and log agent_run
//   7. Return the selected issue for the caller to dispatch

import { NextRequest, NextResponse } from 'next/server'
import { getQueueConfig, getAllQueueAgentIds } from '@/lib/agent-queue'
import { ensureVaultDispatchConfigs } from '@/lib/agent-manifests'
import { satisfiesIssueDependency } from '@/lib/issue-lifecycle'
import { isHubPaused } from '@/lib/hub-pause'
import { isAgentPaused } from '@/lib/loop-breaker'
import { checkDispatchCeilings } from '@/lib/agent-budget'
import { exec } from 'child_process'
import { getDefaultRuntime, getRuntimeByName, inspectRuntime, listRuntimes } from '@/lib/runtimes'
import { isAlive } from '@/lib/runtimes/detached-spawn'
import { recordSpawn } from '@/lib/runtimes/token-ledger'
import { logAgentCost } from '@/lib/agent-cost-log'
import { resolveCallerRole, checkRoutePermission } from '@/lib/permission-check'
import { CONFIG_DIR, LOG_DIR, TODERO_DIR as TODERO_ROOT, resolveBinary } from '@/lib/paths'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { db } from '@/lib/db'
import { applyFilters, applyShaping, readQueryShape } from '@/lib/db/query-params'
import { dbUnavailableResponse } from '@/lib/db-http'
import {
  buildRetrievedContext,
  RetrievalBudgetExceededError,
  estimateTokens,
  getContextBudgetTokens,
} from '@/lib/memory-retrieval'

/**
 * Run one of the queue's filter strings through the database seam.
 *
 * `lib/agent-queue.ts` stores each lane's filters as query fragments
 * (`type=in.(task,bug)&project=eq.Todero`, `sortOrder: 'priority.asc'`). They
 * are translated into `DbQueryBuilder` calls here rather than pasted onto a
 * vendor URL, so this route sits behind `lib/db.ts` like everything else and a
 * different adapter needs no HTTP API of its own.
 *
 * Returns `[]` and warns on a query error — the callers below all treat a
 * non-array as "nothing eligible", which is the behaviour this preserves.
 */
async function selectRows<T>(table: string, query: string): Promise<T[]> {
  const params = new URLSearchParams(query)
  const { select } = readQueryShape(params)
  let builder = db().from(table).select(select)
  builder = applyFilters(builder, params)
  builder = applyShaping(builder, params)
  const { data, error } = await builder
  if (error) {
    console.warn(`[run-agent] ${table} query failed: ${error.message}`)
    return []
  }
  return (data ?? []) as T[]
}

// Machine-portable paths. These used to name one developer's Mac home
// directory, so every dispatch on any other host died before the first HTTP
// call: the spawn cwd did not exist and the log path was unwritable.
//   TODERO_DIR         repo root used as the agent working dir
//   TODERO_CONFIG_DIR  agent config/memory dir
//   TODERO_LOG_DIR     where per-run agent logs land (under os.tmpdir())
//   CLAUDE_BIN         claude CLI path or name (resolved on PATH)
const TODERO_DIR = TODERO_ROOT
const WORKSPACE = CONFIG_DIR
const CLAUDE_BIN = resolveBinary(process.env.CLAUDE_BIN ?? 'claude') ?? 'claude'
const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low']
const MAX_REJECTION_CYCLES = 3

// In-memory context cache keyed by agentId — TTL 30 minutes.
// Agent memory/context changes at most daily; short TTL was causing unnecessary DB reads.
// This ONLY caches the identity half of the context (SOUL/handbook/skills/daily
// notes) — agent-level, not task-level. A per-agent cache can never be
// task-relevant, so the task-specific retrieval half (below) is never cached
// here; it is already a small, budgeted, ranked query per spawn, not the
// wholesale dump the cache originally existed to avoid re-querying.
const CONTEXT_CACHE_TTL_MS = 30 * 60 * 1000
const contextCache = new Map<string, { context: string; expiresAt: number }>()

/**
 * Budget for the identity half of the spawn context (SOUL, per-agent SOUL,
 * AGENTS handbook, skill docs, recent daily notes) assembled below. Derived
 * from the retrieval budget (`getContextBudgetTokens()`) rather than an
 * unrelated magic number, so the one env knob
 * (`TODERO_MEMORY_RETRIEVAL_BUDGET_TOKENS`) scales both halves of the spawn
 * context together. The multiplier lands close to the old
 * `MAX_CONTEXT_BYTES = 30_000` (~7,500 tokens) this replaces: identity docs
 * are static guidance read once per spawn, not per-task retrieval, so they
 * get a larger allowance than the ~1,300-token retrieval budget.
 */
const IDENTITY_CONTEXT_BUDGET_MULTIPLIER = 6
function getIdentityContextBudgetTokens(): number {
  return getContextBudgetTokens() * IDENTITY_CONTEXT_BUDGET_MULTIPLIER
}

/**
 * Fetches the agent-level (not task-level) half of the spawn context: SOUL,
 * per-agent SOUL, the AGENTS handbook, skill docs, and today/yesterday's
 * daily notes. Cached per agent for 30 minutes by `loadContextFromDB` below.
 *
 * memory-loop-retrieval round 2: this used to also pull self_improving /
 * long_term / corrections WHOLESALE (limit=20, unranked) and then silently
 * drop whole sections off the end with `while (...) sections.pop()` once the
 * combined text passed a fixed byte cap — exactly the "uncapped, unranked
 * injection that buries the record that mattered" bug this piece exists to
 * fix, just relocated to a query with no task key to rank against. That tier
 * now lives in `buildRetrievedContext()` (`loadContextFromDB` below), ranked
 * against the actual task. What remains here is genuinely task-independent
 * identity material, so it keeps its own (larger) budget and is selected by
 * the same whole-section discipline `lib/memory-retrieval.ts` already
 * applies to ranked records: never chop a section, never silently drop the
 * first (most important) one.
 */
async function loadIdentityContext(agentId: string): Promise<string> {
  // Fetch global + per-agent documents + shared skill docs
  const docs = await selectRows<{ agent_id: string; doc_type: string; slug: string; content: string }>(
    'agent_documents',
    `or=(agent_id.eq.global,agent_id.eq.${agentId},agent_id.eq.skill)&select=agent_id,doc_type,slug,content&order=doc_type.asc,slug.asc&limit=100`,
  )

  // Fetch memory: today + yesterday daily notes only. long_term / self_improving
  // / corrections moved to buildRetrievedContext() — ranked against the task,
  // not dumped here. Bug fix (kept from the prior round): table was renamed
  // agent_memory → agent_memory_files (agent_memory is the key-value store).
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const agentMemoryScope = `or=(agent_id.eq.global,agent_id.eq.${agentId})`
  const dailyRows = await selectRows<{ memory_type: string; date_key: string | null; content: string; updated_at?: string }>(
    'agent_memory_files',
    `${agentMemoryScope}&memory_type=eq.daily&date_key=in.(${today},${yesterday})&select=memory_type,date_key,content,updated_at&order=updated_at.desc&limit=20`,
  )

  const sections: string[] = []

  // Global soul first
  const globalSoul = docs.find(d => d.agent_id === 'global' && d.doc_type === 'soul')
  if (globalSoul) sections.push(`# SOUL\n\n${globalSoul.content}`)

  // Per-agent soul
  const agentSoul = docs.find(d => d.agent_id === agentId && d.doc_type === 'soul')
  if (agentSoul) sections.push(`# ${agentId.toUpperCase()} SOUL\n\n${agentSoul.content}`)

  // Agents handbook
  const handbook = docs.find(d => d.agent_id === 'global' && d.doc_type === 'agents')
  if (handbook) sections.push(`# AGENTS HANDBOOK\n\n${handbook.content}`)

  // Skills: per-agent skills first, then shared skill docs (agent_id='skill')
  const agentSkills = docs.filter(d => (d.agent_id === agentId || d.agent_id === 'skill') && d.doc_type === 'skill')
  for (const skill of agentSkills) {
    sections.push(`# SKILL: ${skill.slug}\n\n${skill.content}`)
  }

  // Daily notes, newest first
  const dailyMem = dailyRows
    .filter(m => m.memory_type === 'daily')
    .sort((a, b) => (b.date_key ?? '').localeCompare(a.date_key ?? ''))
  for (const m of dailyMem) {
    sections.push(`# DAILY MEMORY (${m.date_key})\n\n${m.content}`)
  }

  // Whole-section budget selection — the same discipline
  // lib/memory-retrieval.ts applies to ranked records: estimate tokens per
  // section, keep adding whole sections while under budget, STOP (never
  // chop) once the running total would overflow. The one section that may
  // never be silently dropped is the first non-empty one — an agent's own
  // identity (global SOUL, or whatever section landed first) — mirroring
  // "the top-ranked record" in buildRetrievedContext: if it alone exceeds
  // the budget, that is RetrievalBudgetExceededError, raised rather than
  // truncated. This replaces the old `while (...) sections.pop()` loop,
  // which silently dropped whichever section happened to land last,
  // regardless of whether that was the important one.
  const budgetTokens = getIdentityContextBudgetTokens()
  const selected: string[] = []
  let usedTokens = 0
  for (const section of sections) {
    const sectionTokens = estimateTokens(section)
    if (selected.length === 0 && sectionTokens > budgetTokens) {
      const label = section.split('\n', 1)[0].replace(/^#\s*/, '')
      throw new RetrievalBudgetExceededError(agentId, '(identity-context)', label, sectionTokens, budgetTokens)
    }
    if (usedTokens + sectionTokens > budgetTokens) break
    selected.push(section)
    usedTokens += sectionTokens
  }

  return selected.join('\n\n---\n\n')
}

/**
 * Full spawn context: the cached, agent-level identity half plus a fresh,
 * task-ranked retrieval half. `taskKey`/`taskTitle` identify the task being
 * spawned for — retrieval ranks this agent's past run records against THAT,
 * not against nothing, and is never served from `contextCache` (see the
 * comment on that Map).
 */
async function loadContextFromDB(agentId: string, taskKey: string, taskTitle: string): Promise<string> {
  const cached = contextCache.get(agentId)
  let identityContext: string
  if (cached && cached.expiresAt > Date.now()) {
    identityContext = cached.context
  } else {
    identityContext = await loadIdentityContext(agentId)
    contextCache.set(agentId, { context: identityContext, expiresAt: Date.now() + CONTEXT_CACHE_TTL_MS })
  }

  const retrieved = await buildRetrievedContext(agentId, taskKey, taskTitle)
  if (retrieved.availability === 'unavailable') {
    console.warn(
      `[run-agent] retrieval unavailable for ${agentId}/${taskKey} (${retrieved.engine}): ${retrieved.unavailableReason ?? 'unknown reason'} — proceeding with identity context only, not a clean "nothing relevant" result`,
    )
  }

  return [identityContext, retrieved.text].filter(Boolean).join('\n\n---\n\n')
}


// ── SAFETY GUARD (owner directive, 2026-08-24) ───────────────────────────────
// Todero must not autonomously dispatch agents while it is itself being rebuilt.
// Claude builds Todero; Todero does not build Todero. This guard is ON by
// default and must be explicitly opted out of via TODERO_DISPATCH_ENABLED=1.
// Rationale: /api/cron/queue-refill and /api/cron/watchdog pull real backlog
// tasks and spawn `claude --permission-mode bypassPermissions`, with a watcher
// that self-kicks this endpoint when the child exits. On this host that only
// failed because no POSIX shell is present — a protection we are actively removing.
function dispatchDisabled(): boolean {
  return process.env.TODERO_DISPATCH_ENABLED !== '1'
}
const DISPATCH_BLOCKED_BODY = {
  error: 'Agent dispatch is disabled on this instance.',
  code: 'DISPATCH_DISABLED',
  hint: 'Set TODERO_DISPATCH_ENABLED=1 to allow Todero to spawn agents. Intentionally off while Todero is under reconstruction.',
}

/**
 * POST /api/run-agent?dryRun=1 — answer "would a dispatch work on this host?"
 * without dispatching. Resolves the runtime that would be chosen, resolves its
 * binary on PATH, and creates the log file under LOG_DIR so the caller can see
 * the exact path an agent's output would land in.
 *
 * Deliberately runs BEFORE the dispatch guard: the guard exists to stop Todero
 * spawning agents, and this branch spawns nothing. It is also the only way to
 * verify the portable-spawn plumbing on a host where dispatch is (correctly)
 * turned off. `binResolved: null` means a real dispatch here would return
 * ok:false — that is the answer, not a failure to answer.
 */
async function dryRunReport(req: NextRequest): Promise<NextResponse> {
  try {
    const requested = req.nextUrl.searchParams.get('runtime')
    const info = await inspectRuntime(requested)

    mkdirSync(LOG_DIR, { recursive: true })
    // Slugged: the agent name reaches a filename, and `?agent=../../x` must not
    // be able to steer where that file lands.
    const agentId = (req.nextUrl.searchParams.get('agent') ?? 'dry-run')
      .replace(/[^a-zA-Z0-9_-]/g, '-')
      .slice(0, 40) || 'dry-run'
    const logFile = join(LOG_DIR, `dryrun-${agentId}-${Date.now()}.log`)
    writeFileSync(
      logFile,
      `[dry-run] ${new Date().toISOString()} agent=${agentId} runtime=${info.runtime}
` +
      `[dry-run] bin=${info.bin} resolved=${info.binResolved ?? 'NOT FOUND ON PATH'}
` +
      `[dry-run] available=${info.available}${info.unavailableReason ? ` reason=${info.unavailableReason}` : ''}
`
    )

    return NextResponse.json({
      dryRun: true,
      runtime: info.runtime,
      bin: info.bin,
      binResolved: info.binResolved,
      runtimeAvailable: info.available,
      unavailableReason: info.unavailableReason,
      logDir: LOG_DIR,
      logFile,
      dispatchEnabled: !dispatchDisabled(),
      // `openai-api` launches the Node binary this server already runs under,
      // so `binResolved` is never null for it — a configured-but-dead LLM
      // endpoint used to sail through this branch as wouldSpawn:true. The
      // runtime's own availability probe is the sensor that knows.
      wouldSpawn: info.available && info.binResolved !== null,
      ...(info.unavailableReason
        ? { warning: `a real dispatch would fail: ${info.unavailableReason}` }
        : {}),
    })
  } catch (err) {
    return NextResponse.json(
      {
        dryRun: true,
        error: `dry-run resolution failed: ${err instanceof Error ? err.message : String(err)}`,
      },
      { status: 500 }
    )
  }
}

export async function POST(req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  // Dry run first: it resolves and reports, it never spawns.
  if (req.nextUrl.searchParams.get('dryRun') === '1') {
    return dryRunReport(req)
  }

  if (dispatchDisabled()) {
    return NextResponse.json(DISPATCH_BLOCKED_BODY, { status: 503 })
  }

  const REQUIRED_PERMISSION = 'agents:spawn' as const
  const callerRole = await resolveCallerRole(req)
  if (callerRole !== null) {
    const perm = await checkRoutePermission(callerRole, 'POST', '/api/run-agent')
    if (!perm.allowed) return NextResponse.json(perm.body, { status: perm.status })
  }

  // Hub pause guard — reject new agent activations when paused
  if (await isHubPaused()) {
    return NextResponse.json({ error: 'Agents are paused', paused: true }, { status: 503 })
  }

  // registry-reaches-dispatch piece: registers a dispatchable config for
  // every current Brain2 vault agent into lib/agent-queue.ts's runtime cache
  // BEFORE the getQueueConfig() lookup below — a vault agent dispatched in a
  // freshly started process (no prior GET /api/agents in this process) must
  // still resolve, not answer "Unknown agent" because nothing happened to
  // warm the cache yet. Never throws; degrades to whatever was last
  // persisted (or nothing) when the vault itself is unreachable from here —
  // see lib/agent-manifests.ts.
  //
  // Round 2: the result used to be discarded here too, so a persistence
  // 404 was invisible on the dispatch path as well as the roster path. This
  // route has no roster envelope to carry it in (a spawn returns a run, not
  // a roster), so a failed persist is logged server-side instead — visible
  // to whoever runs this host, same as any other boot-time degradation.
  const vaultSync = await ensureVaultDispatchConfigs()
  if (vaultSync.warning) {
    console.warn(`[run-agent] ${vaultSync.warning}`)
  }

  const body = await req.json().catch(() => ({}))
  const agentId = req.nextUrl.searchParams.get('agent') ?? (body as Record<string, string>).agent_id
  if (!agentId) {
    return NextResponse.json(
      { error: 'Missing ?agent= parameter or agent_id in body', available: getAllQueueAgentIds() },
      { status: 400 }
    )
  }

  // TOD-766: Loop breaker guard — skip agents paused after 3 consecutive failures
  if (await isAgentPaused(agentId)) {
    return NextResponse.json(
      { error: `Agent '${agentId}' is paused by loop breaker. Check inbox for review request.`, paused: true, loop_breaker: true },
      { status: 503 }
    )
  }

  // TOD-2381 (agent-budget-stop): ceilings checked OUTSIDE the agent, before a
  // run starts. Concurrency / run-count / dollar-spend are all read from
  // agent_runs and token_ledger rows the server itself wrote — never an
  // estimate, never something the agent is asked to report about itself.
  const ceiling = await checkDispatchCeilings(agentId)
  if (!ceiling.allowed) {
    return NextResponse.json(
      {
        error: `Agent '${agentId}' is over its ${ceiling.ceiling} ceiling: ${ceiling.reason}`,
        ceiling: ceiling.ceiling,
        reason: ceiling.reason,
        detail: ceiling.detail,
        overBudget: true,
      },
      { status: 429 }
    )
  }

  const config = getQueueConfig(agentId)
  if (!config) {
    return NextResponse.json(
      { error: `Unknown agent: ${agentId}`, available: getAllQueueAgentIds() },
      { status: 400 }
    )
  }

  // Reviewers (tester/designer) don't filter by assignee — they review all code_review issues
  // and filter by their own pending status. This is the dual-review model.
  const isReviewer = agentId === 'tester' || agentId === 'designer'
  const reviewStatusField = agentId === 'tester' ? 'tester_status' : 'designer_status'

  // ── Step 1: WIP limit check ──
  // For agents where pickupStatus === workingStatus (e.g. deployer), wipExtraFilter
  // narrows WIP count to claimed issues only (started_at IS NOT NULL), preventing
  // the full queue length from being mis-counted as active WIP.
  // For skipAssigneeFilter agents (main), count all is_blocked issues with started_at set.
  // is_blocked=false excluded from WIP: a blocked in-progress issue must not hold the WIP slot.
  const wipExtraFilter = config.wipExtraFilter ? `&${config.wipExtraFilter}` : ''
  const wipQuery = isReviewer
    ? `status=eq.${config.workingStatus}&${reviewStatusField}=in.(running,in_progress)&is_blocked=eq.false&select=id`
    : config.skipAssigneeFilter
      ? `is_blocked=eq.true&started_at=not.is.null&select=id`
      : `assignee=eq.${agentId}&status=eq.${config.workingStatus}&is_blocked=eq.false${wipExtraFilter}&select=id`
  const wipIssues = await selectRows<{ id: string }>('issues', wipQuery)
  if (wipIssues.length >= config.wipLimit) {
    return NextResponse.json({
      agent: agentId,
      message: `WIP limit reached: ${wipIssues.length}/${config.wipLimit} ${config.workingStatus}. Finish current work first.`,
      wip: wipIssues.length,
    })
  }

  // ── Step 2: Fetch eligible issues ──
  const dorFilter = config.dorFields.map(f => `${f}=not.is.null`).join('&')
  const extraFilter = config.extraFilters ? `&${config.extraFilters}` : ''
  // Reviewers: all code_review issues where THEIR status is pending (not tied to assignee field)
  // skipAssigneeFilter agents (main): no assignee filter — pick up any blocked issue
  const assigneeFilter = isReviewer
    ? `${reviewStatusField}=eq.pending`
    : config.skipAssigneeFilter
      ? ''
      : `assignee=eq.${agentId}`
  // Support multi-status pickup (e.g. PO handles backlog + feature_review)
  // null pickupStatus = no status filter (main agent filters on is_blocked via extraFilters)
  const allPickupStatuses = config.pickupStatuses ?? (config.pickupStatus ? [config.pickupStatus] : [])
  const statusFilter = allPickupStatuses.length === 0
    ? ''
    : allPickupStatuses.length === 1
      ? `status=eq.${allPickupStatuses[0]}`
      : `status=in.(${allPickupStatuses.join(',')})`
  // Build URL — join non-empty filters with & to avoid double-ampersand artifacts
  // is_blocked=eq.false ensures agents never receive blocked issues (even when blocked_by=null).
  // main (skipAssigneeFilter) uses extraFilters=is_blocked=eq.true — omit the false filter so they don't conflict.
  const blockedFilter = config.skipAssigneeFilter ? '' : 'is_blocked=eq.false'
  const baseFilters = [assigneeFilter, statusFilter, dorFilter, blockedFilter].filter(Boolean).join('&')
  const query = `${baseFilters}${extraFilter}&select=id,title,description,priority,due_date,created_at,project,acceptance_criteria,task_key,feature_branch,blocked_by,is_blocked,rejection_count,type,status,parent_id,tester_notes,designer_notes,tester_status,designer_status,owner,deployer_notes&order=${config.sortOrder}&limit=${config.fetchLimit}`

  const tasks = await selectRows<{
    id: string; title: string; description: string; priority: string;
    due_date: string | null; created_at: string; project: string; acceptance_criteria: string | null;
    task_key: string | null; feature_branch: string | null;
    blocked_by: string | null; is_blocked: boolean | null; status: string; parent_id: string | null;
    rejection_count: number | null; type: string | null;
    tester_notes: string | null; designer_notes: string | null;
    tester_status: string | null; designer_status: string | null;
    owner: string | null; deployer_notes: string | null;
  }>('issues', query)

  if (tasks.length === 0) {
    return NextResponse.json({
      agent: agentId,
      message: `No eligible issues for ${agentId} (status=${allPickupStatuses.join('|')}, DoR fields: ${config.dorFields.join(', ')})`,
    })
  }

  // ── Step 3: Blocked-item skip ──
  let readyTasks = tasks
  if (config.checkBlocking) {
    const blockedByIds = tasks.filter(t => t.blocked_by).map(t => t.blocked_by!)
    let blockerStatuses: Record<string, string> = {}

    if (blockedByIds.length > 0) {
      const blockers = await selectRows<{ id: string; task_key: string | null; status: string }>(
        'issues',
        `or=(id.in.(${blockedByIds.join(',')}),task_key.in.(${blockedByIds.join(',')}))&select=id,task_key,status`,
      )
      for (const b of blockers) {
        blockerStatuses[b.id] = b.status
        if (b.task_key) blockerStatuses[b.task_key] = b.status
      }
    }

    readyTasks = tasks.filter(t => {
      if (!t.blocked_by) return true
      const blockerStatus = blockerStatuses[t.blocked_by]
      return satisfiesIssueDependency(blockerStatus)
    })
  }

  if (readyTasks.length === 0) {
    return NextResponse.json({
      agent: agentId,
      message: 'All eligible issues are blocked by unfinished dependencies',
      blocked: tasks.filter(t => t.blocked_by).map(t => ({
        task_key: t.task_key, blocked_by: t.blocked_by,
      })),
    })
  }

  // ── Step 3.5: Feature-lock (TOD-2344) — stick to one feature until siblings reviewed ──
  // If this agent has any in-progress task with a parent_id, restrict the next pick to
  // siblings of that parent. Produces coherent feature batches and reduces context switching.
  // Lock auto-releases when no in-progress task for this agent has a parent_id, or when
  // readyTasks contains no siblings of locked parent (fallback to global queue to avoid starve).
  {
    const inProgressTasks = await selectRows<{ parent_id: string | null }>(
      'issues',
      `status=eq.in_progress&assignee=eq.${agentId}&parent_id=not.is.null&select=parent_id`,
    )
    if (inProgressTasks.length > 0) {
      const lockedParents = new Set(inProgressTasks.map(t => t.parent_id).filter(Boolean) as string[])
      if (lockedParents.size > 0) {
        const filtered = readyTasks.filter(t => t.parent_id && lockedParents.has(t.parent_id))
        const parentList = Array.from(lockedParents).join(',')
        if (filtered.length > 0) {
          console.log(`[feature-lock] ${agentId} locked to parent(s) ${parentList} — ${filtered.length} sibling(s) remaining (was ${readyTasks.length} eligible)`)
          readyTasks = filtered
        } else {
          console.log(`[feature-lock] ${agentId} parent(s) ${parentList} have no eligible siblings — releasing lock`)
        }
      }
    }
  }

  // ── Step 4: Priority sort — parent underway first, then priority → due_date → created_at ──
  // Fetch parent statuses so issues under an active feature (status=underway) jump the queue.
  const parentIds = Array.from(new Set(readyTasks.map(t => t.parent_id).filter(Boolean))) as string[]
  const parentStatuses: Record<string, string> = {}
  if (parentIds.length > 0) {
    const parents = await selectRows<{ id: string; status: string }>(
      'issues',
      `id=in.(${parentIds.join(',')})&select=id,status`,
    )
    {
      for (const p of parents) parentStatuses[p.id] = p.status
    }
  }

  readyTasks.sort((a, b) => {
    // Tier 1: issues whose parent is underway come first
    const aUnderway = a.parent_id && parentStatuses[a.parent_id] === 'underway' ? 0 : 1
    const bUnderway = b.parent_id && parentStatuses[b.parent_id] === 'underway' ? 0 : 1
    if (aUnderway !== bUnderway) return aUnderway - bUnderway
    // Tier 2: priority (critical → high → medium → low)
    const pa = PRIORITY_ORDER.indexOf(a.priority)
    const pb = PRIORITY_ORDER.indexOf(b.priority)
    if (pa !== pb) return pa - pb
    // Tier 3: due_date (earlier first, nulls last)
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
    if (a.due_date) return -1
    if (b.due_date) return 1
    // Tier 4: created_at oldest first (FIFO)
    return a.created_at.localeCompare(b.created_at)
  })

  // ── Step 5: Loop breaker check — BEFORE claim, skip escalated issues ──
  // Moved earlier (was Step 7): previously the issue was already claimed in_progress
  // before this check ran, leaving escalated issues stuck until the watchdog cleared them.
  // TOD-fix: instead of halting the entire queue when the top issue is escalated,
  // skip it and try the next ready task so other work can proceed.
  const escalatedKeys: string[] = []
  let task: typeof readyTasks[0] | null = null
  for (const candidate of readyTasks) {
    // main (skipAssigneeFilter) intentionally picks up blocked issues — skip the guard for it
    if (candidate.is_blocked && !config.skipAssigneeFilter) {
      escalatedKeys.push(candidate.task_key ?? candidate.id)
      continue
    }
    task = candidate
    break
  }

  if (!task) {
    return NextResponse.json({
      agent: agentId,
      message: `All eligible issues are blocked (is_blocked=true). Run main agent to triage.`,
      escalated: true,
      escalatedIssues: escalatedKeys,
    })
  }

  // ── Step 4b: Query inbox for resolved entry linked to this task ──
  // AC (TOD-1069): inject <inbox-response> block if a resolved inbox entry exists for this issue.
  //
  // Round-3 fix: dropped the `response_data=not.is.null` filter. On a database
  // still missing migration 022's response_data column, PATCH /api/inbox
  // (app/api/inbox/route.ts) degrades to writing the same outcome into
  // `context.resolution.effect` instead — a row resolved that way would never
  // match `response_data=not.is.null` and this block would silently never
  // fire, which is exactly the two-halves-disagreeing bug this fixes. Fetch a
  // few candidates by recency instead and read whichever place the payload
  // actually landed.
  let inboxResponseBlock = ''
  try {
    const inboxRows = await selectRows<{
      type: string; status: string; response_data: Record<string, unknown> | null
      resolved_by: string | null; context: Record<string, unknown> | null
    }>(
      'inbox',
      `issue_id=eq.${task.id}&status=in.(approved,denied,explained,timeout)&order=resolved_at.desc&limit=5&select=type,status,response_data,resolved_by,context`,
    )
    const contextResolutionOf = (row: { context: Record<string, unknown> | null }) =>
      (row.context && typeof row.context === 'object' && !Array.isArray(row.context))
        ? (row.context as Record<string, unknown>).resolution as Record<string, unknown> | undefined
        : undefined
    const entry = inboxRows.find(r => {
      const res = contextResolutionOf(r)
      return r.response_data != null || res?.effect != null || res?.data != null
    })
    if (entry) {
      const res = contextResolutionOf(entry)
      const payload = (entry.response_data ?? res?.effect ?? res?.data ?? {}) as Record<string, unknown>
      const responseFields = Object.entries(payload)
        .map(([k, v]) => `  <${k}>${JSON.stringify(v)}</${k}>`)
        .join('\n')
      inboxResponseBlock = `\n<inbox-response>
  <request_type>${entry.type}</request_type>
  <resolution_status>${entry.status}</resolution_status>
  <resolved_by>${entry.resolved_by ?? (res?.by as string | undefined) ?? 'unknown'}</resolved_by>
  <response_data>
${responseFields}
  </response_data>
</inbox-response>`
    }
  } catch {
    // Best-effort — never block spawn on inbox query failure
  }

  // ── Step 5: Claim the issue ──
  // Always set started_at to mark the issue as claimed by this agent, even when
  // pickupStatus === workingStatus (e.g. deployer). This lets the wipExtraFilter
  // distinguish "claimed" from "queued but unclaimed" issues in the WIP count.
  const claimFields: Record<string, string> = {
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  if (config.workingStatus && config.pickupStatus !== config.workingStatus) {
    claimFields.status = config.workingStatus
  }
  await db().from('issues').update(claimFields).eq('id', task.id)

  // ── Step 7: Log agent_run ──
  const { data: agentRunRows } = await db()
    .from('agent_runs')
    .insert({
      agent_id: agentId,
      task_id: task.id,
      task_title: task.title,
      status: 'running',
    })
    .select('id')
  const agentRunId: string | undefined = (agentRunRows as Array<{ id: string }> | null)?.[0]?.id

  // ── Step 8: Auto-set feature branch for code-producing agents ──
  // Branch-prefix routing (P3 / Gap #3): type=ops issues land on
  // infra/tod-NNNN; everything else lands on feat/tod-NNNN.
  // The pre-commit hook enforces file-scope separation between the two
  // prefixes so mixed-concern commits can never enter the pipeline.
  let branch = task.feature_branch
  if (!branch && task.task_key && ['builder', 'ops'].includes(agentId)) {
    const prefix = task.type === 'ops' ? 'infra' : 'feat'
    branch = `${prefix}/${(task.task_key as string).toLowerCase()}`
    await db().from('issues').update({ feature_branch: branch }).eq('id', task.id)
  }

  // ── Step 9: Spawn Claude Code agent in background ──
  // FIX (2026-04-10): Previously `$(cat ...)` template literal was never evaluated.
  // memory-loop-retrieval round 2: this is the ONLY code path that actually
  // spawns an agent, so it must be the one that carries the task key/title
  // through to retrieval — without them, loadContextFromDB cannot rank
  // anything and retrieval degrades to "nothing to search for".
  const dbContext = await loadContextFromDB(agentId, task.task_key ?? task.id, task.title ?? '')
  const context = `# WORKSPACE IDENTITY\n\n${dbContext}`

  // Size guardrail — warn if prompt context exceeds 25KB (approx 6k tokens)
  if (context.length > 25_000) {
    console.warn(`[run-agent] context for ${agentId} is ${context.length} bytes — trim skill selection if this keeps climbing`)
  }

  const transitionGate = config.completionStatus ? `

🚨 NON-NEGOTIABLE FINAL STEP 🚨
Your work is NOT COMPLETE until you PATCH the issue status. If you skip this step, your work is LOST because another agent cannot pick up this issue while it is still in its current status.

After finishing the work, RUN THIS EXACT COMMAND before ending your session:

curl -s -X PATCH http://localhost:3000/api/issues -H "Content-Type: application/json" -d '{"id":"${task.id}","status":"${config.completionStatus}","transitioned_by":"${agentId}","implementation_notes":"<1-2 sentences of what you did>","commit_sha":"'"$(git rev-parse HEAD 2>/dev/null || echo none)"'","regression_test":"<how to verify>"}'

VERIFY the response shows status="${config.completionStatus}". If you get an error:
1. Read the error message carefully (missing fields, wrong role, etc.)
2. Fix the issue and retry the PATCH
3. Do NOT end your session until the PATCH succeeds

This is a HARD RULE. Do not treat it as optional. Do not assume someone else will do it for you.` : ''

  const pushGate = `

🛑 GIT PUSH / PR RULES — NON-NEGOTIABLE 🛑
You are a pipeline agent. Your scope ends at \`git commit\` (locally) + the MC API PATCH.
- ❌ DO NOT run \`git push\`
- ❌ DO NOT run \`gh pr create\`
- ❌ DO NOT run \`gh pr merge\`, \`gh pr close\`, \`gh pr review\`, or \`gh pr edit\`
- ❌ DO NOT push to any remote under any circumstance
- ✅ KAOS pushes one batched PR per window at 7:00 AM ET and 7:00 PM ET (via pr-window.py)
- ✅ Your local commits on feat/tod-X will be picked up by the next window automatically

If your task feels urgent enough to warrant an immediate PR, you are WRONG. Bypassing the window is never the answer. Instead: PATCH back to open with implementation_notes explaining the urgency, and let Michael or KAOS decide.

This rule exists because per-issue PRs create review fatigue and merge conflicts. One batched PR per window is the correct cadence.`

  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
  const heartbeatInstruction = `

💓 HEARTBEAT — REQUIRED EVERY 5 MINUTES 💓
While working, write a heartbeat every ~5 minutes so the watchdog knows you're alive.
If you stop writing heartbeats for 10 min, the watchdog assumes you died and resets the issue to open — losing your WIP slot.

Run this before each major step (read → edit → build → commit):
curl -s -X PATCH ${appUrl}/api/heartbeat \\
  -H "Content-Type: application/json" \\
  -d '{"task_key":"${task.task_key}"}'

Expected response: {"ok":true}. If you get an error, keep working — heartbeat failures are not blockers.`

  const selfChain = `\n\nAFTER the PATCH succeeds, call: curl -s -X POST http://localhost:3000/api/run-agent?agent=${agentId} to auto-claim your next task.`
  const loopBreaker = `\n\nIF same error 3 times: STOP, PATCH back to open with notes explaining the blocker. Do NOT retry infinitely.`

  // Only builder and ops run in isolated git worktrees — all other agents run in ~/todero directly.
  const CODE_AGENTS_SET = new Set(['builder', 'ops'])
  const worktreeGuard = CODE_AGENTS_SET.has(agentId) ? `

🛑 WORKTREE RULES — node_modules is SHARED 🛑
You are running inside a git worktree. Your node_modules directory is a SYMLINK to ~/todero/node_modules.
- ❌ DO NOT run \`npm install\` or \`npm ci\` — it replaces the symlink with an incomplete local install, breaking ALL other agents
- ❌ DO NOT run \`npm install <package>\` — if a package is missing, PATCH back to open with a note asking KAOS to install it
- ✅ \`npm run build\` is fine — it uses the existing symlinked node_modules
- ✅ If build fails with "Cannot find module X", check ~/todero/node_modules/X directly; if truly missing, PATCH back to open
- ✅ Stay in your worktree directory — do NOT cd to ~/todero for any build commands` : ''

  // Branch-scope rules (P3 / Gap #3) — builder + ops only.
  // The API has already created the correct branch prefix for this issue's
  // type (feat/ for app-code, infra/ for pipeline infra). The pre-commit
  // hook enforces the separation. This block tells the agent what it means
  // so it doesn't fight the hook.
  const branchScopeRules = CODE_AGENTS_SET.has(agentId) ? `

🧭 BRANCH SCOPE — feat/ vs infra/ 🧭
Your branch prefix is set by the API from the issue's type (${task.type ?? 'unknown'}) — you do NOT choose it.
- \`feat/tod-NNNN\` (app-code only): edit anything EXCEPT the LOCKED_FILES below. The hook blocks LOCKED_FILES on feat/.
- \`infra/tod-NNNN\` (pipeline infra only): edit ONLY the LOCKED_FILES below. The hook blocks every other path on infra/.

LOCKED_FILES (the pipeline-critical set — only touchable from infra/):
  lib/agent-queue.ts, lib/issue-routing.ts, lib/issue-lifecycle.ts,
  lib/runtimes/claude-code.ts, lib/runtimes/worktree.ts, lib/constants.ts,
  app/api/issues/route.ts, app/api/run-agent/route.ts, app/api/notify/route.ts,
  app/api/queue-refill/route.ts, .githooks/pre-commit

If the hook blocks your commit:
- On feat/ blocking LOCKED_FILES → your task should not need those files; skip them. If it truly does, the issue is mis-typed: PATCH back to open with notes asking PO to re-type it as \`ops\`.
- On infra/ blocking app-code → your task should not need app-code; skip it. If it truly does, this is a mixed-concern issue: PATCH back to open with notes asking PO to split it into sibling issues (type=feature for app-code + type=ops for infra).
- Never mix: the split-issue rule prevents TOD-604-style drift where one PR shipped partial app-code + partial infra and both sides got stuck in review.` : ''

  // TOD-2300: Builder self-triage on pickup. Agents were occasionally writing
  // redundant code for issues whose AC was already satisfied by prior work
  // (follow-ups filed before the parent landed, duplicate tickets, backlog
  // rot). This block tells Builder to verify before writing.
  const selfTriageRules = agentId === 'builder' ? `

🔎 SELF-TRIAGE ON PICKUP — verify BEFORE writing 🔎
Before any edit, check whether the Acceptance Criteria are already satisfied:
1. Parse each AC bullet into a concrete, checkable assertion (file exists / function exists / behavior present / field in schema).
2. Verify each assertion against the current repo (Read / Grep). Do not infer from issue title or description alone.
3. Decide:
   - ALL assertions already satisfied → close out. PATCH to code_review with resolution_type=no_change_required, implementation_notes listing each AC + the file/line proving it, commit_sha from current HEAD, regression_test="n/a — no code change, verified pre-existing state". Do NOT write code.
   - SOME satisfied → document the partials in implementation_notes, implement ONLY the missing pieces, then submit normally.
   - NONE satisfied → proceed with implementation as usual.
Rationale: writing redundant code wastes a review cycle and pollutes the diff; shipping no_change_required when warranted keeps the board honest.` : ''

  // TOD-796 follow-up: point agents at the rest of the skill library.
  // The universal bundle (proactivity/execution, self-improving/corrections, etc.) is
  // already inlined in ${context} above. This note tells the agent where to look for
  // deeper protocols (memory templates, scaling, migration, operations playbooks) if
  // it decides the task needs them. Keeps the inline prompt small while still giving
  // agents a way to self-rescue when a task exceeds their baseline knowledge.
  // Phase 2.5 (TOD-1514): Reference DB slugs, not local file paths
  const skillReference = `

📚 Additional skills available via DB slugs (already loaded in context above by slug name):
  proactivity, self-improving, issue-routing, bug-report, agent-creation, agent-setup, deployer-prep

Your universal behavioral rules (proactivity loop, corrections discipline, memory hygiene, reflections) are already inlined in the workspace-context above. Only request additional skill context when the task specifically needs deeper protocol — don't load everything speculatively.`

  const branchInstruction = branch
    ? `\nBranch: ${branch} (git checkout -b ${branch} 2>/dev/null || git checkout ${branch})`
    : ''

  // TOD-1069: Behavioral gate for inbox responses injected above
  const inboxResponseGate = inboxResponseBlock ? `
\n📬 INBOX RESPONSE DETECTED — read the <inbox-response> block above and act accordingly:
- approved → continue with the task, using any fields in <response_data> as guidance or input
- denied   → do NOT proceed with implementation; log the denial reason in implementation_notes and PATCH the issue back to open with rejection_count++
- explained → treat the <response_data> as additional context and continue normally
- timeout  → treat as informational context; proceed using best judgment` : ''

  const deployerFeedback = task.deployer_notes ? `
⚠️ DEPLOYER FEEDBACK — READ THIS BEFORE STARTING ⚠️
This issue was bounced back by Deployer. You MUST fix the issue below before resubmitting to code_review.

${task.deployer_notes}

Do NOT resubmit without resolving the above.` : ''

  const rejectionFeedback = (task.rejection_count ?? 0) > 0 ? `
⚠️ REJECTION FEEDBACK — READ THIS BEFORE STARTING ⚠️
This issue has been rejected ${task.rejection_count} time(s). You MUST address the feedback below before re-submitting.
${task.tester_status && task.tester_status !== 'pending' ? `\nTester (${task.tester_status}): ${task.tester_notes ?? 'no notes'}` : ''}
${task.designer_status && task.designer_status !== 'pending' ? `\nDesigner (${task.designer_status}): ${task.designer_notes ?? 'no notes'}` : ''}

Fix every issue mentioned above. Do NOT resubmit without addressing all feedback.` : ''

  // Q5: Inject block reason so the main agent (and any agent that receives a blocked issue)
  // knows exactly what kind of block it's dealing with before starting work.
  const blockedReasonBlock = task.is_blocked ? (() => {
    if (task.blocked_by === 'system:rejection_loop') {
      return `
🔴 BLOCKED — REJECTION LOOP
This issue is blocked because it was rejected ${task.rejection_count ?? 3}+ times.
Tester notes: ${task.tester_notes ?? '(none)'}
Designer notes: ${task.designer_notes ?? '(none)'}
Resolve the underlying problem before proceeding. Do NOT re-submit without addressing all feedback.`
    }
    if (task.blocked_by) {
      return `
🔴 BLOCKED — DEPENDENCY
This issue is blocked on dependency: ${task.blocked_by}
Verify the blocking issue is complete before proceeding. If it is done, unblock via PATCH { is_blocked: false, blocked_by: null, transitioned_by: "${agentId}" }.`
    }
    return `
🔴 BLOCKED — MANUAL HOLD
This issue was manually blocked. Read implementation_notes and tester_notes for context before proceeding.`
  })() : ''

  const prompt = [
    `<workspace-context>${context}</workspace-context>`,
    `\nYou are ${agentId}. ${config.promptPrefix}`,
    `\nTask: ${task.task_key ?? ''} — ${task.title}`,
    `Project: ${task.project} | Priority: ${task.priority}`,
    `Description: ${task.description ?? 'See title'}`,
    `Acceptance Criteria: ${task.acceptance_criteria ?? 'See description'}`,
    inboxResponseBlock,
    inboxResponseGate,
    blockedReasonBlock,
    deployerFeedback,
    rejectionFeedback,
    branchInstruction,
    skillReference,
    heartbeatInstruction,
    transitionGate,
    pushGate,
    worktreeGuard,
    branchScopeRules,
    selfTriageRules,
    loopBreaker,
    selfChain,
  ].join('\n')

  // Log dir is created lazily so an unwritable temp surfaces here rather than
  // as a spawn ENOENT. The location comes from lib/paths so every writer agrees.
  mkdirSync(LOG_DIR, { recursive: true })
  const logFile = join(LOG_DIR, `agent-${agentId}-${Date.now()}.log`)

  // TOD-793: Dispatch via the runtime adapter registry.
  // Runtime selection priority:
  //   1. per-request ?runtime= override
  //   2. per-agent modelChain walk (TOD-XXX gap 2 fix)
  //   3. TODERO_RUNTIME env
  //   4. highest-priority registered runtime
  const requestedRuntime = req.nextUrl.searchParams.get('runtime')
  let runtime: Awaited<ReturnType<typeof getDefaultRuntime>>
  if (requestedRuntime) {
    runtime = await getRuntimeByName(requestedRuntime) ?? await getDefaultRuntime()
  } else if (config.modelChain && config.modelChain.length > 0) {
    // Walk the agent's fallback chain until we find an available runtime
    runtime = await getDefaultRuntime()  // pessimistic default
    for (const binding of config.modelChain) {
      const r = await getRuntimeByName(binding.runtime)
      if (r) {
        runtime = r
        break
      }
    }
  } else {
    runtime = await getDefaultRuntime()
  }

  // run-agent-locally piece: an explicit ?model= override — a concrete model
  // id (typically a vault agent's `model.fallback_local` from
  // Global_Agents/<id>/manifest.json, e.g. "qwen2.5-coder:14b") the caller
  // already resolved, rather than the per-agent Claude alias in
  // agent-queue.ts. Only lib/runtimes/openai-api.ts reads it
  // (AgentSpawnOptions.modelOverride); other adapters ignore it. Absent =
  // unchanged behavior — config.model still resolves as before.
  //
  // registry-reaches-dispatch piece: the caller resolving that id by hand
  // was the gap — nothing ever passed it automatically, so a local-eligible
  // vault agent's fallback_local was documented here but never actually
  // reached a spawn without someone manually adding ?model=. config.
  // localFallbackModel (lib/agent-manifests.ts's manifestToQueueConfig(),
  // set only when the manifest carries local_eligible:true) is now the
  // default when the caller did not ask for a specific model. mapModel()
  // still checks it against the endpoint's own live model roster before
  // trusting it, so this can never dispatch a model the configured endpoint
  // has not actually pulled — it only removes the requirement that a human
  // type the id in by hand every time.
  const modelOverride = req.nextUrl.searchParams.get('model') ?? config.localFallbackModel ?? undefined

  const spawnResult = await runtime.spawn({
    agentId,
    workingDir: TODERO_DIR,
    prompt,
    model: config.model,
    modelOverride,
    logFile,
    branch,
    taskId: task.id,
    bypassPermissions: true,
  })

  // ── Spawn failure: reset issue to open + mark agent_run as error ──
  // Previously a failed spawn left the issue stuck in_progress until the watchdog
  // cleared it (up to 45 min). Now we immediately undo the claim so the next
  // kick can retry without waiting.
  if (!spawnResult.ok) {
    await db()
      .from('issues')
      .update({ status: config.pickupStatus, started_at: null, heartbeat_at: null, updated_at: new Date().toISOString() })
      .eq('id', task.id)
    if (agentRunId) {
      await db()
        .from('agent_runs')
        .update({ status: 'error', error: spawnResult.error, finished_at: new Date().toISOString() })
        .eq('id', agentRunId)
    }
  } else {
    // TOD-2381: persist the OS pid onto the agent_runs row so a heartbeat-time
    // ceiling stop (wall clock / no progress) can send it a real signal
    // instead of only disowning the row in the database.
    if (agentRunId && spawnResult.pid) {
      void (async () => {
        try {
          const { error } = await db().from('agent_runs').update({ pid: spawnResult.pid }).eq('id', agentRunId)
          if (error) console.warn(`[run-agent] pid persist failed: ${error.message}`)
        } catch { /* best-effort */ }
      })()
    }
    // run-agent-locally piece: persist the log file path so GET
    // /api/run-agent/trace can find it later — before this, a run's trace
    // (or its plain claude-code transcript) was only ever locatable by
    // already knowing the temp filename from this one HTTP response.
    // migrations/046_agent_runs_log_file.sql; best-effort like the pid
    // persist above — a database that has not run that migration yet just
    // never gets this column filled in, not an error.
    if (agentRunId && spawnResult.logFile) {
      void (async () => {
        try {
          const { error } = await db().from('agent_runs').update({ log_file: spawnResult.logFile }).eq('id', agentRunId)
          if (error) console.warn(`[run-agent] log_file persist failed: ${error.message}`)
        } catch { /* best-effort */ }
      })()
    }
    // ── Spawn-confirmation heartbeat — only on successful spawn ──
    // Fires 60s after spawn. If the process dies immediately (context failure,
    // missing binary, worktree error), it never writes its own heartbeat, so this
    // one-time write lets the watchdog detect the fast-death case (heartbeat_at
    // < now()-10min) rather than waiting 45 min for the stale check.
    // NOT fired on spawn failure (would mask the dead process from the watchdog).
    void (async () => {
      await new Promise(resolve => setTimeout(resolve, 60_000))
      // Only vouch for a process that is still there. Writing this blind is
      // what let a child that died at second 3 look alive to the watchdog.
      if (spawnResult.pid && !isAlive(spawnResult.pid)) return
      await db().from('issues').update({ heartbeat_at: new Date().toISOString() }).eq('id', task.id)
    })()
  }

  // TOD-799: Record spawn to token_ledger (no-op if migration not applied)
  recordSpawn({
    agentId,
    taskId: task.id,
    taskKey: task.task_key,
    runtime: runtime.name,
    model: config.model,
    promptBytes: prompt.length,
    logFile,
    metadata: { branch: branch ?? null, priority: task.priority },
  })

  // TOD-939: Best-effort cost logging — fire-and-forget, never blocks response
  logAgentCost({
    project: task.project,
    agent: agentId,
    cost_usd: 0,
    token_count: 0,
    task_key: task.task_key,
    date: new Date().toISOString().slice(0, 10),
  }).catch(() => { /* best-effort */ })

  // Only name a log that is really on disk. Returning a path the adapter never
  // opened is what let a failed dispatch read as a successful one.
  const spawnLogFile = spawnResult.logFile ?? logFile
  const logFileExists = (() => {
    try { return existsSync(spawnLogFile) } catch { return false }
  })()

  // A dispatch that never started is a server-side failure, not a 200. The
  // caller (and the queue kicker) must be able to tell those apart by status
  // code alone.
  return NextResponse.json({
    ok: spawnResult.ok,
    agent: agentId,
    runtime: spawnResult.runtime,
    task: {
      id: task.id,
      title: task.title,
      taskKey: task.task_key,
      project: task.project,
      priority: task.priority,
      branch,
    },
    spawned: spawnResult.ok,
    pid: spawnResult.pid ?? null,
    spawnError: spawnResult.error,
    command: spawnResult.command,
    ...(logFileExists ? { logFile: spawnLogFile } : { logFile: null, logFileMissing: spawnLogFile }),
    wip: (wipIssues?.length ?? 0) + 1,
    wipLimit: config.wipLimit,
    remaining: readyTasks.length - 1,
  }, { status: spawnResult.ok ? 200 : 500 })
}

// GET /api/run-agent — status/heartbeat for all queue lanes
export async function GET(req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const REQUIRED_PERMISSION = 'agents:read' as const
  const callerRole = await resolveCallerRole(req)
  if (callerRole !== null) {
    const perm = await checkRoutePermission(callerRole, 'GET', '/api/run-agent')
    if (!perm.allowed) return NextResponse.json(perm.body, { status: perm.status })
  }

  // registry-reaches-dispatch piece: see the identical call + comment in
  // POST above — this GET path resolves configs via the same
  // getQueueConfig()/getAllQueueAgentIds() and must see the same vault
  // agents, whether that is `?info=1` on one agent or the full lane listing
  // below.
  //
  // Round 2: no longer discarded — `vaultSync.warning` is threaded into both
  // response branches below so a persistence failure is visible on this
  // route too, not just GET /api/agents.
  const vaultSync = await ensureVaultDispatchConfigs()

  const agentId = req.nextUrl.searchParams.get('agent')
  const infoMode = req.nextUrl.searchParams.get('info') === '1'

  // GET /api/run-agent?agent=X&info=1 — resolve runtime config without spawning.
  //
  // run-agent-locally piece / round-3 fix: this used to call
  // getDefaultRuntime()/getRuntimeByName(), both of which call
  // assertDispatchEnabled() and THROW when TODERO_DISPATCH_ENABLED!=1 — i.e.
  // this read-only "what would happen" endpoint 500'd (empty body, uncaught
  // DispatchDisabledError) on every instance in the guard's own default
  // state. Use inspectRuntime() instead — the same guard-free resolver the
  // ?dryRun=1 branch above already uses for exactly this reason (see its
  // comment: "Deliberately runs BEFORE the dispatch guard").
  if (infoMode) {
    if (!agentId) {
      return NextResponse.json({ error: '?agent=X is required when ?info=1' }, { status: 400 })
    }
    const config = getQueueConfig(agentId)
    if (!config) {
      return NextResponse.json({ error: `Unknown agent: ${agentId}` }, { status: 400 })
    }
    const chainLength = config.modelChain?.length ?? 0
    let resolvedRuntime: string
    let modelAlias: string
    if (config.modelChain && config.modelChain.length > 0) {
      // Walk the chain for the first binding whose runtime reports available —
      // mirrors the POST path's walk, but via the guard-free inspector.
      let picked: { runtime: string; alias: string } | null = null
      for (const binding of config.modelChain) {
        const info = await inspectRuntime(binding.runtime)
        if (info.available) {
          picked = { runtime: info.runtime, alias: binding.alias }
          break
        }
      }
      if (picked) {
        resolvedRuntime = picked.runtime
        modelAlias = picked.alias
      } else {
        const fallback = await inspectRuntime(null)
        resolvedRuntime = fallback.runtime
        modelAlias = config.model
      }
    } else {
      const info = await inspectRuntime(null)
      resolvedRuntime = info.runtime
      modelAlias = config.model
    }
    return NextResponse.json({
      agent: agentId,
      resolvedRuntime,
      modelAlias,
      chainLength,
      dispatchEnabled: !dispatchDisabled(),
      vaultSync: { source: vaultSync.source, persisted: vaultSync.persisted, warning: vaultSync.warning },
    })
  }

  const agentIds = agentId ? [agentId] : getAllQueueAgentIds()

  const lanes = await Promise.all(
    agentIds.map(async (id) => {
      const config = getQueueConfig(id)
      if (!config) return { agent: id, error: 'unknown agent' }

      // Count WIP — mirror the POST path exactly for each agent type
      const isReviewerGet = id === 'tester' || id === 'designer'
      const reviewStatusFieldGet = id === 'tester' ? 'tester_status' : 'designer_status'
      const wipExtraFilterGet = config.wipExtraFilter ? `&${config.wipExtraFilter}` : ''
      const wipQueryGet = isReviewerGet
        ? `status=eq.${config.workingStatus}&${reviewStatusFieldGet}=in.(running,in_progress)&is_blocked=eq.false&select=id`
        : `assignee=eq.${id}&status=eq.${config.workingStatus}${wipExtraFilterGet}&select=id`
      const wipIssues = await selectRows<{ id: string }>('issues', wipQueryGet)

      // Count eligible — reviewers filter by pending review status, not assignee
      const dorFilter = config.dorFields.map(f => `${f}=not.is.null`).join('&')
      const extraFilter = config.extraFilters ? `&${config.extraFilters}` : ''
      const eligibleFilter = isReviewerGet
        ? `status=eq.${config.pickupStatus}&${reviewStatusFieldGet}=eq.pending`
        : `assignee=eq.${id}&status=eq.${config.pickupStatus}`
      const eligible = await selectRows<{ id: string }>(
        'issues',
        `${eligibleFilter}&${dorFilter}${extraFilter}&select=id&limit=100`,
      )

      return {
        agent: id,
        wip: wipIssues.length,
        wipLimit: config.wipLimit,
        eligible: eligible.length,
        pickupStatus: config.pickupStatus,
        workingStatus: config.workingStatus,
      }
    })
  )

  return NextResponse.json({
    lanes,
    timestamp: new Date().toISOString(),
    vaultSync: { source: vaultSync.source, persisted: vaultSync.persisted, warning: vaultSync.warning },
  })
}

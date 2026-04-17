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
import { satisfiesIssueDependency } from '@/lib/issue-lifecycle'
import { isHubPaused } from '@/lib/hub-pause'
import { isAgentPaused } from '@/lib/loop-breaker'
import { exec } from 'child_process'
import { readFileSync as fsReadFileSync } from 'fs'
import { getDefaultRuntime, getRuntimeByName, listRuntimes } from '@/lib/runtimes'
import { recordSpawn } from '@/lib/runtimes/token-ledger'
import { logAgentCost } from '@/lib/agent-cost-log'

const SUPA_URL = 'https://twthgapiouiqhavrcnry.supabase.co'
// Lazy-init: avoids crashing at build time when env vars aren't set (CI).
// Falls back to hardcoded key for local dev (same as hub-client.ts).
let _supaKey: string | null = null
function getSupaKey(): string {
  if (!_supaKey) {
    _supaKey = process.env.SUPABASE_SERVICE_ROLE_KEY ??
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
  }
  return _supaKey
}
function getHeaders() { const k = getSupaKey(); return { 'apikey': k, 'Authorization': `Bearer ${k}`, 'Content-Type': 'application/json' } }

const CLAUDE_BIN = '/Users/kemuniagent/.local/bin/claude'
const WORKSPACE = '/Users/kemuniagent/todero/config'
const TODERO_DIR = '/Users/kemuniagent/todero'
const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low']
const MAX_REJECTION_CYCLES = 3

const AGENT_CONTEXT_SOURCE = process.env.AGENT_CONTEXT_SOURCE ?? 'fs'
const MAX_CONTEXT_BYTES = 30_000

// In-memory context cache keyed by agentId — TTL 5 minutes
// Prevents redundant Supabase reads when watchdog kicks same agent repeatedly
const CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000
const contextCache = new Map<string, { context: string; expiresAt: number }>()

async function loadContextFromDB(agentId: string): Promise<string> {
  const cached = contextCache.get(agentId)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.context
  }
  const supaHeaders = {
    'apikey': getSupaKey(),
    'Authorization': `Bearer ${getSupaKey()}`,
    'Content-Type': 'application/json',
  }

  // Fetch global + per-agent documents + shared skill docs
  const docsRes = await fetch(
    `${SUPA_URL}/rest/v1/agent_documents?or=(agent_id.eq.global,agent_id.eq.${agentId},agent_id.eq.skill)&order=doc_type.asc,slug.asc`,
    { headers: supaHeaders }
  )
  const docs = await docsRes.json() as Array<{ agent_id: string; doc_type: string; slug: string; content: string }>

  // Fetch memory: today + yesterday daily notes + long_term + self_improving + corrections
  // Bug fix: table was renamed agent_memory → agent_memory_files (agent_memory is the key-value store)
  const today = new Date().toISOString().slice(0, 10)
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const memRes = await fetch(
    `${SUPA_URL}/rest/v1/agent_memory_files?agent_id=eq.global&or=(memory_type.in.(long_term,self_improving,corrections),and(memory_type.eq.daily,date_key.in.(${today},${yesterday})))&order=updated_at.desc`,
    { headers: supaHeaders }
  )
  const memRows = await memRes.json() as Array<{ memory_type: string; date_key: string | null; content: string }>

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

  // Memory: self_improving first (HOT), then long_term, then daily (newest first)
  const siMem = memRows.find(m => m.memory_type === 'self_improving')
  if (siMem) sections.push(`# SELF-IMPROVING MEMORY\n\n${siMem.content}`)

  const ltMem = memRows.find(m => m.memory_type === 'long_term')
  if (ltMem) sections.push(`# LONG-TERM MEMORY\n\n${ltMem.content}`)

  const dailyMem = memRows.filter(m => m.memory_type === 'daily').sort((a, b) => (b.date_key ?? '').localeCompare(a.date_key ?? ''))
  for (const m of dailyMem) {
    sections.push(`# DAILY MEMORY (${m.date_key})\n\n${m.content}`)
  }

  // Hard context limit: drop from the end (oldest memory) until under MAX_CONTEXT_BYTES
  let combined = sections.join('\n\n---\n\n')
  while (combined.length > MAX_CONTEXT_BYTES && sections.length > 1) {
    sections.pop()
    combined = sections.join('\n\n---\n\n')
  }

  // Cache the result
  contextCache.set(agentId, { context: combined, expiresAt: Date.now() + CONTEXT_CACHE_TTL_MS })
  return combined
}

export async function POST(req: NextRequest) {
  // Hub pause guard — reject new agent activations when paused
  if (await isHubPaused()) {
    return NextResponse.json({ error: 'Agents are paused', paused: true }, { status: 503 })
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
  const wipExtraFilter = config.wipExtraFilter ? `&${config.wipExtraFilter}` : ''
  const wipUrl = isReviewer
    ? `${SUPA_URL}/rest/v1/issues?status=eq.${config.workingStatus}&${reviewStatusField}=in.(running,in_progress)&select=id`
    : `${SUPA_URL}/rest/v1/issues?assignee=eq.${agentId}&status=eq.${config.workingStatus}${wipExtraFilter}&select=id`
  const wipRes = await fetch(wipUrl, { headers: getHeaders() })
  const wipIssues = await wipRes.json() as Array<{ id: string }>
  if (Array.isArray(wipIssues) && wipIssues.length >= config.wipLimit) {
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
  // Workers: issues assigned to them
  const assigneeFilter = isReviewer
    ? `${reviewStatusField}=eq.pending`
    : `assignee=eq.${agentId}`
  // Support multi-status pickup (e.g. PO handles backlog + feature_review)
  const allPickupStatuses = config.pickupStatuses ?? [config.pickupStatus]
  const statusFilter = allPickupStatuses.length === 1
    ? `status=eq.${allPickupStatuses[0]}`
    : `status=in.(${allPickupStatuses.join(',')})`
  const url = `${SUPA_URL}/rest/v1/issues?${assigneeFilter}&${statusFilter}&${dorFilter}${extraFilter}&select=id,title,description,priority,due_date,created_at,project,acceptance_criteria,task_key,feature_branch,blocked_by,rejection_count,type,status,parent_id&order=${config.sortOrder}&limit=${config.fetchLimit}`

  const res = await fetch(url, { headers: getHeaders() })
  const tasks = await res.json() as Array<{
    id: string; title: string; description: string; priority: string;
    due_date: string | null; created_at: string; project: string; acceptance_criteria: string | null;
    task_key: string | null; feature_branch: string | null;
    blocked_by: string | null; status: string; parent_id: string | null
  }>

  if (!Array.isArray(tasks) || tasks.length === 0) {
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
      const blockerRes = await fetch(
        `${SUPA_URL}/rest/v1/issues?or=(id.in.(${blockedByIds.join(',')}),task_key.in.(${blockedByIds.join(',')}))&select=id,task_key,status`,
        { headers: getHeaders() }
      )
      const blockers = await blockerRes.json() as Array<{ id: string; task_key: string | null; status: string }>
      if (Array.isArray(blockers)) {
        for (const b of blockers) {
          blockerStatuses[b.id] = b.status
          if (b.task_key) blockerStatuses[b.task_key] = b.status
        }
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

  // ── Step 4: Priority sort — parent underway first, then priority → due_date → created_at ──
  // Fetch parent statuses so issues under an active feature (status=underway) jump the queue.
  const parentIds = Array.from(new Set(readyTasks.map(t => t.parent_id).filter(Boolean))) as string[]
  const parentStatuses: Record<string, string> = {}
  if (parentIds.length > 0) {
    const parentRes = await fetch(
      `${SUPA_URL}/rest/v1/issues?id=in.(${parentIds.join(',')})&select=id,status`,
      { headers: getHeaders() }
    )
    const parents = await parentRes.json() as Array<{ id: string; status: string }>
    if (Array.isArray(parents)) {
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

  const task = readyTasks[0]

  // ── Step 5: Claim the issue ──
  // Always set started_at to mark the issue as claimed by this agent, even when
  // pickupStatus === workingStatus (e.g. deployer). This lets the wipExtraFilter
  // distinguish "claimed" from "queued but unclaimed" issues in the WIP count.
  const claimFields: Record<string, string> = {
    started_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }
  if (config.pickupStatus !== config.workingStatus) {
    claimFields.status = config.workingStatus
  }
  await fetch(`${SUPA_URL}/rest/v1/issues?id=eq.${task.id}`, {
    method: 'PATCH',
    headers: { ...getHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify(claimFields),
  })

  // ── Step 5b: Spawn-confirmation heartbeat (60 s after spawn) ──────────────
  // If the spawned process exits immediately (context failure, missing binary,
  // worktree error), it never writes a heartbeat. The watchdog will detect
  // heartbeat_at < now()-10min and reset to open — catching fast-death cases
  // that used to hold WIP for 20-30 min before the old stale check triggered.
  void (async () => {
    await new Promise(resolve => setTimeout(resolve, 60_000))
    await fetch(`${SUPA_URL}/rest/v1/issues?id=eq.${task.id}`, {
      method: 'PATCH',
      headers: { ...getHeaders(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ heartbeat_at: new Date().toISOString() }),
    })
  })()

  // ── Step 6: Log agent_run ──
  await fetch(`${SUPA_URL}/rest/v1/agent_runs`, {
    method: 'POST',
    headers: { ...getHeaders(), 'Prefer': 'return=minimal' },
    body: JSON.stringify({
      agent_id: agentId,
      task_id: task.id,
      task_title: task.title,
      status: 'running',
    }),
  })

  // ── Step 7: Loop breaker check — skip if issue has been rejected too many times ──
  const rejectionCount = (task as Record<string, unknown>).rejection_count as number ?? 0
  if (rejectionCount >= MAX_REJECTION_CYCLES) {
    return NextResponse.json({
      agent: agentId,
      message: `Issue ${task.task_key} has been rejected ${rejectionCount} times. Escalating to KAOS.`,
      escalated: true,
    })
  }

  // ── Step 8: Auto-set feature branch for code-producing agents ──
  let branch = task.feature_branch
  if (!branch && task.task_key && ['builder', 'ops'].includes(agentId)) {
    branch = `feat/${(task.task_key as string).toLowerCase()}`
    await fetch(`${SUPA_URL}/rest/v1/issues?id=eq.${task.id}`, {
      method: 'PATCH', headers: { ...getHeaders(), 'Prefer': 'return=minimal' },
      body: JSON.stringify({ feature_branch: branch })
    })
  }

  // ── Step 9: Spawn Claude Code agent in background ──
  // FIX (2026-04-10): Previously `$(cat ...)` template literal was never evaluated.
  // TOD-796 (2026-04-10): Now also injects todero/config skills so pipeline agents inherit
  // proactivity, corrections discipline, memory hygiene, and self-reflection rules.
  // AGENT_CONTEXT_SOURCE=db loads context from Supabase; default 'fs' keeps filesystem path.
  const readIfExists = (p: string): string => {
    try { return fsReadFileSync(p, 'utf8') } catch { return '' }
  }
  const today = new Date().toISOString().slice(0, 10)

  let context: string
  if (AGENT_CONTEXT_SOURCE === 'db') {
    context = await loadContextFromDB(agentId)
    // Wrap in contextSections format matching existing structure
    const contextSections: string[] = [`# WORKSPACE IDENTITY\n\n${context}`]
    context = contextSections.join('\n\n===============================\n\n')
  } else {
    // Existing filesystem path (unchanged)
    const workspaceParts = [
      readIfExists(`${WORKSPACE}/SOUL.md`),
      readIfExists(`${WORKSPACE}/AGENTS.md`),
      readIfExists(`${WORKSPACE}/self-improving/memory.md`),
      readIfExists(`${WORKSPACE}/memory/${today}.md`),
    ].filter(Boolean)
    const workspace = workspaceParts.join('\n\n---\n\n')

    const universalSkills = [
      readIfExists(`${WORKSPACE}/skills/proactivity/execution.md`),
      readIfExists(`${WORKSPACE}/skills/proactivity/signals.md`),
      readIfExists(`${WORKSPACE}/skills/proactivity/boundaries.md`),
      readIfExists(`${WORKSPACE}/skills/self-improving/corrections.md`),
      readIfExists(`${WORKSPACE}/skills/self-improving/memory.md`),
      readIfExists(`${WORKSPACE}/skills/self-improving/reflections.md`),
    ].filter(Boolean).join('\n\n---\n\n')

    const agentSkillFiles: Record<string, string[]> = {
      po:       [`${WORKSPACE}/skills/issue-routing/SKILL.md`, `${WORKSPACE}/skills/agent-setup/SKILL.md`],
      main:     [`${WORKSPACE}/skills/issue-routing/SKILL.md`, `${WORKSPACE}/skills/agent-creation/SKILL.md`],
      scout:    [`${WORKSPACE}/skills/issue-routing/SKILL.md`],
      builder:  [`${WORKSPACE}/skills/self-improving/learning.md`],
      ops:      [`${WORKSPACE}/skills/self-improving/operations.md`],
      tester:   [`${WORKSPACE}/skills/bug-report/SKILL.md`],
      designer: [],
      auditor:  [`${WORKSPACE}/skills/self-improving/reflections.md`],
      deployer: [],
    }
    const agentSkills = (agentSkillFiles[agentId] ?? [])
      .map(readIfExists)
      .filter(Boolean)
      .join('\n\n---\n\n')

    const contextSections: string[] = []
    if (workspace) contextSections.push(`# WORKSPACE IDENTITY\n\n${workspace}`)
    if (universalSkills) contextSections.push(`# UNIVERSAL SKILLS (behavioral rules — follow these on every task)\n\n${universalSkills}`)
    if (agentSkills) contextSections.push(`# ${agentId.toUpperCase()}-SPECIFIC SKILLS\n\n${agentSkills}`)
    context = contextSections.join('\n\n===============================\n\n')
  }

  // Size guardrail — warn if prompt context exceeds 25KB (approx 6k tokens)
  if (context.length > 25_000) {
    console.warn(`[run-agent] context for ${agentId} is ${context.length} bytes — trim skill selection if this keeps climbing`)
  }

  const transitionGate = `

🚨 NON-NEGOTIABLE FINAL STEP 🚨
Your work is NOT COMPLETE until you PATCH the issue status. If you skip this step, your work is LOST because another agent cannot pick up this issue while it is still in its current status.

After finishing the work, RUN THIS EXACT COMMAND before ending your session:

curl -s -X PATCH http://localhost:3000/api/issues -H "Content-Type: application/json" -d '{"id":"${task.id}","status":"${config.completionStatus}","transitioned_by":"${agentId}","implementation_notes":"<1-2 sentences of what you did>","commit_sha":"'"$(git rev-parse HEAD 2>/dev/null || echo none)"'","regression_test":"<how to verify>"}'

VERIFY the response shows status="${config.completionStatus}". If you get an error:
1. Read the error message carefully (missing fields, wrong role, etc.)
2. Fix the issue and retry the PATCH
3. Do NOT end your session until the PATCH succeeds

This is a HARD RULE. Do not treat it as optional. Do not assume someone else will do it for you.`

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

  const worktreeGuard = `

🛑 WORKTREE RULES — node_modules is SHARED 🛑
You are running inside a git worktree. Your node_modules directory is a SYMLINK to ~/todero/node_modules.
- ❌ DO NOT run \`npm install\` or \`npm ci\` — it replaces the symlink with an incomplete local install, breaking ALL other agents
- ❌ DO NOT run \`npm install <package>\` — if a package is missing, PATCH back to open with a note asking KAOS to install it
- ✅ \`npm run build\` is fine — it uses the existing symlinked node_modules
- ✅ If build fails with "Cannot find module X", check ~/todero/node_modules/X directly; if truly missing, PATCH back to open
- ✅ Stay in your worktree directory — do NOT cd to ~/todero for any build commands`

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

  const prompt = [
    `<workspace-context>${context}</workspace-context>`,
    `\nYou are ${agentId}. ${config.promptPrefix}`,
    `\nTask: ${task.task_key ?? ''} — ${task.title}`,
    `Project: ${task.project} | Priority: ${task.priority}`,
    `Description: ${task.description ?? 'See title'}`,
    `Acceptance Criteria: ${task.acceptance_criteria ?? 'See description'}`,
    branchInstruction,
    skillReference,
    heartbeatInstruction,
    transitionGate,
    pushGate,
    worktreeGuard,
    loopBreaker,
    selfChain,
  ].join('\n')

  const logFile = `/tmp/agent-${agentId}-${Date.now()}.log`

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

  const spawnResult = await runtime.spawn({
    agentId,
    workingDir: TODERO_DIR,
    prompt,
    model: config.model,
    logFile,
    branch,
    taskId: task.id,
    bypassPermissions: true,
  })

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
    spawnError: spawnResult.error,
    logFile,
    wip: (wipIssues?.length ?? 0) + 1,
    wipLimit: config.wipLimit,
    remaining: readyTasks.length - 1,
  })
}

// GET /api/run-agent — status/heartbeat for all queue lanes
export async function GET(req: NextRequest) {
  const agentId = req.nextUrl.searchParams.get('agent')
  const agentIds = agentId ? [agentId] : getAllQueueAgentIds()

  const lanes = await Promise.all(
    agentIds.map(async (id) => {
      const config = getQueueConfig(id)
      if (!config) return { agent: id, error: 'unknown agent' }

      // Count WIP — apply wipExtraFilter so deployer WIP is accurate (same logic as POST path)
      const wipExtraFilterGet = config.wipExtraFilter ? `&${config.wipExtraFilter}` : ''
      const wipRes = await fetch(
        `${SUPA_URL}/rest/v1/issues?assignee=eq.${id}&status=eq.${config.workingStatus}${wipExtraFilterGet}&select=id`,
        { headers: getHeaders() }
      )
      const wipIssues = await wipRes.json() as Array<{ id: string }>

      // Count eligible
      const dorFilter = config.dorFields.map(f => `${f}=not.is.null`).join('&')
      const extraFilter = config.extraFilters ? `&${config.extraFilters}` : ''
      const eligibleRes = await fetch(
        `${SUPA_URL}/rest/v1/issues?assignee=eq.${id}&status=eq.${config.pickupStatus}&${dorFilter}${extraFilter}&select=id&limit=100`,
        { headers: getHeaders() }
      )
      const eligible = await eligibleRes.json() as Array<{ id: string }>

      return {
        agent: id,
        wip: Array.isArray(wipIssues) ? wipIssues.length : 0,
        wipLimit: config.wipLimit,
        eligible: Array.isArray(eligible) ? eligible.length : 0,
        pickupStatus: config.pickupStatus,
        workingStatus: config.workingStatus,
      }
    })
  )

  return NextResponse.json({ lanes, timestamp: new Date().toISOString() })
}

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
import { exec } from 'child_process'
import { readFileSync as fsReadFileSync } from 'fs'

const SUPA_URL = 'https://twthgapiouiqhavrcnry.supabase.co'
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
const HEADERS = { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' }

const CLAUDE_BIN = '/Users/kemuniagent/.local/bin/claude'
const WORKSPACE = '/Users/kemuniagent/kaos-config'
const TODERO_DIR = '/Users/kemuniagent/todero'
const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low']
const MAX_REJECTION_CYCLES = 3

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
  const wipRes = await fetch(wipUrl, { headers: HEADERS })
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
  const url = `${SUPA_URL}/rest/v1/issues?${assigneeFilter}&status=eq.${config.pickupStatus}&${dorFilter}${extraFilter}&select=id,title,description,priority,due_date,project,acceptance_criteria,task_key,feature_branch,blocked_by,rejection_count,type&order=${config.sortOrder}&limit=${config.fetchLimit}`

  const res = await fetch(url, { headers: HEADERS })
  const tasks = await res.json() as Array<{
    id: string; title: string; description: string; priority: string;
    due_date: string | null; project: string; acceptance_criteria: string | null;
    task_key: string | null; feature_branch: string | null;
    blocked_by: string | null
  }>

  if (!Array.isArray(tasks) || tasks.length === 0) {
    return NextResponse.json({
      agent: agentId,
      message: `No eligible issues for ${agentId} (status=${config.pickupStatus}, DoR fields: ${config.dorFields.join(', ')})`,
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
        { headers: HEADERS }
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

  // ── Step 4: Priority sort (fallback — Supabase already sorts, but ensure consistency) ──
  readyTasks.sort((a, b) => {
    const pa = PRIORITY_ORDER.indexOf(a.priority)
    const pb = PRIORITY_ORDER.indexOf(b.priority)
    if (pa !== pb) return pa - pb
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
    if (a.due_date) return -1
    if (b.due_date) return 1
    return 0
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
    headers: { ...HEADERS, 'Prefer': 'return=minimal' },
    body: JSON.stringify(claimFields),
  })

  // ── Step 6: Log agent_run ──
  await fetch(`${SUPA_URL}/rest/v1/agent_runs`, {
    method: 'POST',
    headers: { ...HEADERS, 'Prefer': 'return=minimal' },
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
      method: 'PATCH', headers: { ...HEADERS, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ feature_branch: branch })
    })
  }

  // ── Step 9: Spawn Claude Code agent in background ──
  // FIX (2026-04-10): Previously `$(cat ...)` template literal was never evaluated.
  // TOD-796 (2026-04-10): Now also injects kaos-config skills so pipeline agents inherit
  // proactivity, corrections discipline, memory hygiene, and self-reflection rules.
  const readIfExists = (p: string): string => {
    try { return fsReadFileSync(p, 'utf8') } catch { return '' }
  }
  const today = new Date().toISOString().slice(0, 10)

  // Workspace identity — always loaded
  const workspaceParts = [
    readIfExists(`${WORKSPACE}/SOUL.md`),
    readIfExists(`${WORKSPACE}/AGENTS.md`),
    readIfExists(`${WORKSPACE}/self-improving/memory.md`),
    readIfExists(`${WORKSPACE}/memory/${today}.md`),
  ].filter(Boolean)
  const workspace = workspaceParts.join('\n\n---\n\n')

  // Universal skill bundle — behavioral rules every agent inherits
  const universalSkills = [
    readIfExists(`${WORKSPACE}/skills/proactivity/execution.md`),
    readIfExists(`${WORKSPACE}/skills/proactivity/signals.md`),
    readIfExists(`${WORKSPACE}/skills/proactivity/boundaries.md`),
    readIfExists(`${WORKSPACE}/skills/self-improving/corrections.md`),
    readIfExists(`${WORKSPACE}/skills/self-improving/memory.md`),
    readIfExists(`${WORKSPACE}/skills/self-improving/reflections.md`),
  ].filter(Boolean).join('\n\n---\n\n')

  // Agent-specific skill routing
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

  // Assemble context — workspace first (most-authoritative), then skills, then task
  const contextSections: string[] = []
  if (workspace) contextSections.push(`# WORKSPACE IDENTITY\n\n${workspace}`)
  if (universalSkills) contextSections.push(`# UNIVERSAL SKILLS (behavioral rules — follow these on every task)\n\n${universalSkills}`)
  if (agentSkills) contextSections.push(`# ${agentId.toUpperCase()}-SPECIFIC SKILLS\n\n${agentSkills}`)
  const context = contextSections.join('\n\n===============================\n\n')

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

  const selfChain = `\n\nAFTER the PATCH succeeds, call: curl -s -X POST http://localhost:3000/api/run-agent?agent=${agentId} to auto-claim your next task.`
  const loopBreaker = `\n\nIF same error 3 times: STOP, PATCH back to open with notes explaining the blocker. Do NOT retry infinitely.`

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
    transitionGate,
    pushGate,
    loopBreaker,
    selfChain,
  ].join('\n')

  const escaped = prompt.replace(/'/g, "'\\''")
  const logFile = `/tmp/agent-${agentId}-${Date.now()}.log`
  const modelFlag = config.model ? `--model ${config.model}` : ''
  // Safeguard: always switch to main before spawning agent (prevents feature branch drift)
  // Agents that need a feature branch will checkout from main in their own task flow
  const cmd = `cd ${TODERO_DIR} && git checkout main 2>/dev/null; nohup ${CLAUDE_BIN} --permission-mode bypassPermissions ${modelFlag} --print '${escaped}' > ${logFile} 2>&1 < /dev/null & disown`
  exec(cmd, {
    timeout: 5000,
    detached: true,
    stdio: 'ignore',
  } as never, () => {})

  return NextResponse.json({
    ok: true,
    agent: agentId,
    task: {
      id: task.id,
      title: task.title,
      taskKey: task.task_key,
      project: task.project,
      priority: task.priority,
      branch,
    },
    spawned: true,
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

      // Count WIP
      const wipRes = await fetch(
        `${SUPA_URL}/rest/v1/issues?assignee=eq.${id}&status=eq.${config.workingStatus}&select=id`,
        { headers: HEADERS }
      )
      const wipIssues = await wipRes.json() as Array<{ id: string }>

      // Count eligible
      const dorFilter = config.dorFields.map(f => `${f}=not.is.null`).join('&')
      const extraFilter = config.extraFilters ? `&${config.extraFilters}` : ''
      const eligibleRes = await fetch(
        `${SUPA_URL}/rest/v1/issues?assignee=eq.${id}&status=eq.${config.pickupStatus}&${dorFilter}${extraFilter}&select=id&limit=100`,
        { headers: HEADERS }
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

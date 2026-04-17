import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import { writeFileSync } from 'fs'
import path from 'path'
import { satisfiesIssueDependency } from '@/lib/issue-lifecycle'

const execAsync = promisify(exec)
const BUILDER_WRAPPER = path.join(process.cwd(), 'scripts', 'builder-with-cost.sh')

const SUPA_URL = 'https://twthgapiouiqhavrcnry.supabase.co'
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
const HEADERS = { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' }

const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low']
const WIP_LIMIT_IN_PROGRESS = 3

export async function POST(req: NextRequest) {
  const auth = req.headers.get('x-internal-secret')
  if (auth !== (process.env.INTERNAL_SECRET ?? 'kaos-internal-2026')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // ── INF-184: WIP limit check — max 3 in_progress ──
  const wipRes = await fetch(
    `${SUPA_URL}/rest/v1/issues?assignee=eq.builder&status=eq.in_progress&select=id`,
    { headers: HEADERS }
  )
  const wipIssues = await wipRes.json() as Array<{ id: string }>
  if (Array.isArray(wipIssues) && wipIssues.length >= WIP_LIMIT_IN_PROGRESS) {
    return NextResponse.json({
      message: `WIP limit reached: ${wipIssues.length}/${WIP_LIMIT_IN_PROGRESS} in_progress. Finish current work first.`,
      wip: wipIssues.length
    })
  }

  // ── INF-179: DoR gate — only fetch issues with ALL required fields ──
  const res = await fetch(
    `${SUPA_URL}/rest/v1/issues?assignee=eq.builder&status=eq.open&description=not.is.null&acceptance_criteria=not.is.null&test_tier=not.is.null&select=id,title,description,priority,due_date,project,acceptance_criteria,test_tier,task_key,feature_branch,blocked_by&limit=50`,
    { headers: HEADERS }
  )
  const tasks = await res.json() as Array<{
    id: string; title: string; description: string; priority: string;
    due_date: string | null; project: string; acceptance_criteria: string | null;
    test_tier: string | null; task_key: string | null; feature_branch: string | null;
    blocked_by: string | null
  }>

  if (!tasks.length) {
    return NextResponse.json({ message: 'No DoR-ready builder tasks (need description + acceptance_criteria + test_tier)' })
  }

  // ── INF-186: Dependency blocking — skip issues where blocked_by issue is not in a finished state ──
  const blockedByIds = tasks
    .filter(t => t.blocked_by)
    .map(t => t.blocked_by!)
  let blockerStatuses: Record<string, string> = {}
  if (blockedByIds.length > 0) {
    // Fetch status of blocking issues (could be task_key or id)
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

  const readyTasks = tasks.filter(t => {
    if (!t.blocked_by) return true
    const blockerStatus = blockerStatuses[t.blocked_by]
    return satisfiesIssueDependency(blockerStatus)
  })

  if (readyTasks.length === 0) {
    return NextResponse.json({
      message: 'All DoR-ready tasks are blocked by unfinished dependencies',
      blocked: tasks.filter(t => t.blocked_by).map(t => ({ task_key: t.task_key, blocked_by: t.blocked_by }))
    })
  }

  // Sort by priority → due_date → Vespera first
  readyTasks.sort((a, b) => {
    const pa = PRIORITY_ORDER.indexOf(a.priority)
    const pb = PRIORITY_ORDER.indexOf(b.priority)
    if (pa !== pb) return pa - pb
    if (a.due_date && b.due_date) return a.due_date.localeCompare(b.due_date)
    if (a.due_date) return -1
    if (b.due_date) return 1
    if (a.project === 'Vespera' && b.project !== 'Vespera') return -1
    if (b.project === 'Vespera' && a.project !== 'Vespera') return 1
    return 0
  })

  const task = readyTasks[0]

  // ── INF-180: Branch strategy — auto-set feature_branch if null ──
  let branch = task.feature_branch
  if (!branch && task.task_key) {
    branch = `feat/${task.task_key.toLowerCase()}`
    // Persist feature_branch on the issue
    await fetch(`${SUPA_URL}/rest/v1/issues?id=eq.${task.id}`, {
      method: 'PATCH', headers: { ...HEADERS, 'Prefer': 'return=minimal' },
      body: JSON.stringify({ feature_branch: branch, updated_at: new Date().toISOString() })
    })
  }

  // Mark in_progress
  await fetch(`${SUPA_URL}/rest/v1/issues?id=eq.${task.id}`, {
    method: 'PATCH', headers: { ...HEADERS, 'Prefer': 'return=minimal' },
    body: JSON.stringify({ status: 'in_progress', updated_at: new Date().toISOString() })
  })

  // Log agent run
  const runRes = await fetch(`${SUPA_URL}/rest/v1/agent_runs`, {
    method: 'POST', headers: { ...HEADERS, 'Prefer': 'return=representation' },
    body: JSON.stringify({ agent_id: 'builder', task_id: task.id, task_title: task.title, status: 'running' })
  })
  const [run] = await runRes.json()

  // Spawn Builder — checkout correct branch
  const prompt = `You are Builder. Complete this task for nabitllc/vespera:
Task: ${task.title}
Description: ${task.description || 'See task title'}
Project: ${task.project}
Branch: ${branch || 'main'}

${branch ? `Checkout branch ${branch} (create if needed): git checkout -b ${branch} 2>/dev/null || git checkout ${branch}` : 'Work on main branch.'}
Add [skip ci] to all commits. npm run build must pass.
When done: curl -s -X POST http://localhost:3000/api/task-done -H 'x-internal-secret: kaos-internal-2026' -H 'Content-Type: application/json' -d '{"taskId":"${task.id}","taskTitle":"${task.title}","agentId":"builder","status":"done"}'
Then notify: curl -s -X POST http://localhost:3000/api/notify -H 'Content-Type: application/json' -d '{"text":"✅ Builder completed ${task.title}","channels":["discord-alerts"]}'`

  // Write prompt to tempfile — avoids shell quoting issues and lets the
  // wrapper script capture --output-format=json for cost/token tracking.
  const runId = run?.id ?? 'none'
  const repoDir = `/tmp/builder-${task.id.slice(0, 8)}`
  const promptFile = `/tmp/builder-prompt-${runId}.txt`
  try { writeFileSync(promptFile, prompt) } catch { /* non-fatal */ }

  // Clone repo, then background the wrapper which runs claude and writes back cost/tokens
  execAsync(
    `git clone https://github.com/nabitllc/vespera.git ${repoDir} 2>/dev/null; ` +
    `/bin/bash ${BUILDER_WRAPPER} ${runId} ${repoDir} ${promptFile} &`
  ).catch(console.error)

  return NextResponse.json({
    ok: true, task: task.title, taskKey: task.task_key,
    branch, runId: run?.id, priority: task.priority,
    wip: (wipIssues?.length ?? 0) + 1
  })
}

import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

const SUPA_URL = 'https://twthgapiouiqhavrcnry.supabase.co'
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
const HEADERS = { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}`, 'Content-Type': 'application/json' }

const PRIORITY_ORDER = ['critical', 'high', 'medium', 'low']

export async function POST(req: NextRequest) {
  const auth = req.headers.get('x-internal-secret')
  if (auth !== (process.env.INTERNAL_SECRET ?? 'kaos-internal-2026')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Smart task selection: priority → due_date → created_at
  const res = await fetch(
    `${SUPA_URL}/rest/v1/issues?assignee=eq.builder&status=eq.open&select=id,title,description,priority,due_date,project&limit=50`,
    { headers: HEADERS }
  )
  const tasks = await res.json() as Array<{id:string,title:string,description:string,priority:string,due_date:string|null,project:string}>

  if (!tasks.length) {
    return NextResponse.json({ message: 'No open builder tasks' })
  }

  // Sort: priority first, then due_date (nulls last), then project=Vespera first
  tasks.sort((a, b) => {
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

  const task = tasks[0]

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

  // Spawn Builder
  const prompt = `You are Builder. Complete this task for nabitllc/vespera:
Task: ${task.title}
Description: ${task.description || 'See task title'}
Project: ${task.project}

Work on main branch (if small fix) or create branch feature/${task.id.slice(0,8)} for larger changes.
Add [skip ci] to all commits. npm run build must pass.
When done: curl -s -X POST http://localhost:3000/api/task-done -H 'x-internal-secret: kaos-internal-2026' -H 'Content-Type: application/json' -d '{"taskId":"${task.id}","taskTitle":"${task.title}","agentId":"builder","status":"done"}'
Then: /opt/homebrew/bin/openclaw system event --text "Done: Builder completed ${task.title}" --mode now`

  const repoDir = `/tmp/builder-${task.id.slice(0,8)}`
  execAsync(`git clone https://github.com/nabitllc/vespera.git ${repoDir} 2>/dev/null; cd ${repoDir} && claude --permission-mode bypassPermissions --print '${prompt.replace(/'/g, "\\'")}' 2>&1 &`)
    .catch(console.error)

  return NextResponse.json({ ok: true, task: task.title, runId: run?.id, priority: task.priority })
}

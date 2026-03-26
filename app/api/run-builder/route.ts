import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'
import { createClient } from '@supabase/supabase-js'

const execAsync = promisify(exec)

const supabase = createClient(
  'https://twthgapiouiqhavrcnry.supabase.co',
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'
)

export async function POST(req: NextRequest) {
  // Verify internal secret
  const auth = req.headers.get('x-internal-secret')
  if (auth !== (process.env.INTERNAL_SECRET ?? 'kaos-internal-2026')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Get next open builder task
  const { data: tasks, error } = await supabase
    .from('tasks')
    .select('*')
    .eq('assignee', 'builder')
    .eq('status', 'open')
    .order('priority', { ascending: true }) // critical first
    .limit(1)

  if (error || !tasks?.length) {
    return NextResponse.json({ message: 'No open builder tasks' })
  }

  const task = tasks[0]

  // Log run start
  const { data: run } = await supabase
    .from('agent_runs')
    .insert({
      agent_id: 'builder',
      task_id: task.id,
      task_title: task.title,
      status: 'running',
    })
    .select('id')
    .single()

  // Mark task in_progress
  await supabase
    .from('tasks')
    .update({ status: 'in_progress', updated_at: new Date().toISOString() })
    .eq('id', task.id)

  const runId = run?.id
  const prompt = buildPrompt(task)

  // Spawn Builder in background (non-blocking)
  const cmd = `cd /Users/kemuniagent/.openclaw/workspace-builder && claude --permission-mode bypassPermissions --print ${JSON.stringify(prompt)}`

  exec(cmd, { maxBuffer: 10 * 1024 * 1024 }, async (error, stdout, stderr) => {
    if (error) {
      await supabase.from('agent_runs').update({
        status: 'failed',
        finished_at: new Date().toISOString(),
        error: error.message,
      }).eq('id', runId)
      await supabase.from('tasks').update({
        status: 'open',
        updated_at: new Date().toISOString(),
      }).eq('id', task.id)
    } else {
      await supabase.from('agent_runs').update({
        status: 'done',
        finished_at: new Date().toISOString(),
        output: stdout.slice(-2000), // last 2k chars
      }).eq('id', runId)
      await supabase.from('tasks').update({
        status: 'in_review',
        updated_at: new Date().toISOString(),
      }).eq('id', task.id)
    }
  })

  return NextResponse.json({
    message: 'Builder started',
    task: task.title,
    runId,
  })
}

function buildPrompt(task: { title: string; description: string; project: string; type: string }) {
  const projectContext: Record<string, string> = {
    Vespera: 'Vespera is a goth community app. Repo: nabitllc/vespera. Stack: Next.js 14, Supabase (pxuyvmijevxnlxyobajh.supabase.co), Vercel, Tailwind, TypeScript. Deploy via webhook only — do NOT trigger Vercel directly. Open PRs against main branch.',
    Kemuni: 'Kemuni is a property management SaaS. Await further context from workspace-kemuni.',
    Infrastructure: 'Infrastructure work on the Mac mini. Mission Control at /Users/kemuniagent/mission-control. OpenClaw config at ~/.openclaw/openclaw.json.',
  }

  const ctx = projectContext[task.project] ?? 'Check workspace files for context.'

  return `You are Builder, coding agent for Nabit LLC.

TASK: ${task.title}
DESCRIPTION: ${task.description}
PROJECT: ${task.project}
TYPE: ${task.type}

PROJECT CONTEXT: ${ctx}

RULES:
- Read existing code before writing anything new
- TypeScript strict, no any, mobile-first, dark theme (#080808)
- Run npm run build before committing
- Commit with: feat: ${task.title.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/ /g, '-')}
- Open a PR against main on GitHub
- When done: openclaw system event --text "Builder done: ${task.title}" --mode now

Begin now.`
}

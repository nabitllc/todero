import { NextRequest, NextResponse } from 'next/server'
import { updateTaskStatus, logAgentRun } from '@/lib/tasks'

// Called by agents when they complete a task
// Usage: curl -X POST http://localhost:3000/api/task-done \
//   -H "x-internal-secret: kaos-internal-2026" \
//   -d '{"taskId":"uuid","taskTitle":"...","agentId":"builder","status":"done","output":"..."}'

export async function POST(req: NextRequest) {
  const auth = req.headers.get('x-internal-secret')
  if (auth !== (process.env.INTERNAL_SECRET ?? 'kaos-internal-2026')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { taskId, taskTitle, agentId, status, output, error } = await req.json()

  if (!agentId || !status) {
    return NextResponse.json({ error: 'agentId and status required' }, { status: 400 })
  }

  // Determine next task status based on agent
  const taskStatus = status === 'done'
    ? (agentId === 'tester' ? 'done' : 'in_review')  // builder→in_review, tester→done
    : status === 'failed' ? 'open'  // reset on failure
    : 'in_progress'

  const promises: Promise<unknown>[] = []

  if (taskId) {
    promises.push(updateTaskStatus(taskId, taskStatus))
  }

  promises.push(logAgentRun(agentId, taskId ?? null, taskTitle ?? 'Unknown task', status, output, error))

  await Promise.all(promises)

  return NextResponse.json({ ok: true, taskStatus })
}

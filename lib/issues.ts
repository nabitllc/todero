// Shared task update helper — used by all agent run endpoints
const SUPA_URL = 'https://twthgapiouiqhavrcnry.supabase.co'
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'

export type TaskStatus = 'backlog' | 'open' | 'in_progress' | 'in_review' | 'done'

export async function updateTaskStatus(taskId: string, status: TaskStatus) {
  await fetch(`${SUPA_URL}/rest/v1/issues?id=eq.${taskId}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify({ status, updated_at: new Date().toISOString() }),
  })
}

export async function logAgentRun(agentId: string, taskId: string | null, taskTitle: string, status: 'running' | 'done' | 'failed', output?: string, error?: string) {
  const body: Record<string, unknown> = { agent_id: agentId, task_title: taskTitle, status }
  if (taskId) body.task_id = taskId
  if (status !== 'running') body.finished_at = new Date().toISOString()
  if (output) body.output = output.slice(-2000)
  if (error) body.error = error

  const res = await fetch(`${SUPA_URL}/rest/v1/agent_runs`, {
    method: 'POST',
    headers: {
      'apikey': SUPA_KEY,
      'Authorization': `Bearer ${SUPA_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  return data[0]?.id ?? null
}

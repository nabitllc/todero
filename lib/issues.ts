// Shared task update helper — used by all agent run endpoints
const SUPA_URL = 'https://twthgapiouiqhavrcnry.supabase.co'
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'

export type TaskStatus = 'backlog' | 'open' | 'in_progress' | 'in_review' | 'code_review' | 'approved' | 'released' | 'completed' | 'closed'

// INF-203: Cost trend sparkline data model
export interface CostSnapshot {
  date: string
  cost: number
  tokens: number
}

// INF-218: Kanban swimlane types
export type BoardGroupBy = 'status' | 'feature' | 'business'

export interface KanbanColumn {
  id: string
  label: string
  color: string
}

export interface Task {
  id: string
  title: string
  description?: string
  status: string
  assignee?: string
  project?: string
  priority?: string
  type?: string
  due_date?: string
  created_at?: string
  updated_at?: string
  resolution_type?: string
  acceptance_criteria?: string
  sprint?: string
  steps_to_reproduce?: string
  expected_behavior?: string
  actual_behavior?: string
  environment?: string
  pr_url?: string
  blocked_by?: string
  parent_id?: string
  task_key?: string
  status_category?: 'Planned' | 'Ongoing' | 'SignOff' | 'Done' | null
  test_status?: string
  tester_status?: string
  tester_notes?: string
  tested_by?: string
  tester_reviewed_at?: string
  designer_status?: string
  designer_notes?: string
  designed_by?: string
  designer_reviewed_at?: string
}

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

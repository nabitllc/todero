// Shared task update helper — used by all agent run endpoints
import { db } from '@/lib/db'

export type TaskStatus = 'backlog' | 'open' | 'in_progress' | 'code_review' | 'approved' | 'released' | 'completed' | 'closed'

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
  is_blocked?: boolean
  parent_id?: string
  task_key?: string
  severity?: string
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
  owner?: string
  reviewer?: string
  worked_by?: string
  implementation_notes?: string
  reviewer_notes?: string
  regression_test?: string
  feature_branch?: string
  deployer_status?: 'ready' | 'failed' | null
  deployer_notes?: string | null
  commit_sha?: string
  rejection_count?: number
  last_rejection_reason?: string
  started_at?: string
  completed_at?: string
}

export async function updateTaskStatus(taskId: string, status: TaskStatus) {
  await db()
    .from('issues')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', taskId)
}

export async function logAgentRun(agentId: string, taskId: string | null, taskTitle: string, status: 'running' | 'done' | 'failed', output?: string, error?: string) {
  const body: Record<string, unknown> = { agent_id: agentId, task_title: taskTitle, status }
  if (taskId) body.task_id = taskId
  if (status !== 'running') body.finished_at = new Date().toISOString()
  if (output) body.output = output.slice(-2000)
  if (error) body.error = error

  const { data } = await db().from('agent_runs').insert(body).select('id')
  return (data as Array<{ id: string }> | null)?.[0]?.id ?? null
}

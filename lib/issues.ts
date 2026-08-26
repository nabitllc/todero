// Shared task update helper — used by all agent run endpoints
import { db } from '@/lib/db'

export type TaskStatus = 'backlog' | 'open' | 'in_progress' | 'code_review' | 'approved' | 'released' | 'completed' | 'closed'

// INF-203: Cost trend sparkline data model
// TOD: kill-fake-infra-greens — cost/tokens are null when no snapshot was
// stored for that day. A day nothing measured must render as absent, not
// as a fabricated $0.00 that looks identical to a real zero-spend day.
export interface CostSnapshot {
  date: string
  cost: number | null
  tokens: number | null
}

// INF-218: Kanban swimlane types
export type BoardGroupBy = 'status' | 'feature' | 'business'

export interface KanbanColumn {
  id: string
  label: string
  color: string
}

// @db-table issues
//
// EVERY FIELD BELOW IS A COLUMN ON `issues`, and scripts/no-phantom-columns.mjs
// enforces that against the live schema. The annotation above is what binds this
// interface to that table — it is read from the raw source, so do not delete it.
//
// TOD-2446: this interface is where the `test_status` fabrication lived longest.
// It declared a field that is not a column, BoardTab rendered it, and the API
// wrote it; every PATCH into or out of `code_review` answered HTTP 500 `no such
// column: test_status`. A type that lies about the row shape is how a phantom
// survives a sweep: `t.test_status` type-checks, so nothing objects.
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
  // TOD-2446 TOMBSTONE — `test_status?: string` was declared here and is GONE.
  // It is not a column on `issues` (57 columns, measured with PRAGMA
  // table_info; none of them this one) and it is not being added, because the
  // combined review verdict is DERIVED, not stored:
  // `computeDualReviewState()` in lib/issue-routing.ts already returns
  // `overallTestStatus` from the two real columns below.
  //
  // The pre-Neon export (exports/supabase/issues.json, 3078 rows) proves why a
  // stored copy is the wrong shape: `test_status` was populated on all 3078
  // rows there, and on 372 of them (12.1%) it DISAGREED with the value derived
  // from `tester_status`/`designer_status` — 'passed' sitting on rows whose two
  // reviewers were both still 'pending'. It was a second source of truth that
  // drifted. Migration 007 had already reached the same conclusion by replacing
  // the `test_status_passed` validator with `dual_review_passed`.
  //
  // If you need the combined verdict, call computeDualReviewState(). Do not
  // re-add the field.
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

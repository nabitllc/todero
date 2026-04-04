export function normalizeReviewStatus(value: unknown): string {
  return typeof value === 'string' ? value.toLowerCase() : 'pending'
}

export function computeDualReviewState(issue: Record<string, unknown>) {
  const testerStatus = normalizeReviewStatus(issue.tester_status)
  const designerStatus = normalizeReviewStatus(issue.designer_status)
  const testerPassed = testerStatus === 'passed'
  const designerPassed = designerStatus === 'passed'
  const anyFailed = testerStatus === 'failed' || designerStatus === 'failed'
  const bothPassed = testerPassed && designerPassed
  const overallTestStatus = bothPassed ? 'passed' : anyFailed ? 'failed' : 'pending'

  return { testerStatus, designerStatus, testerPassed, designerPassed, anyFailed, bothPassed, overallTestStatus }
}

export function resolveReopenAssignee(issue: Record<string, unknown> | null | undefined) {
  const preferred = issue?.owner ?? issue?.worked_by
  return typeof preferred === 'string' && preferred.trim() ? preferred : 'builder'
}

export function aggregateReviewerNotes(issue: Record<string, unknown>) {
  return [
    typeof issue.tester_notes === 'string' && issue.tester_notes.trim() ? `Tester: ${issue.tester_notes.trim()}` : null,
    typeof issue.designer_notes === 'string' && issue.designer_notes.trim() ? `Designer: ${issue.designer_notes.trim()}` : null,
  ].filter(Boolean).join(' | ')
}

export function applyExecutionStatusRouting(
  before: Record<string, unknown> | null | undefined,
  fields: Record<string, unknown>
) {
  const nextStatus = fields.status
  if (typeof nextStatus !== 'string') return fields

  if (nextStatus === 'in_progress' && !fields.assignee) {
    const currentWorker = before?.assignee ?? before?.owner
    if (typeof currentWorker === 'string' && currentWorker.trim()) {
      fields.assignee = currentWorker
    }
  }

  if (nextStatus === 'open' && !fields.assignee) {
    fields.assignee = resolveReopenAssignee(before)
  }

  if (before?.status === 'in_progress' && nextStatus === 'backlog') {
    fields.assignee = 'po'
  }

  if (nextStatus === 'code_review') {
    const reviewer = fields.reviewer ?? before?.reviewer
    if (typeof reviewer === 'string' && reviewer.trim()) {
      fields.assignee = reviewer
    }
    fields.tester_status = 'pending'
    fields.designer_status = 'pending'
    if (fields.test_status === undefined) fields.test_status = 'pending'
  }

  if (before?.status === 'in_progress' && nextStatus === 'product_review') {
    fields.assignee = 'po'
  }

  if (nextStatus === 'approved') {
    const deployer = typeof (fields.deployer ?? before?.deployer) === 'string' && String(fields.deployer ?? before?.deployer).trim()
      ? String(fields.deployer ?? before?.deployer)
      : 'deployer'
    fields.deployer = deployer
    fields.assignee = deployer
  }

  if (nextStatus === 'released' || (before?.status === 'product_review' && nextStatus === 'completed')) {
    const auditor = typeof (fields.auditor ?? before?.auditor) === 'string' && String(fields.auditor ?? before?.auditor).trim()
      ? String(fields.auditor ?? before?.auditor)
      : 'auditor'
    fields.auditor = auditor
    fields.assignee = auditor
  }

  if (nextStatus === 'closed') {
    fields.assignee = null
  }

  return fields
}

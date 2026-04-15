export const ISSUE_TERMINAL_STATUSES = ['wrapped', 'closed'] as const
export const ISSUE_COMPLETED_STATUSES = ['wrapped', 'closed'] as const
// A blocked_by dependency is satisfied when the blocker reaches approved, released, wrapped, or closed.
// 'approved' is included: code is reviewed and ready — dependent work can proceed before deployment.
// 'cancelled' is NOT a valid status in this system.
export const ISSUE_DEPENDENCY_SATISFIED_STATUSES = ['approved', 'released', 'wrapped', 'closed'] as const
export const ISSUE_SIGNOFF_STATUSES = ['released', 'wrapped'] as const
export const ISSUE_ACTIVE_WORK_STATUSES = ['open', 'in_progress', 'underway', 'code_review', 'product_review', 'feature_review', 'approved', 'released'] as const

const terminalStatusSet = new Set<string>(ISSUE_TERMINAL_STATUSES)
const completedStatusSet = new Set<string>(ISSUE_COMPLETED_STATUSES)
const dependencySatisfiedStatusSet = new Set<string>(ISSUE_DEPENDENCY_SATISFIED_STATUSES)
const signoffStatusSet = new Set<string>(ISSUE_SIGNOFF_STATUSES)
const activeWorkStatusSet = new Set<string>(ISSUE_ACTIVE_WORK_STATUSES)

export function isTerminalIssueStatus(status: unknown): boolean {
  return typeof status === 'string' && terminalStatusSet.has(status)
}

export function isCompletedIssueStatus(status: unknown): boolean {
  return typeof status === 'string' && completedStatusSet.has(status)
}

export function satisfiesIssueDependency(status: unknown): boolean {
  return typeof status === 'string' && dependencySatisfiedStatusSet.has(status)
}

export function isSignoffIssueStatus(status: unknown): boolean {
  return typeof status === 'string' && signoffStatusSet.has(status)
}

export function isActiveWorkIssueStatus(status: unknown): boolean {
  return typeof status === 'string' && activeWorkStatusSet.has(status)
}

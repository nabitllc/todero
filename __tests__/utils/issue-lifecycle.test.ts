import {
  ISSUE_COMPLETED_STATUSES,
  ISSUE_DEPENDENCY_SATISFIED_STATUSES,
  ISSUE_SIGNOFF_STATUSES,
  isActiveWorkIssueStatus,
  isCompletedIssueStatus,
  isTerminalIssueStatus,
  satisfiesIssueDependency,
} from '@/lib/issue-lifecycle'

describe('issue lifecycle helpers', () => {
  it('keeps the canonical finished status sets locked', () => {
    expect(ISSUE_COMPLETED_STATUSES).toEqual(['wrapped', 'closed'])
    expect(ISSUE_DEPENDENCY_SATISFIED_STATUSES).toEqual(['released', 'wrapped', 'closed'])
    expect(ISSUE_SIGNOFF_STATUSES).toEqual(['released', 'wrapped'])
  })

  it('treats only real finished states as dependency-satisfying', () => {
    expect(satisfiesIssueDependency('released')).toBe(true)
    expect(satisfiesIssueDependency('wrapped')).toBe(true)
    expect(satisfiesIssueDependency('closed')).toBe(true)
    expect(satisfiesIssueDependency('approved')).toBe(false)
    expect(satisfiesIssueDependency('done')).toBe(false)
  })

  it('separates active, completed, and terminal states', () => {
    expect(isActiveWorkIssueStatus('approved')).toBe(true)
    expect(isActiveWorkIssueStatus('underway')).toBe(true)
    expect(isActiveWorkIssueStatus('feature_review')).toBe(true)
    expect(isActiveWorkIssueStatus('wrapped')).toBe(false)
    expect(isCompletedIssueStatus('wrapped')).toBe(true)
    expect(isCompletedIssueStatus('closed')).toBe(true)
    expect(isTerminalIssueStatus('cancelled')).toBe(false)
  })
})

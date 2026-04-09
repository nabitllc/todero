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
    expect(ISSUE_COMPLETED_STATUSES).toEqual(['completed', 'closed'])
    expect(ISSUE_DEPENDENCY_SATISFIED_STATUSES).toEqual(['released', 'completed', 'closed'])
    expect(ISSUE_SIGNOFF_STATUSES).toEqual(['released', 'completed'])
  })

  it('treats only real finished states as dependency-satisfying', () => {
    expect(satisfiesIssueDependency('released')).toBe(true)
    expect(satisfiesIssueDependency('completed')).toBe(true)
    expect(satisfiesIssueDependency('closed')).toBe(true)
    expect(satisfiesIssueDependency('approved')).toBe(false)
    expect(satisfiesIssueDependency('done')).toBe(false)
  })

  it('separates active, completed, and terminal states', () => {
    expect(isActiveWorkIssueStatus('approved')).toBe(true)
    expect(isActiveWorkIssueStatus('completed')).toBe(false)
    expect(isCompletedIssueStatus('completed')).toBe(true)
    expect(isCompletedIssueStatus('closed')).toBe(true)
    expect(isTerminalIssueStatus('cancelled')).toBe(false)
  })
})

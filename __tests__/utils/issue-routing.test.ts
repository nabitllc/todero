import {
  aggregateReviewerNotes,
  applyExecutionStatusRouting,
  computeDualReviewState,
  resolveReopenAssignee,
} from '@/lib/issue-routing'

describe('issue routing helpers', () => {
  it('routes code_review work to the reviewer and primes both review lanes', () => {
    const fields: Record<string, unknown> = { status: 'code_review' }
    applyExecutionStatusRouting({ reviewer: 'tester' }, fields)

    expect(fields).toMatchObject({
      status: 'code_review',
      assignee: 'tester',
      tester_status: 'pending',
      designer_status: 'pending',
      test_status: 'pending',
    })
  })

  it('routes in_progress -> product_review and backlog to po', () => {
    const reviewFields: Record<string, unknown> = { status: 'product_review' }
    applyExecutionStatusRouting({ status: 'in_progress', owner: 'builder' }, reviewFields)
    expect(reviewFields.assignee).toBe('po')

    const backlogFields: Record<string, unknown> = { status: 'backlog' }
    applyExecutionStatusRouting({ status: 'in_progress', owner: 'builder' }, backlogFields)
    expect(backlogFields.assignee).toBe('po')
  })

  it('routes approved work to deployer and signoff/completion to auditor', () => {
    const approvedFields: Record<string, unknown> = { status: 'approved' }
    applyExecutionStatusRouting({}, approvedFields)
    expect(approvedFields).toMatchObject({ assignee: 'deployer', deployer: 'deployer' })

    const releasedFields: Record<string, unknown> = { status: 'released' }
    applyExecutionStatusRouting({}, releasedFields)
    expect(releasedFields).toMatchObject({ assignee: 'auditor', auditor: 'auditor' })

    const completedFields: Record<string, unknown> = { status: 'completed' }
    applyExecutionStatusRouting({ status: 'product_review' }, completedFields)
    expect(completedFields).toMatchObject({ assignee: 'auditor', auditor: 'auditor' })
  })

  it('clears assignee on closed and reopens to owner/worked_by', () => {
    const closedFields: Record<string, unknown> = { status: 'closed' }
    applyExecutionStatusRouting({ owner: 'builder' }, closedFields)
    expect(closedFields.assignee).toBeNull()

    expect(resolveReopenAssignee({ owner: 'main', worked_by: 'builder' })).toBe('main')
    expect(resolveReopenAssignee({ worked_by: 'builder' })).toBe('builder')
  })

  it('computes dual review state and aggregates notes', () => {
    expect(computeDualReviewState({ tester_status: 'passed', designer_status: 'passed' }).bothPassed).toBe(true)
    expect(computeDualReviewState({ tester_status: 'failed', designer_status: 'passed' }).anyFailed).toBe(true)
    expect(aggregateReviewerNotes({ tester_notes: 'Looks good', designer_notes: 'UI approved' })).toBe('Tester: Looks good | Designer: UI approved')
  })
})

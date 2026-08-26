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
    })
  })

  // TOD-2445. This block used to also assert `test_status: 'pending'`, and that
  // assertion is why the defect survived: `test_status` is NOT a column on
  // `issues`, so writing it made every PATCH into or out of code_review answer
  // HTTP 500 `no such column: test_status` — the review lifecycle could not
  // complete in either direction — while this test stayed green pinning the
  // write in place.
  //
  // A test asserting a write the database refuses is worse than no test: it
  // makes the defect look deliberate. The real columns are asserted above.
  it('does NOT write test_status, which is not a column on issues', () => {
    const fields: Record<string, unknown> = { status: 'code_review', reviewer: 'tester' }
    applyExecutionStatusRouting({ status: 'in_progress', owner: 'builder' }, fields)
    expect(fields).not.toHaveProperty('test_status')
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

  it('clears assignee on closed', () => {
    const closedFields: Record<string, unknown> = { status: 'closed' }
    applyExecutionStatusRouting({ owner: 'builder' }, closedFields)
    expect(closedFields.assignee).toBeNull()
  })

  describe('resolveReopenAssignee — type-aware open-state routing', () => {
    it('routes task to builder', () => {
      expect(resolveReopenAssignee({ type: 'task', owner: 'main' })).toBe('builder')
    })

    it('routes bug to builder', () => {
      expect(resolveReopenAssignee({ type: 'bug', owner: 'main' })).toBe('builder')
    })

    it('routes feature to builder (not owner/main)', () => {
      expect(resolveReopenAssignee({ type: 'feature', owner: 'main' })).toBe('builder')
    })

    it('routes ops to ops', () => {
      expect(resolveReopenAssignee({ type: 'ops', owner: 'ops' })).toBe('ops')
    })

    it('routes research to scout', () => {
      expect(resolveReopenAssignee({ type: 'research', owner: 'scout' })).toBe('scout')
    })

    it('prefers worked_by over type-based routing', () => {
      expect(resolveReopenAssignee({ type: 'feature', owner: 'main', worked_by: 'builder' })).toBe('builder')
      expect(resolveReopenAssignee({ type: 'ops', worked_by: 'builder' })).toBe('builder')
    })

    it('never returns main or KAOS as open-state assignee', () => {
      const result1 = resolveReopenAssignee({ type: 'feature', owner: 'main' })
      const result2 = resolveReopenAssignee({ type: 'epic', owner: 'main' })
      expect(result1).not.toBe('main')
      expect(result2).not.toBe('main')
      expect(result1).not.toBe('KAOS')
      expect(result2).not.toBe('KAOS')
    })

    it('falls back to builder for unknown types', () => {
      expect(resolveReopenAssignee({ type: 'unknown' })).toBe('builder')
      expect(resolveReopenAssignee(null)).toBe('builder')
      expect(resolveReopenAssignee(undefined)).toBe('builder')
    })
  })

  it('computes dual review state and aggregates notes', () => {
    expect(computeDualReviewState({ tester_status: 'passed', designer_status: 'passed' }).bothPassed).toBe(true)
    expect(computeDualReviewState({ tester_status: 'failed', designer_status: 'passed' }).anyFailed).toBe(true)
    expect(aggregateReviewerNotes({ tester_notes: 'Looks good', designer_notes: 'UI approved' })).toBe('Tester: Looks good | Designer: UI approved')
  })
})

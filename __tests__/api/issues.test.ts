import {
  VALID_TYPES,
  VALID_PRIORITIES,
  VALID_STATUSES,
  VALID_SEVERITIES,
  VALID_RESOLUTION_TYPES,
  PROJECT_PREFIX,
  getProjectPrefix,
  normalizeProjectName,
} from '@/lib/constants'

// ── Mock Supabase ────────────────────────────────────────────────────────────
const mockMaybeSingle = jest.fn()
const mockEq = jest.fn(() => ({ maybeSingle: mockMaybeSingle }))
const mockSelect = jest.fn(() => ({ eq: mockEq }))
const mockFrom = jest.fn(() => ({ select: mockSelect }))

jest.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ from: mockFrom }),
}))

// ── Enum validation tests ────────────────────────────────────────────────────
describe('VALID_TYPES', () => {
  it('is non-empty', () => {
    expect(VALID_TYPES.length).toBeGreaterThan(0)
  })

  it('contains expected core types', () => {
    expect(VALID_TYPES).toContain('epic')
    expect(VALID_TYPES).toContain('feature')
    expect(VALID_TYPES).toContain('task')
    expect(VALID_TYPES).toContain('bug')
  })

  it('contains ops and research', () => {
    expect(VALID_TYPES).toContain('ops')
    expect(VALID_TYPES).toContain('research')
  })
})

describe('VALID_PRIORITIES', () => {
  it('is non-empty', () => {
    expect(VALID_PRIORITIES.length).toBeGreaterThan(0)
  })

  it('contains expected values', () => {
    expect(VALID_PRIORITIES).toContain('critical')
    expect(VALID_PRIORITIES).toContain('high')
    expect(VALID_PRIORITIES).toContain('medium')
    expect(VALID_PRIORITIES).toContain('low')
  })
})

describe('VALID_STATUSES', () => {
  it('is non-empty', () => {
    expect(VALID_STATUSES.length).toBeGreaterThan(0)
  })

  it('contains lifecycle statuses', () => {
    expect(VALID_STATUSES).toContain('backlog')
    expect(VALID_STATUSES).toContain('in_progress')
    expect(VALID_STATUSES).toContain('completed')
    expect(VALID_STATUSES).toContain('closed')
  })

  it('contains review statuses', () => {
    expect(VALID_STATUSES).toContain('in_review')
    expect(VALID_STATUSES).toContain('code_review')
    expect(VALID_STATUSES).toContain('product_review')
  })
})

describe('VALID_SEVERITIES', () => {
  it('contains S0 through S3', () => {
    expect(VALID_SEVERITIES).toEqual(['S0', 'S1', 'S2', 'S3'])
  })
})

describe('VALID_RESOLUTION_TYPES', () => {
  it('is non-empty', () => {
    expect(VALID_RESOLUTION_TYPES.length).toBeGreaterThan(0)
  })

  it('contains common resolution types', () => {
    expect(VALID_RESOLUTION_TYPES).toContain('code_change')
    expect(VALID_RESOLUTION_TYPES).toContain('duplicate')
    expect(VALID_RESOLUTION_TYPES).toContain('wont_fix')
  })
})

// ── Hierarchy validation logic (unit-level, using mock Supabase) ─────────────
describe('validateHierarchy logic', () => {
  // Re-implement the pure logic from route.ts for testability
  async function validateHierarchy(
    type: string,
    parentId: string | null | undefined,
    lookupParent: (id: string) => Promise<{ id: string; type: string; task_key: string } | null>
  ): Promise<{ error: string } | null> {
    if (type === 'task' || type === 'bug') {
      if (!parentId) return { error: `type=${type} requires parent_id pointing to a feature issue` }
      const parent = await lookupParent(parentId)
      if (!parent) return { error: `parent_id ${parentId} does not exist` }
      if (parent.type !== 'feature') {
        return { error: `type=${type} requires parent to be a feature, but parent ${parent.task_key} is type=${parent.type}` }
      }
    } else if (type === 'feature') {
      if (!parentId) return { error: `type=feature requires parent_id pointing to an epic issue` }
      const parent = await lookupParent(parentId)
      if (!parent) return { error: `parent_id ${parentId} does not exist` }
      if (parent.type !== 'epic') {
        return { error: `type=feature requires parent to be an epic, but parent ${parent.task_key} is type=${parent.type}` }
      }
    } else if (type === 'epic') {
      if (parentId) return { error: `type=epic should not have a parent_id (epics are top-level)` }
    }
    return null
  }

  const fakeFeatureParent = { id: 'feat-1', type: 'feature', task_key: 'MC-10' }
  const fakeEpicParent = { id: 'epic-1', type: 'epic', task_key: 'MC-1' }

  it('allows task with feature parent', async () => {
    const result = await validateHierarchy('task', 'feat-1', async () => fakeFeatureParent)
    expect(result).toBeNull()
  })

  it('rejects task without parent_id', async () => {
    const result = await validateHierarchy('task', null, async () => null)
    expect(result).toEqual({ error: 'type=task requires parent_id pointing to a feature issue' })
  })

  it('rejects task with epic parent', async () => {
    const result = await validateHierarchy('task', 'epic-1', async () => fakeEpicParent)
    expect(result).toEqual({
      error: 'type=task requires parent to be a feature, but parent MC-1 is type=epic',
    })
  })

  it('allows feature with epic parent', async () => {
    const result = await validateHierarchy('feature', 'epic-1', async () => fakeEpicParent)
    expect(result).toBeNull()
  })

  it('rejects feature without parent_id', async () => {
    const result = await validateHierarchy('feature', null, async () => null)
    expect(result).toEqual({ error: 'type=feature requires parent_id pointing to an epic issue' })
  })

  it('rejects epic with parent_id', async () => {
    const result = await validateHierarchy('epic', 'some-id', async () => fakeEpicParent)
    expect(result).toEqual({ error: 'type=epic should not have a parent_id (epics are top-level)' })
  })

  it('allows epic without parent_id', async () => {
    const result = await validateHierarchy('epic', null, async () => null)
    expect(result).toBeNull()
  })

  it('allows ops with or without parent_id (bypasses hierarchy)', async () => {
    expect(await validateHierarchy('ops', null, async () => null)).toBeNull()
    expect(await validateHierarchy('ops', 'any-id', async () => fakeFeatureParent)).toBeNull()
  })

  it('allows research with or without parent_id (bypasses hierarchy)', async () => {
    expect(await validateHierarchy('research', null, async () => null)).toBeNull()
    expect(await validateHierarchy('research', 'any-id', async () => fakeEpicParent)).toBeNull()
  })
})

// ── Task key prefix derivation ───────────────────────────────────────────────
describe('generateTaskKey prefix logic', () => {
  it('generates MC prefix for Mission Control', () => {
    expect(getProjectPrefix('Mission Control')).toBe('MC')
  })

  it('normalizes Todero aliases before deriving prefix', () => {
    expect(normalizeProjectName(' tod ')).toBe('Todero')
    expect(getProjectPrefix(' tod ')).toBe('TOD')
    expect(getProjectPrefix('todero')).toBe('TOD')
  })

  it('defaults to TOD for unknown project', () => {
    expect(getProjectPrefix('NonExistent')).toBe('TOD')
  })
})


describe('dual review gate logic', () => {
  function computeDualReviewState(issue: { tester_status?: string; designer_status?: string }) {
    const testerStatus = (issue.tester_status ?? 'pending').toLowerCase()
    const designerStatus = (issue.designer_status ?? 'pending').toLowerCase()
    const bothPassed = testerStatus === 'passed' && designerStatus === 'passed'
    const anyFailed = testerStatus === 'failed' || designerStatus === 'failed'
    return {
      bothPassed,
      anyFailed,
      overall: bothPassed ? 'passed' : anyFailed ? 'failed' : 'pending',
    }
  }

  function resolveReopenAssignee(issue: { owner?: string | null; worked_by?: string | null }) {
    const preferred = issue.owner ?? issue.worked_by
    return preferred && preferred.trim() ? preferred : 'builder'
  }

  function applyStatusRouting(before: { status?: string; owner?: string | null; worked_by?: string | null; deployer?: string | null; auditor?: string | null }, nextStatus: string) {
    const fields: Record<string, unknown> = { status: nextStatus }

    if (nextStatus === 'open') {
      fields.assignee = resolveReopenAssignee(before)
    }
    if (nextStatus === 'approved') {
      fields.deployer = before.deployer?.trim() ? before.deployer : 'deployer'
      fields.assignee = fields.deployer
    }
    if (nextStatus === 'released') {
      fields.auditor = before.auditor?.trim() ? before.auditor : 'auditor'
      fields.assignee = fields.auditor
    }
    if (nextStatus === 'closed') {
      fields.assignee = null
    }

    return fields
  }

  it('stays pending until both reviewer lanes pass', () => {
    expect(computeDualReviewState({ tester_status: 'passed', designer_status: 'pending' })).toEqual({
      bothPassed: false,
      anyFailed: false,
      overall: 'pending',
    })
  })

  it('passes only when tester and designer both pass', () => {
    expect(computeDualReviewState({ tester_status: 'passed', designer_status: 'passed' })).toEqual({
      bothPassed: true,
      anyFailed: false,
      overall: 'passed',
    })
  })

  it('fails if either reviewer fails', () => {
    expect(computeDualReviewState({ tester_status: 'failed', designer_status: 'passed' })).toEqual({
      bothPassed: false,
      anyFailed: true,
      overall: 'failed',
    })
  })

  it('reopens failed code review work to open and routes back to owner when present', () => {
    expect(applyStatusRouting({ status: 'code_review', owner: 'builder', worked_by: 'builder' }, 'open')).toEqual({
      status: 'open',
      assignee: 'builder',
    })
    expect(applyStatusRouting({ status: 'code_review', owner: 'main', worked_by: 'builder' }, 'open')).toEqual({
      status: 'open',
      assignee: 'main',
    })
  })

  it('routes approved work to deployer', () => {
    expect(applyStatusRouting({ deployer: null }, 'approved')).toEqual({
      status: 'approved',
      deployer: 'deployer',
      assignee: 'deployer',
    })
  })

  it('routes released work to auditor', () => {
    expect(applyStatusRouting({ auditor: null }, 'released')).toEqual({
      status: 'released',
      auditor: 'auditor',
      assignee: 'auditor',
    })
  })

  it('clears assignee on closed', () => {
    expect(applyStatusRouting({ owner: 'builder' }, 'closed')).toEqual({
      status: 'closed',
      assignee: null,
    })
  })
})

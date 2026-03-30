import {
  VALID_TYPES,
  VALID_PRIORITIES,
  VALID_STATUSES,
  VALID_SEVERITIES,
  VALID_RESOLUTION_TYPES,
  PROJECT_PREFIX,
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
    expect(VALID_STATUSES).toContain('done')
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
  function getPrefix(project: string): string {
    return PROJECT_PREFIX[project] ?? 'TOD'
  }

  it('generates MC prefix for Mission Control', () => {
    expect(getPrefix('Mission Control')).toBe('MC')
  })

  it('defaults to TOD for unknown project', () => {
    expect(getPrefix('NonExistent')).toBe('TOD')
  })
})

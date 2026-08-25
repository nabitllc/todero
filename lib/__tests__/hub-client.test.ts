/**
 * Unit tests for hub-client.ts (TOD-964)
 *
 * AC-4: query with business_id=X returns only rows where business_id=X
 * AC-5: query without hub context returns rows across all hubs (admin client)
 */

import { getHubClient, createAdminClient, HUB_SCOPED_TABLES } from '../hub-client'

// ── Supabase mock ─────────────────────────────────────────────────────────────

const mockEq = jest.fn()
const mockSelect = jest.fn()
const mockInsert = jest.fn()
const mockUpdate = jest.fn()
const mockDelete = jest.fn()
const mockUpsert = jest.fn()
const mockFrom = jest.fn()

// Each filter method returns the same mock chain (self-returning)
const filterBuilder: Record<string, jest.Mock> = {
  eq: mockEq,
  select: mockSelect,
  single: jest.fn(),
  maybeSingle: jest.fn(),
  order: jest.fn(),
  limit: jest.fn(),
  in: jest.fn(),
  not: jest.fn(),
  ilike: jest.fn(),
}

// Make all filter builder methods return the builder itself for chaining
Object.keys(filterBuilder).forEach((k) => {
  filterBuilder[k].mockReturnValue(filterBuilder)
})

const queryBuilder = {
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  delete: mockDelete,
  upsert: mockUpsert,
}

mockSelect.mockReturnValue(filterBuilder)
mockInsert.mockReturnValue(filterBuilder)
mockUpdate.mockReturnValue(filterBuilder)
mockDelete.mockReturnValue(filterBuilder)
mockUpsert.mockReturnValue(filterBuilder)
mockFrom.mockReturnValue(queryBuilder)

// hub-client now goes through the vendor-neutral seam, so that is what the
// test stubs — no vendor SDK involved.
jest.mock('@/lib/db', () => ({
  db: jest.fn(() => ({
    provider: 'test',
    missingEnv: () => [],
    from: mockFrom,
    rpc: jest.fn(),
  })),
}))

// ── Helpers ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks()
  // Re-attach return values after clearAllMocks
  Object.keys(filterBuilder).forEach((k) => {
    filterBuilder[k].mockReturnValue(filterBuilder)
  })
  mockSelect.mockReturnValue(filterBuilder)
  mockInsert.mockReturnValue(filterBuilder)
  mockUpdate.mockReturnValue(filterBuilder)
  mockDelete.mockReturnValue(filterBuilder)
  mockUpsert.mockReturnValue(filterBuilder)
  mockFrom.mockReturnValue(queryBuilder)
  mockEq.mockReturnValue(filterBuilder)
})

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('HUB_SCOPED_TABLES', () => {
  it('includes the expected tables', () => {
    expect(HUB_SCOPED_TABLES).toContain('issues')
    expect(HUB_SCOPED_TABLES).toContain('sprints')
    expect(HUB_SCOPED_TABLES).toContain('agents')
    expect(HUB_SCOPED_TABLES).toContain('projects')
  })
})

describe('getHubClient — hub-scoped tables', () => {
  const BIZ_ID = 'biz-abc-123'

  it('AC-4: auto-injects business_id filter on SELECT', () => {
    const db = getHubClient(BIZ_ID)
    db.from('issues').select('*')

    expect(mockFrom).toHaveBeenCalledWith('issues')
    expect(mockSelect).toHaveBeenCalledWith('*')
    expect(mockEq).toHaveBeenCalledWith('business_id', BIZ_ID)
  })

  it('auto-injects business_id on SELECT for all hub-scoped tables', () => {
    for (const table of HUB_SCOPED_TABLES) {
      jest.clearAllMocks()
      mockSelect.mockReturnValue(filterBuilder)
      mockFrom.mockReturnValue(queryBuilder)
      mockEq.mockReturnValue(filterBuilder)

      const db = getHubClient(BIZ_ID)
      db.from(table).select('*')

      expect(mockEq).toHaveBeenCalledWith('business_id', BIZ_ID)
    }
  })

  it('injects business_id into INSERT row data', () => {
    const db = getHubClient(BIZ_ID)
    db.from('issues').insert({ title: 'Test issue', status: 'open' })

    expect(mockInsert).toHaveBeenCalledWith(
      { title: 'Test issue', status: 'open', business_id: BIZ_ID },
      undefined
    )
  })

  it('injects business_id into all rows on bulk INSERT', () => {
    const db = getHubClient(BIZ_ID)
    db.from('issues').insert([{ title: 'A' }, { title: 'B' }])

    expect(mockInsert).toHaveBeenCalledWith(
      [
        { title: 'A', business_id: BIZ_ID },
        { title: 'B', business_id: BIZ_ID },
      ],
      undefined
    )
  })

  it('auto-injects business_id filter on UPDATE', () => {
    const db = getHubClient(BIZ_ID)
    db.from('sprints').update({ status: 'closed' })

    expect(mockUpdate).toHaveBeenCalledWith({ status: 'closed' }, undefined)
    expect(mockEq).toHaveBeenCalledWith('business_id', BIZ_ID)
  })

  it('auto-injects business_id filter on DELETE', () => {
    const db = getHubClient(BIZ_ID)
    db.from('agents').delete()

    expect(mockDelete).toHaveBeenCalled()
    expect(mockEq).toHaveBeenCalledWith('business_id', BIZ_ID)
  })

  it('injects business_id into UPSERT row data', () => {
    const db = getHubClient(BIZ_ID)
    db.from('projects').upsert({ name: 'My project', id: 'proj-1' })

    expect(mockUpsert).toHaveBeenCalledWith(
      { name: 'My project', id: 'proj-1', business_id: BIZ_ID },
      undefined
    )
  })

  it('overwrites caller-supplied business_id with the hub context value', () => {
    const db = getHubClient(BIZ_ID)
    db.from('issues').insert({ title: 'X', business_id: 'wrong-biz' })

    expect(mockInsert).toHaveBeenCalledWith(
      { title: 'X', business_id: BIZ_ID },
      undefined
    )
  })
})

describe('getHubClient — non-hub-scoped tables', () => {
  const BIZ_ID = 'biz-abc-123'

  it('passes through raw builder for non-hub-scoped table (agent_memory)', () => {
    const db = getHubClient(BIZ_ID)
    const result = db.from('agent_memory')

    expect(mockFrom).toHaveBeenCalledWith('agent_memory')
    // Should be the raw query builder, no auto-eq
    expect(result).toBe(queryBuilder)
  })

  it('does not inject business_id on non-hub-scoped SELECT', () => {
    const db = getHubClient(BIZ_ID)
    db.from('businesses').select('*')

    expect(mockSelect).toHaveBeenCalledWith('*')
    // eq should not have been called with business_id automatically
    const bizIdCalls = mockEq.mock.calls.filter(
      ([col, val]) => col === 'business_id' && val === BIZ_ID
    )
    expect(bizIdCalls).toHaveLength(0)
  })
})

describe('createAdminClient — AC-5 aggregate view', () => {
  it('returns rows across all hubs (no automatic business_id filter)', () => {
    const db = createAdminClient()
    db.from('issues').select('*')

    expect(mockFrom).toHaveBeenCalledWith('issues')
    expect(mockSelect).toHaveBeenCalledWith('*')
    // No automatic business_id filter injected
    const bizIdCalls = mockEq.mock.calls.filter(([col]) => col === 'business_id')
    expect(bizIdCalls).toHaveLength(0)
  })

  it('returns the raw Supabase client for full query flexibility', () => {
    const db = createAdminClient()
    const builder = db.from('issues')
    expect(builder).toBe(queryBuilder)
  })
})

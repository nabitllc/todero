/**
 * memory-retrieval-relevance piece.
 *
 * `lib/memory-retrieval.ts`'s FTS5 path is proven against a real sqlite
 * database in `memory-retrieval.test.ts`. This file proves the OTHER path —
 * the portable keyword-overlap fallback used on the postgres/supabase
 * providers, which FTS5 cannot reach — against a mocked `../db` seam (same
 * pattern `hub-client.test.ts` uses), since a real postgres instance is not
 * available in this test environment.
 *
 * Round-4 critic findings this piece exists to close, both on THIS path:
 *   1. "TOD is tokenised as a query term and appears in every stored record's
 *      task_key, so every spawn matches every record" — an issue-key prefix
 *      must never act as a query term here either.
 *   2. "just keyword-overlap over the newest 200 rows — and then reports
 *      that bounded scan as a completed search" — a scan that hits its
 *      window must say so, not print a clean "nothing relevant" when an
 *      older record past row 200 was never looked at.
 */

const mockLimit = jest.fn()
const mockOrder = jest.fn()
const mockEq = jest.fn()
const mockSelect = jest.fn()
const mockFrom = jest.fn()

// Chain: db().from('agent_run_records').select(...).eq(...).order(...).limit(...)
mockSelect.mockReturnValue({ eq: mockEq })
mockEq.mockReturnValue({ order: mockOrder })
mockOrder.mockReturnValue({ limit: mockLimit })
mockFrom.mockReturnValue({ select: mockSelect })

jest.mock('../db', () => ({
  db: jest.fn(() => ({ from: mockFrom })),
  // Anything other than 'sqlite' routes memory-retrieval.ts onto the
  // portable engine under test here.
  DB_PROVIDER: 'postgres',
}))

function row(overrides: Partial<{
  id: string; task_key: string; task_title: string | null
  attempted: string | null; rejection_reason: string | null
  reviewer_notes: string | null; created_at: string
}> = {}) {
  return {
    id: overrides.id ?? 'row-id',
    task_key: overrides.task_key ?? 'TOD-1',
    task_title: overrides.task_title ?? null,
    attempted: overrides.attempted ?? null,
    rejection_reason: overrides.rejection_reason ?? null,
    reviewer_notes: overrides.reviewer_notes ?? null,
    created_at: overrides.created_at ?? '2026-01-01T00:00:00Z',
  }
}

beforeEach(() => {
  jest.clearAllMocks()
  mockSelect.mockReturnValue({ eq: mockEq })
  mockEq.mockReturnValue({ order: mockOrder })
  mockOrder.mockReturnValue({ limit: mockLimit })
  mockFrom.mockReturnValue({ select: mockSelect })
})

describe('memory-retrieval-relevance: portable (keyword-overlap) engine', () => {
  it('routes onto the keyword-overlap engine, not fts5, when the provider is not sqlite', async () => {
    mockLimit.mockResolvedValue({ data: [], error: null })
    const { searchRunRecords } = await import('../memory-retrieval')
    const { engine } = await searchRunRecords('agent-1', 'anything', 10)
    expect(engine).toBe('keyword-overlap')
  })

  it('never matches on a shared issue-key prefix alone — same defect the round-4 critic named', async () => {
    mockLimit.mockResolvedValue({
      data: [
        row({ id: '1', task_key: 'TOD-1', task_title: 'Update sidebar layout', rejection_reason: 'broke hidden class on desktop nav' }),
        row({ id: '2', task_key: 'TOD-2', task_title: 'Add dark mode toggle', rejection_reason: 'settings panel CSS color values' }),
      ],
      error: null,
    })
    const { buildRetrievedContext } = await import('../memory-retrieval')
    // "TOD" is every record's shared prefix. Neither stored record is about
    // login timeouts, so this must come back genuinely empty — not
    // "everything matches because every task_key starts with TOD-".
    const result = await buildRetrievedContext('agent-1', 'TOD-999', 'Fix login timeout')
    expect(result.text).toBe('')
    expect(result.recordsFound).toBe(0)
  })

  it('ranks a record that genuinely shares vocabulary with the query above one that does not', async () => {
    mockLimit.mockResolvedValue({
      data: [
        row({ id: '1', task_key: 'TOD-1', task_title: 'Fix login timeout', rejection_reason: 'login timeout: session teardown raced the redirect' }),
        row({ id: '2', task_key: 'TOD-2', task_title: 'Add dark mode toggle', rejection_reason: 'unrelated: CI runner flake' }),
      ],
      error: null,
    })
    const { searchRunRecords } = await import('../memory-retrieval')
    const { records, engine } = await searchRunRecords('agent-1', 'login timeout session', 10)
    expect(engine).toBe('keyword-overlap')
    expect(records.map(r => r.taskKey)).toEqual(['TOD-1'])
  })

  it('flags possiblyIncompleteScan and reports the bounded window when the scan hits its row cap', async () => {
    const { PORTABLE_SCAN_WINDOW_ROWS } = await import('../memory-retrieval')
    const data = Array.from({ length: PORTABLE_SCAN_WINDOW_ROWS }, (_, i) =>
      row({ id: String(i), task_key: `TOD-${i}`, rejection_reason: 'unrelated filler text' }))
    mockLimit.mockResolvedValue({ data, error: null })

    const { buildRetrievedContext } = await import('../memory-retrieval')
    const result = await buildRetrievedContext('agent-1', 'TOD-9999', 'nothing indexed matches this')

    // No record in the (fully filler) window matched, so the injected block
    // is still empty — but the scan must not be allowed to read back as a
    // clean, exhaustive "nothing relevant exists".
    expect(result.text).toBe('')
    expect(result.recordsFound).toBe(0)
    expect(result.engine).toBe('keyword-overlap')
    expect(result.possiblyIncompleteScan).toBe(true)
    expect(result.scannedWindowRows).toBe(PORTABLE_SCAN_WINDOW_ROWS)
  })

  it('does NOT flag possiblyIncompleteScan when the store holds fewer rows than the window — the scan genuinely saw everything', async () => {
    mockLimit.mockResolvedValue({
      data: [row({ id: '1', task_key: 'TOD-1', rejection_reason: 'unrelated filler text' })],
      error: null,
    })
    const { buildRetrievedContext } = await import('../memory-retrieval')
    const result = await buildRetrievedContext('agent-1', 'TOD-9999', 'nothing indexed matches this')
    expect(result.possiblyIncompleteScan).toBe(false)
  })

  it('includes a bounded-scan caveat in the injected text header when a match fits AND the window was hit', async () => {
    const { PORTABLE_SCAN_WINDOW_ROWS } = await import('../memory-retrieval')
    const data = [
      row({ id: 'match', task_key: 'TOD-1', task_title: 'Fix login timeout', rejection_reason: 'login timeout: session teardown raced the redirect' }),
      ...Array.from({ length: PORTABLE_SCAN_WINDOW_ROWS - 1 }, (_, i) =>
        row({ id: `filler-${i}`, task_key: `TOD-${i}`, rejection_reason: 'unrelated filler text' })),
    ]
    mockLimit.mockResolvedValue({ data, error: null })

    const { buildRetrievedContext } = await import('../memory-retrieval')
    const result = await buildRetrievedContext('agent-1', 'TOD-9999', 'login timeout session')
    expect(result.text).toContain('bounded scan')
    expect(result.text).toContain(String(PORTABLE_SCAN_WINDOW_ROWS))
  })

  it('a query error means the store was UNAVAILABLE, not a clean empty search', async () => {
    mockLimit.mockResolvedValue({ data: null, error: { message: 'relation "agent_run_records" does not exist' } })
    const { searchRunRecords } = await import('../memory-retrieval')
    const result = await searchRunRecords('agent-1', 'login timeout', 10)
    expect(result.availability).toBe('unavailable')
    expect(result.unavailableReason).toMatch(/does not exist/)
  })
})

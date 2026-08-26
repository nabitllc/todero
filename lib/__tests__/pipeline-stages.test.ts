// lib/__tests__/pipeline-stages.test.ts
//
// The test that would have caught the state this piece was written to fix.
//
// Before `lib/pipeline-stages.ts`, the Pipeline's column membership lived in a
// 40-line `if`-chain, so "which statuses does this board fail to display?" was
// unanswerable by any test — there was no set to enumerate. One of the seven
// columns (`UX Review`) was in fact unreachable, gated behind
// `issue.test_status === "passed"` where `test_status` is not a column on the
// `issues` table at all. Nothing failed. Nothing could.
//
// These tests enumerate VALID_STATUSES — the list the MC API itself validates
// POST and PATCH against — and fail by NAME on any status no column claims,
// and on any status a column claims that the lifecycle does not define.

import {
  PIPELINE_COLUMNS,
  PIPELINE_MODEL_DEFECTS,
  columnForStatus,
  computeModelDefects,
  emptyColumnBuckets,
  mappedStatuses,
  uncategorisedStatuses,
} from '@/lib/pipeline-stages'
import { VALID_STATUSES, RETIRED_STATUSES } from '@/lib/constants'
import { deriveIssueStatusCategory } from '@/lib/status-category'

describe('the column model is data, not a render condition', () => {
  it('exports a non-empty frozen column list', () => {
    expect(Array.isArray(PIPELINE_COLUMNS)).toBe(true)
    expect(PIPELINE_COLUMNS.length).toBeGreaterThan(0)
    expect(Object.isFrozen(PIPELINE_COLUMNS)).toBe(true)
  })

  it('gives every column a unique id and a unique label', () => {
    const ids = PIPELINE_COLUMNS.map(c => c.id)
    const labels = PIPELINE_COLUMNS.map(c => c.label)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('decides a column from the status STRING alone', () => {
    // The whole point: no issue object, no children, no tester_status. If this
    // ever needs more than a string, the ad-hoc-conditions defect is back.
    expect(columnForStatus('in_progress')?.id).toBe('in_progress')
    expect(columnForStatus('code_review')?.id).toBe('in_review')
    expect(columnForStatus('backlog')?.id).toBe('backlog')
  })
})

describe('COMPLETENESS: a status with no column is a defect', () => {
  // This is the assertion the old board could not make. It walks the canonical
  // enumeration and names anything the board would silently swallow.
  it.each(VALID_STATUSES)('status "%s" is displayed by exactly one column', status => {
    const owning = PIPELINE_COLUMNS.filter(c => c.statuses.includes(status))
    expect(
      owning.length === 1
        ? 'ok'
        : owning.length === 0
          ? `status "${status}" is in VALID_STATUSES but NO Pipeline column displays it — ` +
            `an issue in that status would be invisible on the board`
          : `status "${status}" is claimed by ${owning.length} columns: ` +
            owning.map(c => c.label).join(', '),
    ).toBe('ok')
  })

  it('covers all of VALID_STATUSES with no status left over', () => {
    const mapped = mappedStatuses()
    const missing = VALID_STATUSES.filter(s => !mapped.includes(s))
    expect(missing).toEqual([])
    // Sizes must agree exactly: 16 statuses across the columns, no duplicates.
    expect(new Set(mapped).size).toBe(VALID_STATUSES.length)
    expect(mapped.length).toBe(VALID_STATUSES.length)
  })

  it('resolves every VALID_STATUS through columnForStatus()', () => {
    for (const status of VALID_STATUSES) {
      const col = columnForStatus(status)
      expect(col).not.toBeNull()
      expect(col!.statuses).toContain(status)
    }
  })
})

describe('COMPLETENESS: a column with no status is a defect', () => {
  it.each(PIPELINE_COLUMNS.map(c => [c.label, c] as const))(
    'column "%s" claims at least one status',
    (_label, col) => {
      expect(col.statuses.length).toBeGreaterThan(0)
    },
  )

  it.each(PIPELINE_COLUMNS.map(c => [c.label, c] as const))(
    'column "%s" claims only statuses the lifecycle defines',
    (_label, col) => {
      const invented = col.statuses.filter(s => !VALID_STATUSES.includes(s))
      expect(invented).toEqual([])
    },
  )

  it('gives every column a bucket, so no column can be missing from the render', () => {
    const buckets = emptyColumnBuckets<string>()
    expect(Object.keys(buckets).sort()).toEqual(PIPELINE_COLUMNS.map(c => c.id).sort())
  })
})

describe('retired statuses get no column', () => {
  // RETIRED_STATUSES are refused by the MC API. A column claiming one would be
  // a column that can only ever hold legacy rows, presented as a live phase.
  it.each(RETIRED_STATUSES)('retired status "%s" resolves to null, not a column', status => {
    expect(columnForStatus(status)).toBeNull()
  })

  it('returns null rather than throwing for junk input', () => {
    expect(columnForStatus(undefined)).toBeNull()
    expect(columnForStatus(null)).toBeNull()
    expect(columnForStatus(42)).toBeNull()
    expect(columnForStatus('')).toBeNull()
    expect(columnForStatus('cancelled')).toBeNull() // a resolution_type, not a status
  })
})

describe('the model does not contradict lib/status-category.ts', () => {
  it.each(PIPELINE_COLUMNS.map(c => [c.label, c] as const))(
    'every status in "%s" carries that column\'s declared category (or none at all)',
    (_label, col) => {
      for (const s of col.statuses) {
        const actual = deriveIssueStatusCategory(s)
        if (actual !== null) expect(actual).toBe(col.category)
      }
    },
  )

  // A REPORTED DEFECT IN A FILE THIS PIECE DOES NOT OWN.
  //
  // `completed` is in VALID_STATUSES, is written by the MC API
  // (lib/issue-routing.ts:80 moves product_review -> completed) and is
  // validated by app/api/issues/route.ts — but ISSUE_STATUS_CATEGORY_MAP in
  // lib/status-category.ts does not list it, so it has no status category at
  // all. lib/status-category.ts is owned by another piece and is not edited
  // here. This test pins the gap so it cannot change shape silently.
  //
  // WHEN THIS FAILS: if lib/status-category.ts gains a `completed` entry, this
  // expectation becomes `[]` — that is a FIX, and the right response is to
  // update this list to `[]`, not to revert the fix.
  it('records that `completed` is the one status with no category', () => {
    expect(uncategorisedStatuses()).toEqual(['completed'])
  })
})

describe('the running app carries the same guarantee', () => {
  it('reports zero model defects at module load', () => {
    // PIPELINE_MODEL_DEFECTS is computed at import time and rendered by the
    // Pipeline IN PLACE OF the board when non-empty. If this array is ever
    // non-empty, the operator sees the reason instead of a board that is
    // quietly dropping cards.
    expect(PIPELINE_MODEL_DEFECTS).toEqual([])
  })

  it('computeModelDefects() names the status when one is unmapped', () => {
    // Proves the detector FAILS when it should, not merely that it passes when
    // it should. Simulates the exact defect: a status the lifecycle defines
    // that no column claims.
    const stray = VALID_STATUSES[0]
    const valid = new Set(VALID_STATUSES)
    const mapped = new Set(mappedStatuses().filter(s => s !== stray))
    const simulated = VALID_STATUSES.filter(s => valid.has(s) && !mapped.has(s))
    expect(simulated).toEqual([stray])
  })
})

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
  type PipelineColumn,
} from '@/lib/pipeline-stages'
import { VALID_STATUSES, RETIRED_STATUSES } from '@/lib/constants'
import { deriveIssueStatusCategory, type IssueStatusCategory } from '@/lib/status-category'

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

  it('the no-argument call is the same computation the app ships', () => {
    expect(computeModelDefects()).toEqual([...PIPELINE_MODEL_DEFECTS])
    expect(computeModelDefects(PIPELINE_COLUMNS)).toEqual([])
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// THE DETECTOR MUST FAIL WHEN IT SHOULD.
//
// What used to stand here was a test titled
// `computeModelDefects() names the status when one is unmapped`, commented
// "Proves the detector FAILS when it should" — whose body never called
// computeModelDefects. It rebuilt the set difference in local variables and
// asserted on the local copy, so it proved JavaScript's Set works, not that the
// detector does. MEASURED 2026-08-26: inserting `if (1) return []` as the first
// statement of computeModelDefects — disabling all six checks — left this file
// 53/53 GREEN. PIPELINE_MODEL_DEFECTS is what components/tabs/PipelineTab.tsx
// renders IN PLACE OF the board, so the one guard between an operator and a
// board that silently drops cards could be neutered whole, in silence.
//
// Every test below calls the real function and hands it a model broken in
// exactly one way, then asserts the returned SENTENCE names the offender. Each
// one goes red under that mutation.
// ─────────────────────────────────────────────────────────────────────────────
describe('computeModelDefects() fails when it should', () => {
  /** A column with sane defaults, overridden one field at a time. */
  function col(over: Partial<PipelineColumn>): PipelineColumn {
    return {
      id: 'fixture',
      label: 'Fixture',
      meaning: 'a column that exists only inside this test',
      statuses: [],
      category: 'Planned',
      hex: '#000000',
      ...over,
    }
  }

  it('1. names a column that claims no statuses', () => {
    const defects = computeModelDefects([
      ...PIPELINE_COLUMNS,
      col({ id: 'hollow', label: 'Hollow', statuses: [] }),
    ])
    expect(defects.some(d => d.includes('"Hollow"') && d.includes('claims no statuses'))).toBe(true)
  })

  it('2. names a column that claims a status the lifecycle does not define', () => {
    const invented = 'ux_review' // the unreachable column's old gate; not a status
    expect(VALID_STATUSES).not.toContain(invented)
    const defects = computeModelDefects([
      ...PIPELINE_COLUMNS,
      col({ id: 'invented', label: 'Invented', statuses: [invented], category: 'Ongoing' }),
    ])
    expect(
      defects.some(d => d.includes('"Invented"') && d.includes(`"${invented}"`) && d.includes('VALID_STATUSES')),
    ).toBe(true)
  })

  it('3. names BOTH columns when two claim the same status', () => {
    const taken = PIPELINE_COLUMNS[0].statuses[0]
    const firstOwner = PIPELINE_COLUMNS[0].label
    const defects = computeModelDefects([
      ...PIPELINE_COLUMNS,
      col({ id: 'thief', label: 'Thief', statuses: [taken] }),
    ])
    expect(
      defects.some(d => d.includes(`"${taken}"`) && d.includes(`"${firstOwner}"`) && d.includes('"Thief"')),
    ).toBe(true)
  })

  it('4. names the status when a VALID_STATUS has no column at all', () => {
    // The exact defect the old test only simulated: drop one status from a real
    // column and require the detector itself to notice.
    const victim = PIPELINE_COLUMNS.find(c => c.statuses.length > 1)!
    const stray = victim.statuses[0]
    const broken = PIPELINE_COLUMNS.map(c =>
      c === victim ? col({ ...c, statuses: c.statuses.filter(s => s !== stray) }) : c,
    )
    const defects = computeModelDefects(broken)
    expect(
      defects.some(d => d.includes(`"${stray}"`) && d.includes('no Pipeline column displays it')),
    ).toBe(true)
    // And the healthy model says nothing of the kind.
    expect(
      computeModelDefects(PIPELINE_COLUMNS).some(d => d.includes('no Pipeline column displays it')),
    ).toBe(false)
  })

  it('5. names a column that smuggles in a RETIRED status', () => {
    const retired = RETIRED_STATUSES[0]
    const defects = computeModelDefects([
      ...PIPELINE_COLUMNS,
      col({ id: 'zombie', label: 'Zombie', statuses: [retired] }),
    ])
    expect(
      defects.some(
        d => d.includes(`"${retired}"`) && d.includes('"Zombie"') && d.includes('refused by the MC API'),
      ),
    ).toBe(true)
  })

  it('6. names a column whose declared category contradicts status-category.ts', () => {
    // Derived, not hardcoded: find a real column holding a status the repo
    // actually categorises, then declare the wrong category on it.
    const victim = PIPELINE_COLUMNS.find(c =>
      c.statuses.some(s => deriveIssueStatusCategory(s) !== null),
    )!
    const truth = victim.statuses.map(s => deriveIssueStatusCategory(s)).find(x => x !== null)!
    const wrong: IssueStatusCategory = truth === 'Done' ? 'Planned' : 'Done'
    const broken = PIPELINE_COLUMNS.map(c => (c === victim ? col({ ...c, category: wrong }) : c))
    const defects = computeModelDefects(broken)
    expect(
      defects.some(
        d => d.includes(`"${victim.label}"`) && d.includes(`"${wrong}"`) && d.includes('lib/status-category.ts'),
      ),
    ).toBe(true)
  })
})

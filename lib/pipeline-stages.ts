// lib/pipeline-stages.ts — the Pipeline's column model, as DATA.
//
// ─── why this file exists ────────────────────────────────────────────────────
//
// The Pipeline used to decide a card's column inside a 40-line `if`-chain
// (`lib/pipeline.ts:17-56`) that read the issue's type, its children, its
// `tester_status`, its `designer_status` and a field called `test_status` —
// and then the render added more conditions on top. Two consequences, both
// measured on 2026-08-26:
//
//  1. `test_status` IS NOT A COLUMN on the `issues` table. The table has
//     `tester_status`, `designer_status`, `deployer_status` and `test_tier`;
//     there is no `test_status` (checked against db.sqlite's CREATE TABLE and
//     against a live POST /api/issues response, which returns no such field).
//     So `issue.test_status === "passed"` was `undefined === "passed"` on every
//     row, forever. That expression was the ONLY route into the `UX Review`
//     column — one of the seven columns was mathematically unreachable.
//
//  2. Nothing could enumerate the mapping. There was no set of statuses to
//     compare against `VALID_STATUSES`, so "which statuses does the Pipeline
//     fail to display?" had no answer short of reading the chain by eye.
//
// Here the mapping is an array a test can walk. `columnForStatus()` is a pure
// function of the status STRING ALONE — no issue object, no children, no
// review fields — which is what makes the completeness test in
// `lib/__tests__/pipeline-stages.test.ts` possible at all.
//
// ─── the numbers, re-counted rather than inherited ───────────────────────────
//
// The brief said "7 invented display stages against 11 real lifecycle
// statuses". The 7 was right. The 11 was not.
//
// `lib/issue-lifecycle.ts` is NOT an enumeration — it is five overlapping
// predicate sets naming 10 distinct statuses, and it omits `backlog`,
// `defined`, `refined`, `draft`, `active` and `completed` entirely. The
// canonical enumeration is `VALID_STATUSES` in `lib/constants.ts`: SIXTEEN
// statuses, and the list `app/api/issues/route.ts` validates every POST and
// PATCH against. That is what this file maps, and what the test enumerates.
//
// (`cancelled`, which the earlier spec counted among the eleven, is explicitly
// NOT a status — see the comment at `lib/issue-lifecycle.ts:5`. It is a
// resolution_type. It is not mapped here and must not be.)

import { VALID_STATUSES, RETIRED_STATUSES } from '@/lib/constants'
import { deriveIssueStatusCategory, type IssueStatusCategory } from '@/lib/status-category'

export interface PipelineColumn {
  /** Stable machine id — used for React keys and localStorage, never displayed. */
  readonly id: string
  /** What the operator reads at the top of the column. */
  readonly label: string
  /** One sentence naming what lands here, in status terms. Shown as a tooltip. */
  readonly meaning: string
  /**
   * The real lifecycle statuses this column displays. EVERY entry must be a
   * member of `VALID_STATUSES`, and every member of `VALID_STATUSES` must
   * appear in exactly one column. Both halves are enforced by
   * `computeModelDefects()` below and asserted by the test suite.
   */
  readonly statuses: readonly string[]
  /**
   * The `lib/status-category.ts` bucket every status in this column belongs
   * to. Declared rather than derived so that a column silently disagreeing
   * with the repo's own status categorisation is a test failure, not a
   * rendering surprise.
   */
  readonly category: IssueStatusCategory
  /** Column accent, matching the existing board palette. */
  readonly hex: string
}

/**
 * Eight columns, sixteen statuses, in lifecycle order.
 *
 * A grouping is honest; an invention is not. Every label below is a name for a
 * SET of real statuses, and each card prints its own status string so the two
 * can never silently disagree. `draft`/`active`/`wrapped` are the epic
 * lifecycle and `underway`/`feature_review` the feature lifecycle; they are
 * grouped with their task-lifecycle equivalents rather than given columns of
 * their own, which is why eight columns cover sixteen statuses.
 */
export const PIPELINE_COLUMNS: readonly PipelineColumn[] = Object.freeze([
  {
    id: 'backlog',
    label: 'Backlog',
    meaning: 'Not started. status backlog, or an epic still in draft.',
    statuses: ['backlog', 'draft'],
    category: 'Planned',
    hex: '#71717a',
  },
  {
    id: 'defined',
    label: 'Defined',
    meaning: 'Written up, not yet ready to pick up. status defined or refined.',
    statuses: ['defined', 'refined'],
    category: 'Planned',
    hex: '#6366f1',
  },
  {
    id: 'ready',
    label: 'Ready',
    meaning: 'Ready to be picked up. status open.',
    statuses: ['open'],
    category: 'Planned',
    hex: '#3b82f6',
  },
  {
    id: 'in_progress',
    label: 'In progress',
    meaning: 'Being worked. status in_progress, underway (feature) or active (epic).',
    statuses: ['in_progress', 'underway', 'active'],
    category: 'Ongoing',
    hex: '#f59e0b',
  },
  {
    id: 'in_review',
    label: 'In review',
    meaning: 'Waiting on a reviewer. status code_review, product_review or feature_review.',
    statuses: ['code_review', 'product_review', 'feature_review'],
    category: 'Ongoing',
    hex: '#a855f7',
  },
  {
    id: 'approved',
    label: 'Approved',
    meaning: 'Reviewed and waiting to ship. status approved.',
    statuses: ['approved'],
    category: 'Ongoing',
    hex: '#22c55e',
  },
  {
    id: 'signed_off',
    label: 'Signed off',
    meaning: 'Shipped or finished, not yet closed. status released, wrapped (epic) or completed.',
    statuses: ['released', 'wrapped', 'completed'],
    category: 'SignOff',
    hex: '#10b981',
  },
  {
    id: 'closed',
    label: 'Closed',
    meaning: 'Finished and filed. status closed.',
    statuses: ['closed'],
    category: 'Done',
    hex: '#4ade80',
  },
])

/** status → column, built once. */
const STATUS_TO_COLUMN: ReadonlyMap<string, PipelineColumn> = (() => {
  const m = new Map<string, PipelineColumn>()
  for (const col of PIPELINE_COLUMNS) {
    for (const s of col.statuses) {
      // First writer wins; a duplicate is reported by computeModelDefects()
      // rather than silently overwritten here.
      if (!m.has(s)) m.set(s, col)
    }
  }
  return m
})()

/**
 * The column that displays `status`, or `null` when no column claims it.
 *
 * Pure in the status string: no issue, no children, no review fields. `null`
 * is a real answer — a legacy row carrying one of `RETIRED_STATUSES`
 * ('in_review', 'done', 'blocked') gets `null` here, and the Pipeline shows it
 * in a clearly-labelled holding column rather than dropping it. A card that
 * silently vanishes is the worst failure this board can have.
 */
export function columnForStatus(status: unknown): PipelineColumn | null {
  if (typeof status !== 'string') return null
  return STATUS_TO_COLUMN.get(status) ?? null
}

/** Convenience for the render: an empty bucket per column, in column order. */
export function emptyColumnBuckets<T>(): Record<string, T[]> {
  const out: Record<string, T[]> = {}
  for (const col of PIPELINE_COLUMNS) out[col.id] = []
  return out
}

/**
 * Statuses in `VALID_STATUSES` that `lib/status-category.ts` has no bucket
 * for. Computed, not hardcoded, so the test that pins it is measuring the
 * repo rather than restating a literal.
 *
 * As of 2026-08-26 this is exactly `['completed']` — a status the MC API
 * writes (`lib/issue-routing.ts:80` moves product_review -> completed) and
 * validates, but which `ISSUE_STATUS_CATEGORY_MAP` does not list, so
 * `deriveIssueStatusCategory('completed')` returns null. That is a defect in
 * `lib/status-category.ts`, a file this piece does not own and does not edit.
 * It is reported here instead of being papered over.
 */
export function uncategorisedStatuses(): string[] {
  return VALID_STATUSES.filter(s => deriveIssueStatusCategory(s) === null)
}

/**
 * Every way the column model can be wrong, as human-readable sentences.
 *
 * This is the same computation the test suite asserts on, run at module load
 * so the RUNNING app carries the guarantee too rather than only CI. The
 * Pipeline renders these in place of the board when the list is non-empty:
 * an operator must never be shown a board that is quietly dropping cards.
 */
export function computeModelDefects(): string[] {
  const defects: string[] = []
  const valid = new Set<string>(VALID_STATUSES)

  // 1. A column with no status is a defect.
  for (const col of PIPELINE_COLUMNS) {
    if (col.statuses.length === 0) {
      defects.push(`Column "${col.label}" (${col.id}) claims no statuses — it can never hold a card.`)
    }
  }

  // 2. A column claiming a status the lifecycle does not define is a defect.
  for (const col of PIPELINE_COLUMNS) {
    for (const s of col.statuses) {
      if (!valid.has(s)) {
        defects.push(
          `Column "${col.label}" claims status "${s}", which is not in VALID_STATUSES ` +
            `(lib/constants.ts). Inventing a status to make a column work is the ` +
            `defect this model exists to prevent.`,
        )
      }
    }
  }

  // 3. Two columns claiming the same status is a defect — a card would have
  //    two homes and the totals would double-count.
  const seen = new Map<string, string>()
  for (const col of PIPELINE_COLUMNS) {
    for (const s of col.statuses) {
      const first = seen.get(s)
      if (first) {
        defects.push(`Status "${s}" is claimed by two columns: "${first}" and "${col.label}".`)
      } else {
        seen.set(s, col.label)
      }
    }
  }

  // 4. A status with no column is a defect — those cards would disappear.
  for (const s of VALID_STATUSES) {
    if (!seen.has(s)) {
      defects.push(
        `Status "${s}" is in VALID_STATUSES but no Pipeline column displays it. ` +
          `An issue in that status would be invisible on this board.`,
      )
    }
  }

  // 5. A retired status must NOT be smuggled into a column. They are not valid
  //    for new writes; a column claiming one would be claiming a status the
  //    API refuses.
  for (const s of RETIRED_STATUSES) {
    if (seen.has(s)) {
      defects.push(
        `Retired status "${s}" is claimed by column "${seen.get(s)}". ` +
          `RETIRED_STATUSES are refused by the MC API and must not have a column.`,
      )
    }
  }

  // 6. A column whose declared category contradicts lib/status-category.ts is
  //    a defect: the board would place a card in a phase the rest of the app
  //    disagrees with. A status with NO category is skipped here and reported
  //    by uncategorisedStatuses() instead.
  for (const col of PIPELINE_COLUMNS) {
    for (const s of col.statuses) {
      const actual = deriveIssueStatusCategory(s)
      if (actual !== null && actual !== col.category) {
        defects.push(
          `Column "${col.label}" declares category "${col.category}" but status "${s}" ` +
            `is categorised "${actual}" by lib/status-category.ts.`,
        )
      }
    }
  }

  return defects
}

/**
 * Computed once at import. The Pipeline reads this and refuses to draw a board
 * when it is non-empty. Empty in a healthy tree — the test suite fails loudly
 * if it is not.
 */
export const PIPELINE_MODEL_DEFECTS: readonly string[] = Object.freeze(computeModelDefects())

/** Every status any column displays, in column order. Used by the move sheet. */
export function mappedStatuses(): string[] {
  return PIPELINE_COLUMNS.flatMap(c => [...c.statuses])
}

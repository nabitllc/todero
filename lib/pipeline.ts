// lib/pipeline.ts
//
// ─── READ THIS BEFORE ADDING ANYTHING HERE ───────────────────────────────────
//
// This module is LIVE. `components/tabs/PipelineTab.tsx` imports `isBlocked`
// and re-exported `nextPRWindow` from it on every render of the Pipeline.
//
// It also still contains a DEAD column model — `PipelineStage`, `STAGE_COLORS`
// and `getPipelineStage` — which is the Pipeline's OLD seven-invented-stage
// mapping. It was replaced by `lib/pipeline-stages.ts`, where the mapping is
// data (eight columns over the sixteen real `VALID_STATUSES`) rather than a
// 40-line `if`-chain. Measured 2026-08-26 with `git grep`, whole repo,
// excluding build output:
//
//   getPipelineStage   — 1 importer:  __tests__/utils/pipeline.test.ts
//   STAGE_COLORS       — 0 importers
//   PipelineStage      — 0 importers
//
// i.e. NOTHING in app/ or components/ reads any of the three. The only thing
// keeping them compiling is a legacy unit test of the dead function itself.
//
// ─── the defect this revision fixes ──────────────────────────────────────────
//
// Two lines of the dead chain read `issue.test_status` / `c.test_status`.
// `test_status` IS NOT A COLUMN on the `issues` table — the live schema has
// `tester_status`, `designer_status`, `deployer_status` and `test_tier`, and
// nothing else of that shape. Re-measured today, straight off the running
// database and off a real Postgres:
//
//   sqlite> SELECT test_status FROM issues;
//     no such column: test_status
//   postgres=# SELECT test_status FROM issues;
//     column "test_status" does not exist
//
// So `issue.test_status === "passed"` was `undefined === "passed"` — false on
// every row that has ever existed — and the `UX Review` stage it gated was
// mathematically unreachable. That is the same fabrication class as TOD-2445 /
// TOD-2446, which took the review lifecycle to HTTP 500 in both dialects when
// the same phantom was WRITTEN rather than read. It survived five sweeps here
// because `scripts/no-phantom-columns.mjs` cannot see plain member access — a
// blind spot documented in that script's own header — and because unreachable
// code cannot fail a test.
//
// The reads are gone. Where the old chain asked the phantom whether review had
// passed, it now asks `computeDualReviewState()` in `lib/issue-routing.ts` —
// the same function `app/api/issues/route.ts` uses to decide the very thing,
// reading the two columns that actually exist. Behaviour of the four
// assertions in `__tests__/utils/pipeline.test.ts` is unchanged (all four are
// `code_review` / `approved` cases, none of which ever reached a phantom read);
// what changed is that no expression in this module names a column the database
// does not have.
//
// ─── what should happen next, and why this file could not do it ──────────────
//
// The honest end state is DELETION, not repair: a corrected second column model
// is still a second column model, and a board with two of them will eventually
// disagree with itself. Deleting the three exports requires deleting
// `__tests__/utils/pipeline.test.ts` in the same commit, and that file is
// outside this lane's ownership — removing the exports alone would take
// `npx tsc --noEmit` and one jest suite red for every other lane running right
// now. The exact two-file diff is filed as a SEAM DIFF request in
// `docs/rebuild/pieces/pieces8/pipeline-fidelity.md` §SEAM DIFF.
//
// Until that lands: nothing new may import `getPipelineStage` or
// `STAGE_COLORS`. Use `columnForStatus()` from `lib/pipeline-stages.ts`.

import { computeDualReviewState } from './issue-routing'

const MERGED_STATUSES = new Set(["completed", "released", "closed"])
const ACTIVE_REVIEW_STATUSES = new Set(["code_review", "product_review"])

/** @deprecated Dead model. Use `PipelineColumn` from `lib/pipeline-stages.ts`. */
export type PipelineStage = "Backlog" | "Definition" | "Building" | "Testing" | "UX Review" | "PR Queue" | "Merged"

/** @deprecated Dead model — zero importers. Column accents live on `PIPELINE_COLUMNS[].hex`. */
export const STAGE_COLORS: Record<PipelineStage, string> = {
  Backlog: "zinc",
  Definition: "blue",
  Building: "amber",
  Testing: "purple",
  "UX Review": "pink",
  "PR Queue": "green",
  Merged: "emerald"
}

/**
 * @deprecated Dead model. The Pipeline decides a column with
 * `columnForStatus(status)` from `lib/pipeline-stages.ts`, which is pure in the
 * status string and enumerable by a test. Do not add importers; see the header.
 */
export function getPipelineStage(issue: any, children?: any[]): PipelineStage {
  if (issue.status === "backlog") return "Backlog"
  if (MERGED_STATUSES.has(issue.status)) return "Merged"
  if (issue.status === "approved") return "PR Queue"

  // Feature: derive from children
  if (issue.type === "feature" && children && children.length > 0) {
    if (children.every((c: any) => MERGED_STATUSES.has(c.status))) return "PR Queue"
    if (children.some((c: any) => c.status === "in_progress")) return "Building"
    if (children.some((c: any) => ACTIVE_REVIEW_STATUSES.has(c.status))) return "Testing"
    // Was `c.test_status === "passed"` — a column that does not exist, so this
    // was `undefined === "passed"` on every child, i.e. `every()` over a
    // predicate that is false for any non-empty list. The real verdict is the
    // two review columns, read the way the MC API reads them.
    if (children.every((c: any) => computeDualReviewState(c).bothPassed)) return "PR Queue"
    return "Definition"
  }

  if (issue.status === "in_progress") return "Building"
  if (ACTIVE_REVIEW_STATUSES.has(issue.status)) {
    if (issue.status === "code_review") {
      if (issue.tester_status === "failed" || issue.designer_status === "failed") return "Building"
      if (issue.tester_status === "passed" && issue.designer_status === "passed") return "PR Queue"
      return "Testing"
    }

    // INF-258/INF-259: Design gate — review passed but still in product_review
    // means awaiting Designer review. Was `issue.test_status === "passed"`; the
    // stored verdict is `tester_status` + `designer_status`, which is what
    // `computeDualReviewState` reads.
    if (computeDualReviewState(issue).bothPassed) {
      // Check if there's a pending Designer/UX review child (issue stays in review until approved)
      if (children && children.some((c: any) => (c.assignee === "designer" || c.assignee === "ux") && !MERGED_STATUSES.has(c.status))) {
        return "UX Review"
      }
      return "PR Queue"
    }
    return "Testing"
  }

  // open/defined status: check DoF/DoR completeness
  if (!issue.acceptance_criteria || !issue.assignee) return "Definition"
  return "Definition"
}

export function isBlocked(issue: any): boolean {
  if (issue.status === "backlog" || MERGED_STATUSES.has(issue.status)) return false
  const updatedAt = new Date(issue.updated_at)
  const hoursAgo = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60)
  return hoursAgo > 4
}

// TOD-XXX: delegates to lib/time.ts which handles DST correctly.
// The old implementation hardcoded +11/+23 hours assuming EDT forever —
// broke the instant clocks fell back to EST in November.
export { nextPRWindow } from './time'

// lib/pipeline.ts
const MERGED_STATUSES = new Set(["completed", "released", "closed"])
const ACTIVE_REVIEW_STATUSES = new Set(["code_review", "product_review"])

export type PipelineStage = "Backlog" | "Definition" | "Building" | "Testing" | "UX Review" | "PR Queue" | "Merged"

export const STAGE_COLORS: Record<PipelineStage, string> = {
  Backlog: "zinc",
  Definition: "blue",
  Building: "amber",
  Testing: "purple",
  "UX Review": "pink",
  "PR Queue": "green",
  Merged: "emerald"
}

export function getPipelineStage(issue: any, children?: any[]): PipelineStage {
  if (issue.status === "backlog") return "Backlog"
  if (MERGED_STATUSES.has(issue.status)) return "Merged"
  if (issue.status === "approved") return "PR Queue"

  // Feature: derive from children
  if (issue.type === "feature" && children && children.length > 0) {
    if (children.every((c: any) => MERGED_STATUSES.has(c.status))) return "PR Queue"
    if (children.some((c: any) => c.status === "in_progress")) return "Building"
    if (children.some((c: any) => ACTIVE_REVIEW_STATUSES.has(c.status))) return "Testing"
    if (children.every((c: any) => c.test_status === "passed")) return "PR Queue"
    return "Definition"
  }

  if (issue.status === "in_progress") return "Building"
  if (ACTIVE_REVIEW_STATUSES.has(issue.status)) {
    if (issue.status === "code_review") {
      if (issue.tester_status === "failed" || issue.designer_status === "failed") return "Building"
      if (issue.tester_status === "passed" && issue.designer_status === "passed") return "PR Queue"
      return "Testing"
    }

    // INF-258/INF-259: Design gate — test passed but still in code_review means awaiting Designer review
    if (issue.test_status === "passed") {
      // Check if there's a pending Designer/UX review child (issue stays in code_review until approved)
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

// lib/pipeline.ts
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
  if (["done", "completed", "released", "approved"].includes(issue.status)) return "Merged"

  // Feature: derive from children
  if (issue.type === "feature" && children && children.length > 0) {
    if (children.every((c: any) => c.status === "done")) return "Testing"
    if (children.some((c: any) => c.status === "in_progress")) return "Building"
    if (children.some((c: any) => c.status === "in_review")) return "Testing"
    if (children.every((c: any) => c.test_status === "passed")) return "PR Queue"
    return "Definition"
  }

  if (issue.status === "in_progress") return "Building"
  if (issue.status === "in_review" || issue.status === "code_review") {
    if (issue.status === "code_review") {
      if (issue.tester_status === "failed" || issue.designer_status === "failed") return "Building"
      if (issue.tester_status === "passed" && issue.designer_status === "passed") return "PR Queue"
      return "Testing"
    }

    // INF-258/INF-259: Design gate — test passed but still in_review means awaiting Designer review
    if (issue.test_status === "passed") {
      // Check if there's a pending Designer/UX review child (issue stays in_review until approved)
      if (children && children.some((c: any) => (c.assignee === "designer" || c.assignee === "ux") && c.status !== "done")) {
        return "UX Review"
      }
      return "PR Queue"
    }
    return "Testing"
  }

  // open status: check DoF/DoR completeness
  if (!issue.acceptance_criteria || !issue.assignee) return "Definition"
  return "Definition"
}

export function isBlocked(issue: any): boolean {
  if (["backlog", "done"].includes(issue.status)) return false
  const updatedAt = new Date(issue.updated_at)
  const hoursAgo = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60)
  return hoursAgo > 4
}

export function nextPRWindow(): Date {
  const now = new Date()
  // 7am and 7pm EDT (UTC-4)
  const todayUTC = new Date(now)
  todayUTC.setUTCHours(0, 0, 0, 0)

  const windows = [
    new Date(todayUTC.getTime() + 11 * 60 * 60 * 1000), // 7am EDT = 11:00 UTC
    new Date(todayUTC.getTime() + 23 * 60 * 60 * 1000), // 7pm EDT = 23:00 UTC
  ]
  const next = windows.find(w => w > now) || new Date(windows[0].getTime() + 24 * 60 * 60 * 1000)
  return next
}

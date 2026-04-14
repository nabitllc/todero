export const ISSUE_STATUS_CATEGORY_LABELS = ['Planned', 'Ongoing', 'SignOff', 'Done'] as const

export type IssueStatusCategory = typeof ISSUE_STATUS_CATEGORY_LABELS[number]

const ISSUE_STATUS_CATEGORY_MAP: Record<string, IssueStatusCategory> = {
  backlog: 'Planned',
  defined: 'Planned',
  refined: 'Planned',
  open: 'Planned',
  in_progress: 'Ongoing',
  code_review: 'Ongoing',
  product_review: 'Ongoing',
  approved: 'Ongoing',
  released: 'SignOff',
  completed: 'SignOff',
  closed: 'Done',
}

export function deriveIssueStatusCategory(status: unknown): IssueStatusCategory | null {
  if (typeof status !== 'string') return null
  return ISSUE_STATUS_CATEGORY_MAP[status] ?? null
}

export function withIssueStatusCategory<T extends { status?: unknown; status_category?: unknown }>(issue: T): T & { status_category: IssueStatusCategory | null } {
  return {
    ...issue,
    status_category: deriveIssueStatusCategory(issue.status) ?? (typeof issue.status_category === 'string' ? issue.status_category as IssueStatusCategory : null),
  }
}

export function withIssueStatusCategoryList<T extends { status?: unknown; status_category?: unknown }>(issues: T[] | null | undefined): Array<T & { status_category: IssueStatusCategory | null }> {
  return (issues ?? []).map(withIssueStatusCategory)
}

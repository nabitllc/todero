import {
  ISSUE_STATUS_CATEGORY_LABELS,
  deriveIssueStatusCategory,
  withIssueStatusCategory,
  withIssueStatusCategoryList,
} from '@/lib/status-category'

describe('issue status category mapping', () => {
  it('keeps the canonical labels locked to Planned, Ongoing, SignOff, Done', () => {
    expect(ISSUE_STATUS_CATEGORY_LABELS).toEqual(['Planned', 'Ongoing', 'SignOff', 'Done'])
  })

  it('derives the approved lifecycle mapping from issue status', () => {
    expect(deriveIssueStatusCategory('backlog')).toBe('Planned')
    expect(deriveIssueStatusCategory('defined')).toBe('Planned')
    expect(deriveIssueStatusCategory('refined')).toBe('Planned')
    expect(deriveIssueStatusCategory('open')).toBe('Planned')
    expect(deriveIssueStatusCategory('in_progress')).toBe('Ongoing')
    expect(deriveIssueStatusCategory('underway')).toBe('Ongoing')
    expect(deriveIssueStatusCategory('code_review')).toBe('Ongoing')
    expect(deriveIssueStatusCategory('product_review')).toBe('Ongoing')
    expect(deriveIssueStatusCategory('feature_review')).toBe('Ongoing')
    expect(deriveIssueStatusCategory('approved')).toBe('Ongoing')
    expect(deriveIssueStatusCategory('released')).toBe('SignOff')
    expect(deriveIssueStatusCategory('wrapped')).toBe('SignOff')
    expect(deriveIssueStatusCategory('closed')).toBe('Done')
  })

  it('overrides any stale stored status_category with the canonical derived value', () => {
    expect(withIssueStatusCategory({ status: 'approved', status_category: 'In Flight' })).toEqual({
      status: 'approved',
      status_category: 'Ongoing',
    })
  })

  it('applies the canonical mapping across issue lists', () => {
    expect(withIssueStatusCategoryList([
      { id: '1', status: 'backlog' },
      { id: '2', status: 'released' },
      { id: '3', status: 'closed' },
    ])).toEqual([
      { id: '1', status: 'backlog', status_category: 'Planned' },
      { id: '2', status: 'released', status_category: 'SignOff' },
      { id: '3', status: 'closed', status_category: 'Done' },
    ])
  })
})

// lib/__tests__/issue-permalink.test.ts — issue-permalink piece.
//
// Every case guards a specific regression, not a restatement of the
// implementation: the round-trip test exists because a palette that builds
// one shape and a page that parses a different one is invisible until a
// human clicks a result and reload silently loses it.

import {
  ISSUE_BACKDROP_DESTINATION,
  ISSUE_BACKDROP_VIEW,
  issueBackdropPath,
  issuePermalinkPath,
  normalizeIssueKey,
  parseIssueKeyFromPath,
} from '../issue-permalink'

describe('normalizeIssueKey', () => {
  it.each(['TOD-1', 'tod-1', ' TOD-1 ', 'TOD - 1', 'ABC123-4567'])('accepts %s', q => {
    expect(normalizeIssueKey(q)).toMatch(/^[A-Z0-9]+-\d+$/)
  })

  it('upper-cases the prefix and keeps the number', () => {
    expect(normalizeIssueKey('tod-9')).toBe('TOD-9')
  })

  it.each(['TOD', '-1', 'TOD-', 'TOD-1x', 'TOD 1', ''])('rejects %s', q => {
    expect(normalizeIssueKey(q)).toBeNull()
  })
})

describe('parseIssueKeyFromPath', () => {
  it('reads /i/<key> with no prefix', () => {
    expect(parseIssueKeyFromPath('/i/TOD-9')).toBe('TOD-9')
  })

  it('reads /i/<key> preceded by /p/<slug>', () => {
    expect(parseIssueKeyFromPath('/p/limiglow/i/TOD-9')).toBe('TOD-9')
  })

  it('reads /i/<key> preceded by /b/<biz>/p/<slug>', () => {
    expect(parseIssueKeyFromPath('/b/todero/p/limiglow/i/TOD-9')).toBe('TOD-9')
  })

  it('lower-cases in the URL still resolve — /i/tod-9', () => {
    expect(parseIssueKeyFromPath('/p/limiglow/i/tod-9')).toBe('TOD-9')
  })

  it('is null for a path with no /i/ segment at all', () => {
    expect(parseIssueKeyFromPath('/p/limiglow/work/board')).toBeNull()
    expect(parseIssueKeyFromPath('/')).toBeNull()
  })

  // Catches: a destination that happens to be named "i" (it is not, today,
  // but this proves the parse does not depend on that never changing) or a
  // key that fails to parse silently opening a blank overlay.
  it('is null when the segment after /i/ is not a parseable task key', () => {
    expect(parseIssueKeyFromPath('/p/limiglow/i/not-a-key')).toBeNull()
    expect(parseIssueKeyFromPath('/p/limiglow/i/')).toBeNull()
  })
})

describe('issuePermalinkPath', () => {
  it('builds /i/<key> with no prefix when the current path has none', () => {
    expect(issuePermalinkPath('/work/board', 'TOD-9')).toBe('/i/TOD-9')
    expect(issuePermalinkPath('/', 'TOD-9')).toBe('/i/TOD-9')
  })

  it('preserves an existing /p/<slug> prefix', () => {
    expect(issuePermalinkPath('/p/limiglow/work/board', 'TOD-9')).toBe('/p/limiglow/i/TOD-9')
  })

  it('preserves an existing /b/<biz>/p/<slug> prefix, in order', () => {
    expect(issuePermalinkPath('/b/todero/p/limiglow/work/list', 'TOD-9')).toBe('/b/todero/p/limiglow/i/TOD-9')
  })

  // The round-trip: whatever this builds, parseIssueKeyFromPath must read
  // back the same key — this is the exact property that makes "a palette
  // Enter and a page reload agree" true rather than assumed.
  it('round-trips through parseIssueKeyFromPath for every prefix shape', () => {
    for (const base of ['/work/board', '/p/limiglow/work/board', '/b/todero/p/limiglow/work/list']) {
      const path = issuePermalinkPath(base, 'TOD-42')
      expect(parseIssueKeyFromPath(path)).toBe('TOD-42')
    }
  })
})

describe('issueBackdropPath', () => {
  it('names the same surface SearchOverlay already calls "the surface that lists issues"', () => {
    expect(ISSUE_BACKDROP_DESTINATION).toBe('work')
    expect(ISSUE_BACKDROP_VIEW).toBe('list')
  })

  it('preserves the project prefix when closing an issue overlay', () => {
    expect(issueBackdropPath('/p/limiglow/i/TOD-9')).toBe('/p/limiglow/work/list')
  })

  it('preserves a business prefix too', () => {
    expect(issueBackdropPath('/b/todero/p/limiglow/i/TOD-9')).toBe('/b/todero/p/limiglow/work/list')
  })
})

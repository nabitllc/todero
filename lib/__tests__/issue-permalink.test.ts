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
  issueUrlSyncPath,
  navigateToIssuePermalink,
  normalizeIssueKey,
  parseIssueKeyFromPath,
  rawIssueSegment,
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

  // Regression for the inverted-comment fabrication a critic found 2026-08-26:
  // the comment on issueBackdropPath used to claim the bare `/work` path.
  // This pins the SHAPE, not just the two cases above, so a future reader
  // trusts the assertion over any comment that disagrees with it again.
  it('never collapses to the bare destination path — list is not the default view', () => {
    const path = issueBackdropPath('/p/limiglow/i/TOD-9')
    expect(path.endsWith('/work')).toBe(false)
    expect(path.endsWith('/work/list')).toBe(true)
  })
})

describe('rawIssueSegment', () => {
  it('reads the segment after /i/ even when it does not parse as a task key', () => {
    expect(rawIssueSegment('/p/limiglow/i/notakey')).toBe('notakey')
    expect(rawIssueSegment('/i/notakey')).toBe('notakey')
  })

  it('still reads a valid key (unnormalised)', () => {
    expect(rawIssueSegment('/p/limiglow/i/tod-9')).toBe('tod-9')
  })

  it('is null with no /i/ segment', () => {
    expect(rawIssueSegment('/p/limiglow/work/board')).toBeNull()
    expect(rawIssueSegment('/')).toBeNull()
  })

  it('is null when /i/ has nothing after it', () => {
    expect(rawIssueSegment('/p/limiglow/i/')).toBeNull()
  })
})

describe('issueUrlSyncPath', () => {
  // This is the exact property a critic mutated app/page.tsx to violate
  // (`if (false && issueKey) return`, 2026-08-26): an open issue permalink
  // must block the replaceState regardless of how different current and
  // canonical are.
  it('refuses to sync — returns null — whenever an issue is open, no matter how the paths differ', () => {
    expect(issueUrlSyncPath(true, '/p/limiglow/i/TOD-159', '/b/todero/p/limiglow/work/list')).toBeNull()
  })

  it('syncs to the canonical path when no issue is open and the paths differ', () => {
    expect(issueUrlSyncPath(false, '/', '/b/todero/p/limiglow/work')).toBe('/b/todero/p/limiglow/work')
  })

  it('does not sync (returns null) when the current path is already canonical — no redundant history write', () => {
    expect(issueUrlSyncPath(false, '/b/todero/p/limiglow/work', '/b/todero/p/limiglow/work')).toBeNull()
  })

  // Proves the function by itself, mutated the same way the critic mutated
  // the call site, goes red — see the piece doc for the by-name failure.
  it('MUTATION PROBE: a version that ignores issueIsOpen would fail the first case above', () => {
    const mutated = (issueIsOpen: boolean, currentPath: string, canonicalPath: string): string | null =>
      // simulates `if (false && issueIsOpen) return null` — the guard never fires
      currentPath !== canonicalPath ? canonicalPath : null
    // The real function returns null here; the mutated stand-in does not —
    // this assertion is what "goes red by name" means for issueUrlSyncPath.
    expect(issueUrlSyncPath(true, '/p/limiglow/i/TOD-159', '/b/todero/p/limiglow/work/list')).toBeNull()
    expect(mutated(true, '/p/limiglow/i/TOD-159', '/b/todero/p/limiglow/work/list')).not.toBeNull()
  })
})

describe('navigateToIssuePermalink', () => {
  // No jsdom in this project (testEnvironment: "node" in jest.config.js,
  // jest-environment-jsdom not installed — verified 2026-08-26) — window is
  // stubbed by hand rather than skipped, so the push+dispatch idiom is still
  // proven, not merely read.
  it('pushes the permalink path (preserving prefix) and dispatches a popstate app/page.tsx already listens for', () => {
    const pushState = jest.fn()
    const dispatchEvent = jest.fn()
    ;(global as any).window = {
      location: { pathname: '/p/limiglow/work/board' },
      history: { pushState },
      dispatchEvent,
    }
    ;(global as any).PopStateEvent = class {
      type: string
      constructor(type: string) { this.type = type }
    }
    try {
      navigateToIssuePermalink('TOD-9')
      expect(pushState).toHaveBeenCalledWith({}, '', '/p/limiglow/i/TOD-9')
      expect(dispatchEvent).toHaveBeenCalledTimes(1)
      expect(dispatchEvent.mock.calls[0][0].type).toBe('popstate')
    } finally {
      delete (global as any).window
      delete (global as any).PopStateEvent
    }
  })
})

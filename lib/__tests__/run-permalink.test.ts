// lib/__tests__/run-permalink.test.ts — runs-need-urls piece.
//
// Every case below pins a specific regression this piece either found or
// created the possibility of. None of them restate the implementation:
//
//   - the round-trip cases exist because a list that BUILDS one shape and a
//     page that PARSES another is invisible until a human clicks a run and
//     reloads;
//   - the `runMountPath` / `runUrlSyncPath` cases exist because that is
//     literally the bug that made this piece necessary — app/page.tsx's
//     replaceState erasing `/runs/r/<id>` from the address bar milliseconds
//     after load;
//   - the collision case exists because the whole path shape depends on `r`
//     never becoming a view id of Runs, which is a fact about
//     components/nav/config.ts that a future editor cannot be expected to
//     remember.

import { DEFAULT_VIEW, DESTINATIONS, LEGACY_TAB_MAP, type DestinationId } from '@/components/nav/config'
import {
  RUN_BACKDROP_VIEW,
  RUN_DESTINATION,
  RUN_ID_PATTERN,
  RUN_SEGMENT,
  closeRunPermalink,
  isProjectlessRunsReferer,
  navigateToRunPermalink,
  normalizeRunId,
  parseRunIdFromPath,
  rawRunSegment,
  runBackdropPath,
  runMountPath,
  runPermalinkPath,
  runUrlSyncPath,
} from '../run-permalink'

const ID = '3f2a1b0c-4d5e-4f60-8a91-b2c3d4e5f607'
const UPPER = ID.toUpperCase()

describe('normalizeRunId', () => {
  it('accepts a uuid, trims it, and lower-cases it', () => {
    expect(normalizeRunId(ID)).toBe(ID)
    expect(normalizeRunId(`  ${UPPER}  `)).toBe(ID)
  })

  it.each(['', 'not-an-id', ID.slice(0, 35), `${ID}0`, 'g'.repeat(36)])(
    'rejects %s',
    raw => {
      expect(normalizeRunId(raw)).toBeNull()
    },
  )

  // Guards the claim made in lib/run-permalink.ts and in
  // app/api/agent-runs/[id]/route.ts's PATCH comment: this pattern is
  // BYTE-IDENTICAL to the validator PATCH has always enforced. If someone
  // tightens or loosens it, the two stop agreeing and a permalink can name an
  // id the API refuses (or vice versa).
  it('is the exact pattern the PATCH route has always enforced', () => {
    expect(RUN_ID_PATTERN.source).toBe('^[0-9a-f-]{36}$')
  })
})

describe('rawRunSegment / parseRunIdFromPath', () => {
  it('reads …/runs/r/<id> with no prefix', () => {
    expect(parseRunIdFromPath(`/runs/r/${ID}`)).toBe(ID)
  })

  it('reads …/runs/r/<id> preceded by /p/<slug>', () => {
    expect(parseRunIdFromPath(`/p/limiglow/runs/r/${ID}`)).toBe(ID)
  })

  it('reads …/runs/r/<id> preceded by /b/<biz>/p/<slug>', () => {
    expect(parseRunIdFromPath(`/b/todero/p/limiglow/runs/r/${ID}`)).toBe(ID)
  })

  it('accepts an upper-cased id in the URL and normalises it', () => {
    expect(parseRunIdFromPath(`/p/limiglow/runs/r/${UPPER}`)).toBe(ID)
  })

  it('is null for the Runs list itself, and for every other destination', () => {
    expect(parseRunIdFromPath('/p/limiglow/runs')).toBeNull()
    expect(parseRunIdFromPath('/p/limiglow/runs/all')).toBeNull()
    expect(parseRunIdFromPath('/p/limiglow/work/board')).toBeNull()
    expect(parseRunIdFromPath('/')).toBeNull()
  })

  // The `/i/<key>` shape must not be mistaken for a run, and vice versa —
  // both are `<letter>/<value>` pairs peeled after the same prefix.
  it('does not read an issue permalink as a run', () => {
    expect(rawRunSegment('/p/limiglow/i/TOD-9')).toBeNull()
    expect(parseRunIdFromPath('/p/limiglow/i/TOD-9')).toBeNull()
  })

  // TOD-2467's lesson, applied to runs: a malformed id must still register as
  // "a run WAS requested", or the operator's typo'd link is indistinguishable
  // from an ordinary page load.
  it('rawRunSegment reports a malformed id that parseRunIdFromPath rejects', () => {
    expect(rawRunSegment('/p/limiglow/runs/r/nope')).toBe('nope')
    expect(parseRunIdFromPath('/p/limiglow/runs/r/nope')).toBeNull()
  })

  it('is null when the marker segment is present but the id is missing', () => {
    expect(rawRunSegment('/p/limiglow/runs/r')).toBeNull()
    expect(rawRunSegment('/p/limiglow/runs/r/')).toBeNull()
  })
})

describe('runPermalinkPath', () => {
  it('preserves a /b/<biz>/p/<slug> prefix', () => {
    expect(runPermalinkPath('/b/todero/p/limiglow/runs', ID))
      .toBe(`/b/todero/p/limiglow/runs/r/${ID}`)
  })

  it('preserves a bare /p/<slug> prefix', () => {
    expect(runPermalinkPath('/p/limiglow/work/board', ID)).toBe(`/p/limiglow/runs/r/${ID}`)
  })

  it('builds an unprefixed path from the root', () => {
    expect(runPermalinkPath('/', ID)).toBe(`/runs/r/${ID}`)
  })

  // Without this, clicking run B while run A is open would produce
  // `/p/x/runs/r/A/runs/r/B` — a path that parses back to A.
  it('is idempotent: replaces the id rather than nesting a second one', () => {
    const first = runPermalinkPath('/p/limiglow/runs', ID)
    const second = runPermalinkPath(first, '11111111-2222-4333-8444-555555555555')
    expect(second).toBe('/p/limiglow/runs/r/11111111-2222-4333-8444-555555555555')
    expect(parseRunIdFromPath(second)).toBe('11111111-2222-4333-8444-555555555555')
  })

  it('round-trips: what it builds is what parseRunIdFromPath reads back', () => {
    for (const base of ['/', '/p/limiglow/runs', '/b/todero/p/limiglow/work/list']) {
      expect(parseRunIdFromPath(runPermalinkPath(base, ID))).toBe(ID)
    }
  })
})

describe('runBackdropPath', () => {
  it('lands on the Runs list under the same prefix', () => {
    expect(runBackdropPath(`/b/todero/p/limiglow/runs/r/${ID}`)).toBe('/b/todero/p/limiglow/runs')
    expect(runBackdropPath(`/p/limiglow/runs/r/${ID}`)).toBe('/p/limiglow/runs')
    expect(runBackdropPath(`/runs/r/${ID}`)).toBe('/runs')
  })

  // The backdrop must be a URL that reloads onto the view it names. Today
  // `all` IS DEFAULT_VIEW.runs so it collapses; if that ever stops being
  // true, this asserts the segment reappears rather than the path silently
  // reloading onto a different view.
  it('collapses the view segment only while it is the destination default', () => {
    const collapsed = RUN_BACKDROP_VIEW === DEFAULT_VIEW[RUN_DESTINATION]
    expect(runBackdropPath('/p/limiglow/runs').endsWith('/runs')).toBe(collapsed)
  })
})

describe('runMountPath', () => {
  // THE bug this piece exists to fix. Measured 2026-08-26: app/page.tsx's
  // mount effect canonicalises to buildPath(...), which for a run permalink is
  // `/p/limiglow/runs` — erasing the id before the operator can reload.
  it('re-attaches the run segment to a canonical path', () => {
    expect(runMountPath(ID, '/p/limiglow/runs')).toBe(`/p/limiglow/runs/r/${ID}`)
  })

  it('does better than suppression: a cold-loaded run GAINS the resolved scope', () => {
    // `/runs/r/<id>` loaded with no project, canonicalised once scope
    // derivation resolves Limiglow under business Todero.
    expect(runMountPath(ID, '/b/todero/p/limiglow/runs'))
      .toBe(`/b/todero/p/limiglow/runs/r/${ID}`)
  })

  it('leaves a non-run path exactly as computed', () => {
    expect(runMountPath(null, '/p/limiglow/work/list')).toBe('/p/limiglow/work/list')
    expect(runMountPath(null, '/')).toBe('/')
  })

  // A malformed segment must survive canonicalisation too — otherwise the
  // address bar is rewritten and the evidence a run was requested is gone.
  it('preserves a malformed segment rather than dropping it', () => {
    expect(runMountPath('nope', '/p/limiglow/runs')).toBe('/p/limiglow/runs/r/nope')
  })
})

describe('runUrlSyncPath', () => {
  it('writes nothing when the issue rule already said not to', () => {
    expect(runUrlSyncPath(ID, null)).toBeNull()
    expect(runUrlSyncPath(null, null)).toBeNull()
  })

  it('passes an approved path straight through when no run is open', () => {
    expect(runUrlSyncPath(null, '/p/limiglow/work/list')).toBe('/p/limiglow/work/list')
  })

  // The mutation TOD-2467's critic applied to app/page.tsx — forcing the
  // "sync anyway" branch while a permalink is open — turns THIS red, by name.
  it('keeps the run in the path it writes, so a scope sync cannot erase the permalink', () => {
    const written = runUrlSyncPath(ID, '/b/todero/p/limiglow/runs')
    expect(written).toBe(`/b/todero/p/limiglow/runs/r/${ID}`)
    expect(parseRunIdFromPath(written!)).toBe(ID)
  })
})

describe('the segment cannot collide with the router', () => {
  // The whole path shape depends on `r` never becoming a view id of Runs —
  // app/page.tsx's parseURL would then resolve `runs/r` as a VIEW and the id
  // would be dropped. That is a fact about components/nav/config.ts, asserted
  // here rather than remembered.
  it('RUN_SEGMENT is not a view id of the runs destination', () => {
    const runs = DESTINATIONS.find(d => d.id === RUN_DESTINATION)
    expect(runs).toBeDefined()
    expect(runs!.views.map(v => v.id)).not.toContain(RUN_SEGMENT)
  })

  it('RUN_SEGMENT is not a destination id', () => {
    expect(DESTINATIONS.map(d => d.id as string)).not.toContain(RUN_SEGMENT)
  })

  it('RUN_SEGMENT is not a legacy tab id', () => {
    expect(Object.keys(LEGACY_TAB_MAP)).not.toContain(RUN_SEGMENT)
  })

  // The permalink is deliberately a SUB-PATH of `runs` so middleware.ts's
  // existing cross-project exemption (`rest[0] === 'runs'`) covers it
  // unchanged. If the first segment ever stopped being the destination id,
  // that exemption would silently stop applying and the drill-down would
  // become narrower than the list it drills out of.
  it('the first segment after the prefix is the runs destination itself', () => {
    const built = runPermalinkPath('/p/limiglow/work/board', ID)
    expect(built.split('/').filter(Boolean)[2]).toBe(RUN_DESTINATION)
    const dest: DestinationId = RUN_DESTINATION
    expect(dest).toBe('runs')
  })
})

describe('navigateToRunPermalink / closeRunPermalink', () => {
  // No jsdom in this project (testEnvironment: "node" in jest.config.js,
  // jest-environment-jsdom not installed — verified 2026-08-26,
  // `ls node_modules/jest-environment-jsdom` -> not present). `window` is
  // stubbed by hand rather than the case being skipped, so the push+dispatch
  // idiom is proven rather than merely read — same approach
  // lib/__tests__/issue-permalink.test.ts already takes.
  function withWindow(pathname: string, run: (pushState: jest.Mock, dispatchEvent: jest.Mock) => void) {
    const pushState = jest.fn()
    const dispatchEvent = jest.fn()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- deliberate global stub, see above
    const g = global as any
    g.window = { location: { pathname }, history: { pushState }, dispatchEvent }
    g.PopStateEvent = class {
      type: string
      constructor(type: string) { this.type = type }
    }
    try {
      run(pushState, dispatchEvent)
    } finally {
      delete g.window
      delete g.PopStateEvent
    }
  }

  it('pushes the permalink and dispatches a popstate the router already listens for', () => {
    withWindow('/p/limiglow/runs', (pushState, dispatchEvent) => {
      navigateToRunPermalink(ID)
      expect(pushState).toHaveBeenCalledWith({}, '', `/p/limiglow/runs/r/${ID}`)
      expect(dispatchEvent).toHaveBeenCalledTimes(1)
      expect(dispatchEvent.mock.calls[0][0].type).toBe('popstate')
    })
  })

  it('preserves a /b/<biz>/p/<slug> prefix when navigating from another destination', () => {
    withWindow('/b/todero/p/limiglow/work/board', pushState => {
      navigateToRunPermalink(ID)
      expect(pushState).toHaveBeenCalledWith({}, '', `/b/todero/p/limiglow/runs/r/${ID}`)
    })
  })

  it('does not push a duplicate history entry for the run already open', () => {
    withWindow(`/p/limiglow/runs/r/${ID}`, (pushState, dispatchEvent) => {
      navigateToRunPermalink(ID)
      expect(pushState).not.toHaveBeenCalled()
      expect(dispatchEvent).not.toHaveBeenCalled()
    })
  })

  it('closing navigates to the backdrop list, as a real URL', () => {
    withWindow(`/p/limiglow/runs/r/${ID}`, (pushState, dispatchEvent) => {
      closeRunPermalink()
      expect(pushState).toHaveBeenCalledWith({}, '', '/p/limiglow/runs')
      expect(dispatchEvent).toHaveBeenCalledTimes(1)
    })
  })

  it('closing from the list is a no-op', () => {
    withWindow('/p/limiglow/runs', pushState => {
      closeRunPermalink()
      expect(pushState).not.toHaveBeenCalled()
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// isProjectlessRunsReferer — the compensating derivation for middleware's
// project-less blind spot.
//
// Measured live 2026-08-26 against the running dev server, with a valid
// session cookie, before this function existed:
//
//   referer /p/limiglow/runs/r/<id>  -> 200
//   referer /runs/r/<id>             -> 400 unscoped_run_read
//   referer /runs/all                -> 400 unscoped_run_read
//   referer /b/todero/runs/all       -> 400 unscoped_run_read
//
// The un-prefixed Runs screen — the one a run permalink is reached from — was
// refused by the endpoint built for it. The rejection cases below are not
// padding: they are the boundary of the widening, and the reason it is
// reviewable at all.
const ORIGIN = 'http://localhost:3000'

describe('isProjectlessRunsReferer', () => {
  it('fires for the un-prefixed Runs screen', () => {
    expect(isProjectlessRunsReferer(`${ORIGIN}/runs`, ORIGIN)).toBe(true)
    expect(isProjectlessRunsReferer(`${ORIGIN}/runs/all`, ORIGIN)).toBe(true)
    expect(isProjectlessRunsReferer(`${ORIGIN}/runs/r/${ID}`, ORIGIN)).toBe(true)
  })

  it('fires under a /b/<biz> prefix, which carries no project', () => {
    expect(isProjectlessRunsReferer(`${ORIGIN}/b/todero/runs/all`, ORIGIN)).toBe(true)
  })

  it('does NOT fire when a project is already in the path — middleware owns that', () => {
    expect(isProjectlessRunsReferer(`${ORIGIN}/p/limiglow/runs/all`, ORIGIN)).toBe(false)
    expect(isProjectlessRunsReferer(`${ORIGIN}/b/todero/p/limiglow/runs/r/${ID}`, ORIGIN)).toBe(false)
  })

  // A path that TRIED to name a project and failed is ambiguous, and ambiguity
  // stays a 400. This is the one case where being lenient would actually widen
  // something middleware deliberately refuses.
  it('does NOT fire for a malformed or empty project segment', () => {
    expect(isProjectlessRunsReferer(`${ORIGIN}/p/Not_A_Slug/runs/all`, ORIGIN)).toBe(false)
    expect(isProjectlessRunsReferer(`${ORIGIN}/p`, ORIGIN)).toBe(false)
  })

  it('does NOT fire for any destination other than runs', () => {
    for (const p of ['/work/list', '/now/overview', '/fleet/roster', '/settings/projects', '/']) {
      expect(isProjectlessRunsReferer(`${ORIGIN}${p}`, ORIGIN)).toBe(false)
    }
  })

  it('does NOT fire cross-origin, matching middleware’s own origin check', () => {
    expect(isProjectlessRunsReferer('https://evil.example/runs/all', ORIGIN)).toBe(false)
    expect(isProjectlessRunsReferer(`http://localhost:3001/runs/all`, ORIGIN)).toBe(false)
  })

  it('does NOT fire for a missing or unparseable referer', () => {
    expect(isProjectlessRunsReferer(null, ORIGIN)).toBe(false)
    expect(isProjectlessRunsReferer('', ORIGIN)).toBe(false)
    expect(isProjectlessRunsReferer('not a url', ORIGIN)).toBe(false)
  })

  // `runs` is not spelled here twice by accident: the destination this fires on
  // and the destination the permalink is built under have to be the same one,
  // or the endpoint would accept a referer for a screen that cannot produce it.
  it('fires on exactly the destination the permalink is built under', () => {
    expect(isProjectlessRunsReferer(`${ORIGIN}/${RUN_DESTINATION}/all`, ORIGIN)).toBe(true)
  })
})

// The `/p/<slug>` case is covered above by behaviour rather than by an early
// return, and that is deliberate — see the comment in the function. This is
// the assertion that pins the mechanism, so removing the `/b/<biz>` peel or
// widening the destination check cannot quietly re-open it.
describe('isProjectlessRunsReferer — the mechanism, not just the result', () => {
  it('leaves a project segment sitting where the destination check will reject it', () => {
    expect(isProjectlessRunsReferer(`${ORIGIN}/p/limiglow/runs/r/${ID}`, ORIGIN)).toBe(false)
    expect(isProjectlessRunsReferer(`${ORIGIN}/b/todero/p/limiglow/runs`, ORIGIN)).toBe(false)
    // …while the same path with the project removed does fire.
    expect(isProjectlessRunsReferer(`${ORIGIN}/b/todero/runs`, ORIGIN)).toBe(true)
  })
})

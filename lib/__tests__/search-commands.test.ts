/**
 * search-and-jump piece (Wave 6).
 *
 * Every case here is written to FAIL on a specific regression, not merely to
 * pass today. The regression each one guards is named above it, because this
 * codebase has twice shipped a guard that asserted something no realistic
 * mistake could violate.
 */

import {
  COMMANDS,
  COMMAND_SOURCE,
  buildCommands,
  matchCommands,
  navPlanFor,
  normalizeTaskKey,
  parseSearchInput,
  pathForView,
  projectFromPath,
  resolveNavToken,
  sanitizeIlikePattern,
  issueSearchQuery,
  scoreCommand,
} from '../search-commands'
import {
  DESTINATIONS,
  DEFAULT_VIEW,
  LEGACY_TAB_MAP,
  viewsOf,
  type DestinationId,
} from '@/components/nav/config'

/**
 * app/page.tsx's `buildPath()`, transcribed. `pathForView` must agree with it
 * for every command, or the one view that navigates by URL lands somewhere the
 * SPA's own URL sync will immediately rewrite.
 */
function buildPathReference(
  business: string | null,
  destination: DestinationId,
  view: string,
  projectSlug: string | null,
): string {
  const defaultView = DEFAULT_VIEW[destination]
  const destSegs = view !== defaultView ? [destination, view] : [destination]
  const projSegs = projectSlug ? ['p', projectSlug] : []
  const segs = [...projSegs, ...destSegs]
  if (business) return `/b/${business}/${segs.join('/')}`
  if (!projectSlug && destination === 'now' && view === 'overview') return '/'
  return `/${segs.join('/')}`
}

describe('command coverage — derived from config, never copied', () => {
  // Catches: a destination or view added to components/nav/config.ts that the
  // palette silently does not offer. That is exactly the drift a second,
  // hardcoded list produces, and it is invisible on screen.
  it('has exactly one command per view in DESTINATIONS', () => {
    const expected = DESTINATIONS.flatMap(d => d.views.map(v => `${d.id}/${v.id}`)).sort()
    expect(COMMANDS.map(c => c.key).sort()).toEqual(expected)
  })

  it('offers all six destinations as their own row', () => {
    const destRows = COMMANDS.filter(c => c.isDestinationRow)
    expect(destRows.map(c => c.destination)).toEqual(DESTINATIONS.map(d => d.id))
    for (const row of destRows) {
      expect(row.view).toBe(DEFAULT_VIEW[row.destination])
      expect(row.label).toBe(DESTINATIONS.find(d => d.id === row.destination)!.label)
    }
  })

  it('takes every label and question straight from config', () => {
    for (const c of COMMANDS) {
      const dest = DESTINATIONS.find(d => d.id === c.destination)!
      expect(c.question).toBe(dest.question)
      const view = dest.views.find(v => v.id === c.view)!
      expect(c.label).toBe(c.isDestinationRow ? dest.label : `${dest.label} → ${view.label}`)
    }
  })

  it('states real counts in its provenance line', () => {
    const views = DESTINATIONS.reduce((n, d) => n + d.views.length, 0)
    expect(COMMAND_SOURCE).toBe(
      `components/nav/config.ts — ${DESTINATIONS.length} destinations, ${views} views`,
    )
    expect(COMMANDS).toHaveLength(views)
  })

  it('rebuilds identically — nothing is captured from mutable state', () => {
    expect(buildCommands().map(c => c.key)).toEqual(COMMANDS.map(c => c.key))
  })
})

describe('activation reaches the surface the row names', () => {
  // Catches: a view renamed in config while LEGACY_TAB_MAP still names the old
  // segment. resolveNavToken then returns the destination's DEFAULT view —
  // which on screen looks exactly like the jump worked, while showing the
  // wrong surface. navPlanFor must detect that and fall back to the URL.
  it('every command round-trips to its own (destination, view)', () => {
    for (const c of COMMANDS) {
      if (c.nav.kind === 'token') {
        expect(resolveNavToken(c.nav.token)).toEqual([c.destination, c.view])
      } else {
        expect(c.nav.destination).toBe(c.destination)
        expect(c.nav.view).toBe(c.view)
      }
    }
  })

  it('resolveNavToken reproduces goTo’s fallback for a stale mapping', () => {
    // Every LEGACY_TAB_MAP entry must name a view that still exists, or
    // app/page.tsx quietly redirects it to the default. Assert the model does
    // the same thing the app does, and that no entry is currently stale.
    for (const [token, [dest, view]] of Object.entries(LEGACY_TAB_MAP)) {
      const resolved = resolveNavToken(token)!
      expect(resolved[0]).toBe(dest)
      expect(resolved[1]).toBe(viewsOf(dest).includes(view) ? view : DEFAULT_VIEW[dest])
      // If this fails, a legacy id points at a view that no longer exists.
      expect(viewsOf(dest)).toContain(resolved[1])
    }
  })

  it('falls back to a path plan when no token can name the pair', () => {
    // now/signal has no LEGACY_TAB_MAP entry and is not a default view, so no
    // onNavigate(string) token can express it. If this ever becomes a token
    // plan it means someone added the mapping — fine — but until then the
    // fallback is the only thing making that view keyboard-reachable.
    const signal = COMMANDS.find(c => c.key === 'now/signal')!
    expect(signal.nav.kind).toBe('path')
  })

  it('a fabricated token does not resolve', () => {
    expect(resolveNavToken('not-a-destination')).toBeNull()
    expect(navPlanFor('work', 'no-such-view')).toEqual({
      kind: 'path',
      destination: 'work',
      view: 'no-such-view',
    })
  })
})

describe('matching — TOD-2416 sprint→bolt is the named drift case', () => {
  const first = (q: string) => matchCommands(q)[0]

  it('finds every destination and every view by its own id and label', () => {
    for (const c of COMMANDS) {
      expect(matchCommands(c.view).map(x => x.key)).toContain(c.key)
      expect(matchCommands(c.label).map(x => x.key)).toContain(c.key)
    }
  })

  it('typing the current name finds the Bolt board', () => {
    expect(first('bolt').key).toBe('work/bolt')
  })

  it('typing the pre-rename name still finds it, under its NEW label', () => {
    const hit = first('sprint')
    expect(hit.key).toBe('work/bolt')
    // The palette must never teach a name that no longer exists.
    expect(hit.label).not.toMatch(/sprint/i)
    expect(hit.label).toBe('Work → Bolt board')
  })

  it('typing a destination id finds that destination first', () => {
    for (const d of DESTINATIONS) {
      expect(first(d.id).destination).toBe(d.id)
      expect(first(d.id).isDestinationRow).toBe(true)
    }
  })

  it('an empty query returns every command, so arrows alone reach all six', () => {
    const all = matchCommands('')
    expect(all).toHaveLength(COMMANDS.length)
    expect(new Set(all.filter(c => c.isDestinationRow).map(c => c.destination)).size).toBe(
      DESTINATIONS.length,
    )
  })

  it('a query that matches nothing returns nothing (not everything)', () => {
    expect(matchCommands('zzzzqqq')).toEqual([])
    expect(scoreCommand('zzzzqqq', COMMANDS[0])).toBe(0)
  })

  it('an exact id outranks a mere substring', () => {
    const memory = COMMANDS.find(c => c.key === 'memory/memory')!
    const other = COMMANDS.find(c => c.question.toLowerCase().includes('learned') && c !== memory)
    expect(scoreCommand('memory', memory)).toBeGreaterThan(scoreCommand('mem', memory))
    if (other) expect(scoreCommand('memory', memory)).toBeGreaterThan(scoreCommand('memory', other))
  })
})

describe('pathForView reproduces app/page.tsx buildPath', () => {
  // Catches: the URL shape drifting from app/page.tsx, which would strand the
  // one path-plan view (now/signal) or drop the /p/<slug> scope segment — and
  // dropping that segment silently un-scopes every request the page then makes.
  const cases: Array<[string, string | null, string | null]> = [
    ['/b/todero/p/limiglow/work/board', 'todero', 'limiglow'],
    ['/p/limiglow/now', null, 'limiglow'],
    ['/now', null, null],
    ['/', null, null],
  ]

  it.each(cases)('from %s', (current, biz, proj) => {
    for (const c of COMMANDS) {
      expect(pathForView(current, c.destination, c.view)).toBe(
        buildPathReference(biz, c.destination, c.view, proj),
      )
    }
  })

  it('keeps the project segment, which is what the server scopes by', () => {
    expect(pathForView('/b/todero/p/limiglow/fleet/team', 'now', 'signal')).toBe(
      '/b/todero/p/limiglow/now/signal',
    )
  })
})

describe('normalizeTaskKey', () => {
  // Catches both failure directions: too loose fires a ?task_key= request on
  // ordinary words; too strict never fires the identifier jump at all.
  it.each(['TOD-1', 'tod-1', ' TOD-1 ', 'TOD - 1', 'ABC123-4567'])('accepts %s', q => {
    expect(normalizeTaskKey(q)).toMatch(/^[A-Z0-9]+-\d+$/)
  })

  it('upper-cases the prefix and keeps the number', () => {
    expect(normalizeTaskKey('tod-1')).toBe('TOD-1')
    expect(normalizeTaskKey(' TOD-42 ')).toBe('TOD-42')
  })

  it.each(['TOD', '-1', 'TOD-', 'TOD-1x', 'TOD 1', 'fix the TOD-1 bug', '1-TOD', ''])(
    'rejects %s',
    q => {
      expect(normalizeTaskKey(q)).toBeNull()
    },
  )
})

describe('the issues text query', () => {
  // Catches: a structural PostgREST character reaching the or=() filter, where
  // it changes the filter's SHAPE rather than the value inside it — a
  // comma silently turns one filter into two.
  it.each([',', '(', ')', '%', '*'])('strips the structural character %s', ch => {
    expect(sanitizeIlikePattern(`a${ch}b`)).toBe('ab')
  })

  it('keeps ordinary text intact', () => {
    expect(sanitizeIlikePattern('  scope guard  ')).toBe('scope guard')
  })

  it('never emits a raw comma or paren inside the or() filter', () => {
    const q = issueSearchQuery('a,b)c(d%e*f')
    const inner = q.slice(q.indexOf('or=(') + 4, q.indexOf(')&'))
    const clauses = inner.split(',')
    expect(clauses).toHaveLength(2) // exactly the two ilike clauses, not five
    for (const clause of clauses) {
      // Nothing structural survives un-encoded...
      expect(clause).not.toMatch(/[()*]/)
      // ...and the only `%` present is the wildcard this module added itself,
      // percent-encoded, wrapping a value with every structural char removed.
      const value = decodeURIComponent(clause.split('.').slice(2).join('.'))
      expect(value).toBe('%abcdef%')
    }
  })

  it('carries no project or archived clause — the server injects both', () => {
    const q = issueSearchQuery('x')
    expect(q).not.toMatch(/project=/)
    expect(q).not.toMatch(/archived_at=/)
    expect(q).not.toMatch(/all_projects/)
  })

  // Measured 2026-08-26 against the running server (Limiglow `ops` fixture
  // TOD-155): this exact shape, sent through app/api/db/[...path]/route.ts
  // with a Limiglow Referer, returned precisely that one row.
  it('adds a structured filter per SearchFilters field, and omits an empty one', () => {
    const q = issueSearchQuery('permalink', { status: 'backlog', assignee: 'po', beforeDate: '2026-08-27' })
    expect(q).toMatch(/status=eq\.backlog/)
    expect(q).toMatch(/assignee=eq\.po/)
    expect(q).toMatch(/created_at=lt\.2026-08-27/)
    expect(q).toMatch(/or=\(/)
  })

  it('omits the or() clause entirely when filters alone are narrowing', () => {
    // A `%%` ilike would silently match every row — this asserts no such
    // clause is emitted rather than trusting it to be harmless.
    const q = issueSearchQuery('', { status: 'closed' })
    expect(q).not.toMatch(/or=\(/)
    expect(q).toMatch(/status=eq\.closed/)
  })
})

describe('parseSearchInput — search modifiers', () => {
  const STATUSES = ['backlog', 'open', 'closed']

  it('parses in:/from:/before: into structured filters and leaves free text alone', () => {
    const r = parseSearchInput('foo in:backlog from:ops before:2026-08-01 bar', STATUSES)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.filters).toEqual({ status: 'backlog', assignee: 'ops', beforeDate: '2026-08-01' })
    expect(r.text).toBe('foo bar')
  })

  it('lower-cases in: values so "in:Backlog" still matches the status', () => {
    const r = parseSearchInput('in:Backlog', STATUSES)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.filters.status).toBe('backlog')
  })

  // Catches: a filter that quietly does nothing instead of saying so — the
  // fabrication class this rebuild keeps paying for (see the piece doc).
  it('refuses an unsupported modifier rather than treating it as free text', () => {
    const r = parseSearchInput('to:someone', STATUSES)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/"to:" is not a modifier/)
  })

  it('refuses a status in: does not have, and names the valid ones', () => {
    const r = parseSearchInput('in:nonsense', STATUSES)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/backlog, open, closed/)
  })

  it('refuses a before: value that is not a plain date', () => {
    const r = parseSearchInput('before:yesterday', STATUSES)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).toMatch(/before:2026-08-01/)
  })

  // Regression 2026-08-26: DATE_MODIFIER's old shape-only regex (four
  // digits, dash, two digits, dash, two digits) let a calendar-impossible
  // value through validation, reach a live query, and render results under
  // "ISSUES MATCHING THIS FILTER" as though the filter had been honoured.
  it.each(['9999-99-99', '2026-13-45', '2026-02-30', '2023-02-29'])(
    'refuses a shape-valid but calendar-impossible before: value — %s',
    v => {
      const r = parseSearchInput(`before:${v}`, STATUSES)
      expect(r.ok).toBe(false)
      if (!r.ok) expect(r.message).toMatch(new RegExp(`before:${v}`))
    },
  )

  it('accepts a real leap-day date (2024 is a leap year)', () => {
    const r = parseSearchInput('before:2024-02-29', STATUSES)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.filters.beforeDate).toBe('2024-02-29')
  })

  // Regression 2026-08-26: `from:` stored the raw-cased value, so
  // `from:Po` 0-matched a real assignee (`po`) — a case mismatch reading
  // identically to "this person has no issues", indistinguishable to the
  // operator from the truth.
  it('lower-cases from: values so "from:Po" still narrows to assignee po', () => {
    const r = parseSearchInput('from:Po', STATUSES)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.filters.assignee).toBe('po')
  })

  it('refuses a modifier with no value after the colon', () => {
    const r = parseSearchInput('in:', STATUSES)
    expect(r.ok).toBe(false)
  })

  it('an empty query is a valid, empty result — not a refusal', () => {
    const r = parseSearchInput('', STATUSES)
    expect(r.ok).toBe(true)
    if (r.ok) { expect(r.filters).toEqual({}); expect(r.text).toBe('') }
  })
})

describe('projectFromPath', () => {
  // Catches: the palette naming a different project than the one the server
  // actually scoped by — which would make the "not found in <project>" line
  // in the scope-boundary case say something untrue.
  it('reads /p/<slug> with and without a business prefix', () => {
    expect(projectFromPath('/b/todero/p/limiglow/work/board')).toBe('Limiglow')
    expect(projectFromPath('/p/limiglow/now')).toBe('Limiglow')
    expect(projectFromPath('/p/two-words/now')).toBe('Two Words')
  })

  it('is null when no project segment is present', () => {
    expect(projectFromPath('/')).toBeNull()
    expect(projectFromPath('/work/board')).toBeNull()
    expect(projectFromPath('/b/todero/work/board')).toBeNull()
    expect(projectFromPath('/p/Not_A_Slug/now')).toBeNull()
  })
})

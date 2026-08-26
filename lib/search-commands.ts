// lib/search-commands.ts — search-and-jump piece (Wave 6)
//
// Every non-React decision the command palette makes lives here so it can be
// unit-tested without a DOM: what commands exist, how a typed string scores
// against them, how an activated command reaches the surface it names, and
// what a task key looks like.
//
// THE ONE RULE THIS FILE EXISTS TO KEEP: the list of destinations and views is
// DERIVED from components/nav/config.ts, never copied. This codebase has
// shipped stale duplicate lists more than once, and it just renamed `sprint`
// to `bolt` (TOD-2416) — a hardcoded copy would already be wrong. There is no
// string literal in this file naming a destination or a view; every label, id,
// question and alias below is read out of that config at module load.

import {
  DESTINATIONS,
  DEFAULT_VIEW,
  LEGACY_TAB_MAP,
  isDestinationId,
  viewsOf,
  type DestinationId,
} from '@/components/nav/config'

// ─── how an activated command reaches its surface ────────────────────────────
//
// app/page.tsx hands SearchOverlay exactly one navigation prop:
// `onNavigate(tab: string)`. That function resolves a string through
// LEGACY_TAB_MAP, then through isDestinationId, and nothing else — so it can
// express "a destination" and "any view an old flat tab id happened to name",
// but it cannot express an arbitrary (destination, view) pair. `now/signal` is
// a real view with no legacy id, and app/page.tsx is owned by another agent
// this round, so widening the prop is not available.
//
// Rather than drop that view (a destination the keyboard cannot reach is the
// whole defect this piece exists to fix) or invent a fake token, a command
// carries a PLAN: a token when one provably resolves to the right pair, and
// otherwise the canonical URL, pushed with history.pushState + a `popstate`
// dispatch — which app/page.tsx's own back/forward listener already handles.

export type NavPlan =
  /** Pass this string to `onNavigate` — app/page.tsx resolves it. */
  | { kind: 'token'; token: string }
  /** No token can name this pair; push the URL and let popstate re-parse it. */
  | { kind: 'path'; destination: DestinationId; view: string }

export interface PaletteCommand {
  /** Stable id, used for the row's DOM id and React key. */
  key: string
  destination: DestinationId
  view: string
  /** True when this row IS the destination (its default view), not a sub-view. */
  isDestinationRow: boolean
  /** "Fleet", or "Work → Bolt board" — both halves come from config. */
  label: string
  /** The destination's own `question` from config, shown as the row's hint. */
  question: string
  /**
   * Older names for the same surface, taken from LEGACY_TAB_MAP. Typing
   * `sprint` still finds the Bolt board — but the row renders its CURRENT
   * label, so the palette never teaches a name that no longer exists.
   */
  aliases: string[]
  nav: NavPlan
}

/**
 * Model of `app/page.tsx`'s `navigate()` + `goTo()` resolution, kept here so
 * `navPlanFor` can CHECK a token instead of assuming it, and so a test can
 * assert the round trip. `goTo`'s fallback is reproduced exactly: a mapped
 * view that no longer exists in `viewsOf(dest)` silently becomes the
 * destination's default view — which on screen looks like the jump worked
 * while showing the wrong surface.
 */
export function resolveNavToken(token: string): [DestinationId, string] | null {
  const legacy = LEGACY_TAB_MAP[token]
  if (legacy) {
    const [d, v] = legacy
    return [d, viewsOf(d).includes(v) ? v : DEFAULT_VIEW[d]]
  }
  if (isDestinationId(token)) return [token, DEFAULT_VIEW[token]]
  return null
}

/** Every LEGACY_TAB_MAP key that resolves to this exact pair. */
function tokensFor(destination: DestinationId, view: string): string[] {
  const out: string[] = []
  if (view === DEFAULT_VIEW[destination]) out.push(destination)
  for (const token of Object.keys(LEGACY_TAB_MAP)) {
    if (token === destination) continue
    const resolved = resolveNavToken(token)
    if (resolved && resolved[0] === destination && resolved[1] === view) out.push(token)
  }
  return out
}

/**
 * The plan for one pair. A token is used ONLY if it demonstrably round-trips
 * back to the same pair through `resolveNavToken`; otherwise the URL plan is
 * used. That check is what makes this drift-proof: rename a view in config
 * and leave LEGACY_TAB_MAP stale, and the token stops round-tripping, so the
 * palette falls back to the path rather than quietly landing on the Board.
 */
export function navPlanFor(destination: DestinationId, view: string): NavPlan {
  for (const token of tokensFor(destination, view)) {
    const resolved = resolveNavToken(token)
    if (resolved && resolved[0] === destination && resolved[1] === view) {
      return { kind: 'token', token }
    }
  }
  return { kind: 'path', destination, view }
}

/**
 * One command per destination (its default view) plus one per non-default
 * view. The destination row and its default view are the same surface, so
 * they are not listed twice.
 */
export function buildCommands(): PaletteCommand[] {
  const out: PaletteCommand[] = []
  for (const dest of DESTINATIONS) {
    const def = DEFAULT_VIEW[dest.id]
    const one = (view: { id: string; label: string }): PaletteCommand => {
      const isDestinationRow = view.id === def
      return {
        key: `${dest.id}/${view.id}`,
        destination: dest.id,
        view: view.id,
        isDestinationRow,
        label: isDestinationRow ? dest.label : `${dest.label} → ${view.label}`,
        question: dest.question,
        // Every token that names this surface, minus the ones already covered
        // by the destination id and the view id — what is left is genuinely an
        // OLD name (e.g. `sprint`, `pipeline` for the Bolt board), which the
        // palette should still find even though it no longer displays it.
        aliases: tokensFor(dest.id, view.id).filter(t => t !== dest.id && t !== view.id),
        nav: navPlanFor(dest.id, view.id),
      }
    }
    // Destination row first within its own destination — the six destinations
    // are the headline answer to "jump somewhere".
    const rows = dest.views.map(one)
    out.push(...rows.filter(c => c.isDestinationRow), ...rows.filter(c => !c.isDestinationRow))
  }
  return out
}

/** Built once — config is a module constant, so this cannot go stale at runtime. */
export const COMMANDS: PaletteCommand[] = buildCommands()

/** Counts for the destination group's provenance line — computed, never typed. */
export const COMMAND_SOURCE = `components/nav/config.ts — ${DESTINATIONS.length} destinations, ${COMMANDS.length} views`

// ─── matching ────────────────────────────────────────────────────────────────

/** Every string a command can be found by. */
function haystack(c: PaletteCommand): string[] {
  return [c.label, c.destination, c.view, ...c.aliases, ...c.label.split(/\s*→\s*|\s+/)]
    .map(s => s.toLowerCase())
    .filter(Boolean)
}

/**
 * Score a command against a query. 0 means "no match, do not show".
 * Exact id/alias beats prefix beats substring; the destination's `question`
 * is the weakest signal, so typing "cost" finds Runs ("what did it cost?")
 * without letting a question word outrank a real name.
 */
export function scoreCommand(query: string, c: PaletteCommand): number {
  const q = query.trim().toLowerCase()
  if (!q) return 1
  const fields = haystack(c)
  if (fields.some(f => f === q)) return 100
  if (fields.some(f => f.startsWith(q))) return 60
  if (fields.some(f => f.includes(q))) return 30
  if (c.question.toLowerCase().includes(q)) return 10
  return 0
}

/**
 * Commands matching `query`, best first, config order preserved within a
 * score. An empty query returns every command, so ⌘K followed by arrow keys
 * alone reaches all six destinations.
 */
export function matchCommands(query: string, commands: PaletteCommand[] = COMMANDS): PaletteCommand[] {
  const scored = commands
    .map((c, i) => ({ c, i, s: scoreCommand(query, c) }))
    .filter(x => x.s > 0)
  scored.sort((a, b) => (b.s - a.s) || (a.i - b.i))
  return scored.map(x => x.c)
}

// ─── task keys ───────────────────────────────────────────────────────────────

/**
 * `TOD-1` / `tod-1` / ` TOD-1 ` -> `TOD-1`; anything else -> null.
 *
 * Deliberately strict. Too loose and every ordinary word fires a
 * `?task_key=` request; too strict and the identifier jump — the whole point
 * of the benchmark — never fires at all.
 */
export function normalizeTaskKey(query: string): string | null {
  const m = /^\s*([A-Za-z][A-Za-z0-9]{0,15})\s*-\s*(\d{1,9})\s*$/.exec(query)
  return m ? `${m[1].toUpperCase()}-${m[2]}` : null
}

// ─── the issues text query ───────────────────────────────────────────────────

/**
 * Strip the characters that are STRUCTURAL in PostgREST's `or=(…)` grammar.
 * A user typing `foo,bar` or `a)` would otherwise change the shape of the
 * filter rather than the value inside it — and `%`/`*` would silently widen
 * the pattern the caller did not ask to widen.
 */
export function sanitizeIlikePattern(query: string): string {
  return query.replace(/[,()%*]/g, '').trim()
}

/**
 * The query string after `issues?` for the text-search leg. The project and
 * archived clauses are deliberately ABSENT: app/api/db/[...path]/route.ts
 * injects both from the middleware-resolved scope and fails closed (400
 * `unscoped_issues_read`) when it cannot — adding them here would be a second
 * copy of a boundary that is already enforced, and a client-supplied
 * `project=` can only ever narrow, never widen.
 */
export function issueSearchQuery(query: string, limit = 8): string {
  const pattern = encodeURIComponent(`%${sanitizeIlikePattern(query)}%`)
  return (
    `issues?or=(title.ilike.${pattern},task_key.ilike.${pattern})` +
    `&order=updated_at.desc&limit=${limit}&select=task_key,title,status,type,assignee`
  )
}

// ─── scope, read off the URL the server itself scoped by ─────────────────────

const PROJECT_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * `limiglow` -> `Limiglow`. The same plain title-case codec middleware.ts and
 * app/page.tsx use; duplicated in its two-line form for the same reason
 * middleware.ts gives — app/page.tsx is a 'use client' file this piece does
 * not own, and importing from it would create the coupling neither file wants.
 */
function slugToProjectName(slug: string): string {
  return slug.split('-').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
}

/**
 * The project this page is scoped to, read from `/p/<slug>` in its own path —
 * i.e. from the SAME signal middleware.ts resolved the server-side scope
 * from, so the name in "not found in <project>" always matches the boundary
 * that actually refused. Null when the path carries no project segment.
 */
export function projectFromPath(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean)
  let rest = parts
  if (rest[0] === 'b' && rest[1]) rest = rest.slice(2)
  if (rest[0] !== 'p' || !rest[1] || !PROJECT_SLUG.test(rest[1])) return null
  return slugToProjectName(rest[1])
}

/**
 * The canonical path for a (destination, view), preserving whatever
 * `/b/<biz>` and `/p/<slug>` prefix the current path carries. Reproduces
 * `app/page.tsx`'s `buildPath()` — including its one special case, that the
 * bare default screen with no business and no project is `/`.
 */
export function pathForView(currentPath: string, destination: DestinationId, view: string): string {
  const parts = currentPath.split('/').filter(Boolean)
  const prefix: string[] = []
  let rest = parts
  if (rest[0] === 'b' && rest[1]) { prefix.push('b', rest[1]); rest = rest.slice(2) }
  if (rest[0] === 'p' && rest[1]) { prefix.push('p', rest[1]); rest = rest.slice(2) }
  const destSegs = view !== DEFAULT_VIEW[destination] ? [destination, view] : [destination]
  const segs = [...prefix, ...destSegs]
  const hasBusiness = prefix[0] === 'b'
  const hasProject = prefix.includes('p')
  if (!hasBusiness && !hasProject && destination === 'now' && view === DEFAULT_VIEW.now) return '/'
  return `/${segs.join('/')}`
}

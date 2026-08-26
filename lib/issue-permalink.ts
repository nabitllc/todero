// lib/issue-permalink.ts — issue-permalink piece.
//
// "Navigation & Deep Linking" and "Search & Findability" were both held back
// by the same missing thing: no URL opens one specific issue. Every other
// identity this app names gets a path segment — `/b/<biz>` for business,
// `/p/<slug>` for project (see app/page.tsx's parseURL/buildPath and
// components/nav/config.ts) — never a query string, because a query string
// is a hint a caller can drop and still land somewhere that LOOKS like it
// worked. An issue gets the same treatment: `/i/<task-key>`, preceded by
// whatever `/b/<biz>` and `/p/<slug>` prefix already precede a destination.
//
// `i` was chosen, not `issue` or `issues`, to match the existing one-letter
// convention (`b`, `p`) rather than introduce a second style, and because it
// cannot collide with a DestinationId (`now`/`work`/`fleet`/`runs`/`memory`/
// `settings`) or any key in components/nav/config.ts's LEGACY_TAB_MAP — so
// this segment can never be shadowed by, or shadow, either.
//
// Two callers read this module: app/page.tsx's parseURL (owned by the
// orchestrator — see docs/rebuild/pieces/pieces7/issue-permalink.md for the
// exact diff it needs) and components/SearchOverlay.tsx (owned by this
// piece), so the path a palette Enter builds and the path a page reload
// parses are provably the same shape — the round-trip is asserted in
// lib/__tests__/issue-permalink.test.ts, not merely eyeballed.
//
// Scope: this module parses and builds a PATH. It resolves nothing about
// whether the named issue exists or belongs to the scoped project — that is
// GET /api/issues?task_key=, enforced server-side (see route.ts's own
// comments on that branch), exactly as it already is for every other caller.

import { DEFAULT_VIEW, type DestinationId } from '@/components/nav/config'

/** Matches lib/search-commands.ts's `normalizeTaskKey` exactly (same
 *  strictness, same reasoning: too loose and an ordinary word becomes a
 *  server request; too strict and the permalink never resolves). Not
 *  imported from there — that module is the palette's own backing logic and
 *  this permalink shape has to parse correctly even if the palette never
 *  ran, e.g. on a bookmarked link opened directly. */
const TASK_KEY = /^\s*([A-Za-z][A-Za-z0-9]{0,15})\s*-\s*(\d{1,9})\s*$/

/** `TOD-9` / `tod-9` / ` TOD-9 ` -> `TOD-9`; anything else -> null. */
export function normalizeIssueKey(raw: string): string | null {
  const m = TASK_KEY.exec(raw)
  return m ? `${m[1].toUpperCase()}-${m[2]}` : null
}

/**
 * The destination + view an issue permalink renders as its backdrop — the
 * surface a closed overlay lands on, and the one SearchOverlay's own
 * ISSUE_LIST_KEY already names as "the surface that lists issues" (see that
 * file). Exported so nothing else re-hardcodes the pair `work`/`list`.
 */
export const ISSUE_BACKDROP_DESTINATION: DestinationId = 'work'
export const ISSUE_BACKDROP_VIEW = 'list'

/**
 * Read `/i/<key>` out of a pathname, tolerating whatever `/b/<biz>` and
 * `/p/<slug>` prefix precede it — the same peeling order app/page.tsx's own
 * parseURL uses for those two segments. Returns null when the path names no
 * issue, or names one that does not parse as a task key: the caller falls
 * back to the ordinary destination parse rather than opening a blank
 * overlay over an unparseable key.
 */
export function parseIssueKeyFromPath(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean)
  let rest = parts
  if (rest[0] === 'b' && rest[1]) rest = rest.slice(2)
  if (rest[0] === 'p' && rest[1]) rest = rest.slice(2)
  if (rest[0] !== 'i' || !rest[1]) return null
  return normalizeIssueKey(rest[1])
}

/**
 * The permalink path for an issue, preserving whatever `/b/<biz>` and
 * `/p/<slug>` prefix `currentPath` already carries — mirrors
 * lib/search-commands.ts's `pathForView` for the identical reason that
 * function gives: a caller with a business/project already in its address
 * bar keeps it when jumping to an issue, rather than being bounced back to
 * an unscoped root.
 */
export function issuePermalinkPath(currentPath: string, taskKey: string): string {
  const parts = currentPath.split('/').filter(Boolean)
  const prefix: string[] = []
  let rest = parts
  if (rest[0] === 'b' && rest[1]) { prefix.push('b', rest[1]); rest = rest.slice(2) }
  if (rest[0] === 'p' && rest[1]) { prefix.push('p', rest[1]); rest = rest.slice(2) }
  return `/${[...prefix, 'i', taskKey].join('/')}`
}

/**
 * The canonical backdrop path (`/p/<slug>/work` today, since `list` is not
 * Work's default view — see DEFAULT_VIEW) to land on when an issue overlay
 * closes. Exported so app/page.tsx's seam diff and SearchOverlay compute the
 * SAME "closed" destination rather than two independent guesses.
 */
export function issueBackdropPath(currentPath: string): string {
  const parts = currentPath.split('/').filter(Boolean)
  const prefix: string[] = []
  let rest = parts
  if (rest[0] === 'b' && rest[1]) { prefix.push('b', rest[1]); rest = rest.slice(2) }
  if (rest[0] === 'p' && rest[1]) { prefix.push('p', rest[1]); rest = rest.slice(2) }
  const destSegs = ISSUE_BACKDROP_VIEW !== DEFAULT_VIEW[ISSUE_BACKDROP_DESTINATION]
    ? [ISSUE_BACKDROP_DESTINATION, ISSUE_BACKDROP_VIEW]
    : [ISSUE_BACKDROP_DESTINATION]
  return `/${[...prefix, ...destSegs].join('/')}`
}

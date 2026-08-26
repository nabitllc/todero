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
 * file). Exported so nothing else NEEDS to re-hardcode the pair `work`/`list`.
 *
 * Measured 2026-08-26: that guarantee is not live yet. app/page.tsx hardcodes
 * this exact pair independently, twice — parseURL's own issue branch and the
 * `<IssueDetailOverlay onClose>` prop — and today the only importer of these
 * two constants is this module's own test file. See
 * docs/rebuild/pieces/pieces7/issue-permalink.md for the seam diff that
 * converges both call sites onto this constant (this piece cannot apply it:
 * app/page.tsx is orchestrator-owned). Until that diff lands, do not read
 * this comment as describing what app/page.tsx does today — only what it
 * would do once it imports these.
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
 * The canonical backdrop path (`/p/<slug>/work/list` today — NOT the bare
 * `/p/<slug>/work` — because `list` is not Work's default view: DEFAULT_VIEW
 * .work is `board`, so the ternary below keeps the explicit `list` segment
 * rather than collapsing it away. Corrected 2026-08-26: an earlier version of
 * this comment stated the opposite path and inverted the reason for it; the
 * test directly below this function has always asserted the correct one —
 * `/p/limiglow/work/list` — so only the prose was wrong, not the code) to
 * land on when an issue overlay closes. Exported so app/page.tsx's seam diff
 * and SearchOverlay compute the SAME "closed" destination rather than two
 * independent guesses — see the seam-diff note on ISSUE_BACKDROP_DESTINATION
 * above for the current, honest state of who actually calls this.
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

/**
 * The raw segment after `/i/` in a pathname, whether or not it parses as a
 * task key — distinct from `parseIssueKeyFromPath`, which answers "what
 * KEY does this permalink name, if any", this answers the narrower question
 * "was an issue even being asked for at all". Same prefix-peeling as
 * `parseIssueKeyFromPath`; deliberately does not decodeURIComponent or
 * validate the segment — see the seam-diff note in
 * docs/rebuild/pieces/pieces7/issue-permalink.md for why a RAW, unparsed
 * segment is exactly what the caller needs here, and what happens to it
 * next (a scoped `GET /api/issues?task_key=` 404, not a client-side guess).
 *
 * Measured 2026-08-26: without this, `/p/limiglow/i/notakey` silently fell
 * through app/page.tsx's parseURL to the `now` default, and the mount-time
 * replaceState rewrote the address bar to `/p/limiglow/now` before the
 * operator could see any evidence an issue had even been requested — a
 * typo'd or truncated shared link looked exactly like an ordinary page
 * load. This function is what lets the seam diff say "still an issue
 * request, just one that will 404" instead.
 */
export function rawIssueSegment(pathname: string): string | null {
  const parts = pathname.split('/').filter(Boolean)
  let rest = parts
  if (rest[0] === 'b' && rest[1]) rest = rest.slice(2)
  if (rest[0] === 'p' && rest[1]) rest = rest.slice(2)
  if (rest[0] !== 'i' || !rest[1]) return null
  return rest[1]
}

/**
 * Whether an in-place `history.replaceState` should fire, and to what path —
 * the DECISION both of app/page.tsx's URL-sync effects have to make, pulled
 * out to one tested place instead of two hand-written guards that can drift.
 *
 * TOD-2462 (see this module's header) found this guard missing on the
 * SECOND of the two effects: the mount-time replaceState was guarded, but
 * the `[selectedBusiness, selectedProject, issueKey]` effect fired a tick
 * later on a cold load and overwrote `/p/limiglow/i/TOD-159` with
 * `/b/todero/p/limiglow/work/list` before the operator could reload it. A
 * fresh critic then mutated that guard directly
 * (`if (false && issueKey) return`) and the FULL suite — 1055 passed, 5
 * known-failing, byte-identical to baseline — did not move, because the
 * guard lived entirely in app/page.tsx, which nothing in this repo's test
 * suite can import or render (jest here runs `testEnvironment: "node"`,
 * and `jest-environment-jsdom` is not an installed dependency — verified
 * 2026-08-26, `ls node_modules/jest-environment-jsdom` -> not present).
 *
 * Pulling the DECISION here does not, by itself, close that gap — an
 * app/page.tsx call site that still re-derives `Boolean(issueKey)` by hand
 * instead of calling this function is exactly as mutable as before. It
 * closes the gap only once app/page.tsx's guard is reduced to `if (sync)
 * history.replaceState(..., sync)` calling this — see the seam diff in
 * docs/rebuild/pieces/pieces7/issue-permalink.md. What IS true today: this
 * function's own logic is pinned by
 * lib/__tests__/issue-permalink.test.ts, and mutating it the same way the
 * critic mutated app/page.tsx (forcing the "sync anyway" branch even when
 * an issue is open) turns a specific, named test red — proven in the piece
 * doc, not merely asserted.
 *
 * `issueIsOpen` is `issueKey !== null` from React state; `currentPath` is
 * `location.pathname + location.search`; `canonicalPath` is whatever
 * `buildPath(...)` already computed. Returns the path to write, or null to
 * leave the address bar alone.
 */
export function issueUrlSyncPath(
  issueIsOpen: boolean,
  currentPath: string,
  canonicalPath: string,
): string | null {
  if (issueIsOpen) return null
  return currentPath !== canonicalPath ? canonicalPath : null
}

/**
 * Navigates the SPA to `taskKey`'s permalink: pushes the canonical URL and
 * dispatches a synthetic `popstate` — the same idiom
 * `components/SearchOverlay.tsx`'s own `openIssue` already established (see
 * that file's comment on `go()`/`openIssue`): app/page.tsx's real
 * back/forward listener re-parses `location.pathname` on ANY popstate,
 * synthetic or real, so this is the app's own routing path, not a bypass of
 * it. Exported here so a real `<a href>` issue row (BoardTab, PipelineTab)
 * can fire the identical navigation a palette Enter already does, instead
 * of a second hand-rolled copy of the same three lines.
 */
export function navigateToIssuePermalink(taskKey: string): void {
  const path = issuePermalinkPath(window.location.pathname, taskKey)
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

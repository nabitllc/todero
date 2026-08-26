// lib/run-permalink.ts — runs-need-urls piece (Navigation & Deep Linking, 7/8).
//
// ── THE HOLE THIS FILLS ──────────────────────────────────────────────────────
//
// An issue is fully addressable: `/p/<slug>/i/<key>` opens it, survives a
// reload, and is what a palette Enter and a board row both build (see
// lib/issue-permalink.ts). A RUN had no address at all. Measured 2026-08-26
// against the running dev server:
//
//   $ curl -s -o /dev/null -w '%{http_code}' \
//       -H 'cookie: mc-auth=kaos2026; mc-role=owner' \
//       http://localhost:3000/api/agent-runs/00000000-0000-4000-8000-000000000000
//   405
//
// — no GET existed on the only per-run route in the app; the only way to see
// one run was to scroll components/nav/RunsView.tsx's 100-row list and click,
// which put nothing in the address bar. LangSmith gives every trace a URL and
// Linear makes every view a link; a run was the one identity here that could
// not be sent to anyone.
//
// ── WHY THE SEGMENT LIVES UNDER `runs`, NOT AT THE ROOT ──────────────────────
//
// The obvious shape, by analogy with `/i/<key>`, is `/p/<slug>/r/<id>`. It is
// wrong here, and the reason is in middleware.ts, not in taste.
//
// middleware.ts's `isCrossProjectDestination` treats `runs/*` (and `fleet/*`,
// and `settings/projects`) as deliberately cross-project: it resolves NO
// `x-mc-project` for those screens and stamps `x-mc-all-projects: 1` instead,
// because — its words — "agent-level aggregates … span every project an agent
// has ever touched; scoping them would hide the cross-project picture they
// exist to show." components/nav/RunsView.tsx says the same thing on screen.
//
// A run permalink at `/p/<slug>/r/<id>` would sit OUTSIDE that exemption, so
// middleware would resolve a project scope for it — a scope the list it drills
// into does not have. The drill-down would then be narrower than the list
// above it: a Todero run, visible in the Limiglow operator's cross-project run
// list, would 404 the instant they clicked it. That is a link that renders and
// does not work, which is the failure mode this channel exists to remove.
// middleware.ts is not this piece's file to edit, and it should not be: the
// exemption is correct.
//
// So the run id is a SUB-PATH of the destination that owns it:
//
//     /[b/<biz>/][p/<slug>/]runs/r/<run-id>
//
// This is not a second idiom. It is the same `<letter>/<value>` pair as
// `/b/<biz>`, `/p/<slug>` and `/i/<key>`, positioned so the existing
// cross-project rule applies to it unchanged. Two things fall out for free:
//
//   1. The permalink is never NARROWER than the list, so every row in
//      RunsView can be a real `<a href>` that actually resolves.
//   2. It degrades gracefully with no router change at all. app/page.tsx's
//      parseURL sees `runs` (a DestinationId), then `r` — not a member of
//      `viewsOf('runs')`, which is `['all']` — and falls back to
//      DEFAULT_VIEW.runs. A run URL therefore lands on the Runs list rather
//      than on a 404 or on `now`, even before the seam diff below lands.
//
// `r` cannot collide with anything: it is not a DestinationId, not a key in
// LEGACY_TAB_MAP, and not a view id of `runs`. The last of those three is the
// only one that could change under this file, so it is asserted directly in
// lib/__tests__/run-permalink.test.ts rather than assumed.
//
// ── WHAT THIS FILE DOES NOT DECIDE ───────────────────────────────────────────
//
// It parses and builds a PATH. Whether the named run exists, and whether the
// caller is allowed to read it, is `GET /api/agent-runs/<id>`'s job and is
// enforced server-side from middleware's unforgeable headers — see that
// route's own comments. Nothing here is a permission check.

import { DEFAULT_VIEW, type DestinationId } from '@/components/nav/config'

/** The destination a run permalink lives under. */
export const RUN_DESTINATION: DestinationId = 'runs'

/**
 * The marker segment between the destination and the run id.
 *
 * Exported so the collision test can assert it against `viewsOf('runs')`
 * instead of a human re-checking components/nav/config.ts by eye every time a
 * view is added to Runs.
 */
export const RUN_SEGMENT = 'r'

/**
 * What an `agent_runs.id` is allowed to look like.
 *
 * Deliberately byte-identical to the validator app/api/agent-runs/[id]/route.ts
 * has enforced on PATCH since it was written (`/^[0-9a-f-]{36}$/`) — that
 * route now imports THIS constant rather than keeping its own copy, so the id
 * a permalink is willing to build can never drift from the id the API is
 * willing to answer for. It is loose (it would accept 36 dashes); it is not
 * tightened here, because tightening a validator an internal writer
 * (scripts/builder-with-cost.sh) already passes through is a behaviour change
 * this piece did not measure the blast radius of, and a malformed id fails
 * safely one step later as a 404 from the database lookup.
 */
export const RUN_ID_PATTERN = /^[0-9a-f-]{36}$/

/** Split off a leading `/b/<biz>` and `/p/<slug>`, exactly as app/page.tsx's
 *  parseURL and lib/issue-permalink.ts both peel them, in that order. */
function peelPrefix(pathname: string): { prefix: string[]; rest: string[] } {
  const parts = pathname.split('/').filter(Boolean)
  const prefix: string[] = []
  let rest = parts
  if (rest[0] === 'b' && rest[1]) { prefix.push('b', rest[1]); rest = rest.slice(2) }
  if (rest[0] === 'p' && rest[1]) { prefix.push('p', rest[1]); rest = rest.slice(2) }
  return { prefix, rest }
}

/** `<uuid>` / `<UUID>` / ` <uuid> ` -> lower-cased id; anything else -> null. */
export function normalizeRunId(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase()
  return RUN_ID_PATTERN.test(trimmed) ? trimmed : null
}

/**
 * The RAW segment after `runs/r/`, whether or not it is a well-formed id.
 *
 * The distinction matters for the same reason lib/issue-permalink.ts's
 * `rawIssueSegment` exists (TOD-2467): a truncated or typo'd shared link that
 * falls through to "no run requested" is indistinguishable, on screen, from an
 * ordinary page load — the address bar gets rewritten by app/page.tsx's
 * mount-time replaceState before the operator sees any evidence a run was ever
 * asked for. This function is what lets the caller say "a run WAS requested,
 * and that id is not a run id" instead of silently rendering the list.
 */
export function rawRunSegment(pathname: string): string | null {
  const { rest } = peelPrefix(pathname)
  if (rest[0] !== RUN_DESTINATION) return null
  if (rest[1] !== RUN_SEGMENT || !rest[2]) return null
  return rest[2]
}

/** The normalised run id an `…/runs/r/<id>` path names, or null. */
export function parseRunIdFromPath(pathname: string): string | null {
  const raw = rawRunSegment(pathname)
  return raw === null ? null : normalizeRunId(raw)
}

/**
 * The permalink path for a run, preserving whatever `/b/<biz>` and `/p/<slug>`
 * prefix `currentPath` already carries — same reason lib/issue-permalink.ts's
 * `issuePermalinkPath` preserves them: an operator with a business/project in
 * their address bar keeps it when opening a run, instead of being bounced to
 * an unscoped root.
 *
 * Whatever followed the prefix in `currentPath` is discarded, so this is
 * idempotent: calling it on a path that is ALREADY a run permalink replaces
 * the id rather than nesting a second one.
 */
export function runPermalinkPath(currentPath: string, runId: string): string {
  const { prefix } = peelPrefix(currentPath)
  return `/${[...prefix, RUN_DESTINATION, RUN_SEGMENT, runId].join('/')}`
}

/**
 * The Runs view a closed run detail lands back on — the list it drilled out
 * of. Named as its own constant, not read from DEFAULT_VIEW, because those two
 * are the same string today by coincidence and not by rule: `runBackdropPath`
 * below compares them, and if a different default view is ever added to Runs,
 * the comparison starts emitting the explicit `/runs/all` segment instead of
 * silently producing a URL that reloads onto the wrong view.
 */
export const RUN_BACKDROP_VIEW = 'all'

/**
 * The path a closed run detail lands on: the Runs list, under the same
 * business/project prefix. `all` collapses away today because it IS
 * DEFAULT_VIEW.runs — same `view !== defaultView` rule app/page.tsx's
 * `buildPath` applies to every other destination, so the two cannot disagree
 * about what the canonical Runs URL is.
 */
export function runBackdropPath(currentPath: string): string {
  const { prefix } = peelPrefix(currentPath)
  const destSegs = RUN_BACKDROP_VIEW !== DEFAULT_VIEW[RUN_DESTINATION]
    ? [RUN_DESTINATION, RUN_BACKDROP_VIEW]
    : [RUN_DESTINATION]
  return `/${[...prefix, ...destSegs].join('/')}`
}

/**
 * The path app/page.tsx's MOUNT-TIME `replaceState` should write.
 *
 * Measured 2026-08-26, before this piece: that effect canonicalises the URL to
 * `buildPath(business, destination, view, project)` on every cold load that is
 * not an issue permalink. For `/p/limiglow/runs/r/<id>` that is
 * `/p/limiglow/runs` — the run id is erased from the address bar milliseconds
 * after the page loads, so the permalink cannot survive the very reload it
 * exists for.
 *
 * lib/issue-permalink.ts solved the same problem by SUPPRESSING the rewrite
 * entirely (`if (k) setIssueKey(k) else replaceState(...)`), which preserves
 * the permalink but also means a cold-loaded `/i/<key>` never gains the
 * `/p/<slug>` segment the auto-derived scope resolved. This is designed to do
 * better for the same one line at the call site: the canonical path is still
 * computed, and the run segment is re-attached to it, so a cold-loaded
 * `/runs/r/<id>` WOULD become `/b/todero/p/limiglow/runs/r/<id>` — canonical
 * and still a permalink.
 *
 * ── NOT WIRED UP YET. READ THIS BEFORE BELIEVING THE PARAGRAPH ABOVE. ────────
 *
 * Measured 2026-08-26 on the worktree: `grep -c 'run-permalink' app/page.tsx`
 * -> 0. NOTHING in the shipped app calls this function. The sentence above is
 * a description of what this function returns, not of what the running app
 * does, and it becomes true only when the seam diff in
 * docs/rebuild/pieces/pieces8/runs-need-urls.md §5 is applied to app/page.tsx
 * (orchestrator-owned; this piece is not permitted to edit that file).
 * __tests__/nav/runs-permalink-seam.test.ts fails, by name and with the diff
 * in its message, for exactly as long as that remains true — so this is a RED
 * gate, not a paragraph someone has to read.
 *
 * There is no in-component workaround, and that was checked rather than
 * assumed. app/page.tsx:921 gates EVERY destination behind `!selectedProject`,
 * so RunsView does not mount until `/api/businesses` + `/api/projects`
 * resolve — which is strictly after the mount-time `replaceState` at
 * app/page.tsx:452 has already run. RunsView therefore cannot read the run
 * segment before it is erased, no matter how its effects are ordered.
 *
 * `runSegment` is `rawRunSegment(location.pathname)`, not a parsed id: a
 * malformed segment must survive canonicalisation too, or the operator loses
 * the evidence that a run was requested at all (see `rawRunSegment`).
 */
export function runMountPath(runSegment: string | null, canonicalPath: string): string {
  return runSegment === null ? canonicalPath : runPermalinkPath(canonicalPath, runSegment)
}

/**
 * Whether app/page.tsx's project-sync `replaceState` should fire, and to what.
 *
 * This composes with — never replaces — `issueUrlSyncPath`. The seam is one
 * line: the existing `issueUrlSyncPath(...)` call becomes the `proposedSync`
 * argument here, so the issue rule still runs first and this only decides what
 * happens to a path the issue rule already approved.
 *
 * TOD-2467's lesson is why the DECISION lives here rather than inline in
 * app/page.tsx: jest in this repo runs `testEnvironment: "node"`,
 * `jest-environment-jsdom` is not installed (verified 2026-08-26,
 * `ls node_modules/jest-environment-jsdom` -> not present), and
 * parseURL/buildPath are not exported — so nothing in the suite can import or
 * render app/page.tsx. A guard written there is a guard a critic can delete
 * while every gate stays green. Written here, it is pinned by
 * lib/__tests__/run-permalink.test.ts.
 *
 * That is a real but PARTIAL guarantee, stated plainly: it holds only once
 * app/page.tsx actually calls this instead of re-deriving the condition by
 * hand. Until the seam diff in
 * docs/rebuild/pieces/pieces8/runs-need-urls.md lands, the app's behaviour is
 * whatever app/page.tsx does today, not what this function says.
 */
export function runUrlSyncPath(
  runSegment: string | null,
  proposedSync: string | null,
): string | null {
  if (proposedSync === null) return null
  return runMountPath(runSegment, proposedSync)
}

/**
 * Whether a `Referer` names the Runs screen with NO `/p/<slug>` in it.
 *
 * ── THE DEFECT THIS COMPENSATES FOR, MEASURED ────────────────────────────────
 *
 * middleware.ts stamps `x-mc-all-projects: 1` from `isCrossProjectRequest`,
 * which calls `projectFromPathname` FIRST and returns `false` whenever that
 * returns null — and `projectFromPathname` returns null for any path without a
 * `/p/<slug>`. So the project-less form of a deliberately cross-project screen
 * gets NEITHER header. Measured live 2026-08-26 against the running dev server,
 * with a valid session cookie:
 *
 *   referer /p/limiglow/runs/r/<id>   -> 200
 *   referer /runs/r/<id>              -> 400 unscoped_run_read
 *   referer /runs/all                 -> 400 unscoped_run_read
 *   referer /b/todero/runs/all        -> 400 unscoped_run_read
 *
 * i.e. the un-prefixed Runs screen — the exact screen a run permalink is
 * reached from — was refused by the endpoint built for it, and the refusal
 * text told the operator to use "/p/<project>/runs", the prefixed form of the
 * screen it was refusing. That is a link that renders and does not work.
 *
 * ── WHY FIXING IT HERE GRANTS NOTHING, AND THAT WAS MEASURED TOO ─────────────
 *
 * The real cure is one line in middleware.ts (a seam request is written down in
 * the piece doc §10.3); middleware.ts is not this piece's file. Until it lands,
 * GET /api/agent-runs/<id> derives the same fact from the same Referer
 * middleware itself derives everything from.
 *
 * This widens NOTHING, and the check is not an argument — it is a probe. The
 * cross-project privilege is ALREADY reachable by any caller holding a session,
 * because middleware's project resolution is a title-case codec and not a
 * registry, so an invented slug is accepted:
 *
 *   referer /p/totally-made-up-slug/runs/all + a foreign run -> 200 (measured)
 *
 * Anyone who could reach a run through this function could already reach it by
 * typing a slug that does not exist. What the function removes is a refusal,
 * not a boundary.
 *
 * Deliberately narrow, so the widening is exactly the size of the bug:
 *   - same-origin only, matching middleware's own `refUrl.origin` check;
 *   - `runs` only — not `fleet`, not `settings/projects`. This route exists
 *     for the run permalink and the run permalink lives under `runs`. If Fleet
 *     ever deep-links a run, that is a deliberate one-word change with a test,
 *     not something this function should have pre-granted;
 *   - any `p` segment at all, even a malformed one, returns false. A path that
 *     tried to name a project and failed is ambiguous, and middleware already
 *     owns the well-formed case. Ambiguity stays a 400.
 */
export function isProjectlessRunsReferer(referer: string | null, origin: string): boolean {
  if (!referer) return false
  let url: URL
  try {
    url = new URL(referer)
  } catch {
    return false
  }
  if (url.origin !== origin) return false
  const parts = url.pathname.split('/').filter(Boolean)
  let rest = parts
  // `/b/<biz>` is peeled and `/p/<slug>` deliberately is NOT. That asymmetry
  // IS the "no project in the path" rule: any path carrying a project segment
  // leaves `p` sitting at rest[0], which is not `runs`, so it returns false
  // through the line below. An explicit `if (rest[0] === 'p') return false`
  // stood here for one revision and was removed: no mutation could kill it,
  // because deleting it changed no result. A line that cannot be wrong is not
  // a guard, it is a comment with semicolons — so it is a comment now.
  if (rest[0] === 'b' && rest[1]) rest = rest.slice(2)
  return rest[0] === RUN_DESTINATION
}

/**
 * Navigate the SPA to a run's permalink: push the canonical URL and dispatch a
 * synthetic `popstate`.
 *
 * Same idiom as lib/issue-permalink.ts's `navigateToIssuePermalink` and
 * components/SearchOverlay.tsx's `go()`, for the same reason: app/page.tsx's
 * real back/forward listener re-parses `location.pathname` on ANY popstate,
 * synthetic or real, and components/nav/RunsView.tsx listens for the same
 * event — so this is the app's own routing path, not a bypass of it.
 *
 * Pushing the SAME path twice is suppressed, so a double-click on a run row
 * does not put two identical entries in the back stack.
 */
export function navigateToRunPermalink(runId: string): void {
  const path = runPermalinkPath(window.location.pathname, runId)
  if (window.location.pathname === path) return
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

/** Close an open run: navigate back to the Runs list, as a real URL. */
export function closeRunPermalink(): void {
  const path = runBackdropPath(window.location.pathname)
  if (window.location.pathname === path) return
  window.history.pushState({}, '', path)
  window.dispatchEvent(new PopStateEvent('popstate'))
}

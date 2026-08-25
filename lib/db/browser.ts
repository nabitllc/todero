// ─── Browser-side database access ────────────────────────────────────────────
//
// Client components used to fetch the database directly with a full-privilege
// key literally embedded in the JS bundle: read/write on every table for anyone
// who opened devtools. They now point at the same-origin proxy in
// `app/api/db/rest/[...path]/route.ts`, which is session-gated, table-limited,
// holds the credentials server-side, and — importantly — executes through the
// seam in `lib/db.ts` rather than forwarding anything to a vendor host.
//
// Safe to import from 'use client' files: no credentials, no vendor URL, and no
// vendor wire format. `dbUrl('issues?status=eq.open')` is a same-origin path;
// the filter grammar after the `?` is translated into seam calls server-side.
//
// TODO(db-seam): retire this shim once every tab reads from a typed API route.

/** Same-origin URL for a table query, e.g. `dbUrl('issues?select=*&limit=10')`. */
export function dbUrl(tableAndQuery: string): string {
  return `/api/db/${tableAndQuery.replace(/^\/+/, '')}`
}

/** Headers for a `dbUrl()` request. Credentials are added server-side. */
export function dbRestHeaders(): Record<string, string> {
  return {}
}

// ─── scope-is-a-boundary (TOD-2412 lane) ──────────────────────────────────────
//
// `dbUrl('issues?...')` above is a general-purpose, unscoped escape hatch: it
// takes an arbitrary query string and forwards it verbatim. That generality is
// exactly the hole this piece exists to close for the ISSUES table — a filter
// spread across N call sites (project=eq.X, archived_at=is.null) is a filter
// the (N+1)th call site forgets, and the failure is silent: the row just shows
// up on a board it does not belong on.
//
// `issuesUrl()` is the replacement seam for every NEW issues-table read: the
// project clause and the archived clause are injected HERE, ONCE, and `scope`
// is a required second argument with no default — a call site that forgets it
// does not compile. That is what makes this structural rather than
// conventional: TypeScript refuses `issuesUrl(query)` with one argument.
//
// This does not retrofit `dbUrl('issues?...')` itself to demand a scope,
// because `dbUrl` is also the entry point for agent_runs, sprints,
// notifications, agents and every other table in READABLE_TABLES
// (app/api/db/[...path]/route.ts) — none of which take a project scope, and
// most of which are called from components/tabs/** and other files this piece
// does not own and must not edit while another agent is mid-edit on them
// (see the piece's DO NOT TOUCH list). Overloading `dbUrl` to reject unscoped
// `issues` queries at the type level would fail `tsc --noEmit` on every one of
// those pre-existing call sites — a compile break this piece cannot fix from
// inside its own file boundary. `issuesUrl` is additive instead: it is the
// seam every call site THIS piece owns (app/page.tsx, components/nav/**) now
// goes through, and scripts/no-unscoped-issues.mjs is the guard that catches
// any remaining or reintroduced `dbUrl('issues?...')` literal anywhere else
// under app/ or components/ that skips it.
export interface ProjectScope {
  /** Real project name, e.g. "Limiglow" — never a business name, never a slug. */
  readonly project: string
}

/**
 * Same-origin URL for an ISSUES query, scoped. `query` is everything after
 * `issues?` — do not include `project=` or `archived_at=` in it; both are
 * injected here unconditionally so no caller can omit or override them.
 *
 * Throws instead of silently building an unscoped URL if `scope.project` is
 * empty — an empty string would otherwise serialize as `project=eq.` and
 * match nothing, which reads on screen exactly like "this project truly has
 * zero issues" instead of "the caller had no scope to give me".
 */
export function issuesUrl(query: string, scope: ProjectScope): string {
  if (!scope || !scope.project) {
    throw new Error(
      'issuesUrl() requires a non-empty scope.project — issues queries must never run unscoped. ' +
      'Callers with no project selected yet must not call this at all (see app/page.tsx: every ' +
      'issuesUrl() call site is gated on `selectedProject` being truthy).'
    )
  }
  const rest = query.replace(/^[?&]+/, '')
  const scopedQuery =
    `issues?project=eq.${encodeURIComponent(scope.project)}&archived_at=is.null` +
    (rest ? `&${rest}` : '')
  return dbUrl(scopedQuery)
}

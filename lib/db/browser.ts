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

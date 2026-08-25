// ─── Browser-side database access ────────────────────────────────────────────
//
// Client components used to fetch the database directly with a full-privilege
// key literally embedded in the JS bundle: read/write on every table for anyone
// who opened devtools. They now point at the same-origin proxy in
// `app/api/db/rest/[...path]/route.ts`, which is session-gated, table-limited,
// and holds the credentials server-side.
//
// Safe to import from 'use client' files: this module contains no credentials
// and no vendor URL.
//
// Usage is deliberately drop-in — `${dbRestBase()}/rest/v1/issues?select=*`
// keeps working — so that migrating a component is a one-line change. New code
// should prefer a purpose-built route under /api/ that returns exactly the
// shape the component needs.
//
// TODO(db-seam): retire this shim once every tab reads from a typed API route.

/** Same-origin base for database reads/writes from the browser. */
export function dbRestBase(): string {
  return '/api/db'
}

/** Headers for a `dbRestBase()` request. Credentials are added server-side. */
export function dbRestHeaders(): Record<string, string> {
  return {}
}

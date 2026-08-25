// ─── TRANSITIONAL: direct HTTP access to the database ────────────────────────
//
// A handful of server modules talk to the database over HTTP with PostgREST
// query strings instead of the fluent builder in `lib/db.ts`. They are kept
// working here rather than rewritten, because rewriting ~49 query strings is a
// separate change with its own risk.
//
// TODO(db-seam): migrate these call sites to `db().from(...)`. Until then a
// non-PostgREST adapter (Neon over a SQL driver) must either serve PostgREST or
// these call sites must be converted first. `grep -rn "db/rest'" app/ lib/`
// lists exactly what is left.
//
// What this file DOES buy today: no URL and no key is hardcoded anywhere above
// it, and an unconfigured host fails with a variable-naming error instead of a
// silent 401.
//
// SERVER ONLY. Importing this from a 'use client' file would ship service
// credentials to the browser. Client code uses `lib/db/browser.ts`, which goes
// through the authenticated proxy at /api/db/rest/*.

import { supabaseRestBase, supabaseServiceHeaders } from './supabase-env'

/**
 * Base URL of the database's HTTP API, no trailing slash. Callers append
 * `/rest/v1/<table>?<postgrest query>`.
 *
 * Throws `DbConfigurationError` naming the missing env vars when unconfigured.
 */
export function dbRestBase(): string {
  return supabaseRestBase()
}

/**
 * Service-credential headers for `dbRestBase()` requests.
 *
 * Throws `DbConfigurationError` naming the missing env vars when unconfigured.
 */
export function dbServiceHeaders(): Record<string, string> {
  return supabaseServiceHeaders()
}

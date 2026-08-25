// ─── Turning "the database is not configured" into an honest HTTP answer ─────
//
// `lib/db.ts` throws a `DbConfigurationError` naming the exact missing env
// vars. Left unhandled inside a route handler that becomes a bare 500 with an
// EMPTY body — the operator sees nothing and the cause is only in the server
// log. This module is the shared translation into a 503 that names the variable
// in the response body, so a fresh clone tells you what to set.
//
// Two entry points because routes need both shapes:
//   - `dbUnavailableResponse()` as an early guard, before any query runs.
//   - `dbErrorResponse(e)` in a catch, for anything that slipped past a guard.

import { NextResponse } from 'next/server'
import { DbConfigurationError, dbMissingEnv, DB_ERROR, type DbError } from '@/lib/db'

function body(missing: readonly string[], message?: string) {
  return {
    error:
      message ??
      `Database is not configured. Missing environment variable${missing.length > 1 ? 's' : ''}: ` +
        `${missing.join(', ')}. Set ${missing.length > 1 ? 'them' : 'it'} in .env.local — see .env.local.template.`,
    missingEnv: missing,
  }
}

/**
 * A 503 naming the missing env vars, or `null` when the database is ready.
 * Call it first thing in a handler: `const gate = dbUnavailableResponse(); if (gate) return gate`.
 */
export function dbUnavailableResponse(): NextResponse | null {
  const missing = dbMissingEnv()
  if (missing.length === 0) return null
  return NextResponse.json(body(missing), { status: 503 })
}

/**
 * Map a caught error onto the same 503 body when it is a configuration error,
 * or `null` when it is something else the caller should keep handling.
 */
export function dbErrorResponse(e: unknown): NextResponse | null {
  if (!(e instanceof DbConfigurationError)) return null
  const missing = e.missingEnv.length > 0 ? e.missingEnv : dbMissingEnv()
  return NextResponse.json(body(missing, e.message), { status: 503 })
}

// ─── Missing tables ───────────────────────────────────────────────────────
//
// A route can be fully configured (credentials present) and still fail
// because the schema was never migrated onto this database. Left unhandled,
// that surfaces as either a bare 500 or — worse — the query layer's own raw
// wording ("Could not find the table 'public.x' in the schema cache"), which
// leaks internals and tells an operator nothing they can act on. This turns
// that one failure mode into a named, actionable answer: which table, and
// the exact command that creates it.

const SCHEMA_CACHE_MISS = /schema cache/i
const RELATION_MISSING = /relation .* does not exist/i

/**
 * True when a `DbError` means "this table does not exist" rather than some
 * other failure (bad credentials, network, a real constraint violation).
 * Recognises both adapters: the `postgres` adapter surfaces Postgres's own
 * `42P01` (undefined_table); the `supabase` adapter surfaces PostgREST's
 * schema-cache-miss wording since it never gets a raw SQLSTATE back.
 */
export function isMissingTableError(error: DbError | null | undefined): boolean {
  if (!error) return false
  if (error.code === DB_ERROR.UNDEFINED_TABLE) return true
  return SCHEMA_CACHE_MISS.test(error.message) || RELATION_MISSING.test(error.message)
}

/**
 * A 503 naming the missing table and the fix — never the vendor's raw
 * "schema cache" string. Call this instead of echoing `error.message` once
 * `isMissingTableError(error)` is true.
 */
export function missingTableResponse(table: string): NextResponse {
  return NextResponse.json(
    {
      error: `Table '${table}' does not exist. Run: npm run db:migrate`,
      table,
      fix: 'npm run db:migrate',
    },
    { status: 503 },
  )
}

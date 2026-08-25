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
import { DbConfigurationError, dbMissingEnv } from '@/lib/db'

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

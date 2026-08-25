// ─── Schema preflight ─────────────────────────────────────────────────────
//
// Tables the app queries directly but that a fresh clone's database will not
// have until `npm run db:migrate` runs. Listed here once so /api/health and
// any route that depends on one of them can check the same list instead of
// each guessing independently.
//
// This does NOT run raw SQL — it goes through the same `lib/db.ts` seam every
// route uses, so it works unmodified against either adapter (`supabase` or
// `postgres`) and reports the schema as the app itself would see it.

import { db, isDbConfigured } from '@/lib/db'
import { isMissingTableError } from '@/lib/db-http'

/** Tables that must exist before the routes that depend on them can work. */
export const REQUIRED_TABLES = ['connections', 'deploy_history', 'workspace_members'] as const

export type RequiredTable = (typeof REQUIRED_TABLES)[number]

/**
 * Probe each required table with a cheap, row-less query and report which
 * ones are missing. Any other kind of error (bad credentials, network) is not
 * treated as "missing" — that is a different failure the caller should
 * surface on its own terms, not conflate with an unmigrated schema.
 */
export async function checkRequiredTables(): Promise<{ missing: RequiredTable[] }> {
  if (!isDbConfigured()) {
    // Can't tell what's missing if we can't even connect — but we also can't
    // claim the schema is fine. Report everything as unknown-missing so
    // health still fails loudly rather than defaulting to green.
    return { missing: [...REQUIRED_TABLES] }
  }

  const missing: RequiredTable[] = []
  await Promise.all(
    REQUIRED_TABLES.map(async table => {
      try {
        // Deliberately NOT `head: true` — a HEAD response has no body, so
        // PostgREST's error JSON (the "schema cache" wording we detect on)
        // never arrives and a missing table would silently look fine.
        const { error } = await db().from(table).select('id').limit(1)
        if (error && isMissingTableError(error)) missing.push(table)
      } catch {
        // A DbConfigurationError or thrown transport error here means we
        // couldn't confirm the table exists — treat that as missing too
        // rather than silently skipping it.
        missing.push(table)
      }
    }),
  )
  return { missing: missing.sort() }
}

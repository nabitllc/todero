#!/usr/bin/env node
// ─── npm run db:migrate ───────────────────────────────────────────────────
//
// The one command that turns migrations/*.sql into a real schema. Applies
// every migration file in filename order, tracked in a `schema_migrations`
// ledger table so re-running is a no-op for anything already applied — a
// stranger can run this on every clone, every deploy, and after every pull,
// and it only ever does the delta.
//
// Migrations always run over a DIRECT Postgres connection (`DATABASE_URL`),
// regardless of which adapter `lib/db.ts` picked for the app's own queries.
// That is deliberate: the `supabase` adapter talks to Postgres through an
// HTTP query layer (PostgREST) that has no DDL grammar — there is no way to
// `CREATE TABLE` through it. A direct connection string is the only thing
// that can run this file's contents, on either adapter.
//
//   Local Postgres / the `postgres` adapter:
//     DATABASE_URL=postgresql://user:pass@localhost:5432/todero
//
//   A Supabase-backed install (the default adapter): use the project's
//   direct Postgres connection string, not the anon/service-role API keys —
//   Supabase dashboard -> Settings -> Database -> Connection string (URI).
//     DATABASE_URL=postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres
//
// Usage:  npm run db:migrate

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const MIGRATIONS_DIR = join(__dirname, '..', 'migrations')

// Postgres error codes that mean "this object already exists" — recoverable
// when a migration's target was created by hand or by an older, informal
// process outside this ledger. Anything else aborts the run.
const ALREADY_EXISTS_CODES = new Set([
  '42710', // duplicate_object (e.g. CREATE TYPE ... AS ENUM without IF NOT EXISTS)
  '42P07', // duplicate_table
  '42701', // duplicate_column
  '42723', // duplicate_function
  '42P06', // duplicate_schema
  '42P16', // invalid_table_definition (duplicate constraint name, in practice)
])

function fail(message) {
  console.error(`[db:migrate] ${message}`)
  process.exitCode = 1
}

async function main() {
  const databaseUrl = (process.env.DATABASE_URL ?? '').trim()
  if (!databaseUrl) {
    fail(
      'DATABASE_URL is not set.\n' +
        '  Migrations need a direct Postgres connection — separate from whichever\n' +
        '  adapter (supabase or postgres) serves the app\'s own queries, because the\n' +
        '  supabase adapter\'s HTTP query layer cannot run DDL. Set DATABASE_URL in\n' +
        '  .env.local:\n' +
        '    postgresql://USER:PASSWORD@HOST:5432/DBNAME\n' +
        '  For a Supabase project: Dashboard -> Settings -> Database -> Connection\n' +
        '  string (URI) — not the anon/service-role API keys.',
    )
    return
  }

  let Pool
  try {
    ;({ Pool } = await import('pg'))
  } catch {
    fail('the "pg" package is not installed. Run `npm install` first.')
    return
  }

  const pool = new Pool({ connectionString: databaseUrl })
  const client = await pool.connect()

  try {
    const files = readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort()

    if (files.length === 0) {
      console.log('[db:migrate] no .sql files found in migrations/ — nothing to do.')
      return
    }

    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    const { rows } = await client.query('SELECT filename FROM schema_migrations')
    const applied = new Set(rows.map(r => r.filename))

    let ranCount = 0
    let recoveredCount = 0

    for (const file of files) {
      if (applied.has(file)) continue

      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
      process.stdout.write(`[db:migrate] applying ${file} ... `)

      try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file])
        await client.query('COMMIT')
        console.log('ok')
        ranCount++
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})

        if (err && ALREADY_EXISTS_CODES.has(err.code)) {
          // The object this migration creates already exists — most likely
          // applied by hand before this ledger existed. Record it as applied
          // rather than aborting every migration after it.
          console.log(`already applied (${err.code}: ${err.message.split('\n')[0]}) — recorded`)
          await client.query('INSERT INTO schema_migrations (filename) VALUES ($1) ON CONFLICT DO NOTHING', [file])
          recoveredCount++
          continue
        }

        console.log('FAILED')
        fail(`${file}: ${err instanceof Error ? err.message : String(err)}`)
        return
      }
    }

    if (ranCount === 0 && recoveredCount === 0) {
      console.log(`[db:migrate] up to date — ${files.length} migration(s) already applied, 0 new.`)
    } else {
      console.log(
        `[db:migrate] applied ${ranCount} new migration(s)` +
          (recoveredCount > 0 ? `, recorded ${recoveredCount} pre-existing` : '') +
          `. ${files.length} total tracked.`,
      )
    }
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => {
  fail(err instanceof Error ? err.stack ?? err.message : String(err))
})

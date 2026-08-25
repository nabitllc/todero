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
// DATABASE_URL is read from (in order) the real shell/CI environment, then
// .env.local, then .env — same file this script's own error message and
// .env.local.template point every operator at. A real environment variable
// always wins; the file loader below only fills in what isn't already set.
//
// Usage:  npm run db:migrate

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const MIGRATIONS_DIR = join(REPO_ROOT, 'migrations')

// ─── .env.local / .env loader ──────────────────────────────────────────────
//
// This is a plain Node script, not the Next.js runtime — Next loads
// .env.local for the app automatically, but nothing loads it for a bare
// `node scripts/db-migrate.mjs`. No new dependency: a small KEY=VALUE
// parser is enough for the flat files this repo actually writes.

/** Parse one .env-style file's text into a plain key/value object. */
function parseEnvText(text) {
  const out = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    if (!key) continue
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

/**
 * Load KEY=VALUE pairs from `path` into `process.env`, but only for keys
 * that are not already set — a real shell/CI environment variable always
 * takes precedence over anything in a file. Silently does nothing if the
 * file does not exist.
 */
function loadEnvFile(path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return
  }
  for (const [key, value] of Object.entries(parseEnvText(text))) {
    if (process.env[key] === undefined) process.env[key] = value
  }
}

// .env.local first (repo convention: the local override), then .env for
// anything it didn't set.
loadEnvFile(join(REPO_ROOT, '.env.local'))
loadEnvFile(join(REPO_ROOT, '.env'))

function fail(message) {
  console.error(`[db:migrate] ${message}`)
  process.exitCode = 1
}

/** Best-effort project ref out of a Supabase project URL, or null. */
function supabaseProjectRef() {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim()
  const m = /^https?:\/\/([a-z0-9-]+)\.supabase\.co/i.exec(url)
  return m ? m[1] : null
}

function missingDatabaseUrlMessage() {
  const ref = supabaseProjectRef()
  const base =
    'DATABASE_URL is not set.\n' +
    '  Migrations need a direct Postgres connection — separate from whichever\n' +
    '  adapter (supabase or postgres) serves the app\'s own queries, because the\n' +
    '  supabase adapter\'s HTTP query layer cannot run DDL.\n' +
    '  Set it in .env.local (checked automatically — no shell export needed):\n' +
    '    DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/DBNAME\n'

  if (!ref) {
    return (
      base +
      '  For a Supabase project: Dashboard -> Settings -> Database -> Connection\n' +
      '  string (URI) — not the anon/service-role API keys.'
    )
  }

  // NEXT_PUBLIC_SUPABASE_URL is already in this environment, so the exact
  // host for the direct connection string is known — print it, not a
  // generic paragraph pointing at "your project".
  return (
    base +
    `  This install's NEXT_PUBLIC_SUPABASE_URL points at Supabase project '${ref}'.\n` +
    `  Its direct Postgres connection string is:\n` +
    `    postgresql://postgres:YOUR_DB_PASSWORD@db.${ref}.supabase.co:5432/postgres\n` +
    '  YOUR_DB_PASSWORD is the database password, not the anon/service-role API\n' +
    '  keys already in .env.local — get it from Supabase dashboard -> Settings ->\n' +
    '  Database -> Connection string (URI), or Settings -> Database -> Reset\n' +
    '  database password if it was never recorded.'
  )
}

/**
 * A short window of the raw SQL around a 1-indexed character position (the
 * shape `err.position` comes in from `pg`), plus its line number — enough to
 * name the offending statement without needing a full SQL statement splitter.
 */
function contextAroundPosition(sql, position) {
  const idx = Number(position) - 1
  if (!Number.isFinite(idx) || idx < 0 || idx > sql.length) return null
  const from = Math.max(0, idx - 80)
  const to = Math.min(sql.length, idx + 80)
  const snippet = `${sql.slice(from, idx)}⟪HERE⟫${sql.slice(idx, to)}`.replace(/\s+/g, ' ').trim()
  const line = sql.slice(0, idx).split('\n').length
  return { line, snippet }
}

async function main() {
  const databaseUrl = (process.env.DATABASE_URL ?? '').trim()
  if (!databaseUrl) {
    fail(missingDatabaseUrlMessage())
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
        console.log('FAILED')

        // Deliberately no "already exists -> record as applied" recovery
        // here. A statement failing mid-file means the WHOLE file was just
        // rolled back — nothing it defines exists yet on this database — so
        // inserting it into schema_migrations would be a lie the ledger
        // repeats on every future run. Abort naming the file and, as
        // precisely as a raw error lets us, the statement that failed; fix
        // is to make the SQL itself idempotent (IF NOT EXISTS / DROP ... IF
        // EXISTS first / a DO $$ ... IF NOT EXISTS block), not to paper over
        // the failure here.
        const ctx = err && err.position ? contextAroundPosition(sql, err.position) : null
        const where = ctx ? ` (line ~${ctx.line}, near: "${ctx.snippet}")` : ''
        fail(
          `${file} did not apply — rolled back, NOT recorded as applied.${where}\n` +
            `  ${err instanceof Error ? err.message : String(err)}\n` +
            `  Fix the SQL in migrations/${file} (make the failing statement idempotent)\n` +
            '  and re-run `npm run db:migrate`.',
        )
        return
      }
    }

    if (ranCount === 0) {
      console.log(`[db:migrate] up to date — ${files.length} migration(s) already applied, 0 new.`)
    } else {
      console.log(`[db:migrate] applied ${ranCount} new migration(s). ${files.length} total tracked.`)
    }
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch(err => {
  fail(err instanceof Error ? err.stack ?? err.message : String(err))
})

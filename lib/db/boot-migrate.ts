// ─── Boot-time migrations ──────────────────────────────────────────────────
//
// The comparator (builderz-labs/mission-control) has no `migrate` command at
// all: starting the app migrates it. Todero's equivalent moment is the first
// call to `db()` in `lib/db.ts` — this file is what that call now does before
// handing back an adapter, so `git clone && npm install && npm run dev` ends
// at a working board without anyone having to discover a second command.
//
// `npm run db:migrate` (package.json -> `scripts/db-migrate.mjs`) still
// exists, unchanged, for an operator who wants to run it deliberately — a CI
// step, a deploy hook, checking pending migrations before opening a PR. This
// file does not replace it; it is what makes running it OPTIONAL rather than
// required. The two intentionally share the same algorithm (ordered files,
// a `schema_migrations` ledger, one transaction per file, abort-not-partial
// on failure) without sharing code — `scripts/db-migrate.mjs` runs outside
// the Next.js build entirely (a bare `node` process, before any bundler sees
// it), while this file is compiled into the server bundle and must stay
// import-safe for webpack's client graph (see the lazy `require()`s below,
// and `next.config.js`'s `pg`/`better-sqlite3` aliases) — two different
// runtime constraints the same module can't satisfy at once.
//
// NEVER runs during `next build` (NEXT_PHASE === 'phase-production-build'):
// a build has no reason to reach a database — Vercel's build sandbox often
// cannot even see the one a production deploy will use — and this repo's
// own `prebuild` step (`scripts/generate-required-tables.mjs`) only reads
// source text, never imports `lib/db.ts`, so nothing legitimate is lost by
// refusing here.
//
// Only two providers, because they're the only two whose DDL this repo can
// run itself:
//   sqlite   — synchronous (`better-sqlite3`), so this blocks
//              `resolveAdapter()` for the few milliseconds a fresh clone's
//              migrations take. That block is deliberate: the very next line
//              in `lib/db.ts` creates the adapter, and
//              `lib/db/sqlite-adapter.ts`'s own `open()` deliberately REFUSES
//              to create a missing file (see its comment) — by design, that
//              refusal exists for the case where this boot step never ran.
//              Running it synchronously first is what makes that promise true.
//   postgres — DATABASE_URL, fire-and-forget. `db()` is synchronous at all
//              200+ call sites; making it async to await a network round trip
//              here would be a much larger change than this piece owns. A
//              query landing before this finishes fails exactly as it always
//              would have against an unmigrated database — this only removes
//              the failure for the common case (already migrated, or sqlite).
//   supabase — untouched. Its HTTP query layer (PostgREST) has no DDL
//              grammar, so nothing here could run migrations against it even
//              in principle; `npm run db:migrate` with DATABASE_URL pointed
//              at the project's direct Postgres connection remains the way,
//              same as before this file existed.

const REPO_ROOT = process.cwd()

/** Migration files already applied (or attempted) this process, per provider. */
const ranFor = new Set<string>()

/** True during `next build`. See the module comment above. */
function isBuildPhase(): boolean {
  return process.env.NEXT_PHASE === 'phase-production-build'
}

function migrationFiles(dir: string): string[] {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { readdirSync } = require('fs') as typeof import('fs')
  try {
    return readdirSync(dir)
      .filter((f: string) => f.endsWith('.sql'))
      .sort()
  } catch {
    return []
  }
}

/** Minimal shape of the `better-sqlite3` handle this file actually calls. */
interface SqliteHandle {
  exec(sql: string): void
  close(): void
  prepare(sql: string): {
    all(...params: unknown[]): unknown[]
    run(...params: unknown[]): { changes: number | bigint }
  }
}

/**
 * Same resolution order as `lib/db/sqlite-adapter.ts`'s `sqlitePath()` —
 * `TODERO_SQLITE_PATH`, else `TODERO_DATA_DIR`/db.sqlite, else `<cwd>/db.sqlite`.
 *
 * Deliberately inlined rather than `require('./sqlite-adapter')`: this
 * module is reachable two ways — the real Next.js server (plain CommonJS,
 * where the cross-file require would work fine) and `scripts/db-migrate.mjs`
 * indirectly, via `databaseStatus()` -> `lib/db.ts`'s `dbMissingEnv()` ->
 * `resolveAdapter()`, loaded through `scripts/lib/ts-import.mjs`'s ESM
 * loader hook — and a relative `require()` of a sibling `.ts` file failed to
 * resolve under that second context (`Cannot find module './sqlite-adapter'`)
 * even though the two files sit next to each other on disk. A ~6-line pure
 * function has no such dependency on which loader is running it.
 */
function resolveSqlitePath(): string {
  const explicit = process.env.TODERO_SQLITE_PATH?.trim()
  if (explicit) return explicit
  const root = (process.env.TODERO_DIR?.trim() || process.cwd()).replace(/[\\/]+$/, '')
  const dataDir = process.env.TODERO_DATA_DIR?.trim().replace(/[\\/]+$/, '')
  if (dataDir) return `${dataDir}/db.sqlite`
  return `${root}/db.sqlite`
}

function migrateSqliteSync(): void {
  if (ranFor.has('sqlite')) return
  ranFor.add('sqlite')

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { join, dirname } = require('path') as typeof import('path')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { existsSync, mkdirSync, readFileSync } = require('fs') as typeof import('fs')

  const file = resolveSqlitePath()
  const dir = dirname(file)
  try {
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true })
  } catch {
    // Best effort — if the directory truly can't be created, the Database()
    // constructor below fails with its own, more specific OS error.
  }

  const migrationsDir = join(REPO_ROOT, 'migrations', 'sqlite')
  const files = migrationFiles(migrationsDir)
  if (files.length === 0) return

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3') as typeof import('better-sqlite3')
  // Deliberately no `{ fileMustExist: true }` here — unlike
  // `sqlite-adapter.ts`'s `open()`, THIS is the code path allowed to create
  // the file. That is the entire fix this piece exists to ship.
  const db = new Database(file) as unknown as SqliteHandle
  try {
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
    db.exec('PRAGMA busy_timeout = 5000')
    db.exec(
      'CREATE TABLE IF NOT EXISTS schema_migrations (' +
        '  filename   TEXT PRIMARY KEY,' +
        "  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))" +
        ')',
    )
    const applied = new Set(
      (db.prepare('SELECT filename FROM schema_migrations').all() as Array<{ filename: string }>).map(
        r => r.filename,
      ),
    )

    for (const name of files) {
      if (applied.has(name)) continue
      const sql = readFileSync(join(migrationsDir, name), 'utf8')
      try {
        db.exec('BEGIN')
        db.exec(sql)
        db.prepare('INSERT INTO schema_migrations (filename) VALUES (?)').run(name)
        db.exec('COMMIT')
      } catch (err) {
        try {
          db.exec('ROLLBACK')
        } catch {
          // nothing was open
        }
        // Never let a bad migration take the whole app down at boot: log it
        // and stop applying (later files may depend on this one), and leave
        // `sqlite-adapter.ts`'s own checks to report whatever is still
        // actually wrong when a query runs. `npm run db:migrate` shows the
        // full error for someone fixing the SQL.
        // eslint-disable-next-line no-console
        console.error(
          `[boot-migrate] sqlite/${name} did not apply automatically — ` +
            `${err instanceof Error ? err.message : String(err)} ` +
            '— run `npm run db:migrate` for the full error.',
        )
        break
      }
    }
  } finally {
    db.close()
  }
}

function migratePostgresAsync(): void {
  if (ranFor.has('postgres')) return
  ranFor.add('postgres')

  const databaseUrl = (process.env.DATABASE_URL ?? '').trim()
  if (!databaseUrl) return // nothing to connect to yet — db:migrate explains why when run by hand

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { join } = require('path') as typeof import('path')
  const migrationsDir = join(REPO_ROOT, 'migrations')
  const files = migrationFiles(migrationsDir)
  if (files.length === 0) return

  void (async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { readFileSync } = require('fs') as typeof import('fs')
    let PoolCtor
    try {
      ;({ Pool: PoolCtor } = await import('pg'))
    } catch {
      return // pg not installed — nothing this runner can do silently
    }
    const pool = new PoolCtor({ connectionString: databaseUrl })
    const client = await pool.connect()
    try {
      await client.query(
        'CREATE TABLE IF NOT EXISTS schema_migrations (' +
          '  filename   TEXT PRIMARY KEY,' +
          '  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()' +
          ')',
      )
      const { rows } = await client.query('SELECT filename FROM schema_migrations')
      const applied = new Set((rows as Array<{ filename: string }>).map(r => r.filename))
      for (const file of files) {
        if (applied.has(file)) continue
        const sql = readFileSync(join(migrationsDir, file), 'utf8')
        try {
          await client.query('BEGIN')
          await client.query(sql)
          await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file])
          await client.query('COMMIT')
        } catch (err) {
          await client.query('ROLLBACK').catch(() => {})
          // eslint-disable-next-line no-console
          console.error(
            `[boot-migrate] ${file} did not apply automatically — ` +
              `${err instanceof Error ? err.message : String(err)} ` +
              '— run `npm run db:migrate` for the full error.',
          )
          break
        }
      }
    } finally {
      client.release()
      await pool.end()
    }
  })().catch(err => {
    // eslint-disable-next-line no-console
    console.error(
      '[boot-migrate] postgres boot migration failed:',
      err instanceof Error ? err.message : String(err),
    )
  })
}

/**
 * Called once from `lib/db.ts`'s `resolveAdapter()`, before the adapter for
 * `provider` is created — i.e. on the first real use of the database seam.
 * No-op during `next build`; no-op for `supabase` (see module comment).
 * Never throws — a failure here must not be the reason `db()` breaks in a
 * way its own, more specific configuration errors don't already cover.
 */
export function ensureMigratedOnBoot(provider: string): void {
  if (isBuildPhase()) return
  try {
    if (provider === 'sqlite') {
      migrateSqliteSync()
    } else if (provider === 'postgres') {
      migratePostgresAsync()
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      '[boot-migrate] boot migration failed:',
      err instanceof Error ? err.message : String(err),
    )
  }
}

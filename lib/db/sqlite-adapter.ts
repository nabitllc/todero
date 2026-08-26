// ─── SQLite adapter (better-sqlite3) — the zero-account default ──────────────
//
// The third implementation of the `DbAdapter` contract in `lib/db.ts`, and the
// one that makes `git clone && npm install && npm run setup && npm run dev`
// end at a working board instead of at a signup form. It needs no server, no
// connection string, no project and no account: the whole database is one file
// under the checkout, created by `migrations/sqlite/000_baseline.sql`.
//
// It is the DEFAULT only when nothing else is configured — see
// `lib/db/adapters.ts`. An install that has Supabase credentials or a
// DATABASE_URL keeps the adapter it already had.
//
// DRIVER: `better-sqlite3` — the same synchronous, single-file driver
// builderz-labs/mission-control runs on, and the ONLY sqlite driver this repo
// uses anywhere: this adapter, `scripts/db-migrate.mjs`, and the test fixture
// in `lib/__tests__/db-seam.test.ts` all open the file through it, with the
// same four PRAGMAs. Two engines writing one file was a real bug here once —
// `node:sqlite` has no `busy_timeout`, so a migration run against a live dev
// server died in ~2ms with "database is locked" instead of waiting. It ships
// prebuilt binaries for common platform/ABI pairs (macOS, Linux glibc and
// musl, Windows — x64 and arm64), so `npm install` is a no-toolchain step on
// those; on an uncommon host (FreeBSD, 32-bit, an ABI newer than the last
// published prebuild) `npm install` compiles it from source instead, which
// needs a C++ toolchain (`node-gyp`'s usual prerequisites). Nothing above
// this file (or `lib/db.ts`) knows it exists. The connection is a
// module-level singleton (`handle`, below): one open file descriptor per
// process, reused by every route handler, with PRAGMAs set once at open time:
//   - `journal_mode = WAL`      concurrent readers while a writer holds the file
//   - `synchronous = NORMAL`    safe under WAL, far fewer fsyncs than FULL
//   - `foreign_keys = ON`       the baseline declares real FKs; SQLite defaults them off
//   - `busy_timeout = 5000`     Next.js runs concurrent route handlers against
//                               the same file — without this a second writer
//                               gets `SQLITE_BUSY` immediately instead of
//                               waiting its turn.
//
// Enable it explicitly with:
//     TODERO_DB_PROVIDER=sqlite
//     TODERO_SQLITE_PATH=/some/where/db.sqlite     (optional, full file path)
//     TODERO_DATA_DIR=/some/where                  (optional, directory — see sqlitePath())
//
// HOW IT AVOIDS BEING A SECOND DIALECT
//   Query building is `SqlQueryBuilder` from `pg-adapter.ts`, compiled by
//   `pg-sql.ts` in its `sqlite` dialect. This file therefore contains no verb,
//   no filter and no modifier — only the four things that genuinely differ
//   from a Postgres driver:
//     1. opening the file and running a statement (`executor`),
//     2. encoding JS values SQLite cannot bind (booleans, Dates, objects),
//     3. decoding the columns whose storage type is lossy (BOOLEAN → 0/1,
//        JSON_TEXT → a string) back into what the app expects,
//     4. the two stored procedures the seam's `rpc()` calls, which SQLite has
//        no way to define in DDL.

import type {
  DbAdapter,
  DbAdapterFactory,
  DbError,
  DbResult,
  DbRow,
} from '../db'
import { DbConfigurationError } from './errors'
import { SqlQueryBuilder, type SqlExecutor, type SqlFlavour } from './pg-adapter'

/** Where the database file lives when `TODERO_SQLITE_PATH` does not say. */
const DEFAULT_FILENAME = 'db.sqlite'

/** The subset of `better-sqlite3`'s `Database` this file actually uses. */
interface SqliteDatabase {
  exec(sql: string): void
  close(): void
  prepare(sql: string): {
    all(...params: unknown[]): unknown[]
    run(...params: unknown[]): { changes: number | bigint }
  }
}

/**
 * Absolute path of the database file. Inside the checkout by default, so it
 * travels with the install and is trivially deletable to start over.
 *
 * Resolution order:
 *   1. `TODERO_SQLITE_PATH` — an exact file path, wins outright. Kept for
 *      installs (and this repo's own test seam, `db-seam.test.ts`) that
 *      already pin one.
 *   2. `TODERO_DATA_DIR` — a directory; the file is `db.sqlite` inside it.
 *      This is the knob builderz-labs/mission-control exposes, and the one
 *      an operator reaches for to move the whole data directory (a Docker
 *      volume mount, a different disk) without also renaming the file.
 *   3. Neither set: `db.sqlite` at the repo root — unchanged from every
 *      existing install, `.gitignore` entry, and `.env.local.template` note.
 *
 * The root for (2)/(3) is resolved the same way `lib/paths.ts` resolves
 * `TODERO_DIR` (explicit env var, else the working directory) but WITHOUT
 * importing it: that module reaches for `os`/`fs`/`child_process` at module
 * scope, and `lib/db.ts` — which reaches this file through the adapter
 * registry — is in the client graph. Forward slashes are correct on every
 * platform SQLite runs on, Windows included.
 */
export function sqlitePath(): string {
  const explicit = process.env.TODERO_SQLITE_PATH?.trim()
  if (explicit) return explicit
  const root = (process.env.TODERO_DIR?.trim() || process.cwd()).replace(/[\\/]+$/, '')
  const dataDir = process.env.TODERO_DATA_DIR?.trim().replace(/[\\/]+$/, '')
  if (dataDir) return `${dataDir}/${DEFAULT_FILENAME}`
  return `${root}/${DEFAULT_FILENAME}`
}

// ── driver ───────────────────────────────────────────────────────────────────

let handle: SqliteDatabase | null = null
let injected: SqlExecutor | null = null

/**
 * This adapter needs no environment variables at all — that is the point of
 * it. Returning an empty list is what makes `isDbConfigured()` true on a host
 * where nobody has signed up for anything.
 */
export function sqliteMissingEnv(): string[] {
  return []
}

function open(): SqliteDatabase {
  if (handle) return handle
  const file = sqlitePath()

  // Deliberately refuse to CREATE the file. `better-sqlite3`'s constructor on a
  // missing path happily makes an empty database, and every query after that
  // fails with "no such table: issues" — a message that describes the symptom
  // and hides the cause. Creating the schema is `npm run db:migrate`'s job;
  // saying so here is what turns a confusing 500 into a 503 naming the command.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { existsSync } = require('fs') as typeof import('fs')
  if (!existsSync(file)) {
    throw new DbConfigurationError(
      `The local database file does not exist yet: ${file}. ` +
        `Run \`npm run db:migrate\` (or \`npm run setup\`) to create it. ` +
        `Point TODERO_SQLITE_PATH or TODERO_DATA_DIR somewhere else to use a different file.`,
    )
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const Database = require('better-sqlite3') as typeof import('better-sqlite3')
  // `fileMustExist` is the driver's own belt to the existsSync check's braces —
  // a TOCTOU deletion between the two lines above still fails loudly, not by
  // silently creating an empty database out from under the check.
  const db = new Database(file, { fileMustExist: true }) as unknown as SqliteDatabase
  // Referential integrity is off by default in SQLite; the baseline declares
  // real foreign keys, so turn it on and behave like the Postgres install.
  db.exec('PRAGMA foreign_keys = ON')
  // WAL lets the dev server read while a migration or a script writes.
  db.exec('PRAGMA journal_mode = WAL')
  // NORMAL is safe under WAL (only checkpoints need to survive a power loss,
  // not every commit) and far cheaper than the FULL default — the same
  // tradeoff builderz-labs/mission-control makes for the same reason.
  db.exec('PRAGMA synchronous = NORMAL')
  // Next.js runs concurrent route handlers against this same file; without a
  // busy timeout a second writer gets SQLITE_BUSY immediately instead of
  // waiting the first one out.
  db.exec('PRAGMA busy_timeout = 5000')
  handle = db
  return db
}

/** Close the open file, if any. The next query reopens it. */
export function closeSqlite(): void {
  try {
    handle?.close()
  } catch {
    // already closed — nothing to release
  }
  handle = null
  columnKinds.clear()
}

/** Point the adapter at a different SQLite for the duration of a test. */
export function setSqliteExecutor(next: SqlExecutor | null): void {
  injected = next
  columnKinds.clear()
}

// ── value encoding ───────────────────────────────────────────────────────────

/**
 * Make a JS value bindable. `better-sqlite3` accepts null, numbers, strings,
 * bigints and buffers and rejects everything else outright, so the three
 * shapes the app really passes — booleans, Dates and JSON payloads — are
 * converted here rather than at 200 call sites.
 */
function encode(value: unknown): unknown {
  if (value === undefined) return null
  if (typeof value === 'boolean') return value ? 1 : 0
  if (value instanceof Date) return value.toISOString()
  if (value !== null && typeof value === 'object') return JSON.stringify(value)
  return value
}

// ── row decoding ─────────────────────────────────────────────────────────────

type ColumnKind = 'boolean' | 'json'

/** Declared-type map per table, read once from the schema itself. */
const columnKinds = new Map<string, Map<string, ColumnKind>>()

/**
 * Which columns of `table` need decoding, from SQLite's own catalogue.
 *
 * The baseline declares JSON columns as `JSON_TEXT` and boolean columns as
 * `BOOLEAN` precisely so this lookup exists — a plain `TEXT` column holding
 * `[1,2]` is text, and guessing by looking at values would corrupt it.
 */
function kindsFor(db: SqliteDatabase, table: string): Map<string, ColumnKind> {
  const cached = columnKinds.get(table)
  if (cached) return cached
  const kinds = new Map<string, ColumnKind>()
  try {
    const rows = db.prepare('SELECT "name", "type" FROM pragma_table_info(?)').all(table) as Array<{
      name: string
      type: string
    }>
    for (const row of rows) {
      const declared = String(row.type ?? '').toUpperCase()
      if (declared.startsWith('JSON')) kinds.set(row.name, 'json')
      else if (declared === 'BOOLEAN') kinds.set(row.name, 'boolean')
    }
  } catch {
    // No such table — the query about to run will report that itself, with the
    // table name in the message. Nothing to decode in the meantime.
  }
  columnKinds.set(table, kinds)
  return kinds
}

/**
 * Boolean-declared columns of `table`, from the same catalogue lookup
 * `kindsFor` already does for row decoding — see `SqlFlavour.booleanColumns`
 * in `pg-adapter.ts` for why this exists. Skipped while a test has injected
 * its own executor via `setSqliteExecutor`: that executor is not guaranteed
 * to be a real `better-sqlite3` handle `pragma_table_info` can run against,
 * and no test currently relies on the coercion, so the safe default is to
 * fall back to the pre-fix, uncoerced behaviour rather than open a real file
 * out from under an injected one.
 */
function booleanColumnsFor(table: string): ReadonlySet<string> {
  if (injected) return new Set()
  const db = open()
  const kinds = kindsFor(db, table)
  const out = new Set<string>()
  for (const [column, kind] of kinds) if (kind === 'boolean') out.add(column)
  return out
}

function decodeValue(kind: ColumnKind, value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (kind === 'boolean') return value !== 0 && value !== '0'
  try {
    return JSON.parse(String(value))
  } catch {
    // Not JSON after all — hand back what is stored rather than throwing away
    // a value the app may still be able to use.
    return value
  }
}

/** Turn one driver row into the row shape the app expects. */
function decodeRow(kinds: Map<string, ColumnKind>, row: Record<string, unknown>): DbRow {
  // The driver returns null-prototype objects; spread gives a plain one, which
  // is what every caller (and JSON.stringify) assumes.
  const out: DbRow = { ...row }
  if (kinds.size === 0) return out
  for (const [column, kind] of Array.from(kinds.entries())) {
    if (column in out) out[column] = decodeValue(kind, out[column])
  }
  return out
}

// ── executor ─────────────────────────────────────────────────────────────────

const SELECTS = /^\s*(SELECT|WITH|PRAGMA)/i

/**
 * Run one statement. `table` names the table whose declared column types
 * decode the result — `from(table)` always knows it, and a statement about
 * some other table (the count query, a pragma) simply has nothing to decode.
 */
function executorFor(table: string | null): SqlExecutor {
  if (injected) return injected
  return {
    async query(text, values) {
      const db = open()
      const statement = db.prepare(text)
      const bound = values.map(encode)
      // RETURNING makes a write produce rows, so anything may need `all()`.
      // `run()` is only for the statements that cannot: those with no result
      // columns at all, where `all()` would return [] and lose `changes`.
      const returnsRows = SELECTS.test(text) || /\bRETURNING\b/i.test(text)
      if (returnsRows) {
        const raw = statement.all(...bound) as Array<Record<string, unknown>>
        const kinds = table ? kindsFor(db, table) : new Map<string, ColumnKind>()
        const rows = raw.map(row => decodeRow(kinds, row))
        return { rows, rowCount: rows.length }
      }
      const result = statement.run(...bound)
      return { rows: [], rowCount: Number(result.changes) }
    },
  }
}

// ── error mapping ────────────────────────────────────────────────────────────

/** Error fields `better-sqlite3` attaches. */
interface SqliteErrorShape {
  message?: unknown
  code?: unknown
  errstr?: unknown
}

/**
 * Map a driver error onto the seam's envelope, translating the two SQLSTATEs
 * `lib/db.ts` guarantees (`DB_ERROR.UNDEFINED_TABLE` / `UNDEFINED_COLUMN`) so
 * callers that branch on them keep working on this adapter too.
 */
function toDbError(cause: unknown): DbError {
  const e = (cause ?? {}) as SqliteErrorShape
  const message = typeof e.message === 'string' ? e.message : String(cause)
  let code = typeof e.code === 'string' ? e.code : undefined
  if (/no such table/i.test(message)) code = '42P01'
  else if (/no such column|has no column named/i.test(message)) code = '42703'
  return {
    message,
    ...(code ? { code } : {}),
    details: typeof e.errstr === 'string' ? e.errstr : null,
    hint: null,
  }
}

// ── stored procedures ────────────────────────────────────────────────────────

/**
 * The two functions the app calls through `rpc()`. SQLite has no CREATE
 * FUNCTION, so they live here instead of in the baseline — same semantics,
 * same return shape, so `app/api/issues/route.ts` and
 * `app/api/settings/usage/route.ts` need no branch of their own.
 *
 * Anything else is answered with an error naming the function, rather than a
 * silent null that would look like a legitimate empty result.
 */
async function callRpc(fn: string, params: DbRow | undefined): Promise<DbResult> {
  const exec = executorFor(null)

  if (fn === 'next_issue_number') {
    const prefix = String((params ?? {}).p_prefix ?? '')
    // The same atomic INSERT … ON CONFLICT DO UPDATE … RETURNING as
    // migrations/021_issue_sequences.sql — no read-then-write gap.
    const result = await exec.query(
      'INSERT INTO issue_sequences (prefix, next_number) VALUES (?, 1) ' +
        'ON CONFLICT (prefix) DO UPDATE SET next_number = issue_sequences.next_number + 1 ' +
        'RETURNING next_number',
      [prefix],
    )
    const next = result.rows[0]?.next_number ?? null
    return { data: next, error: null, count: 1, status: 200 }
  }

  if (fn === 'pg_database_size_bytes') {
    const result = await exec.query('SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()', [])
    return { data: result.rows[0]?.bytes ?? 0, error: null, count: 1, status: 200 }
  }

  return {
    data: null,
    error: {
      message:
        `Stored procedure "${fn}" is not implemented on the sqlite provider. ` +
        `SQLite has no CREATE FUNCTION — add it to lib/db/sqlite-adapter.ts, or run ` +
        `Todero on the postgres/supabase provider where migrations/ defines it.`,
      code: '42883',
      details: null,
      hint: null,
    },
    count: null,
    status: 400,
  }
}

// ── factory ──────────────────────────────────────────────────────────────────

export const sqliteAdapterFactory: DbAdapterFactory = {
  provider: 'sqlite',
  create(): DbAdapter {
    const adapter: DbAdapter = {
      provider: 'sqlite',
      missingEnv: sqliteMissingEnv,
      from: (table: string) =>
        new SqlQueryBuilder(executorFor(table), () => adapter, table, {
          dialect: 'sqlite',
          splitRaggedInserts: true,
          toDbError,
          booleanColumns: booleanColumnsFor,
        } satisfies SqlFlavour),
      rpc: async (fn: string, params?: DbRow): Promise<DbResult> => {
        try {
          return await callRpc(fn, params)
        } catch (cause) {
          // "the database is not set up" is a configuration failure, not a bad
          // query — it must reach lib/db-http.ts as a 503 naming the fix.
          if (cause instanceof DbConfigurationError) throw cause
          return { data: null, error: toDbError(cause), count: null, status: 400 }
        }
      },
    }
    return adapter
  },
}

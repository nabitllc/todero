// ─── SQLite adapter (node:sqlite) — the zero-account default ─────────────────
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
// Zero dependencies on purpose: `node:sqlite` ships inside Node itself (22.5+;
// this repo runs 24), so "clone and run" stays true on a host with nothing
// installed but Node — which is the same promise `npm run setup` makes.
//
// Enable it explicitly with:
//     TODERO_DB_PROVIDER=sqlite
//     TODERO_SQLITE_PATH=/some/where/db.sqlite     (optional)
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
import { SqlQueryBuilder, type SqlExecutor, type SqlFlavour } from './pg-adapter'

/** Where the database file lives when `TODERO_SQLITE_PATH` does not say. */
const DEFAULT_FILENAME = 'db.sqlite'

/** The one thing `node:sqlite` gives us, narrowed to what this file uses. */
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
 * The root is resolved the same way `lib/paths.ts` resolves `TODERO_DIR`
 * (explicit env var, else the working directory) but WITHOUT importing it:
 * that module reaches for `os`/`fs`/`child_process` at module scope, and
 * `lib/db.ts` — which reaches this file through the adapter registry — is in
 * the client graph. Forward slashes are correct on every platform SQLite runs
 * on, Windows included.
 */
export function sqlitePath(): string {
  const explicit = process.env.TODERO_SQLITE_PATH?.trim()
  if (explicit) return explicit
  const root = (process.env.TODERO_DIR?.trim() || process.cwd()).replace(/[\\/]+$/, '')
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
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
  const db = new DatabaseSync(sqlitePath()) as unknown as SqliteDatabase
  // Referential integrity is off by default in SQLite; the baseline declares
  // real foreign keys, so turn it on and behave like the Postgres install.
  db.exec('PRAGMA foreign_keys = ON')
  // WAL lets the dev server read while a migration or a script writes.
  db.exec('PRAGMA journal_mode = WAL')
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
 * Make a JS value bindable. `node:sqlite` accepts null, numbers, strings,
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

/** Error fields `node:sqlite` attaches. */
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
        } satisfies SqlFlavour),
      rpc: async (fn: string, params?: DbRow): Promise<DbResult> => {
        try {
          return await callRpc(fn, params)
        } catch (cause) {
          return { data: null, error: toDbError(cause), count: null, status: 400 }
        }
      },
    }
    return adapter
  },
}

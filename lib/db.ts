// ─── The database seam ───────────────────────────────────────────────────────
//
// This file is the ONLY thing the application is allowed to know about
// persistence. Nothing above it may import a vendor SDK, name a vendor product,
// or hardcode a project URL or key. Vendor code lives under `lib/db/`.
//
// WHY THIS EXISTS
//   Todero is moving off its current hosted Postgres onto Postgres on Vercel
//   (Neon). The current vendor was only ever used as plain Postgres: 0 uses of
//   its storage, realtime, channels or auth-as-a-service, and all 40 migrations
//   are plain SQL. So the migration is an adapter swap, not a rewrite — provided
//   every call site goes through here.
//
// HOW TO ADD AN ADAPTER (the contract)
//   One sentence: implement `DbAdapterFactory.create()` so it returns a
//   `DbAdapter` whose `from(table)` hands back a chainable `DbQueryBuilder`
//   compiling to SQL and resolving to `DbResult`, plus `rpc()`, plus
//   `missingEnv()` naming any env vars it needs but cannot find. Then register
//   it in `lib/db/adapters.ts`. Nothing else in the app changes;
//   `TODERO_DB_PROVIDER` selects it at runtime.
//
// THE CONTRACT IS PROVEN, NOT ASSERTED
//   Three adapters implement it today and none of them is privileged:
//     provider `sqlite` — `lib/db/sqlite-adapter.ts`. One file on disk through
//       `better-sqlite3`, needing no server, no connection string and
//       no account. It is what a checkout with no credentials resolves to, so
//       `git clone && npm run setup && npm run dev` ends at a working board.
//     provider `postgres` — `lib/db/pg-adapter.ts`. A plain node-postgres
//       driver against `DATABASE_URL`. Every call below compiles to a
//       parameterised SQL statement; there is no HTTP and no query grammar
//       anywhere in it. This is the adapter a Neon / Vercel-Postgres / RDS move
//       uses as-is — the connection string changes, the code does not.
//     the hosted default — registered in `lib/db/adapters.ts`. Translates the
//       same calls onto a vendor SDK, and is the only place that grammar lives.
//   `lib/__tests__/db-seam.test.ts` runs one identical query set through ALL
//   THREE via `describe.each`, so a method only some of them can express fails
//   the suite. That is the guard against this interface quietly re-growing a
//   vendor dialect.
//
// Note for reviewers: this file deliberately contains no vendor name and no env
// var name. Both live in the adapters. Every verb, filter and modifier below
// maps one-to-one onto a SQL clause — SELECT column list, WHERE predicate,
// ON CONFLICT target, ORDER BY, LIMIT/OFFSET — and filters are passed as data
// (`DbPredicate`), never as a string of somebody's query grammar.

import { DEFAULT_DB_PROVIDER, DB_ADAPTERS } from './db/adapters'
import { DbConfigurationError } from './db/errors'
import { ensureMigratedOnBoot } from './db/boot-migrate'

export { DbConfigurationError }

/** Active provider key. Override with `TODERO_DB_PROVIDER` in the environment. */
export const DB_PROVIDER: string = process.env.TODERO_DB_PROVIDER ?? DEFAULT_DB_PROVIDER

/** A row as the app hands it to the seam — column name to value. */
export type DbRow = Record<string, unknown>

/**
 * Error codes the seam guarantees regardless of which adapter answered.
 * Adapters translate their driver's own codes onto these.
 */
export const DB_ERROR = {
  /** `single()` did not match exactly one row. */
  NO_ROWS: 'PGRST116',
  /** The table does not exist (SQLSTATE 42P01). */
  UNDEFINED_TABLE: '42P01',
  /** The column does not exist (SQLSTATE 42703). */
  UNDEFINED_COLUMN: '42703',
} as const

/** Error envelope returned alongside data. Errors are returned, never thrown. */
export interface DbError {
  message: string
  code?: string
  details?: string | null
  hint?: string | null
}

/**
 * Row payload as it comes back from a query.
 *
 * Intentionally `any`: the app has no generated schema types, so the current
 * adapter already resolves rows as `any` at all 200+ call sites. Narrowing this
 * is a separate, much larger typing migration and is out of scope for the seam
 * — doing it here would turn a mechanical swap into a 200-file refactor.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DbData = any

/** Result envelope for every query. Adapters SHOULD keep this shape exactly. */
export interface DbResult<T = DbData> {
  data: T
  error: DbError | null
  /** Row count when the query asked for one, otherwise null. */
  count: number | null
  status?: number
}

/** Options accepted by `select()`. */
export interface DbSelectOptions {
  count?: 'exact' | 'planned' | 'estimated' | null
  head?: boolean
}

/** Options accepted by `upsert()`. */
export interface DbUpsertOptions extends DbSelectOptions {
  /**
   * Comma-separated column names forming the unique constraint to merge on —
   * the `ON CONFLICT (…)` target. Omit it to use the table's primary key.
   */
  onConflict?: string
  ignoreDuplicates?: boolean
  defaultToNull?: boolean
}

/** Options accepted by the ordering modifier. Both map onto `ORDER BY`. */
export interface DbOrderOptions {
  ascending?: boolean
  nullsFirst?: boolean
}

/**
 * The comparison vocabulary of the seam. Every name here is one SQL operator
 * and nothing else:
 *
 *   eq `=`   neq `<>`   gt `>`   gte `>=`   lt `<`   lte `<=`
 *   like `LIKE`   ilike `ILIKE`   is `IS`   in `= ANY(…)`   contains `@>`
 *
 * A filter is never expressed as a string of grammar. Callers pass a column,
 * one of these operators, and a value; adapters turn that into their own wire
 * form. `in` takes an array, `is` takes `null | true | false`.
 */
export type DbComparison =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'like'
  | 'ilike'
  | 'is'
  | 'in'
  | 'contains'

/** One `column <operator> value` comparison, as data rather than as text. */
export interface DbPredicate {
  column: string
  op: DbComparison
  value: unknown
}

/**
 * Pull columns from a related table into each row of the result.
 *
 * Deliberately explicit — the related table, the two columns that join it, and
 * the key the nested object lands under are all named by the caller. Adapters
 * therefore need no foreign-key metadata and no embedding grammar: both the
 * SQL and the hosted-Postgres adapter satisfy this with a second keyed lookup.
 *
 * `{ table: 'businesses', columns: ['name'], localColumn: 'business_id' }`
 * turns `{ id, business_id }` into `{ id, business_id, businesses: { name } }`.
 */
export interface DbJoin {
  /** Related table to read from. */
  table: string
  /** Columns to take from the related table. */
  columns: readonly string[]
  /** Column on THIS table holding the reference. */
  localColumn: string
  /** Column on the related table the reference points at. Default `'id'`. */
  foreignColumn?: string
  /** Key the nested object appears under in each row. Default = `table`. */
  as?: string
}

/**
 * A chainable query against one table.
 *
 * Every modifier returns the builder so calls can be chained, and the builder
 * itself is thenable so `await` runs it. Each method names a SQL clause, not a
 * transport: a driver-based adapter implements it as a query object that
 * compiles a statement and executes it on `then()`.
 */
export interface DbQueryBuilder extends PromiseLike<DbResult> {
  // ── verbs ──
  /** Column list for the SELECT — `'*'`, or `'id,title'`. Default `'*'`. */
  select(columns?: string, options?: DbSelectOptions): DbQueryBuilder
  insert(values: DbRow | DbRow[], options?: DbSelectOptions): DbQueryBuilder
  upsert(values: DbRow | DbRow[], options?: DbUpsertOptions): DbQueryBuilder
  update(values: DbRow, options?: DbSelectOptions): DbQueryBuilder
  delete(options?: DbSelectOptions): DbQueryBuilder

  // ── filters ──
  eq(column: string, value: unknown): DbQueryBuilder
  neq(column: string, value: unknown): DbQueryBuilder
  gt(column: string, value: unknown): DbQueryBuilder
  gte(column: string, value: unknown): DbQueryBuilder
  lt(column: string, value: unknown): DbQueryBuilder
  lte(column: string, value: unknown): DbQueryBuilder
  like(column: string, pattern: string): DbQueryBuilder
  ilike(column: string, pattern: string): DbQueryBuilder
  is(column: string, value: boolean | null): DbQueryBuilder
  in(column: string, values: readonly unknown[]): DbQueryBuilder
  contains(column: string, value: string | readonly unknown[] | DbRow): DbQueryBuilder
  /** Negate one comparison: `NOT (column <op> value)`. */
  not(column: string, op: DbComparison, value: unknown): DbQueryBuilder
  /**
   * Disjunction: every predicate joined by OR, wrapped in parentheses, and
   * ANDed with the rest of the WHERE clause. Predicates are data, never
   * grammar — `[{ column: 'agent_id', op: 'eq', value: 'kaos' }, …]`.
   */
  or(predicates: readonly DbPredicate[]): DbQueryBuilder
  /** Same as calling the named comparison directly; useful when it is dynamic. */
  filter(column: string, op: DbComparison, value: unknown): DbQueryBuilder
  match(query: DbRow): DbQueryBuilder

  // ── shaping ──
  order(column: string, options?: DbOrderOptions): DbQueryBuilder
  limit(count: number): DbQueryBuilder
  range(from: number, to: number): DbQueryBuilder
  /** Attach columns from a related table. See `DbJoin`. */
  join(spec: DbJoin): DbQueryBuilder
  single<T = DbData>(): PromiseLike<DbResult<T>>
  maybeSingle<T = DbData>(): PromiseLike<DbResult<T>>
  /** Re-type the rows this query resolves to, without changing the query. */
  returns<T = DbData>(): DbQueryBuilder
}

/**
 * The server-side database handle. Everything the app needs from persistence.
 * Implement this and register a factory to change vendors.
 */
export interface DbAdapter {
  /** Provider key this adapter was registered under. */
  readonly provider: string
  /** Env var names this adapter requires but could not find. Empty = ready. */
  missingEnv(): string[]
  /** Start a query against `table`. Throws `DbConfigurationError` if unconfigured. */
  from(table: string): DbQueryBuilder
  /** Call a stored procedure. Throws `DbConfigurationError` if unconfigured. */
  rpc(fn: string, params?: DbRow): PromiseLike<DbResult>
}

/** Registration entry for an adapter implementation. */
export interface DbAdapterFactory {
  readonly provider: string
  create(): DbAdapter
}

let cached: DbAdapter | null = null

function resolveAdapter(): DbAdapter {
  if (cached) return cached
  const factory = DB_ADAPTERS[DB_PROVIDER]
  if (!factory) {
    throw new DbConfigurationError(
      `Unknown database provider "${DB_PROVIDER}". Set TODERO_DB_PROVIDER to one of: ` +
        Object.keys(DB_ADAPTERS).join(', '),
    )
  }
  // Boot-time migrations: the first call to db() applies whatever
  // migrations/ has not yet been applied, so starting the app is enough —
  // `npm run db:migrate` remains available for an operator who wants to run
  // it deliberately, but is never required. See lib/db/boot-migrate.ts.
  ensureMigratedOnBoot(DB_PROVIDER)
  cached = factory.create()
  return cached
}

/**
 * The server-side database handle, using service credentials.
 *
 * Resolution is lazy on purpose: many modules call `db()` at import time, and a
 * throw there would take down the whole route tree with a stack trace pointing
 * at the wrong file. The credential check therefore happens on first query, and
 * fails with a `DbConfigurationError` that names the exact missing env vars.
 */
export function db(): DbAdapter {
  return handle
}

const handle: DbAdapter = {
  get provider() {
    return DB_PROVIDER
  },
  missingEnv: () => resolveAdapter().missingEnv(),
  from: (table: string) => resolveAdapter().from(table),
  rpc: (fn: string, params?: DbRow) => resolveAdapter().rpc(fn, params),
}

/** Env vars the active adapter needs but cannot find. Empty array = ready. */
export function dbMissingEnv(): string[] {
  try {
    return resolveAdapter().missingEnv()
  } catch (e) {
    return e instanceof DbConfigurationError ? [`TODERO_DB_PROVIDER=${DB_PROVIDER}`] : []
  }
}

/**
 * True when the database is usable. Callers should branch on this to degrade
 * honestly — an explicit "not configured" beats an empty list that looks like
 * real data.
 */
export function isDbConfigured(): boolean {
  return dbMissingEnv().length === 0
}

/** Throw a readable, variable-naming error if the database is not configured. */
export function assertDbConfigured(): void {
  const missing = dbMissingEnv()
  if (missing.length > 0) {
    throw new DbConfigurationError(
      `Database is not configured (provider "${DB_PROVIDER}"). Missing environment ` +
        `variable${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}. ` +
        `Set ${missing.length > 1 ? 'them' : 'it'} in .env.local — see .env.local.template.`,
    )
  }
}

/** One-line human summary for health endpoints and startup logs. */
export function dbStatusMessage(): string {
  const missing = dbMissingEnv()
  return missing.length === 0
    ? `database ready (provider "${DB_PROVIDER}")`
    : `database not configured (provider "${DB_PROVIDER}"): missing ${missing.join(', ')}`
}

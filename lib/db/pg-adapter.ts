// ─── Postgres adapter (node-postgres) ────────────────────────────────────────
//
// The second, independent implementation of the `DbAdapter` contract in
// `lib/db.ts`, and the reason that contract can be trusted: this file speaks
// nothing but SQL. Every builder call is accumulated into a `PgQuerySpec` and
// compiled by `pg-sql.ts` into one parameterised statement, executed on
// `then()`. There is no HTTP client here, no query-string grammar, and no
// vendor SDK — so a hosted-Postgres move (Neon / Vercel Postgres / RDS / a
// container on a laptop) is a `DATABASE_URL`, not a code change.
//
// Enable it with:
//     TODERO_DB_PROVIDER=postgres
//     DATABASE_URL=postgresql://user:pass@host:5432/dbname
//
// `lib/__tests__/db-seam.test.ts` drives this adapter against a real Postgres
// created from the repo's own `migrations/*.sql`, running the identical query
// set it runs through the hosted adapter.

import type { Pool } from 'pg'
import type {
  DbAdapter,
  DbAdapterFactory,
  DbData,
  DbError,
  DbJoin,
  DbOrderOptions,
  DbPredicate,
  DbComparison,
  DbQueryBuilder,
  DbResult,
  DbRow,
  DbSelectOptions,
  DbUpsertOptions,
} from '../db'
import { DbConfigurationError } from './errors'
import { attachJoins } from './join'
import {
  compile,
  compileCount,
  compilePrimaryKeyLookup,
  compileRpc,
  type PgQuerySpec,
  type WherePart,
} from './pg-sql'

/** The single env var this adapter needs. */
const REQUIRED_ENV = ['DATABASE_URL'] as const

/**
 * The one thing this adapter needs from the outside world: run a parameterised
 * statement, get rows back. `pg.Pool` satisfies it; so does any other Postgres
 * driver, and so does an in-process Postgres in the test suite.
 */
export interface SqlExecutor {
  query(
    text: string,
    values: readonly unknown[],
  ): Promise<{ rows: DbRow[]; rowCount: number | null }>
}

// ── driver ───────────────────────────────────────────────────────────────────

let pool: Pool | null = null
let injected: SqlExecutor | null = null

export function pgMissingEnv(): string[] {
  return REQUIRED_ENV.filter(name => (process.env[name] ?? '').trim().length === 0)
}

function assertConfigured(): void {
  const missing = pgMissingEnv()
  if (missing.length > 0) {
    throw new DbConfigurationError(
      `Database is not configured. Missing environment variable: ${missing.join(', ')}. ` +
        `Set it in .env.local — see .env.local.template.`,
      missing,
    )
  }
}

function executor(): SqlExecutor {
  if (injected) return injected
  assertConfigured()
  if (!pool) {
    // Required at call time, never at module scope, so no bundler pulls the
    // driver into a browser chunk (next.config.js also stubs it client-side).
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pg = require('pg') as typeof import('pg')
    pool = new pg.Pool({ connectionString: (process.env.DATABASE_URL ?? '').trim() })
  }
  const active = pool
  return {
    async query(text, values) {
      const result = await active.query(text, values as unknown[])
      return { rows: result.rows as DbRow[], rowCount: result.rowCount }
    },
  }
}

/**
 * Point the adapter at a different Postgres for the duration of a test.
 * Pass `null` to go back to the pooled `DATABASE_URL` connection.
 */
export function setSqlExecutor(next: SqlExecutor | null): void {
  injected = next
  primaryKeys.clear()
}

// ── error mapping ────────────────────────────────────────────────────────────

/** Postgres error fields, as node-postgres attaches them. */
interface PgErrorShape {
  message?: unknown
  code?: unknown
  detail?: unknown
  hint?: unknown
}

function toDbError(cause: unknown): DbError {
  const e = (cause ?? {}) as PgErrorShape
  return {
    message: typeof e.message === 'string' ? e.message : String(cause),
    ...(typeof e.code === 'string' ? { code: e.code } : {}),
    details: typeof e.detail === 'string' ? e.detail : null,
    hint: typeof e.hint === 'string' ? e.hint : null,
  }
}

/** The seam's "single() matched no row" code — see `DB_ERROR` in `lib/db.ts`. */
const NO_ROWS = 'PGRST116'

// ── primary keys (default conflict target for upsert) ────────────────────────

const primaryKeys = new Map<string, string[]>()

async function primaryKeyColumns(exec: SqlExecutor, table: string): Promise<string[]> {
  const cached = primaryKeys.get(table)
  if (cached) return cached
  const stmt = compilePrimaryKeyLookup(table)
  const result = await exec.query(stmt.text, stmt.values)
  const columns = result.rows.map(row => String(row.column))
  primaryKeys.set(table, columns)
  return columns
}

// ── the builder ──────────────────────────────────────────────────────────────

type RowMode = 'many' | 'single' | 'maybeSingle'

class PgQueryBuilder implements DbQueryBuilder {
  private readonly spec: PgQuerySpec
  private readonly joins: DbJoin[] = []
  private countMode: DbSelectOptions['count'] = null
  private rowMode: RowMode = 'many'

  constructor(
    private readonly exec: SqlExecutor,
    private readonly adapter: () => DbAdapter,
    table: string,
  ) {
    this.spec = {
      table,
      verb: 'select',
      columns: '*',
      returning: false,
      rows: [],
      patch: null,
      where: [],
      order: [],
      limit: null,
      offset: null,
      onConflict: null,
      ignoreDuplicates: false,
      head: false,
    }
  }

  // ── verbs ──

  select(columns = '*', options?: DbSelectOptions): DbQueryBuilder {
    this.spec.columns = columns
    // `.select()` after a write means "return the rows you touched".
    if (this.spec.verb === 'select') this.spec.head = options?.head ?? false
    else this.spec.returning = true
    this.countMode = options?.count ?? this.countMode
    return this
  }

  insert(values: DbRow | DbRow[], options?: DbSelectOptions): DbQueryBuilder {
    this.spec.verb = 'insert'
    this.spec.rows = Array.isArray(values) ? values : [values]
    this.countMode = options?.count ?? this.countMode
    return this
  }

  upsert(values: DbRow | DbRow[], options?: DbUpsertOptions): DbQueryBuilder {
    this.spec.verb = 'upsert'
    this.spec.rows = Array.isArray(values) ? values : [values]
    this.spec.onConflict = options?.onConflict
      ? options.onConflict.split(',').map(c => c.trim())
      : null
    this.spec.ignoreDuplicates = options?.ignoreDuplicates ?? false
    this.countMode = options?.count ?? this.countMode
    return this
  }

  update(values: DbRow, options?: DbSelectOptions): DbQueryBuilder {
    this.spec.verb = 'update'
    this.spec.patch = values
    this.countMode = options?.count ?? this.countMode
    return this
  }

  delete(options?: DbSelectOptions): DbQueryBuilder {
    this.spec.verb = 'delete'
    this.countMode = options?.count ?? this.countMode
    return this
  }

  // ── filters ──

  private where(column: string, op: DbComparison, value: unknown, negated = false): DbQueryBuilder {
    const part: WherePart = { kind: 'cmp', predicate: { column, op, value }, negated }
    this.spec.where.push(part)
    return this
  }

  eq(column: string, value: unknown) { return this.where(column, 'eq', value) }
  neq(column: string, value: unknown) { return this.where(column, 'neq', value) }
  gt(column: string, value: unknown) { return this.where(column, 'gt', value) }
  gte(column: string, value: unknown) { return this.where(column, 'gte', value) }
  lt(column: string, value: unknown) { return this.where(column, 'lt', value) }
  lte(column: string, value: unknown) { return this.where(column, 'lte', value) }
  like(column: string, pattern: string) { return this.where(column, 'like', pattern) }
  ilike(column: string, pattern: string) { return this.where(column, 'ilike', pattern) }
  is(column: string, value: boolean | null) { return this.where(column, 'is', value) }
  in(column: string, values: readonly unknown[]) { return this.where(column, 'in', [...values]) }

  contains(column: string, value: string | readonly unknown[] | DbRow) {
    return this.where(column, 'contains', value)
  }

  not(column: string, op: DbComparison, value: unknown) {
    return this.where(column, op, value, true)
  }

  filter(column: string, op: DbComparison, value: unknown) {
    return this.where(column, op, value)
  }

  or(predicates: readonly DbPredicate[]): DbQueryBuilder {
    if (predicates.length === 0) {
      throw new Error('or() needs at least one predicate — an empty disjunction has no meaning.')
    }
    this.spec.where.push({ kind: 'or', predicates: [...predicates] })
    return this
  }

  match(query: DbRow): DbQueryBuilder {
    for (const [column, value] of Object.entries(query)) this.where(column, 'eq', value)
    return this
  }

  // ── shaping ──

  order(column: string, options?: DbOrderOptions): DbQueryBuilder {
    this.spec.order.push({
      column,
      ascending: options?.ascending ?? true,
      ...(options?.nullsFirst === undefined ? {} : { nullsFirst: options.nullsFirst }),
    })
    return this
  }

  limit(count: number): DbQueryBuilder {
    this.spec.limit = count
    return this
  }

  range(from: number, to: number): DbQueryBuilder {
    this.spec.offset = from
    this.spec.limit = Math.max(0, to - from + 1)
    return this
  }

  join(spec: DbJoin): DbQueryBuilder {
    this.joins.push(spec)
    return this
  }

  single<T = DbData>(): PromiseLike<DbResult<T>> {
    this.rowMode = 'single'
    this.spec.limit = this.spec.limit ?? 2
    return this as unknown as PromiseLike<DbResult<T>>
  }

  maybeSingle<T = DbData>(): PromiseLike<DbResult<T>> {
    this.rowMode = 'maybeSingle'
    this.spec.limit = this.spec.limit ?? 2
    return this as unknown as PromiseLike<DbResult<T>>
  }

  returns<T = DbData>(): DbQueryBuilder {
    return this
  }

  // ── execution ──

  then<TResult1 = DbResult, TResult2 = never>(
    onfulfilled?: ((value: DbResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected)
  }

  private async run(): Promise<DbResult> {
    try {
      if (this.spec.verb === 'upsert' && !this.spec.onConflict) {
        this.spec.onConflict = await primaryKeyColumns(this.exec, this.spec.table)
      }

      const isRead = this.spec.verb === 'select'
      let rows: DbRow[] = []
      let count: number | null = null

      if (!(isRead && this.spec.head)) {
        const statement = compile(this.spec)
        const executed = await this.exec.query(statement.text, statement.values)
        rows = executed.rows
        if (!isRead) count = executed.rowCount
      }

      if (this.countMode) {
        const counted = compileCount(this.spec)
        const result = await this.exec.query(counted.text, counted.values)
        count = Number(result.rows[0]?.count ?? 0)
      }

      // A write only reports rows when the caller asked for them, exactly as
      // the hosted adapter does — `insert()` alone resolves `data: null`.
      const returnsRows = isRead ? !this.spec.head : this.spec.returning
      const base: DbResult = {
        data: returnsRows ? rows : null,
        error: null,
        count,
        status: 200,
      }

      const joined = await attachJoins(this.adapter(), base, this.joins)
      if (joined.error) return joined
      return this.shape(joined, rows)
    } catch (cause) {
      if (cause instanceof DbConfigurationError) throw cause
      return { data: null, error: toDbError(cause), count: null, status: 400 }
    }
  }

  /** Apply `single()` / `maybeSingle()` row-count expectations. */
  private shape(result: DbResult, rows: DbRow[]): DbResult {
    if (this.rowMode === 'many') return result
    if (rows.length === 1) return { ...result, data: rows[0], count: result.count }
    if (rows.length === 0 && this.rowMode === 'maybeSingle') {
      return { ...result, data: null }
    }
    return {
      data: null,
      error: {
        message: `Expected exactly one row from "${this.spec.table}", got ${rows.length}.`,
        code: NO_ROWS,
        details: null,
        hint: null,
      },
      count: result.count,
      status: 406,
    }
  }
}

// ── factory ──────────────────────────────────────────────────────────────────

export const pgAdapterFactory: DbAdapterFactory = {
  provider: 'postgres',
  create(): DbAdapter {
    const adapter: DbAdapter = {
      provider: 'postgres',
      missingEnv: pgMissingEnv,
      from: (table: string) => new PgQueryBuilder(executor(), () => adapter, table),
      rpc: async (fn: string, params?: DbRow): Promise<DbResult> => {
        const exec = executor()
        try {
          const statement = compileRpc(fn, params)
          const result = await exec.query(statement.text, statement.values)
          // A scalar-returning function comes back as one column on one row;
          // hand back the scalar so callers read it the same way everywhere.
          const [first] = result.rows
          const keys = first ? Object.keys(first) : []
          const data =
            result.rows.length === 1 && keys.length === 1 ? first[keys[0]] : result.rows
          return { data, error: null, count: result.rows.length, status: 200 }
        } catch (cause) {
          if (cause instanceof DbConfigurationError) throw cause
          return { data: null, error: toDbError(cause), count: null, status: 400 }
        }
      },
    }
    return adapter
  },
}

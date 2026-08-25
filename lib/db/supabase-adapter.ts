// ─── Hosted-Postgres adapter (Supabase) ──────────────────────────────────────
//
// Together with `supabase-env.ts`, the ONLY place in the app that imports the
// Supabase SDK or knows the names of the Supabase environment variables.
// Everything else goes through `lib/db.ts`.
//
// Supabase is used here as plain hosted Postgres behind an HTTP query layer: no
// Storage, no Realtime, no channels, no auth-as-a-service. This adapter's whole
// job is to translate the seam's SQL-shaped calls into that HTTP layer's
// grammar — which is why the translation lives HERE and not at the call sites.
// `predicateText()` below is the entire vendor dialect the app still contains.
//
// The sibling `pg-adapter.ts` implements the same contract with nothing but
// SQL. `lib/__tests__/db-seam.test.ts` runs one query set through both, so
// neither adapter can quietly widen the seam to something only it can express.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type {
  DbAdapter,
  DbAdapterFactory,
  DbComparison,
  DbData,
  DbJoin,
  DbOrderOptions,
  DbPredicate,
  DbQueryBuilder,
  DbResult,
  DbRow,
  DbSelectOptions,
  DbUpsertOptions,
} from '../db'
import { attachJoins } from './join'
import { assertSupabaseConfigured, readSupabaseEnv, supabaseMissingEnv } from './supabase-env'

let client: SupabaseClient | null = null

function getClient(): SupabaseClient {
  assertSupabaseConfigured()
  if (!client) {
    client = createClient(
      readSupabaseEnv('NEXT_PUBLIC_SUPABASE_URL'),
      readSupabaseEnv('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
  }
  return client
}

/**
 * The SDK's builder is generically typed against a schema this app does not
 * generate. `any` here is the single, deliberate boundary between the vendor's
 * types and the seam's — no call site above `lib/db.ts` ever sees either.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SdkBuilder = any

// ── the vendor's filter grammar, contained ───────────────────────────────────

/** Operator names this HTTP layer uses where they differ from the seam's. */
const OPERATOR_TEXT: Partial<Record<DbComparison, string>> = { contains: 'cs' }

/** Values containing a separator have to be quoted in the vendor's grammar. */
function quoteValue(value: unknown): string {
  const text = value === null ? 'null' : String(value)
  return /[,.()"\s]/.test(text) ? `"${text.replace(/"/g, '\\"')}"` : text
}

/** One `DbPredicate` as this vendor's `column.op.value` text. */
function predicateText({ column, op, value, negated }: DbPredicate): string {
  const operator = OPERATOR_TEXT[op] ?? op
  // This grammar spells negation as a `not.` prefix between column and operator.
  const not = negated ? 'not.' : ''
  if (op === 'is') return `${column}.${not}is.${value === null ? 'null' : String(value)}`
  if (op === 'in') {
    const list = Array.isArray(value) ? value : [value]
    return `${column}.${not}in.(${list.map(quoteValue).join(',')})`
  }
  return `${column}.${not}${operator}.${quoteValue(value)}`
}

/** The value half of `not()` / `filter()`, which take operator and value apart. */
function filterValue(op: DbComparison, value: unknown): unknown {
  if (op === 'in') {
    const list = Array.isArray(value) ? value : [value]
    return `(${list.map(quoteValue).join(',')})`
  }
  return value
}

// ── the builder ──────────────────────────────────────────────────────────────

class SupabaseQueryBuilder implements DbQueryBuilder {
  private readonly joins: DbJoin[] = []

  constructor(
    private sdk: SdkBuilder,
    private readonly adapter: () => DbAdapter,
  ) {}

  private step(next: SdkBuilder): DbQueryBuilder {
    this.sdk = next
    return this
  }

  // ── verbs ──

  select(columns = '*', options?: DbSelectOptions): DbQueryBuilder {
    return this.step(options ? this.sdk.select(columns, options) : this.sdk.select(columns))
  }

  insert(values: DbRow | DbRow[], options?: DbSelectOptions): DbQueryBuilder {
    return this.step(this.sdk.insert(values, options))
  }

  upsert(values: DbRow | DbRow[], options?: DbUpsertOptions): DbQueryBuilder {
    return this.step(this.sdk.upsert(values, options))
  }

  update(values: DbRow, options?: DbSelectOptions): DbQueryBuilder {
    return this.step(this.sdk.update(values, options))
  }

  delete(options?: DbSelectOptions): DbQueryBuilder {
    return this.step(this.sdk.delete(options))
  }

  // ── filters ──

  eq(column: string, value: unknown) { return this.step(this.sdk.eq(column, value)) }
  neq(column: string, value: unknown) { return this.step(this.sdk.neq(column, value)) }
  gt(column: string, value: unknown) { return this.step(this.sdk.gt(column, value)) }
  gte(column: string, value: unknown) { return this.step(this.sdk.gte(column, value)) }
  lt(column: string, value: unknown) { return this.step(this.sdk.lt(column, value)) }
  lte(column: string, value: unknown) { return this.step(this.sdk.lte(column, value)) }
  like(column: string, pattern: string) { return this.step(this.sdk.like(column, pattern)) }
  ilike(column: string, pattern: string) { return this.step(this.sdk.ilike(column, pattern)) }
  is(column: string, value: boolean | null) { return this.step(this.sdk.is(column, value)) }
  in(column: string, values: readonly unknown[]) { return this.step(this.sdk.in(column, [...values])) }

  contains(column: string, value: string | readonly unknown[] | DbRow) {
    return this.step(this.sdk.contains(column, value))
  }

  not(column: string, op: DbComparison, value: unknown) {
    return this.step(this.sdk.not(column, OPERATOR_TEXT[op] ?? op, filterValue(op, value)))
  }

  filter(column: string, op: DbComparison, value: unknown) {
    return this.step(this.sdk.filter(column, OPERATOR_TEXT[op] ?? op, filterValue(op, value)))
  }

  or(predicates: readonly DbPredicate[]): DbQueryBuilder {
    if (predicates.length === 0) {
      throw new Error('or() needs at least one predicate — an empty disjunction has no meaning.')
    }
    return this.step(this.sdk.or(predicates.map(predicateText).join(',')))
  }

  match(query: DbRow): DbQueryBuilder {
    return this.step(this.sdk.match(query))
  }

  // ── shaping ──

  order(column: string, options?: DbOrderOptions): DbQueryBuilder {
    return this.step(this.sdk.order(column, options))
  }

  limit(count: number): DbQueryBuilder {
    return this.step(this.sdk.limit(count))
  }

  range(from: number, to: number): DbQueryBuilder {
    return this.step(this.sdk.range(from, to))
  }

  join(spec: DbJoin): DbQueryBuilder {
    // Not the vendor's embedded-resource syntax on purpose: the shared helper
    // gives both adapters byte-identical row shapes and needs no FK metadata.
    this.joins.push(spec)
    return this
  }

  single<T = DbData>(): PromiseLike<DbResult<T>> {
    this.sdk = this.sdk.single()
    return this as unknown as PromiseLike<DbResult<T>>
  }

  maybeSingle<T = DbData>(): PromiseLike<DbResult<T>> {
    this.sdk = this.sdk.maybeSingle()
    return this as unknown as PromiseLike<DbResult<T>>
  }

  returns<T = DbData>(): DbQueryBuilder {
    return this.step(this.sdk.returns())
  }

  // ── execution ──

  then<TResult1 = DbResult, TResult2 = never>(
    onfulfilled?: ((value: DbResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return this.run().then(onfulfilled, onrejected)
  }

  private async run(): Promise<DbResult> {
    const result = (await this.sdk) as DbResult
    return attachJoins(this.adapter(), result, this.joins)
  }
}

export const supabaseAdapterFactory: DbAdapterFactory = {
  provider: 'supabase',
  create(): DbAdapter {
    const adapter: DbAdapter = {
      provider: 'supabase',
      missingEnv: supabaseMissingEnv,
      from: (table: string) => new SupabaseQueryBuilder(getClient().from(table), () => adapter),
      rpc: (fn: string, params?: DbRow) =>
        getClient().rpc(fn, params) as unknown as PromiseLike<DbResult>,
    }
    return adapter
  },
}

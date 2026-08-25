// ─── Seam calls → parameterised SQL ──────────────────────────────────────────
//
// The whole point of `lib/db.ts` is that its surface is SQL clauses wearing
// method names. This module is the proof: it takes the state a
// `DbQueryBuilder` accumulated and emits `{ text, values }` for node-postgres.
// No HTTP, no query grammar, no vendor.
//
// Everything a caller supplies is either an identifier — validated against a
// strict pattern and double-quoted — or a bound parameter. Values are never
// interpolated into the statement text.
//
// TWO DIALECTS, ONE COMPILER
//   `SqlDialect` is the only concession to a second engine. Both `postgres`
//   and `sqlite` speak the same clause grammar for everything the seam can
//   express; they disagree on five mechanical points — placeholder syntax,
//   case-insensitive LIKE, list membership, the `count(*)` cast, and whether
//   `DEFAULT` may appear inside a VALUES tuple — and each is handled below
//   where it occurs. Nothing else in the seam or in the adapters duplicates a
//   SELECT/INSERT/UPDATE/DELETE builder.

import type { DbComparison, DbPredicate, DbRow } from '../db'

/** SQL engine a statement is being compiled for. */
export type SqlDialect = 'postgres' | 'sqlite'

/** A statement ready for `client.query(text, values)`. */
export interface SqlStatement {
  text: string
  values: unknown[]
}

/** One entry of the WHERE clause. */
export type WherePart =
  | { kind: 'cmp'; predicate: DbPredicate; negated: boolean }
  | { kind: 'or'; predicates: readonly DbPredicate[] }

/** How a query should be ordered. */
export interface OrderPart {
  column: string
  ascending: boolean
  nullsFirst?: boolean
}

/** Everything the builder collected, in a form the compiler can read. */
export interface PgQuerySpec {
  table: string
  verb: 'select' | 'insert' | 'update' | 'upsert' | 'delete'
  /** Column list for SELECT / RETURNING. `'*'` or `'id,title'`. */
  columns: string
  /** Whether a write was asked to return its rows (`.select()` after it). */
  returning: boolean
  /** Rows for insert / upsert. */
  rows: DbRow[]
  /** SET payload for update. */
  patch: DbRow | null
  where: WherePart[]
  order: OrderPart[]
  limit: number | null
  offset: number | null
  /** Conflict target columns for upsert. Resolved to the PK when omitted. */
  onConflict: string[] | null
  ignoreDuplicates: boolean
  head: boolean
  /** Engine to compile for. Absent means `postgres` — the original behaviour. */
  dialect?: SqlDialect
}

/** Thrown when a call cannot be expressed as SQL. Names the offending part. */
export class SqlCompileError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SqlCompileError'
  }
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/** Validate and double-quote an identifier. Rejects anything else outright. */
export function ident(name: string): string {
  const trimmed = name.trim()
  if (!IDENTIFIER.test(trimmed)) {
    throw new SqlCompileError(`Invalid SQL identifier: ${JSON.stringify(name)}`)
  }
  return `"${trimmed}"`
}

/** `'*'` or `'id, title'` → a validated SELECT list. */
export function columnList(columns: string): string {
  const spec = columns.trim()
  if (spec === '' || spec === '*') return '*'
  return spec
    .split(',')
    .map(part => part.trim())
    .filter(part => part.length > 0)
    .map(part => (part === '*' ? '*' : ident(part)))
    .join(', ')
}

/**
 * Collects bound values and hands back this dialect's placeholder for each —
 * `$n` on Postgres, `?` on SQLite. Values still never reach the statement text.
 */
class Params {
  readonly values: unknown[] = []
  constructor(private readonly dialect: SqlDialect = 'postgres') {}
  bind(value: unknown): string {
    this.values.push(value)
    return this.dialect === 'sqlite' ? '?' : `$${this.values.length}`
  }
}

const BINARY_OPERATORS: Record<Exclude<DbComparison, 'is' | 'in' | 'contains'>, string> = {
  eq: '=',
  neq: '<>',
  gt: '>',
  gte: '>=',
  lt: '<',
  lte: '<=',
  like: 'LIKE',
  // SQLite's LIKE is already ASCII-case-insensitive and has no ILIKE keyword,
  // so `ilike` compiles to plain LIKE there — same result, one keyword less.
  ilike: 'ILIKE',
}

/**
 * `contains` (`@>`) works on both arrays and jsonb. An array value is bound as
 * an array; anything else is bound as jsonb text, which is how the callers that
 * use it (JSON columns) mean it.
 */
function containsPredicate(
  column: string,
  value: unknown,
  params: Params,
  dialect: SqlDialect,
): string {
  if (dialect === 'sqlite') return sqliteContainsPredicate(column, value, params)
  if (Array.isArray(value)) return `${ident(column)} @> ${params.bind(value)}`
  const json = typeof value === 'string' ? value : JSON.stringify(value)
  return `${ident(column)} @> ${params.bind(json)}::jsonb`
}

/**
 * `contains` on SQLite, where the column holds JSON text rather than a native
 * array or jsonb (see migrations/sqlite/000_baseline.sql). Every element the
 * caller named must appear in the stored array — the same "is this a superset?"
 * question `@>` asks. Object containment is not expressible this way and says
 * so rather than answering wrongly.
 */
function sqliteContainsPredicate(column: string, value: unknown, params: Params): string {
  const wanted =
    Array.isArray(value) ? value : typeof value === 'string' || typeof value === 'number' ? [value] : null
  if (wanted === null) {
    throw new SqlCompileError(
      `"contains" against an object is not expressible on SQLite (column "${column}"). ` +
        `Pass the array of elements that must be present instead.`,
    )
  }
  if (wanted.length === 0) return 'TRUE'
  const list = wanted.map(v => params.bind(v)).join(', ')
  return (
    `(SELECT count(DISTINCT "value") FROM json_each(${ident(column)}) ` +
    `WHERE "value" IN (${list})) = ${wanted.length}`
  )
}

function isPredicate(column: string, value: unknown): string {
  if (value === null) return `${ident(column)} IS NULL`
  if (value === true) return `${ident(column)} IS TRUE`
  if (value === false) return `${ident(column)} IS FALSE`
  throw new SqlCompileError(
    `"is" accepts null, true or false — got ${JSON.stringify(value)} on column "${column}".`,
  )
}

/** One `column <op> value` comparison as a SQL predicate. */
function predicateSql(predicate: DbPredicate, params: Params, dialect: SqlDialect): string {
  const { column, op, value } = predicate
  if (op === 'is') return isPredicate(column, value)
  if (op === 'contains') return containsPredicate(column, value, params, dialect)
  if (op === 'in') {
    if (!Array.isArray(value)) {
      throw new SqlCompileError(
        `"in" needs an array of values — got ${typeof value} on column "${column}".`,
      )
    }
    if (value.length === 0) return 'FALSE'
    // Postgres binds the whole list as one array parameter; SQLite has no array
    // type, so each element becomes its own placeholder in an IN list.
    if (dialect === 'sqlite') {
      return `${ident(column)} IN (${value.map(v => params.bind(v)).join(', ')})`
    }
    return `${ident(column)} = ANY(${params.bind(value)})`
  }
  const raw = BINARY_OPERATORS[op]
  const operator = dialect === 'sqlite' && raw === 'ILIKE' ? 'LIKE' : raw
  if (!operator) throw new SqlCompileError(`Unsupported comparison "${op}" on column "${column}".`)
  // `eq`/`neq` against null must become IS [NOT] NULL — `= NULL` is never true.
  if (value === null && (op === 'eq' || op === 'neq')) {
    return `${ident(column)} IS ${op === 'neq' ? 'NOT ' : ''}NULL`
  }
  return `${ident(column)} ${operator} ${params.bind(value)}`
}

function whereSql(parts: readonly WherePart[], params: Params, dialect: SqlDialect): string {
  if (parts.length === 0) return ''
  const rendered = parts.map(part => {
    if (part.kind === 'or') {
      if (part.predicates.length === 0) return 'FALSE'
      return `(${part.predicates
        .map(p => {
          const sql = predicateSql(p, params, dialect)
          return p.negated ? `NOT (${sql})` : sql
        })
        .join(' OR ')})`
    }
    const sql = predicateSql(part.predicate, params, dialect)
    return part.negated ? `NOT (${sql})` : sql
  })
  return ` WHERE ${rendered.join(' AND ')}`
}

function orderSql(order: readonly OrderPart[]): string {
  if (order.length === 0) return ''
  const parts = order.map(o => {
    const direction = o.ascending ? 'ASC' : 'DESC'
    const nulls = o.nullsFirst === undefined ? '' : o.nullsFirst ? ' NULLS FIRST' : ' NULLS LAST'
    return `${ident(o.column)} ${direction}${nulls}`
  })
  return ` ORDER BY ${parts.join(', ')}`
}

function windowSql(spec: PgQuerySpec, params: Params, dialect: SqlDialect): string {
  let sql = ''
  // SQLite has no bare OFFSET: it is only legal as part of a LIMIT clause, so
  // an offset without a limit needs the "unbounded" sentinel LIMIT -1.
  if (spec.limit !== null) sql += ` LIMIT ${params.bind(spec.limit)}`
  else if (spec.offset !== null && dialect === 'sqlite') sql += ' LIMIT -1'
  if (spec.offset !== null) sql += ` OFFSET ${params.bind(spec.offset)}`
  return sql
}

/** Union of the keys across all inserted rows, in first-seen order. */
function insertColumns(rows: readonly DbRow[]): string[] {
  const seen: string[] = []
  for (const row of rows) {
    for (const key of Object.keys(row)) if (!seen.includes(key)) seen.push(key)
  }
  return seen
}

function returningSql(spec: PgQuerySpec): string {
  return spec.returning ? ` RETURNING ${columnList(spec.columns)}` : ''
}

function compileInsert(spec: PgQuerySpec, params: Params, dialect: SqlDialect): string {
  const columns = insertColumns(spec.rows)
  if (columns.length === 0) throw new SqlCompileError(`Nothing to insert into "${spec.table}".`)
  // A key absent from one row of a batch becomes DEFAULT, not NULL — that is
  // what the column's own default is for, and it keeps `created_at`-style
  // columns working on partial rows. SQLite has no DEFAULT keyword inside a
  // VALUES tuple, so the sqlite adapter splits a ragged batch into one
  // statement per distinct key set before it gets here; reaching this throw
  // means that split did not happen.
  const tuples = spec.rows.map(row => {
    const missing = columns.filter(column => !(column in row))
    if (dialect === 'sqlite' && missing.length > 0) {
      throw new SqlCompileError(
        `SQLite cannot insert DEFAULT inside a VALUES tuple: rows for "${spec.table}" ` +
          `disagree on the columns ${missing.join(', ')}. Group rows by key set first.`,
      )
    }
    return `(${columns
      .map(column => (column in row ? params.bind(row[column]) : 'DEFAULT'))
      .join(', ')})`
  })
  return (
    `INSERT INTO ${ident(spec.table)} (${columns.map(ident).join(', ')}) ` +
    `VALUES ${tuples.join(', ')}`
  )
}

function conflictSql(spec: PgQuerySpec): string {
  const target = spec.onConflict ?? []
  if (target.length === 0) {
    throw new SqlCompileError(
      `upsert on "${spec.table}" needs a conflict target: pass { onConflict: 'col,col' } ` +
        `or give the table a primary key.`,
    )
  }
  const targetSql = `(${target.map(ident).join(', ')})`
  if (spec.ignoreDuplicates) return ` ON CONFLICT ${targetSql} DO NOTHING`

  const assignable = insertColumns(spec.rows).filter(column => !target.includes(column))
  if (assignable.length === 0) return ` ON CONFLICT ${targetSql} DO NOTHING`
  const assignments = assignable.map(c => `${ident(c)} = EXCLUDED.${ident(c)}`).join(', ')
  return ` ON CONFLICT ${targetSql} DO UPDATE SET ${assignments}`
}

/** Compile the query the builder described into one parameterised statement. */
export function compile(spec: PgQuerySpec): SqlStatement {
  const dialect = spec.dialect ?? 'postgres'
  const params = new Params(dialect)
  let text: string

  switch (spec.verb) {
    case 'select': {
      const projection = spec.head ? '1' : columnList(spec.columns)
      text =
        `SELECT ${projection} FROM ${ident(spec.table)}` +
        whereSql(spec.where, params, dialect) +
        orderSql(spec.order) +
        windowSql(spec, params, dialect)
      break
    }
    case 'insert':
      text = compileInsert(spec, params, dialect) + returningSql(spec)
      break
    case 'upsert':
      text = compileInsert(spec, params, dialect) + conflictSql(spec) + returningSql(spec)
      break
    case 'update': {
      const patch = spec.patch ?? {}
      const columns = Object.keys(patch)
      if (columns.length === 0) throw new SqlCompileError(`Nothing to update on "${spec.table}".`)
      const assignments = columns.map(c => `${ident(c)} = ${params.bind(patch[c])}`).join(', ')
      text =
        `UPDATE ${ident(spec.table)} SET ${assignments}` +
        whereSql(spec.where, params, dialect) +
        returningSql(spec)
      break
    }
    case 'delete':
      text =
        `DELETE FROM ${ident(spec.table)}` +
        whereSql(spec.where, params, dialect) +
        returningSql(spec)
      break
    default:
      throw new SqlCompileError(`Unsupported verb "${String(spec.verb)}".`)
  }

  return { text, values: params.values }
}

/**
 * The `count: 'exact'` companion statement. Deliberately a second round trip
 * rather than a window function: the data query may carry LIMIT/OFFSET, and the
 * count must ignore both.
 */
export function compileCount(spec: PgQuerySpec): SqlStatement {
  const dialect = spec.dialect ?? 'postgres'
  const params = new Params(dialect)
  // SQLite's count(*) is already an integer and has no `::` cast syntax.
  const projection = dialect === 'sqlite' ? 'count(*) AS count' : 'count(*)::int AS count'
  return {
    text:
      `SELECT ${projection} FROM ${ident(spec.table)}` + whereSql(spec.where, params, dialect),
    values: params.values,
  }
}

/** `SELECT * FROM fn(named => $1, …)` — the seam's `rpc()` in SQL. */
export function compileRpc(fn: string, args: DbRow | undefined): SqlStatement {
  const params = new Params()
  const entries = Object.entries(args ?? {})
  const callArgs = entries.map(([name, value]) => `${ident(name)} => ${params.bind(value)}`)
  return { text: `SELECT * FROM ${ident(fn)}(${callArgs.join(', ')})`, values: params.values }
}

/** Primary-key columns of a table — the default conflict target for upsert. */
export function compilePrimaryKeyLookup(
  table: string,
  dialect: SqlDialect = 'postgres',
): SqlStatement {
  // SQLite keeps this in a table-valued pragma rather than a catalogue join.
  // `pk` is the 1-based position within the key, 0 for non-key columns.
  if (dialect === 'sqlite') {
    return {
      text: 'SELECT "name" AS "column" FROM pragma_table_info(?) WHERE "pk" > 0 ORDER BY "pk"',
      values: [table],
    }
  }
  return {
    text:
      'SELECT a.attname AS column FROM pg_index i ' +
      'JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) ' +
      'WHERE i.indrelid = $1::regclass AND i.indisprimary',
    values: [table],
  }
}

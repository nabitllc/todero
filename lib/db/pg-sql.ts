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

import type { DbComparison, DbPredicate, DbRow } from '../db'

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

/** Collects bound values and hands back the `$n` placeholder for each. */
class Params {
  readonly values: unknown[] = []
  bind(value: unknown): string {
    this.values.push(value)
    return `$${this.values.length}`
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
  ilike: 'ILIKE',
}

/**
 * `contains` (`@>`) works on both arrays and jsonb. An array value is bound as
 * an array; anything else is bound as jsonb text, which is how the callers that
 * use it (JSON columns) mean it.
 */
function containsPredicate(column: string, value: unknown, params: Params): string {
  if (Array.isArray(value)) return `${ident(column)} @> ${params.bind(value)}`
  const json = typeof value === 'string' ? value : JSON.stringify(value)
  return `${ident(column)} @> ${params.bind(json)}::jsonb`
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
function predicateSql(predicate: DbPredicate, params: Params): string {
  const { column, op, value } = predicate
  if (op === 'is') return isPredicate(column, value)
  if (op === 'contains') return containsPredicate(column, value, params)
  if (op === 'in') {
    if (!Array.isArray(value)) {
      throw new SqlCompileError(
        `"in" needs an array of values — got ${typeof value} on column "${column}".`,
      )
    }
    if (value.length === 0) return 'FALSE'
    return `${ident(column)} = ANY(${params.bind(value)})`
  }
  const operator = BINARY_OPERATORS[op]
  if (!operator) throw new SqlCompileError(`Unsupported comparison "${op}" on column "${column}".`)
  // `eq`/`neq` against null must become IS [NOT] NULL — `= NULL` is never true.
  if (value === null && (op === 'eq' || op === 'neq')) {
    return `${ident(column)} IS ${op === 'neq' ? 'NOT ' : ''}NULL`
  }
  return `${ident(column)} ${operator} ${params.bind(value)}`
}

function whereSql(parts: readonly WherePart[], params: Params): string {
  if (parts.length === 0) return ''
  const rendered = parts.map(part => {
    if (part.kind === 'or') {
      if (part.predicates.length === 0) return 'FALSE'
      return `(${part.predicates.map(p => predicateSql(p, params)).join(' OR ')})`
    }
    const sql = predicateSql(part.predicate, params)
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

function windowSql(spec: PgQuerySpec, params: Params): string {
  let sql = ''
  if (spec.limit !== null) sql += ` LIMIT ${params.bind(spec.limit)}`
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

function compileInsert(spec: PgQuerySpec, params: Params): string {
  const columns = insertColumns(spec.rows)
  if (columns.length === 0) throw new SqlCompileError(`Nothing to insert into "${spec.table}".`)
  // A key absent from one row of a batch becomes DEFAULT, not NULL — that is
  // what the column's own default is for, and it keeps `created_at`-style
  // columns working on partial rows.
  const tuples = spec.rows.map(
    row =>
      `(${columns
        .map(column => (column in row ? params.bind(row[column]) : 'DEFAULT'))
        .join(', ')})`,
  )
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
  const params = new Params()
  let text: string

  switch (spec.verb) {
    case 'select': {
      const projection = spec.head ? '1' : columnList(spec.columns)
      text =
        `SELECT ${projection} FROM ${ident(spec.table)}` +
        whereSql(spec.where, params) +
        orderSql(spec.order) +
        windowSql(spec, params)
      break
    }
    case 'insert':
      text = compileInsert(spec, params) + returningSql(spec)
      break
    case 'upsert':
      text = compileInsert(spec, params) + conflictSql(spec) + returningSql(spec)
      break
    case 'update': {
      const patch = spec.patch ?? {}
      const columns = Object.keys(patch)
      if (columns.length === 0) throw new SqlCompileError(`Nothing to update on "${spec.table}".`)
      const assignments = columns.map(c => `${ident(c)} = ${params.bind(patch[c])}`).join(', ')
      text =
        `UPDATE ${ident(spec.table)} SET ${assignments}` +
        whereSql(spec.where, params) +
        returningSql(spec)
      break
    }
    case 'delete':
      text = `DELETE FROM ${ident(spec.table)}` + whereSql(spec.where, params) + returningSql(spec)
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
  const params = new Params()
  return {
    text: `SELECT count(*)::int AS count FROM ${ident(spec.table)}${whereSql(spec.where, params)}`,
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
export function compilePrimaryKeyLookup(table: string): SqlStatement {
  return {
    text:
      'SELECT a.attname AS column FROM pg_index i ' +
      'JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = ANY(i.indkey) ' +
      'WHERE i.indrelid = $1::regclass AND i.indisprimary',
    values: [table],
  }
}

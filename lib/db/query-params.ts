// ─── Legacy query-string → seam translator ───────────────────────────────────
//
// The browser shim (`lib/db/browser.ts`) still speaks the filter grammar the
// client components were written against: `?status=in.(a,b)&order=x.desc`.
// This module turns that string into ordinary `DbQueryBuilder` calls, so the
// proxy route executes through `db()` like everything else instead of pasting
// the query string onto a vendor URL.
//
// It imports nothing vendor-specific — only the seam's own types — which is the
// whole point: whichever adapter is registered, the same builder calls run.
//
// TODO(db-seam): once every tab reads from a purpose-built API route, delete
// this file together with `lib/db/browser.ts` and the proxy route.

import type { DbComparison, DbOrderOptions, DbPredicate, DbQueryBuilder } from '../db'

/** Query-string keys that shape the query rather than filter it. */
const SHAPING_KEYS = new Set(['select', 'order', 'limit', 'offset', 'or', 'on_conflict', 'columns'])

/** Thrown when the query string cannot be expressed as seam calls. */
export class DbQueryParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DbQueryParseError'
  }
}

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Split a comma-separated list, ignoring commas inside `(...)` or `"..."`.
 * `a,b,"c,d",e(f,g)` → `['a', 'b', '"c,d"', 'e(f,g)']`
 */
function splitTopLevel(input: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quoted = false
  let start = 0
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (quoted) {
      if (ch === '"' && input[i - 1] !== '\\') quoted = false
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === '(') depth++
    else if (ch === ')') depth--
    else if (ch === ',' && depth === 0) {
      parts.push(input.slice(start, i))
      start = i + 1
    }
  }
  parts.push(input.slice(start))
  return parts.map(p => p.trim()).filter(p => p.length > 0)
}

/** `(a,b,c)` → `['a','b','c']`; bare `a,b` is tolerated too. */
function parseValueList(raw: string): string[] {
  const inner = raw.startsWith('(') && raw.endsWith(')') ? raw.slice(1, -1) : raw
  return splitTopLevel(inner).map(unquote)
}

/** PostgREST wraps values containing separators in double quotes. */
function unquote(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1).replace(/\\"/g, '"')
    : value
}

/** `is.` only accepts these three. */
function parseIsValue(raw: string): boolean | null {
  const v = raw.toLowerCase()
  if (v === 'null') return null
  if (v === 'true') return true
  if (v === 'false') return false
  throw new DbQueryParseError(`Unsupported "is" value: ${raw}. Expected null, true or false.`)
}

/**
 * Wire operator name → the seam's comparison vocabulary.
 *
 * This map is the entire translation. Everything downstream of it is data:
 * `{ column, op, value }`, never a string of grammar.
 */
const COMPARISONS: Record<string, DbComparison> = {
  eq: 'eq',
  neq: 'neq',
  gt: 'gt',
  gte: 'gte',
  lt: 'lt',
  lte: 'lte',
  like: 'like',
  ilike: 'ilike',
  is: 'is',
  in: 'in',
  cs: 'contains',
}

function toComparison(op: string, column: string): DbComparison {
  const comparison = COMPARISONS[op]
  if (!comparison) {
    throw new DbQueryParseError(`Unsupported filter operator "${op}" on column "${column}".`)
  }
  return comparison
}

/** `status.eq.open` / `agent_id.in.(a,b)` → one `DbPredicate`. */
function parsePredicate(term: string): DbPredicate {
  const firstDot = term.indexOf('.')
  const secondDot = term.indexOf('.', firstDot + 1)
  if (firstDot < 1 || secondDot < 0) {
    throw new DbQueryParseError(
      `Each "or" term must look like <column>.<operator>.<value>, got "${term}".`,
    )
  }
  const column = term.slice(0, firstDot)
  if (!IDENTIFIER.test(column)) {
    throw new DbQueryParseError(`Invalid filter column "${column}".`)
  }
  const op = toComparison(term.slice(firstDot + 1, secondDot), column)
  const raw = term.slice(secondDot + 1)

  if (op === 'is') return { column, op, value: parseIsValue(raw) }
  if (op === 'in') return { column, op, value: parseValueList(raw) }
  return { column, op, value: unquote(raw) }
}

/** `a.eq.1,b.eq.2` → the predicate list `or()` takes. */
export function parseOrPredicates(raw: string): DbPredicate[] {
  const inner = raw.startsWith('(') && raw.endsWith(')') ? raw.slice(1, -1) : raw
  const terms = splitTopLevel(inner)
  if (terms.length === 0) {
    throw new DbQueryParseError('"or" needs at least one term.')
  }
  return terms.map(parsePredicate)
}

/**
 * Apply one `column=operator.value` pair.
 *
 * Scalar values stay strings on purpose: the seam serialises them back into the
 * same comparison either way, and coercing `"007"` to a number would change the
 * query.
 */
function applyFilter(builder: DbQueryBuilder, column: string, raw: string): DbQueryBuilder {
  let rest = raw
  let negated = false
  if (rest.startsWith('not.')) {
    negated = true
    rest = rest.slice(4)
  }

  const dot = rest.indexOf('.')
  if (dot < 1) {
    throw new DbQueryParseError(
      `Filter on "${column}" must look like <operator>.<value>, got "${raw}".`,
    )
  }
  const op = rest.slice(0, dot)
  const value = rest.slice(dot + 1)

  if (negated) {
    // The seam's `not()` takes a comparison and a value, both as data — an `in`
    // negation hands over the actual array, not a parenthesised string.
    if (op === 'is') return builder.not(column, 'is', parseIsValue(value))
    if (op === 'in') return builder.not(column, 'in', parseValueList(value))
    return builder.not(column, toComparison(op, column), unquote(value))
  }

  switch (op) {
    case 'eq':
      return builder.eq(column, unquote(value))
    case 'neq':
      return builder.neq(column, unquote(value))
    case 'gt':
      return builder.gt(column, unquote(value))
    case 'gte':
      return builder.gte(column, unquote(value))
    case 'lt':
      return builder.lt(column, unquote(value))
    case 'lte':
      return builder.lte(column, unquote(value))
    case 'like':
      return builder.like(column, unquote(value))
    case 'ilike':
      return builder.ilike(column, unquote(value))
    case 'is':
      return builder.is(column, parseIsValue(value))
    case 'in':
      return builder.in(column, parseValueList(value))
    case 'cs':
      return builder.contains(column, unquote(value))
    default:
      throw new DbQueryParseError(`Unsupported filter operator "${op}" on column "${column}".`)
  }
}

/** `updated_at.desc.nullslast` → one `order()` call. */
function applyOrder(builder: DbQueryBuilder, spec: string): DbQueryBuilder {
  const [column, ...modifiers] = spec.split('.')
  if (!IDENTIFIER.test(column)) {
    throw new DbQueryParseError(`Invalid order column "${column}".`)
  }
  const options: DbOrderOptions = {}
  for (const modifier of modifiers) {
    const m = modifier.toLowerCase()
    if (m === 'asc') options.ascending = true
    else if (m === 'desc') options.ascending = false
    else if (m === 'nullsfirst') options.nullsFirst = true
    else if (m === 'nullslast') options.nullsFirst = false
    else throw new DbQueryParseError(`Unsupported order modifier "${modifier}" on "${column}".`)
  }
  return builder.order(column, options)
}

function parseCount(raw: string | null): number | null {
  if (raw === null) return null
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 0) throw new DbQueryParseError(`Invalid numeric value "${raw}".`)
  return n
}

/** What the caller asked for that the route itself needs to know about. */
export interface QueryShape {
  /** Column list, or `*` when the caller did not narrow it. */
  select: string
  /** `on_conflict=` target for an upsert, when present. */
  onConflict?: string
}

/** Read the shaping keys without applying anything. */
export function readQueryShape(params: URLSearchParams): QueryShape {
  const select = params.get('select')?.trim()
  const onConflict = params.get('on_conflict')?.trim()
  return {
    select: select && select.length > 0 ? select : '*',
    ...(onConflict ? { onConflict } : {}),
  }
}

/**
 * Apply every filter in the query string to `builder`.
 * Shaping keys (`select`, `order`, …) are skipped — see `applyShaping`.
 */
export function applyFilters(builder: DbQueryBuilder, params: URLSearchParams): DbQueryBuilder {
  let b = builder
  for (const [key, value] of Array.from(params.entries())) {
    if (SHAPING_KEYS.has(key)) continue
    if (!IDENTIFIER.test(key)) {
      throw new DbQueryParseError(`Invalid filter column "${key}".`)
    }
    b = applyFilter(b, key, value)
  }
  const or = params.get('or')
  if (or) b = b.or(parseOrPredicates(or))
  return b
}

/** Apply `order`, `limit` and `offset`. Call after the filters. */
export function applyShaping(builder: DbQueryBuilder, params: URLSearchParams): DbQueryBuilder {
  let b = builder
  const order = params.get('order')
  if (order) {
    for (const spec of splitTopLevel(order)) b = applyOrder(b, spec)
  }

  const limit = parseCount(params.get('limit'))
  const offset = parseCount(params.get('offset'))
  if (offset !== null) {
    // The seam expresses an offset as an inclusive row window.
    b = b.range(offset, offset + (limit ?? 1000) - 1)
  } else if (limit !== null) {
    b = b.limit(limit)
  }
  return b
}

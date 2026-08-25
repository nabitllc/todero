// ─── Related-table attachment, shared by every adapter ───────────────────────
//
// `DbQueryBuilder.join()` is deliberately not a vendor "embedding" feature. It
// is a keyed second lookup plus a merge, which any Postgres — hosted behind an
// HTTP layer or reached with a driver — can do without foreign-key metadata or
// a select-string dialect. Keeping the implementation here means both adapters
// produce byte-identical row shapes and neither can drift.

import type { DbAdapter, DbJoin, DbResult, DbRow } from '../db'

/** Column the reference points at on the related table. */
function foreignColumn(spec: DbJoin): string {
  return spec.foreignColumn ?? 'id'
}

/** Key the nested object lands under in each row. */
function nestedKey(spec: DbJoin): string {
  return spec.as ?? spec.table
}

/** Narrow the related row to just the columns the caller asked for. */
function pick(row: DbRow, columns: readonly string[]): DbRow {
  const out: DbRow = {}
  for (const column of columns) out[column] = row[column]
  return out
}

/**
 * Attach every `join()` the query declared onto the rows it returned.
 *
 * Runs after the main statement, one extra query per join, batched with `in`
 * so the row count does not drive the query count. Returns the result
 * unchanged when there is nothing to attach, and surfaces a failed lookup as
 * the result's `error` rather than as a throw — same contract as any query.
 */
export async function attachJoins(
  adapter: DbAdapter,
  result: DbResult,
  joins: readonly DbJoin[],
): Promise<DbResult> {
  if (joins.length === 0 || result.error || result.data == null) return result

  const rows: DbRow[] = Array.isArray(result.data) ? result.data : [result.data as DbRow]
  if (rows.length === 0) return result

  for (const spec of joins) {
    const key = nestedKey(spec)
    const fk = foreignColumn(spec)
    const ids = Array.from(
      new Set(rows.map(row => row[spec.localColumn]).filter(v => v !== null && v !== undefined)),
    )

    if (ids.length === 0) {
      for (const row of rows) row[key] = null
      continue
    }

    const related = await adapter
      .from(spec.table)
      .select([fk, ...spec.columns].join(','))
      .in(fk, ids)

    if (related.error) return { ...result, data: null, error: related.error }

    const byId = new Map<unknown, DbRow>()
    for (const row of (related.data ?? []) as DbRow[]) byId.set(row[fk], row)

    for (const row of rows) {
      const match = byId.get(row[spec.localColumn])
      row[key] = match ? pick(match, spec.columns) : null
    }
  }

  return result
}

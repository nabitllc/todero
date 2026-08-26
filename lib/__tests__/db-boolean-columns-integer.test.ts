/**
 * Guard for the REMAINING boolean-filter gap: columns that mean boolean but
 * are declared plain `INTEGER` in `migrations/sqlite`, invisible to the
 * type-keyed `booleanColumns` hook (`lib/db/sqlite-adapter.ts`'s `kindsFor`)
 * that `lib/__tests__/db-boolean-filter.test.ts` proved for `is_blocked`.
 *
 * `agent_run_records.succeeded`/`.failed` (migrations/sqlite/040_agent_run_records.sql)
 * and `run_steps.ok` (migrations/sqlite/060_run_steps.sql) are declared
 * `boolean` on postgres and plain `INTEGER` on sqlite. No query-string filter
 * targets them today (verified by hand — see
 * docs/rebuild/pieces/pieces7/boolean-columns.md §1) but the day one does,
 * it reproduces the `is_blocked` defect exactly: `eq.false`/`eq.true` binds a
 * STRING against an INTEGER-affinity 0/1 column and matches zero rows,
 * silently.
 *
 * The fix: `BOOLEAN_MEANING_OVERRIDES`, a curated (not name-heuristic) map in
 * `lib/db/sqlite-adapter.ts`, consulted by the SAME `kindsFor` catalogue
 * lookup that already decodes real `BOOLEAN` columns — so it fixes both
 * directions at once: the WHERE-clause coercion (`booleanColumnsFor`) AND
 * row decoding on read (a reader gets `true`/`false`, not `1`/`0`).
 *
 * This file proves both directions end to end, against a real, file-backed
 * SQLite seeded from this repo's own migrations (000_baseline + 040 + 060 —
 * the same files `npm run db:migrate` applies), through the real seam
 * (`db().from(table)` + `applyFilters`) — not a mock.
 */

import { readFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

describe('sqlite adapter: succeeded/failed/ok — the INTEGER-declared boolean gap', () => {
  const previous = {
    provider: process.env.TODERO_DB_PROVIDER,
    sqlite: process.env.TODERO_SQLITE_PATH,
  }
  let file: string

  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3') as typeof import('better-sqlite3')
    file = join(
      tmpdir(),
      `todero-boolean-columns-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
    )
    const seed = new Database(file)
    seed.exec('PRAGMA foreign_keys = ON')
    seed.exec(readFileSync(join(__dirname, '..', '..', 'migrations', 'sqlite', '000_baseline.sql'), 'utf8'))
    seed.exec(readFileSync(join(__dirname, '..', '..', 'migrations', 'sqlite', '040_agent_run_records.sql'), 'utf8'))
    seed.exec(readFileSync(join(__dirname, '..', '..', 'migrations', 'sqlite', '060_run_steps.sql'), 'utf8'))

    seed
      .prepare(
        'INSERT INTO agent_run_records (id, agent_id, task_key, succeeded, failed) VALUES (?,?,?,?,?)',
      )
      .run('arr-ok', 'GUARD-AGENT', 'GUARD-SUCCEEDED', 1, 0)
    seed
      .prepare(
        'INSERT INTO agent_run_records (id, agent_id, task_key, succeeded, failed) VALUES (?,?,?,?,?)',
      )
      .run('arr-bad', 'GUARD-AGENT', 'GUARD-FAILED', 0, 1)

    seed
      .prepare('INSERT INTO run_steps (id, run_id, step_no, tool, what, ok) VALUES (?,?,?,?,?,?)')
      .run('step-ok', 'guard-run', 1, 'bash', 'a step that succeeded', 1)
    seed
      .prepare('INSERT INTO run_steps (id, run_id, step_no, tool, what, ok) VALUES (?,?,?,?,?,?)')
      .run('step-bad', 'guard-run', 2, 'bash', 'a step that failed', 0)
    seed.close()

    process.env.TODERO_DB_PROVIDER = 'sqlite'
    process.env.TODERO_SQLITE_PATH = file
  })

  afterAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const sqliteMod = require('../db/sqlite-adapter') as typeof import('../db/sqlite-adapter')
    sqliteMod.closeSqlite()
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        unlinkSync(file + suffix)
      } catch {
        // already gone, or still held open on Windows — a temp file either way
      }
    }
    if (previous.provider === undefined) delete process.env.TODERO_DB_PROVIDER
    else process.env.TODERO_DB_PROVIDER = previous.provider
    if (previous.sqlite === undefined) delete process.env.TODERO_SQLITE_PATH
    else process.env.TODERO_SQLITE_PATH = previous.sqlite
  })

  async function selectTaskKeys(query: string): Promise<string[]> {
    let seam: typeof import('../db')
    let qp: typeof import('../db/query-params')
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      seam = require('../db')
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      qp = require('../db/query-params')
    })
    const params = new URLSearchParams(query)
    const { select } = qp!.readQueryShape(params)
    let builder = seam!.db().from('agent_run_records').select(select)
    builder = qp!.applyFilters(builder, params)
    builder = qp!.applyShaping(builder, params)
    const { data, error } = await builder
    if (error) throw new Error(error.message)
    return (data as Array<{ task_key: string }>).map(r => r.task_key)
  }

  async function selectRunSteps(
    query: string,
  ): Promise<Array<{ id: string; ok: unknown }>> {
    let seam: typeof import('../db')
    let qp: typeof import('../db/query-params')
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      seam = require('../db')
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      qp = require('../db/query-params')
    })
    const params = new URLSearchParams(query)
    const { select } = qp!.readQueryShape(params)
    let builder = seam!.db().from('run_steps').select(select)
    builder = qp!.applyFilters(builder, params)
    builder = qp!.applyShaping(builder, params)
    const { data, error } = await builder
    if (error) throw new Error(error.message)
    return data as Array<{ id: string; ok: unknown }>
  }

  it('agent_run_records: succeeded=eq.true returns exactly the succeeded fixture', async () => {
    const keys = await selectTaskKeys(
      'agent_id=eq.GUARD-AGENT&succeeded=eq.true&select=task_key&order=task_key.asc',
    )
    expect(keys).toEqual(['GUARD-SUCCEEDED'])
  })

  it('agent_run_records: succeeded=eq.false returns exactly the non-succeeded fixture', async () => {
    const keys = await selectTaskKeys(
      'agent_id=eq.GUARD-AGENT&succeeded=eq.false&select=task_key&order=task_key.asc',
    )
    expect(keys).toEqual(['GUARD-FAILED'])
  })

  it('agent_run_records: failed=eq.true returns exactly the failed fixture', async () => {
    const keys = await selectTaskKeys(
      'agent_id=eq.GUARD-AGENT&failed=eq.true&select=task_key&order=task_key.asc',
    )
    expect(keys).toEqual(['GUARD-FAILED'])
  })

  it('agent_run_records: read-decode returns a real boolean, not 0/1', async () => {
    const params = new URLSearchParams('agent_id=eq.GUARD-AGENT&task_key=eq.GUARD-SUCCEEDED&select=succeeded,failed')
    let seam: typeof import('../db')
    let qp: typeof import('../db/query-params')
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      seam = require('../db')
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      qp = require('../db/query-params')
    })
    const { select } = qp!.readQueryShape(params)
    let builder = seam!.db().from('agent_run_records').select(select)
    builder = qp!.applyFilters(builder, params)
    const { data, error } = await builder
    if (error) throw new Error(error.message)
    const row = (data as Array<{ succeeded: unknown; failed: unknown }>)[0]
    expect(row.succeeded).toBe(true)
    expect(row.failed).toBe(false)
  })

  it('run_steps: ok=eq.true returns exactly the ok step', async () => {
    const rows = await selectRunSteps('run_id=eq.guard-run&ok=eq.true&select=id,ok&order=step_no.asc')
    expect(rows.map(r => r.id)).toEqual(['step-ok'])
  })

  it('run_steps: ok=eq.false returns exactly the failed step', async () => {
    const rows = await selectRunSteps('run_id=eq.guard-run&ok=eq.false&select=id,ok&order=step_no.asc')
    expect(rows.map(r => r.id)).toEqual(['step-bad'])
  })

  it('run_steps: read-decode returns a real boolean, not 0/1', async () => {
    const rows = await selectRunSteps('run_id=eq.guard-run&select=id,ok&order=step_no.asc')
    expect(rows).toEqual([
      { id: 'step-ok', ok: true },
      { id: 'step-bad', ok: false },
    ])
  })
})

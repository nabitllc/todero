/**
 * Pins the shape of `agent_memory` — the key/value store — on BOTH hosts.
 *
 * The defect this guards against ran for months in production: `agent_memory`
 * carried a daily-notes shape (agent_id, memory_type, date_key, content) while
 * fourteen call sites wrote `{key, value}` into it. Two shipped features were
 * broken the whole time —
 *   GET  /api/settings/cost-history -> 502 `no such column: "value"`
 *   PATCH /api/agent-pause          -> 500 `no column named key`
 * — and /api/health reported green throughout, because the health probe only
 * ever asked whether the table EXISTED.
 *
 * migrations/062_agent_memory_kv.sql (and its SQLite dialect) reshape the
 * table. These tests apply the real migration directories from an empty
 * database and assert the shape that comes out, so the fix cannot silently
 * regress and so the two hosts cannot drift apart again.
 *
 * Deliberately reads the shape from the STORE's own catalogue
 * (pragma_table_info / information_schema), never from the migration text —
 * the same rule the piece itself was held to.
 */

import { readFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { PGlite } from '@electric-sql/pglite'
import { TABLE_PROBE_COLUMNS, REQUIRED_TABLES } from '../required-tables'

const REPO_ROOT = join(__dirname, '..', '..')
const PG_MIGRATIONS = join(REPO_ROOT, 'migrations')
const SQLITE_MIGRATIONS = join(REPO_ROOT, 'migrations', 'sqlite')

function sqlFiles(dir: string): string[] {
  return readdirSync(dir).filter(f => f.endsWith('.sql')).sort()
}

describe('agent_memory is the key/value store, on SQLite', () => {
  // In-memory: better-sqlite3 holds an OS-level file lock on Windows, and a
  // temp file would leak a fixture this piece is required to clean up.
  function freshDb() {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3') as typeof import('better-sqlite3')
    const db = new Database(':memory:')
    for (const file of sqlFiles(SQLITE_MIGRATIONS)) {
      db.exec(readFileSync(join(SQLITE_MIGRATIONS, file), 'utf8'))
    }
    return db
  }

  it('has key/value columns and no daily-notes columns', () => {
    const db = freshDb()
    const cols = (db.prepare('SELECT name, type FROM pragma_table_info(?)').all('agent_memory') as Array<{
      name: string
      type: string
    }>)
    const names = cols.map(c => c.name)

    expect(names).toEqual(expect.arrayContaining(['agent_id', 'key', 'value', 'updated_at']))
    // The shape it must NOT have drifted back to.
    expect(names).not.toContain('memory_type')
    expect(names).not.toContain('date_key')
    expect(names).not.toContain('content')

    // JSON_TEXT is load-bearing, not cosmetic: lib/db/sqlite-adapter.ts's
    // kindsFor() decodes only columns whose DECLARED type starts with "JSON".
    // A plain TEXT `value` would hand lib/loop-breaker.ts's readMemoryValue<T>()
    // a raw string where the Postgres host hands back an object.
    expect(cols.find(c => c.name === 'value')?.type.toUpperCase()).toMatch(/^JSON/)
    db.close()
  })

  it('enforces UNIQUE(agent_id, key) — every writer upserts on that target', () => {
    const db = freshDb()
    // Every call site passes { onConflict: 'agent_id,key' }, which compiles to
    // ON CONFLICT (agent_id, key) DO UPDATE. SQLite rejects that without a
    // matching unique index, so this is what makes the writes work at all.
    const upsert = db.prepare(
      'INSERT INTO agent_memory (agent_id, key, value) VALUES (?, ?, ?) ' +
        'ON CONFLICT (agent_id, key) DO UPDATE SET value = excluded.value',
    )
    expect(() => upsert.run('builder', 'is_paused', '{"paused":true}')).not.toThrow()
    upsert.run('builder', 'is_paused', '{"paused":false}')

    // Merged in place rather than inserting a duplicate — the silent-duplicate
    // bug every call site's onConflict comment warns about.
    const rows = db.prepare('SELECT value FROM agent_memory WHERE agent_id = ?').all('builder')
    expect(rows).toHaveLength(1)
    expect(JSON.parse((rows[0] as { value: string }).value)).toEqual({ paused: false })
    db.close()
  })

  it('leaves agent_memory_files as the daily-notes table', () => {
    const db = freshDb()
    const names = (db.prepare('SELECT name FROM pragma_table_info(?)').all('agent_memory_files') as Array<{
      name: string
    }>).map(c => c.name)
    // The other half of the split. If this ever loses memory_type, the daily
    // notes have nowhere to live and MemoryTab/lib/memory-budget break.
    expect(names).toEqual(expect.arrayContaining(['agent_id', 'memory_type', 'date_key', 'content']))
    expect(names).not.toContain('key')
    db.close()
  })
})

describe('agent_memory is the key/value store, on Postgres', () => {
  it('comes out of migrations/ as key/value, and 062 is idempotent', async () => {
    const pg = await PGlite.create()
    for (const file of sqlFiles(PG_MIGRATIONS)) {
      await pg.exec(readFileSync(join(PG_MIGRATIONS, file), 'utf8'))
    }

    const shape = async () => {
      const { rows } = await pg.query<{ column_name: string; data_type: string }>(
        `SELECT column_name, data_type FROM information_schema.columns
          WHERE table_schema = 'public' AND table_name = 'agent_memory'`,
      )
      return rows
    }

    const before = await shape()
    const names = before.map(r => r.column_name)
    expect(names).toEqual(expect.arrayContaining(['agent_id', 'key', 'value', 'updated_at']))
    expect(names).not.toContain('memory_type')
    // jsonb, so callers that never parse (lib/loop-breaker.ts readMemoryValue)
    // get a real object back, matching what SQLite's JSON_TEXT decode returns.
    expect(before.find(r => r.column_name === 'value')?.data_type).toBe('jsonb')

    // The conflict target every writer names must actually be enforced.
    const { rows: idx } = await pg.query<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'agent_memory'`,
    )
    expect(idx.some(r => /UNIQUE/i.test(r.indexdef) && /agent_id/.test(r.indexdef) && /key/.test(r.indexdef))).toBe(true)

    // Idempotence: re-applying 062 against a database that is ALREADY key/value
    // must be a no-op, not a reshape. This is the branch a hosted database
    // (which 016's own comment says was already key/value) takes on first run.
    await pg.exec(readFileSync(join(PG_MIGRATIONS, '062_agent_memory_kv.sql'), 'utf8'))
    expect(await shape()).toEqual(before)

    await pg.close()
  }, 60_000)

  it('carries daily-notes rows over to agent_memory_files instead of dropping them', async () => {
    const pg = await PGlite.create()
    const files = sqlFiles(PG_MIGRATIONS)
    // Apply everything up to but excluding 062, so agent_memory is still the
    // daily-notes shape 016 creates — then seed a row the reshape must not eat.
    for (const file of files.filter(f => f < '062_')) {
      await pg.exec(readFileSync(join(PG_MIGRATIONS, file), 'utf8'))
    }
    await pg.exec(
      `INSERT INTO agent_memory (agent_id, memory_type, date_key, content)
       VALUES ('global', 'daily', '2026-08-26', 'a note that must survive')`,
    )

    await pg.exec(readFileSync(join(PG_MIGRATIONS, '062_agent_memory_kv.sql'), 'utf8'))

    const { rows } = await pg.query<{ content: string }>(
      `SELECT content FROM agent_memory_files WHERE agent_id = 'global' AND date_key = '2026-08-26'`,
    )
    expect(rows.map(r => r.content)).toEqual(['a note that must survive'])
    await pg.close()
  }, 60_000)
})

describe('the SQLite migration keeps its accidental-re-run guard', () => {
  it('copies daily-notes rows out BEFORE dropping the table', () => {
    const sql = readFileSync(join(SQLITE_MIGRATIONS, '062_agent_memory_kv.sql'), 'utf8')
    const copyAt = sql.indexOf('INSERT OR IGNORE INTO agent_memory_files')
    const dropAt = sql.indexOf('DROP TABLE agent_memory')
    expect(copyAt).toBeGreaterThan(-1)
    expect(dropAt).toBeGreaterThan(-1)
    // SQLite has no conditional DDL, so ORDER is the whole safety property:
    // the copy names `memory_type`, which no longer exists after the reshape,
    // so an accidental second run fails on the FIRST statement and the runner's
    // transaction rolls back with nothing dropped. Reverse these two and a
    // re-run silently destroys the key/value store instead.
    expect(copyAt).toBeLessThan(dropAt)
  })
})

describe('the health probe checks shape, not just existence', () => {
  it('probes agent_memory on `key` — the column the broken shape lacked', () => {
    expect(TABLE_PROBE_COLUMNS.agent_memory).toBe('key')
    expect(TABLE_PROBE_COLUMNS.agent_memory_files).toBe('memory_type')
  })

  it('never probes a bookkeeping column, which would prove nothing', () => {
    // `id` and `created_at` survive almost any shape drift — probing them is
    // how the original guard stayed green while two features were broken.
    const useless = Object.entries(TABLE_PROBE_COLUMNS).filter(
      ([, column]) => column === 'id' || column === 'created_at',
    )
    expect(useless).toEqual([])
  })

  it('declares a probe column for every required table', () => {
    // An unprobed table is existence-checked only. That is allowed by
    // checkRequiredTables (it reports them under `unprobed`), but the intent
    // is full coverage — this fails when a new table is added without one.
    const unprobed = REQUIRED_TABLES.filter(t => !TABLE_PROBE_COLUMNS[t])
    expect(unprobed).toEqual([])
  })
})

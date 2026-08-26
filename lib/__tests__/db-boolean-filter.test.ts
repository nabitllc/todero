/**
 * Guard for the "eq.false silently matches nothing" class of defect.
 *
 * `lib/db/query-params.ts` hands `eq`/`neq` filter values through as plain
 * strings (`is_blocked=eq.false` -> `"false"`), on purpose: coercing every
 * scalar would corrupt a genuine string comparison (`"007"` becoming `7`).
 * Postgres tolerates the string form for free — `col = $1` infers `$1`'s
 * type from `col`, and the boolean input parser accepts `'true'`/`'false'`
 * text — but SQLite has no such inference: a TEXT '0'/'false' parameter never
 * equals an INTEGER-affinity 0/1 column, so `is_blocked=eq.false` matched
 * ZERO rows on every install running the sqlite provider, always, silently.
 *
 * The fix: `lib/db/pg-sql.ts`'s `compile()`/`compileCount()` accept a
 * `booleanColumns` set (only ever non-empty on the sqlite flavour — see
 * `lib/db/sqlite-adapter.ts`'s `booleanColumnsFor`) and coerce an `eq`/`neq`
 * value to a real boolean ONLY when the column is schema-declared boolean
 * AND the string is exactly `true`/`false` (case-insensitively, the same
 * vocabulary `is` already accepts). A column that is not boolean-declared is
 * never in that set, so a TEXT column legitimately holding the word "false"
 * keeps comparing as a string, on both dialects.
 *
 * Layer A below is dialect-free and needs no database: it calls `compile()`
 * directly and asserts on the bound parameter values, which is what actually
 * proves the coercion — not just "the right rows came back", which a
 * differently-broken change could also produce by accident.
 *
 * Layer B replays the real defect against a real, file-backed SQLite built
 * from this repo's own `migrations/sqlite/000_baseline.sql` (the same
 * schema `npm run setup` writes), through the actual seam
 * (`db().from(table)` + `applyFilters`) exactly as
 * `app/api/run-agent/route.ts`'s `selectRows()` calls it — proving the fix
 * end to end, not just at the compiler unit.
 */

import { readFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { compile, type PgQuerySpec, type WherePart } from '../db/pg-sql'

// ── Layer A: the compiler, in isolation ─────────────────────────────────────

function spec(where: WherePart[], dialect: 'postgres' | 'sqlite' = 'sqlite'): PgQuerySpec {
  return {
    table: 'issues',
    verb: 'select',
    columns: 'id',
    returning: false,
    rows: [],
    patch: null,
    where,
    order: [],
    limit: null,
    offset: null,
    onConflict: null,
    ignoreDuplicates: false,
    head: false,
    dialect,
  }
}

describe('pg-sql compile(): boolean-literal coercion', () => {
  const eqFalse: WherePart = {
    kind: 'cmp',
    predicate: { column: 'is_blocked', op: 'eq', value: 'false' },
    negated: false,
  }

  it('without booleanColumns (the pre-fix shape, and what the postgres flavour still passes): value stays the string "false"', () => {
    const statement = compile(spec([eqFalse]))
    expect(statement.values).toEqual(['false'])
    // The bound value is a STRING. Against a 0/1 INTEGER-affinity SQLite
    // column this matches nothing — this assertion IS the defect from
    // TOD boolean-filter, captured so a regression that drops the
    // booleanColumns wiring anywhere upstream reproduces exactly this,
    // not a vague "wrong row count". See the "RED-then-GREEN" note in
    // docs/rebuild/pieces/pieces7/boolean-filter.md for how this was
    // proven against the live sqlite adapter, not just this unit.
  })

  it('with booleanColumns naming the column (what sqlite-adapter.ts now wires): coerced to a real boolean', () => {
    const statement = compile(spec([eqFalse]), new Set(['is_blocked']))
    expect(statement.values).toEqual([false])
  })

  it('coerces eq.true the same way', () => {
    const eqTrue: WherePart = {
      kind: 'cmp',
      predicate: { column: 'is_blocked', op: 'eq', value: 'true' },
      negated: false,
    }
    expect(compile(spec([eqTrue]), new Set(['is_blocked'])).values).toEqual([true])
  })

  it('coerces neq the same way', () => {
    const neqFalse: WherePart = {
      kind: 'cmp',
      predicate: { column: 'is_blocked', op: 'neq', value: 'false' },
      negated: false,
    }
    expect(compile(spec([neqFalse]), new Set(['is_blocked'])).values).toEqual([false])
  })

  it('coerces inside or() predicates — the OverviewTab.tsx blocked-card shape', () => {
    const or: WherePart = {
      kind: 'or',
      predicates: [
        { column: 'blocked_by', op: 'is', value: null, negated: true },
        { column: 'is_blocked', op: 'eq', value: 'true' },
      ],
    }
    expect(compile(spec([or]), new Set(['is_blocked'])).values).toEqual([true])
  })

  it('coerces a negated eq (not.eq)', () => {
    const notEq: WherePart = {
      kind: 'cmp',
      predicate: { column: 'is_blocked', op: 'eq', value: 'false' },
      negated: true,
    }
    expect(compile(spec([notEq]), new Set(['is_blocked'])).values).toEqual([false])
  })

  it('leaves a column NOT in booleanColumns untouched, even if it spells "false"', () => {
    const notesFalse: WherePart = {
      kind: 'cmp',
      predicate: { column: 'notes', op: 'eq', value: 'false' },
      negated: false,
    }
    // "notes" is deliberately absent from the set — a TEXT column genuinely
    // holding the word "false" as data must keep string-matching.
    expect(compile(spec([notesFalse]), new Set(['is_blocked'])).values).toEqual(['false'])
  })

  it('leaves a non-literal string untouched even on a boolean column', () => {
    const garbage: WherePart = {
      kind: 'cmp',
      predicate: { column: 'is_blocked', op: 'eq', value: 'maybe' },
      negated: false,
    }
    expect(compile(spec([garbage]), new Set(['is_blocked'])).values).toEqual(['maybe'])
  })

  it('is a no-op on a value that is already a real boolean (the .eq(col, true) builder form)', () => {
    const realBool: WherePart = {
      kind: 'cmp',
      predicate: { column: 'is_blocked', op: 'eq', value: true },
      negated: false,
    }
    expect(compile(spec([realBool]), new Set(['is_blocked'])).values).toEqual([true])
  })

  it('does not touch is.false/is.true — already typed by parseIsValue()', () => {
    const isFalse: WherePart = {
      kind: 'cmp',
      predicate: { column: 'is_blocked', op: 'is', value: false },
      negated: false,
    }
    const statement = compile(spec([isFalse]), new Set(['is_blocked']))
    expect(statement.text).toContain('IS FALSE')
    expect(statement.values).toEqual([])
  })
})

// ── Layer B: the real defect, replayed end to end on real SQLite ───────────

describe('sqlite adapter: eq.false / eq.true against a real file', () => {
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
      `todero-boolean-filter-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
    )
    const seed = new Database(file)
    seed.exec('PRAGMA foreign_keys = ON')
    seed.exec(
      readFileSync(join(__dirname, '..', '..', 'migrations', 'sqlite', '000_baseline.sql'), 'utf8'),
    )
    const now = new Date().toISOString()
    seed
      .prepare(
        'INSERT INTO issues (id, task_key, title, project, type, priority, status, assignee, ' +
          'acceptance_criteria, is_blocked, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run('t-blocked', 'GUARD-BLOCKED', 'blocked fixture', 'Limiglow', 'task', 'p2', 'backlog', 'kaos', 'n/a', 1, now, now)
    seed
      .prepare(
        'INSERT INTO issues (id, task_key, title, project, type, priority, status, assignee, ' +
          'acceptance_criteria, is_blocked, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run('t-unblocked', 'GUARD-UNBLOCKED', 'unblocked fixture', 'Limiglow', 'task', 'p2', 'backlog', 'kaos', 'n/a', 0, now, now)
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
    let builder = seam!.db().from('issues').select(select)
    builder = qp!.applyFilters(builder, params)
    builder = qp!.applyShaping(builder, params)
    const { data, error } = await builder
    if (error) throw new Error(error.message)
    return (data as Array<{ task_key: string }>).map(r => r.task_key)
  }

  it('is_blocked=eq.false returns exactly the unblocked fixture', async () => {
    const keys = await selectTaskKeys('project=eq.Limiglow&is_blocked=eq.false&select=task_key&order=task_key.asc')
    expect(keys).toEqual(['GUARD-UNBLOCKED'])
  })

  it('is_blocked=eq.true returns exactly the blocked fixture', async () => {
    const keys = await selectTaskKeys('project=eq.Limiglow&is_blocked=eq.true&select=task_key&order=task_key.asc')
    expect(keys).toEqual(['GUARD-BLOCKED'])
  })

  it('the or() form OverviewTab.tsx uses picks up the blocked fixture', async () => {
    const keys = await selectTaskKeys(
      'project=eq.Limiglow&or=(blocked_by.not.is.null,is_blocked.eq.true)&select=task_key&order=task_key.asc',
    )
    expect(keys).toEqual(['GUARD-BLOCKED'])
  })

  it('is_blocked=is.false still works (the operator that was never broken)', async () => {
    const keys = await selectTaskKeys('project=eq.Limiglow&is_blocked=is.false&select=task_key&order=task_key.asc')
    expect(keys).toEqual(['GUARD-UNBLOCKED'])
  })
})

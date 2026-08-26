/**
 * The one mutant lib/__tests__/agent-budget-ceilings.test.ts cannot kill.
 *
 * Measured: changing ONE line in app/api/heartbeat/route.ts —
 *
 *     -  if (owner && ownerRow?.id) {
 *     +  if (false && owner && ownerRow?.id) {
 *
 * — disables `checkInFlightCeilings` at what was, until this session, its only
 * call site in the entire repo. With that line changed, the whole run-safety
 * system is inert: no wall-clock stop, no no-progress halt, no SIGTERM, no
 * inbox row. And it SURVIVED everything: the full suite, `node
 * scripts/acceptance/run.mjs` at 45/45 and 10/10, all nine smoke guards, and
 * (re-measured today against the new lib-level ceiling suite) 30 of 30 of
 * those tests too — because they drive the library directly and never ask
 * whether anything calls it.
 *
 * A ceiling is only real if something reaches it. So this file exercises the
 * ROUTE HANDLER, over a real request object, against a real file-backed SQLite
 * built from migrations/sqlite/*.sql — not a mock of the database and not a
 * grep for the function's name. Deliberately not a grep: `ceilings-exist` in
 * scripts/acceptance/checks-anywhere.mjs is already a grep for these
 * identifiers, it is marked `critical: true`, and it printed "all three
 * ceilings present" while all four ceilings were mutated inert. Spelling is
 * not wiring.
 */

import { readFileSync, readdirSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { NextRequest } from 'next/server'

const MIGRATIONS_SQLITE = join(__dirname, '..', '..', 'migrations', 'sqlite')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const Database = require('better-sqlite3') as typeof import('better-sqlite3')

const AGENT = 'limiglow-hb-probe'
const ISO = (ms: number) => new Date(Date.now() + ms).toISOString()

function buildDatabase(): string {
  const file = join(
    tmpdir(),
    `todero-hb-ceilings-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
  )
  const seed = new Database(file)
  seed.exec('PRAGMA foreign_keys = ON')
  const names = readdirSync(MIGRATIONS_SQLITE).filter(f => f.endsWith('.sql')).sort()
  for (const n of names) seed.exec(readFileSync(join(MIGRATIONS_SQLITE, n), 'utf8'))
  // Record them as applied so lib/db/boot-migrate.ts's self-healing pass does
  // not try to re-apply files that are already in this file's schema.
  seed.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, ' +
      "applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
  )
  const ins = seed.prepare('INSERT OR IGNORE INTO schema_migrations (filename) VALUES (?)')
  for (const n of names) ins.run(n)
  seed.close()
  return file
}

describe('PATCH /api/heartbeat actually reaches the ceilings', () => {
  let file: string
  let raw: import('better-sqlite3').Database
  let route: typeof import('@/app/api/heartbeat/route')
  let sqlite: typeof import('@/lib/db/sqlite-adapter')
  const saved: Record<string, string | undefined> = {}

  beforeAll(() => {
    file = buildDatabase()
    raw = new Database(file)
    for (const k of ['TODERO_DB_PROVIDER', 'TODERO_SQLITE_PATH']) saved[k] = process.env[k]
    process.env.TODERO_DB_PROVIDER = 'sqlite'
    process.env.TODERO_SQLITE_PATH = file
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      route = require('@/app/api/heartbeat/route')
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      sqlite = require('@/lib/db/sqlite-adapter')
    })
  })

  afterAll(() => {
    raw.close()
    try {
      sqlite.closeSqlite()
    } catch {
      /* already closed */
    }
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        unlinkSync(file + suffix)
      } catch {
        /* gone, or held open on Windows — a temp file either way */
      }
    }
  })

  beforeEach(() => {
    for (const t of ['agent_runs', 'inbox', 'agent_memory', 'agent_heartbeats', 'issues']) {
      raw.prepare(`DELETE FROM ${t}`).run()
    }
  })

  function seed(taskKey: string, opts: { runAgeMin: number }): void {
    const now = ISO(0)
    raw
      .prepare(
        'INSERT INTO issues (id, task_key, title, project, type, priority, status, assignee, worked_by, ' +
          'acceptance_criteria, sprint, is_blocked, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(taskKey, taskKey, 'heartbeat fixture', 'Limiglow', 'task', 'p2', 'in_progress', AGENT, AGENT, 'n/a', 'probe-sprint', 0, now, now)
    raw
      .prepare(
        'INSERT INTO agent_runs (id, agent_id, task_id, status, started_at, created_at, stall_count) VALUES (?,?,?,?,?,?,0)',
      )
      .run(`run-${taskKey}`, AGENT, taskKey, 'running', ISO(-opts.runAgeMin * 60_000), now)
  }

  function beat(taskKey: string): Promise<Response> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NextRequest: NR } = require('next/server') as typeof import('next/server')
    const req = new NR('http://localhost:3000/api/heartbeat', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_key: taskKey }),
    }) as unknown as NextRequest
    return route.PATCH(req) as unknown as Promise<Response>
  }

  it('MUTANT M9 — a beat on a run past its wall clock comes back with the ceiling stop, not a bare ok', async () => {
    seed('LIMI-HB-1', { runAgeMin: 90 })

    const res = await beat('LIMI-HB-1')
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      agent: { agent_id: string } | null
      ceilingStop: { stopped: boolean; ceiling?: string; reason?: string } | null
    }

    // The beat itself still succeeds — enforcement must not break liveness.
    expect(body.ok).toBe(true)
    expect(body.agent?.agent_id).toBe(AGENT)

    // …and the ceiling fired, in the same request.
    expect(body.ceilingStop).not.toBeNull()
    expect(body.ceilingStop?.stopped).toBe(true)
    expect(body.ceilingStop?.ceiling).toBe('wall_clock')

    // The stop is durable, not just a field in a response body.
    const run = raw.prepare('SELECT status, stopped_reason FROM agent_runs WHERE id = ?').get('run-LIMI-HB-1') as {
      status: string
      stopped_reason: string | null
    }
    expect(run.status).toBe('stopped')
    expect(run.stopped_reason).toBe('wall_clock')

    const issue = raw.prepare('SELECT is_blocked, blocked_by FROM issues WHERE id = ?').get('LIMI-HB-1') as {
      is_blocked: number
      blocked_by: string | null
    }
    expect(issue.is_blocked).toBe(1)
    expect(issue.blocked_by).toBe('system:ceiling_stop:wall_clock')

    const inbox = raw.prepare("SELECT COUNT(*) AS n FROM inbox WHERE type = 'ceiling_stop'").get() as { n: number }
    expect(inbox.n).toBe(1)
  })

  it('a beat on a healthy run reports ceilingStop:null and changes nothing', async () => {
    seed('LIMI-HB-2', { runAgeMin: 3 })

    const body = (await (await beat('LIMI-HB-2')).json()) as { ok: boolean; ceilingStop: unknown }
    expect(body.ok).toBe(true)
    expect(body.ceilingStop).toBeNull()

    const run = raw.prepare('SELECT status FROM agent_runs WHERE id = ?').get('run-LIMI-HB-2') as { status: string }
    expect(run.status).toBe('running')
    const issue = raw.prepare('SELECT is_blocked FROM issues WHERE id = ?').get('LIMI-HB-2') as { is_blocked: number }
    expect(issue.is_blocked).toBe(0)
  })

  it('the beat still writes heartbeat_at — enforcement rides along, it does not replace liveness', async () => {
    seed('LIMI-HB-3', { runAgeMin: 3 })
    const before = raw.prepare('SELECT heartbeat_at FROM issues WHERE id = ?').get('LIMI-HB-3') as {
      heartbeat_at: string | null
    }
    expect(before.heartbeat_at).toBeNull()

    await beat('LIMI-HB-3')

    const after = raw.prepare('SELECT heartbeat_at FROM issues WHERE id = ?').get('LIMI-HB-3') as {
      heartbeat_at: string | null
    }
    expect(after.heartbeat_at).toBeTruthy()
  })
})

describe('POST /api/heartbeat/sweep — the supervisor trigger, over the route', () => {
  let file: string
  let raw: import('better-sqlite3').Database
  let route: typeof import('@/app/api/heartbeat/sweep/route')
  let sqlite: typeof import('@/lib/db/sqlite-adapter')
  const saved: Record<string, string | undefined> = {}

  beforeAll(() => {
    file = buildDatabase()
    raw = new Database(file)
    for (const k of ['TODERO_DB_PROVIDER', 'TODERO_SQLITE_PATH']) saved[k] = process.env[k]
    process.env.TODERO_DB_PROVIDER = 'sqlite'
    process.env.TODERO_SQLITE_PATH = file
    jest.isolateModules(() => {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      route = require('@/app/api/heartbeat/sweep/route')
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      sqlite = require('@/lib/db/sqlite-adapter')
    })
  })

  afterAll(() => {
    raw.close()
    try {
      sqlite.closeSqlite()
    } catch {
      /* already closed */
    }
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        unlinkSync(file + suffix)
      } catch {
        /* gone, or held open on Windows */
      }
    }
  })

  function post(query = ''): Promise<Response> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { NextRequest: NR } = require('next/server') as typeof import('next/server')
    const req = new NR(`http://localhost:3000/api/heartbeat/sweep${query}`, { method: 'POST' }) as unknown as NextRequest
    return route.POST(req) as unknown as Promise<Response>
  }

  it('stops an abandoned run that never beat, and reports what it did', async () => {
    const now = ISO(0)
    raw
      .prepare(
        'INSERT INTO issues (id, task_key, title, project, type, priority, status, assignee, worked_by, acceptance_criteria, sprint, is_blocked, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run('LIMI-SW-1', 'LIMI-SW-1', 'sweep fixture', 'Limiglow', 'task', 'p2', 'in_progress', AGENT, AGENT, 'n/a', 'probe-sprint', 0, now, now)
    raw
      .prepare('INSERT INTO agent_runs (id, agent_id, task_id, status, started_at, created_at, stall_count) VALUES (?,?,?,?,?,?,0)')
      .run('run-SW-1', AGENT, 'LIMI-SW-1', 'running', ISO(-120 * 60_000), now)

    const res = await post()
    expect(res.status).toBe(200)
    const body = (await res.json()) as {
      ok: boolean
      scanned: number
      stopped: Array<{ runId: string; ceiling: string; taskKey: string | null }>
      errors: string[]
      configProblems: string[]
    }

    expect(body.ok).toBe(true)
    expect(body.errors).toEqual([])
    expect(body.scanned).toBe(1)
    expect(body.stopped).toEqual([
      { runId: 'run-SW-1', agentId: AGENT, taskKey: 'LIMI-SW-1', ceiling: 'wall_clock' },
    ])
    expect(body.configProblems).toEqual([])

    const issue = raw.prepare('SELECT blocked_by FROM issues WHERE id = ?').get('LIMI-SW-1') as {
      blocked_by: string | null
    }
    expect(issue.blocked_by).toBe('system:ceiling_stop:wall_clock')
  })

  it('refuses a nonsense limit with 422 rather than silently sweeping NaN rows', async () => {
    const res = await post('?limit=all')
    expect(res.status).toBe(422)
    const body = (await res.json()) as { field: string }
    expect(body.field).toBe('limit')
  })
})

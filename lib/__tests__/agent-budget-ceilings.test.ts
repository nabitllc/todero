/**
 * lib/agent-budget.ts had ZERO tests. Not "thin coverage" — zero. The only
 * suite that named the module (lib/__tests__/memory-run-agent-retrieval-budget.test.ts:77)
 * `jest.mock`s it away.
 *
 * What that cost, measured before this file existed: six independent one-line
 * mutations were applied to lib/agent-budget.ts SIMULTANEOUSLY — every one of
 * the four named ceilings, the fail-closed schema gate, and the single write
 * that keeps a ceiling-stopped issue out of the dispatcher's eligible query —
 * and the full suite passed, `node scripts/acceptance/run.mjs` reported 45/45
 * and 10/10, and all nine smoke guards were green, while a 90-minute run with
 * five stalled heartbeats went unstopped over real HTTP. The one acceptance
 * check that claims this ground (`ceilings-exist`, critical: true) printed
 * "all three ceilings present" throughout, because it greps for identifier
 * SPELLINGS across lib/ and app/api/ and the mutations left every identifier
 * spelled correctly. It measures vocabulary, not enforcement.
 *
 * So this file is written to kill mutants, not to describe behaviour. Each
 * `it()` below names the exact one-line change it exists to catch. Every one
 * of the seven was re-applied against this file and re-reverted; the piece doc
 * (docs/rebuild/pieces/pieces9/run-safety-ceilings.md) records which assertion
 * caught which, with the real failure text.
 *
 * HOW IT RUNS: against a real, file-backed SQLite built by applying every
 * migrations/sqlite/*.sql in filename order — the same schema `npm run setup`
 * produces — driven through the real `db()` seam. No mock of the database, no
 * stub of the module under test. A ceiling proven only against a hand-written
 * fake is exactly the class of evidence that failed here: the ceilings passed
 * every code-shaped check for the whole program while being inert.
 *
 * FIXTURES: this suite touches only its own temp .sqlite files under the OS
 * temp dir. It never opens db.sqlite and never writes to any shared host
 * database, so it cannot collide with a concurrent lane.
 */

import { readFileSync, readdirSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

type BudgetModule = typeof import('../agent-budget')

const MIGRATIONS_SQLITE = join(__dirname, '..', '..', 'migrations', 'sqlite')

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Database = require('better-sqlite3') as typeof import('better-sqlite3')

function tempFile(tag: string): string {
  return join(
    tmpdir(),
    `todero-ceilings-${tag}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`,
  )
}

/**
 * Build a database file.
 *   'all'           — every migrations/sqlite file, i.e. a correctly migrated host.
 *   'baseline-only' — 000_baseline.sql alone: no agent_budgets table and no
 *                     agent_runs.stall_count/last_progress_hash/pid/stopped_reason.
 *                     This is the shape checkBudgetSchema() exists to detect,
 *                     and it is not hypothetical — it is the state this repo's
 *                     own hosted instance was found in (see that function's
 *                     doc comment).
 */
function buildDatabase(tag: string, which: 'all' | 'baseline-only'): string {
  const file = tempFile(tag)
  const seed = new Database(file)
  seed.exec('PRAGMA foreign_keys = ON')
  const names = readdirSync(MIGRATIONS_SQLITE)
    .filter(f => f.endsWith('.sql'))
    .sort()
  const toApply = which === 'all' ? names : ['000_baseline.sql']
  for (const f of toApply) seed.exec(readFileSync(join(MIGRATIONS_SQLITE, f), 'utf8'))

  // The ledger lib/db/boot-migrate.ts reads. Writing EVERY filename into it,
  // including the ones deliberately not applied, is not a trick to defeat the
  // self-healer — it reproduces the exact state this repo's own hosted
  // instance was found in and which checkBudgetSchema() was written for: a
  // host that believes migration 038 ran and does not have its schema. Without
  // this, `which: 'baseline-only'` is unobservable, because the first db()
  // call silently applies all 22 files and the unmigrated case can never be
  // reached from a test at all. (That self-healing is a good property; it is
  // also why nothing had ever exercised the fail-closed branch.)
  seed.exec(
    'CREATE TABLE IF NOT EXISTS schema_migrations (filename TEXT PRIMARY KEY, ' +
      "applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))",
  )
  const ins = seed.prepare('INSERT OR IGNORE INTO schema_migrations (filename) VALUES (?)')
  for (const n of names) ins.run(n)
  seed.close()
  return file
}

/**
 * Load lib/agent-budget.ts fresh, bound to `file`, with `env` applied.
 *
 * Fresh matters three separate ways and each one is load-bearing:
 *   - `DB_PROVIDER` in lib/db.ts is read at module load, so the provider must
 *     be set before the seam is first required;
 *   - the DEFAULT_* ceiling constants are computed at module load from env,
 *     which is the only way to test that a typo'd env var is refused;
 *   - `schemaCache` is module-level with a 30s TTL, so a migrated and an
 *     unmigrated database cannot share one module instance.
 */
function loadBudget(
  file: string,
  env: Record<string, string | undefined> = {},
): { mod: BudgetModule; close: () => void } {
  const saved: Record<string, string | undefined> = {}
  const apply = { TODERO_DB_PROVIDER: 'sqlite', TODERO_SQLITE_PATH: file, ...env }
  for (const [k, v] of Object.entries(apply)) {
    saved[k] = process.env[k]
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }

  let mod!: BudgetModule
  let sqlite!: typeof import('../db/sqlite-adapter')
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require('../agent-budget')
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    sqlite = require('../db/sqlite-adapter')
  })

  return {
    mod,
    close() {
      try {
        sqlite.closeSqlite()
      } catch {
        /* already closed */
      }
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k]
        else process.env[k] = v
      }
    },
  }
}

function removeFile(file: string): void {
  for (const suffix of ['', '-wal', '-shm']) {
    try {
      unlinkSync(file + suffix)
    } catch {
      // already gone, or still held open on Windows — a temp file either way
    }
  }
}

const AGENT = 'limiglow-probe'
const ISO = (msFromNow: number) => new Date(Date.now() + msFromNow).toISOString()

// ───────────────────────────────────────────────────────────────────────────
// Fully migrated host: every ceiling has real rows to read.
// ───────────────────────────────────────────────────────────────────────────
describe('agent-budget ceilings, against a real migrated SQLite database', () => {
  let file: string
  let raw: import('better-sqlite3').Database
  let budget: BudgetModule
  let close: () => void

  beforeAll(() => {
    file = buildDatabase('full', 'all')
    raw = new Database(file)
    const loaded = loadBudget(file, { TODERO_NO_PROGRESS_MIN_MS: '0' })
    budget = loaded.mod
    close = loaded.close
  })

  afterAll(() => {
    raw.close()
    close()
    removeFile(file)
  })

  beforeEach(() => {
    for (const t of ['agent_runs', 'token_ledger', 'inbox', 'agent_memory', 'agent_heartbeats', 'agent_budgets', 'issues']) {
      raw.prepare(`DELETE FROM ${t}`).run()
    }
  })

  // ── seeding helpers, all raw SQL so the thing under test is never also the
  // thing that set up the fixture ──
  function seedIssue(id: string, updatedAt = ISO(0)): void {
    raw
      .prepare(
        'INSERT INTO issues (id, task_key, title, project, type, priority, status, assignee, ' +
          'acceptance_criteria, sprint, is_blocked, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run(id, `LIMI-${id}`, 'ceiling fixture', 'Limiglow', 'task', 'p2', 'in_progress', AGENT, 'n/a', 'probe-sprint', 0, ISO(0), updatedAt)
  }

  function seedRun(
    id: string,
    over: Partial<{ agent_id: string; task_id: string | null; started_at: string; status: string; pid: number | null; stall_count: number; last_progress_hash: string | null; last_progress_at: string | null }> = {},
  ): void {
    raw
      .prepare(
        'INSERT INTO agent_runs (id, agent_id, task_id, status, started_at, created_at, pid, stall_count, last_progress_hash, last_progress_at) ' +
          'VALUES (?,?,?,?,?,?,?,?,?,?)',
      )
      .run(
        id,
        over.agent_id ?? AGENT,
        over.task_id ?? null,
        over.status ?? 'running',
        over.started_at ?? ISO(0),
        ISO(0),
        over.pid ?? null,
        over.stall_count ?? 0,
        over.last_progress_hash ?? null,
        over.last_progress_at ?? null,
      )
  }

  function seedLedger(n: number, over: Partial<{ agent_id: string; cost_usd: number; spawned_at: string }> = {}): void {
    const stmt = raw.prepare(
      'INSERT INTO token_ledger (id, agent_id, runtime, spawned_at, status, cost_usd) VALUES (?,?,?,?,?,?)',
    )
    for (let i = 0; i < n; i++) {
      stmt.run(`led-${i}-${Math.random().toString(36).slice(2)}`, over.agent_id ?? AGENT, 'claude-code', over.spawned_at ?? ISO(-60_000), 'completed', over.cost_usd ?? 0)
    }
  }

  const runRow = (id: string) =>
    raw.prepare('SELECT status, stopped_reason, stall_count, finished_at FROM agent_runs WHERE id = ?').get(id) as
      | { status: string; stopped_reason: string | null; stall_count: number; finished_at: string | null }
      | undefined
  const issueRow = (id: string) =>
    raw.prepare('SELECT is_blocked, blocked_by FROM issues WHERE id = ?').get(id) as
      | { is_blocked: number; blocked_by: string | null }
      | undefined
  const inboxRows = () =>
    raw.prepare("SELECT agent, type, context FROM inbox WHERE type = 'ceiling_stop'").all() as Array<{
      agent: string
      type: string
      context: string | null
    }>

  // ── concurrency ──────────────────────────────────────────────────────────

  it('MUTANT M3 — concurrency_per_agent refuses when a run is already in flight (`perAgent >= budget.maxConcurrentPerAgent`)', async () => {
    seedRun('run-a')
    const verdict = await budget.getCeilingStatus(AGENT)
    expect(verdict.allowed).toBe(false)
    expect(verdict.ceiling).toBe('concurrency_per_agent')
    // The reason must carry BOTH real numbers. A ceiling that denies without
    // saying what it counted is unauditable, and this is the ceiling most
    // likely to look like a bug to whoever it stops.
    expect(verdict.reason).toContain(`1/1 runs already in flight for ${AGENT}`)
    expect(verdict.detail).toEqual({ running: 1, limit: 1 })
  })

  it('concurrency_per_agent permits when nothing is running — the ceiling opens as well as closes', async () => {
    const verdict = await budget.getCeilingStatus(AGENT)
    expect(verdict).toEqual({ allowed: true })
  })

  it('a stale running row (older than STALE_RUN_CUTOFF_MS) does not occupy a concurrency slot', async () => {
    seedRun('run-zombie', { started_at: ISO(-(budget.STALE_RUN_CUTOFF_MS + 60_000)) })
    // This host carries ~67,600 never-closed status='running' rows. Counting
    // them would make the ceiling deny every dispatch forever — a guard that
    // never opens is as dishonest as one that never closes.
    expect(await budget.getCeilingStatus(AGENT)).toEqual({ allowed: true })
  })

  it('concurrency_total refuses across agents once DEFAULT_MAX_CONCURRENT_TOTAL slots are taken', async () => {
    for (let i = 0; i < budget.DEFAULT_MAX_CONCURRENT_TOTAL; i++) {
      seedRun(`run-other-${i}`, { agent_id: `other-${i}` })
    }
    const verdict = await budget.getCeilingStatus(AGENT)
    expect(verdict.allowed).toBe(false)
    expect(verdict.ceiling).toBe('concurrency_total')
    expect(verdict.reason).toContain(`${budget.DEFAULT_MAX_CONCURRENT_TOTAL}/${budget.DEFAULT_MAX_CONCURRENT_TOTAL} runs already in flight across all agents`)
  })

  // ── run count — "the ceiling that bounds a self-retriggering loop" ────────

  it('MUTANT M4 — run_count_period refuses at the limit (`runCount >= budget.maxRunsPerPeriod`)', async () => {
    seedLedger(budget.DEFAULT_MAX_RUNS_PER_PERIOD)
    const verdict = await budget.getCeilingStatus(AGENT)
    expect(verdict.allowed).toBe(false)
    expect(verdict.ceiling).toBe('run_count_period')
    expect(verdict.reason).toContain(`${budget.DEFAULT_MAX_RUNS_PER_PERIOD}/${budget.DEFAULT_MAX_RUNS_PER_PERIOD} runs already spawned in the last 24h`)
  })

  it('run_count_period permits one below the limit — the boundary is >=, not >', async () => {
    seedLedger(budget.DEFAULT_MAX_RUNS_PER_PERIOD - 1)
    expect(await budget.getCeilingStatus(AGENT)).toEqual({ allowed: true })
  })

  it('run_count_period counts only spawns inside the 24h window', async () => {
    seedLedger(budget.DEFAULT_MAX_RUNS_PER_PERIOD, { spawned_at: ISO(-(budget.RUN_PERIOD_MS + 3_600_000)) })
    expect(await budget.getCeilingStatus(AGENT)).toEqual({ allowed: true })
  })

  it('the operator lever moves the ceiling: an agent_budgets row of 0 refuses immediately', async () => {
    const ok = await budget.setAgentBudget(AGENT, { maxRunsPerPeriod: 0, maxConcurrentPerAgent: 99 })
    expect(ok).toEqual({ ok: true })
    expect((await budget.getAgentBudget(AGENT)).source).toBe('row')
    const verdict = await budget.getCeilingStatus(AGENT)
    expect(verdict.ceiling).toBe('run_count_period')
    expect(verdict.reason).toContain('0/0 runs already spawned')
  })

  // ── dollar spend — dormant by design, but wired ───────────────────────────

  it('dollar_budget fires from real token_ledger cost once a limit_usd is set', async () => {
    await budget.setAgentBudget(AGENT, { limitUsd: 0.5, period: 'run' })
    seedLedger(2, { cost_usd: 0.4 })
    const verdict = await budget.getCeilingStatus(AGENT)
    expect(verdict.allowed).toBe(false)
    expect(verdict.ceiling).toBe('dollar_budget')
    expect(verdict.detail).toMatchObject({ spendUsd: 0.8, limitUsd: 0.5, period: 'run' })
  })

  it('dollar_budget stays dormant while limitUsd is null, however much was spent', async () => {
    seedLedger(2, { cost_usd: 500 })
    expect((await budget.getAgentBudget(AGENT)).limitUsd).toBeNull()
    expect(await budget.getCeilingStatus(AGENT)).toEqual({ allowed: true })
  })

  // ── the act/display split ────────────────────────────────────────────────

  it('checkDispatchCeilings records a refusal in the inbox; getCeilingStatus never does', async () => {
    seedRun('run-a')

    await budget.getCeilingStatus(AGENT)
    await budget.getCeilingStatus(AGENT)
    expect(inboxRows()).toHaveLength(0) // a dashboard poll must not fill the inbox

    const denied = await budget.checkDispatchCeilings(AGENT)
    expect(denied.allowed).toBe(false)
    const rows = inboxRows()
    expect(rows).toHaveLength(1)
    expect(rows[0].agent).toBe(AGENT)
    expect(String(rows[0].context)).toContain('concurrency_per_agent')
  })

  // ── wall clock ───────────────────────────────────────────────────────────

  it('MUTANT M1 — wall_clock stops a run past its limit (`ageMs > budget.maxRunMs`), and the stop is complete', async () => {
    seedIssue('iss-wall')
    seedRun('run-wall', { task_id: 'iss-wall', started_at: ISO(-90 * 60_000) })
    raw.prepare('INSERT INTO agent_heartbeats (agent_id, last_seen) VALUES (?,?)').run(AGENT, ISO(-30_000))

    const verdict = await budget.checkInFlightCeilings(AGENT, {
      id: 'iss-wall',
      task_key: 'LIMI-iss-wall',
      updated_at: ISO(0),
    })

    expect(verdict.allowed).toBe(false)
    expect(verdict.ceiling).toBe('wall_clock')

    // A stop is four writes, not one. Each is asserted separately because each
    // one was independently mutable while every gate stayed green.
    const run = runRow('run-wall')
    expect(run?.status).toBe('stopped')
    expect(run?.stopped_reason).toBe('wall_clock')
    expect(run?.finished_at).toBeTruthy()

    // MUTANT M6 — this is the single write that keeps a ceiling-stopped issue
    // out of the dispatcher's eligible query (`is_blocked=eq.false`,
    // app/api/run-agent/route.ts:509). Inverted, the run reads "stopped" while
    // its issue stays immediately re-dispatchable: the self-retriggering loop
    // the whole module exists to bound, with the stop LOOKING like it worked.
    const issue = issueRow('iss-wall')
    expect(issue?.is_blocked).toBe(1)
    expect(issue?.blocked_by).toBe('system:ceiling_stop:wall_clock')

    const inbox = inboxRows()
    expect(inbox).toHaveLength(1)
    const ctx = JSON.parse(String(inbox[0].context)) as { ceiling: string; reason: string; detail: Record<string, unknown> }
    expect(ctx.ceiling).toBe('wall_clock')
    expect(ctx.reason).toContain('exceeded 60 min wall clock')
    expect(ctx.reason).toContain('90 min elapsed')
    expect(ctx.detail.issue_blocked).toBe(true)
  })

  it('wall_clock leaves a young run alone', async () => {
    seedIssue('iss-young')
    seedRun('run-young', { task_id: 'iss-young', started_at: ISO(-10 * 60_000) })
    raw.prepare('INSERT INTO agent_heartbeats (agent_id, last_seen) VALUES (?,?)').run(AGENT, ISO(-30_000))

    const verdict = await budget.checkInFlightCeilings(AGENT, { id: 'iss-young', task_key: 'k', updated_at: ISO(0) })
    expect(verdict.allowed).toBe(true)
    expect(runRow('run-young')?.status).toBe('running')
    expect(issueRow('iss-young')?.is_blocked).toBe(0)
  })

  // ── no-progress ──────────────────────────────────────────────────────────

  it('MUTANT M2 — no_progress halts on the Nth unchanged check (`nextStallCount >= budget.noProgressHeartbeats`)', async () => {
    const frozen = ISO(-5 * 60_000)
    seedIssue('iss-stall', frozen)
    seedRun('run-stall', { task_id: 'iss-stall', started_at: ISO(-5 * 60_000) })

    const issue = { id: 'iss-stall', task_key: 'LIMI-stall', updated_at: frozen }

    // Beat 1 records the hash (nothing to compare against yet).
    expect((await budget.checkInFlightCeilings(AGENT, issue)).allowed).toBe(true)
    // Beats 2 and 3 are stalled observations 1 and 2.
    expect((await budget.checkInFlightCeilings(AGENT, issue)).allowed).toBe(true)
    expect((await budget.checkInFlightCeilings(AGENT, issue)).allowed).toBe(true)
    // Beat 4 is stalled observation 3 — the default ceiling.
    const stopped = await budget.checkInFlightCeilings(AGENT, issue)
    expect(stopped.allowed).toBe(false)
    expect(stopped.ceiling).toBe('no_progress')

    expect(runRow('run-stall')?.stopped_reason).toBe('no_progress')
    expect(issueRow('iss-stall')?.blocked_by).toBe('system:ceiling_stop:no_progress')

    // The persisted counter must agree with the number the inbox reason
    // quotes. It used to read one lower, because the tracker was written only
    // on the non-stopping path — two numbers for one fact, and the durable one
    // was wrong.
    const ctx = JSON.parse(String(inboxRows()[0].context)) as { detail: { stallCount: number } }
    expect(ctx.detail.stallCount).toBe(3)
    expect(runRow('run-stall')?.stall_count).toBe(3)
  })

  it('no_progress resets the moment the issue actually moves', async () => {
    seedIssue('iss-move')
    seedRun('run-move', { task_id: 'iss-move' })
    const base = { id: 'iss-move', task_key: 'LIMI-move' }

    await budget.checkInFlightCeilings(AGENT, { ...base, updated_at: 'stamp-1' })
    await budget.checkInFlightCeilings(AGENT, { ...base, updated_at: 'stamp-1' })
    expect(runRow('run-move')?.stall_count).toBe(1)

    await budget.checkInFlightCeilings(AGENT, { ...base, updated_at: 'stamp-2' })
    expect(runRow('run-move')?.stall_count).toBe(0)

    // and it is still running, three checks in
    expect(runRow('run-move')?.status).toBe('running')
  })

  it('an issue with no live run row is never stopped — a beat cannot invent a ceiling', async () => {
    seedIssue('iss-norun')
    const verdict = await budget.checkInFlightCeilings(AGENT, { id: 'iss-norun', task_key: 'k', updated_at: ISO(0) })
    expect(verdict).toEqual({ allowed: true })
    expect(issueRow('iss-norun')?.is_blocked).toBe(0)
  })

  // ── THE SWEEP: the ceiling that fires without the agent's cooperation ─────

  it('MUTANT M9 / THE GAP — a run that stops beating is stopped by the sweep, and by nothing else', async () => {
    seedIssue('iss-detached')
    // 90 minutes old, past the 60-minute wall clock, and NO agent_heartbeats
    // row at all. This is the detached self-respawning watcher
    // lib/dispatch-guard.ts's comment names: the failure mode whose defining
    // property is that it stops talking to the supervisor.
    seedRun('run-detached', { task_id: 'iss-detached', started_at: ISO(-90 * 60_000) })

    // The heartbeat path cannot touch it — and not merely because no beat
    // arrives to trigger it. Even when driven directly, it declines, by
    // design: on that path a stop additionally requires a recent beat.
    const viaHeartbeat = await budget.checkInFlightCeilings(AGENT, {
      id: 'iss-detached',
      task_key: 'LIMI-detached',
      updated_at: ISO(0),
    })
    expect(viaHeartbeat.allowed).toBe(true)
    expect(runRow('run-detached')?.status).toBe('running')

    // The supervisor sweep does stop it.
    const swept = await budget.sweepInFlightCeilings()
    expect(swept.errors).toEqual([])
    expect(swept.scanned).toBe(1)
    expect(swept.stopped).toEqual([
      { runId: 'run-detached', agentId: AGENT, taskKey: 'LIMI-iss-detached', ceiling: 'wall_clock' },
    ])

    expect(runRow('run-detached')?.status).toBe('stopped')
    expect(runRow('run-detached')?.stopped_reason).toBe('wall_clock')
    expect(issueRow('iss-detached')?.blocked_by).toBe('system:ceiling_stop:wall_clock')

    // The stop must SAY it was the abandoned case, not leave it to be inferred.
    const ctx = JSON.parse(String(inboxRows()[0].context)) as { reason: string; detail: Record<string, unknown> }
    expect(ctx.reason).toContain('has never sent a heartbeat')
    expect(ctx.detail.source).toBe('sweep')
    expect(ctx.detail.heartbeatRecent).toBe(false)
  })

  it('the sweep is idempotent — a run it stopped is not status=running, so the next pass does not see it', async () => {
    seedIssue('iss-twice')
    seedRun('run-twice', { task_id: 'iss-twice', started_at: ISO(-90 * 60_000) })

    expect((await budget.sweepInFlightCeilings()).stopped).toHaveLength(1)
    const second = await budget.sweepInFlightCeilings()
    expect(second.scanned).toBe(0)
    expect(second.stopped).toEqual([])
    expect(inboxRows()).toHaveLength(1)
  })

  it('the sweep leaves healthy runs running, and says how many it looked at', async () => {
    seedIssue('iss-ok')
    seedRun('run-ok', { task_id: 'iss-ok', started_at: ISO(-5 * 60_000) })
    const swept = await budget.sweepInFlightCeilings()
    expect(swept).toEqual({ scanned: 1, stopped: [], skipped: 0, errors: [] })
    expect(runRow('run-ok')?.status).toBe('running')
  })

  it('the sweep ignores never-closed zombie rows outside the staleness window', async () => {
    seedIssue('iss-zombie')
    seedRun('run-zombie', { task_id: 'iss-zombie', started_at: ISO(-(budget.STALE_RUN_CUTOFF_MS + 3_600_000)) })
    const swept = await budget.sweepInFlightCeilings()
    expect(swept.scanned).toBe(0)
    expect(issueRow('iss-zombie')?.is_blocked).toBe(0)
  })

  it('the sweep counts, rather than silently drops, a running row whose issue is gone', async () => {
    seedRun('run-orphan', { task_id: null, started_at: ISO(-90 * 60_000) })
    const swept = await budget.sweepInFlightCeilings()
    expect(swept.scanned).toBe(0)
    expect(swept.skipped).toBe(1)
    expect(swept.stopped).toEqual([])
  })

  it('the sweep is bounded — it never walks the whole table on a timer', async () => {
    for (let i = 0; i < 5; i++) {
      seedIssue(`iss-batch-${i}`)
      seedRun(`run-batch-${i}`, { task_id: `iss-batch-${i}`, started_at: ISO(-(60 + i) * 60_000) })
    }
    const swept = await budget.sweepInFlightCeilings({ limit: 2 })
    expect(swept.scanned).toBe(2)
    expect(swept.stopped).toHaveLength(2)
    expect(budget.SWEEP_BATCH_LIMIT).toBe(50)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// The chatty-agent false positive — a separate module instance, because the
// floor is a load-time constant.
// ───────────────────────────────────────────────────────────────────────────
describe('no_progress counts elapsed stall, not request volume', () => {
  let file: string
  let raw: import('better-sqlite3').Database
  let budget: BudgetModule
  let close: () => void

  beforeAll(() => {
    file = buildDatabase('stallfloor', 'all')
    raw = new Database(file)
    const loaded = loadBudget(file) // default TODERO_NO_PROGRESS_MIN_MS = 10 min
    budget = loaded.mod
    close = loaded.close
  })
  afterAll(() => {
    raw.close()
    close()
    removeFile(file)
  })

  it('four checks inside a second do not stop a run that started seconds ago', async () => {
    // Measured before the floor existed: four heartbeats landing inside 218 ms
    // stopped a run for "3 consecutive heartbeats with no change". The counter
    // counted REQUESTS, so a chatty agent died in a quarter of a second while
    // a silent one was never touched. Both halves are wrong; this is the first.
    const now = ISO(0)
    raw
      .prepare(
        'INSERT INTO issues (id, task_key, title, project, type, priority, status, assignee, acceptance_criteria, sprint, is_blocked, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
      )
      .run('iss-chatty', 'LIMI-chatty', 'chatty', 'Limiglow', 'task', 'p2', 'in_progress', AGENT, 'n/a', 'probe-sprint', 0, now, now)
    raw
      .prepare('INSERT INTO agent_runs (id, agent_id, task_id, status, started_at, created_at, stall_count) VALUES (?,?,?,?,?,?,0)')
      .run('run-chatty', AGENT, 'iss-chatty', 'running', now, now)

    const issue = { id: 'iss-chatty', task_key: 'LIMI-chatty', updated_at: now }
    for (let i = 0; i < 4; i++) {
      expect((await budget.checkInFlightCeilings(AGENT, issue)).allowed).toBe(true)
    }

    const run = raw.prepare('SELECT status, stall_count FROM agent_runs WHERE id = ?').get('run-chatty') as {
      status: string
      stall_count: number
    }
    // Not stopped — but the observations were still counted, so the halt
    // fires the moment the stall is genuinely old enough.
    expect(run.status).toBe('running')
    expect(run.stall_count).toBe(3)
    expect(budget.DEFAULT_NO_PROGRESS_MIN_MS).toBe(600_000)
  })
})

// ───────────────────────────────────────────────────────────────────────────
// The fail-closed schema gate.
// ───────────────────────────────────────────────────────────────────────────
describe('MUTANT M5 — an unmigrated ceiling schema fails CLOSED', () => {
  let file: string
  let budget: BudgetModule
  let close: () => void

  beforeAll(() => {
    // 000_baseline.sql only: no agent_budgets, no agent_runs.stall_count /
    // last_progress_hash / pid / stopped_reason. On this shape the no-progress
    // halt cannot fire at all — the column it hashes against does not exist —
    // so reporting the built-in defaults as if every ceiling were armed is the
    // exact dishonesty checkBudgetSchema() was added to remove.
    file = buildDatabase('bare', 'baseline-only')
    const loaded = loadBudget(file)
    budget = loaded.mod
    close = loaded.close
  })
  afterAll(() => {
    close()
    removeFile(file)
  })

  it('reports source:"unavailable" rather than quietly "default"', async () => {
    const schema = await budget.checkBudgetSchema()
    expect(schema.available).toBe(false)
    expect(schema.missing.join(' ')).toContain('agent_budgets')

    const b = await budget.getAgentBudget(AGENT)
    expect(b.source).toBe('unavailable')
  })

  it('refuses to dispatch instead of degrading to defaults, and names the migration', async () => {
    const verdict = await budget.checkDispatchCeilings(AGENT)
    expect(verdict.allowed).toBe(false)
    expect(verdict.ceiling).toBe('schema_unavailable')
    expect(verdict.reason).toContain('038_agent_budgets_and_ceilings.sql')
  })
})

// ───────────────────────────────────────────────────────────────────────────
// The disarm-by-typo hole: no code change required, and nothing said.
// ───────────────────────────────────────────────────────────────────────────
describe('a typo in a ceiling env var is refused, not silently obeyed', () => {
  const cases: Array<[string, string, keyof BudgetModule, number]> = [
    ['TODERO_MAX_RUN_MS', '1h', 'DEFAULT_MAX_RUN_MS', 60 * 60 * 1000],
    ['TODERO_NO_PROGRESS_HEARTBEATS', 'three', 'DEFAULT_NO_PROGRESS_HEARTBEATS', 3],
    ['TODERO_MAX_RUNS_PER_PERIOD', '', 'DEFAULT_MAX_RUNS_PER_PERIOD', 20],
    ['TODERO_MAX_CONCURRENT_PER_AGENT', '-1', 'DEFAULT_MAX_CONCURRENT_PER_AGENT', 1],
  ]

  it.each(cases)('%s=%p falls back to the built-in default instead of NaN', (name, value, exported, expected) => {
    // Before this, each of these was `Number(process.env.X ?? default)`.
    // `Number('1h')` is NaN, `ageMs > NaN` is false for every ageMs, and the
    // wall-clock ceiling is gone — permanently, silently, from a plausible
    // .env typo, with the budget panel rendering the NaN as JSON `null` so the
    // UI reports "no limit" and calls it configuration.
    const file = buildDatabase('env', 'all')
    const { mod, close } = loadBudget(file, { [name]: value })
    try {
      expect(mod[exported]).toBe(expected)
      expect(Number.isNaN(mod[exported] as number)).toBe(false)
      if (value !== '') {
        // and it must SAY it refused — a silent correction is its own defect
        expect(mod.ceilingConfigProblems().join('\n')).toContain(name)
      } else {
        expect(mod.ceilingConfigProblems()).toEqual([])
      }
    } finally {
      close()
      removeFile(file)
    }
  })

  it('a legitimate override is still honoured', () => {
    const file = buildDatabase('envok', 'all')
    const { mod, close } = loadBudget(file, { TODERO_MAX_RUN_MS: '90000' })
    try {
      expect(mod.DEFAULT_MAX_RUN_MS).toBe(90_000)
      expect(mod.ceilingConfigProblems()).toEqual([])
    } finally {
      close()
      removeFile(file)
    }
  })
})

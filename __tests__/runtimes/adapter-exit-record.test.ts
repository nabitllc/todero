/**
 * pieces8/memory-attempted, ROUND 2 — THE GAP THIS CLOSES.
 *
 * Round 1 shipped `attempted` / `succeeded` / `failed` / `exit_status` and
 * wired all four into the only place they are ever produced in the running
 * product: the exit callback inside each runtime adapter. Every one of the 29
 * tests it wrote called `summarizeExit()` or `recordRunOnExit()` DIRECTLY.
 * Nothing called `claudeCodeRuntime.spawn()` / `codexRuntime.spawn()` /
 * `cursorRuntime.spawn()` / `openaiApiRuntime.spawn()` and looked at the row
 * that landed. The proof of that hole: gutting the evidence hand-off in all
 * four adapters at once — replacing `attempted: evidence.attempted` and its
 * three siblings with the pre-piece constants `null`/`false`/`false`/`null`,
 * i.e. reverting the entire feature everywhere it runs — left `tsc` clean and
 * the whole suite green. The single most valuable line in the piece was
 * unprotected.
 *
 * These tests drive the REAL `spawn()` of each adapter against a REAL child
 * process, and assert on the REAL row that lands in a scratch sqlite built
 * from the real migrations. There is no mock of `summarizeExit`,
 * `recordRunOnExit`, `spawnDetached` or the DB seam; the only stub is
 * `worktree.ts` (see below), because a test must not run `git worktree add`.
 *
 * HOW A CHILD IS PRODUCED WITHOUT INSTALLING claude/codex/cursor. Each
 * adapter resolves its binary from an env var (`CLAUDE_BIN`, `CODEX_BIN`,
 * `CURSOR_BIN`) at module load. Pointing those at `process.execPath` gives a
 * real OS process, spawned by the real `spawnDetached()`, that exits with a
 * real non-zero code because `node` does not understand `--permission-mode` /
 * `--force` / `exec`. That is precisely the evidence the row is supposed to
 * carry, and it is what a missing-flag or crashed agent produces in
 * production. `openai-api` needs no such trick: it already spawns
 * `process.execPath`, so it is driven end-to-end against a fake
 * OpenAI-compatible server on 127.0.0.1 and produces a genuine completed
 * trace with a genuine tool call.
 *
 * NOTHING TOUCHES THE SHARED DATABASE OR THE REPO. Every row lives in a
 * throwaway sqlite file inside an OS-temp scratch dir that is deleted in
 * `afterEach`; `TEMP`/`TMP` are pointed at that same dir for the duration, so
 * the prompt/runner temp dirs the adapters create are cleaned up with it.
 */

import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'fs'
import { createServer, type Server } from 'http'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AddressInfo } from 'net'

// A test may not run `git worktree add`. claude-code only prepares a worktree
// for code agents (this file uses 'tester', so it never asks), but codex and
// cursor ask unconditionally — and their documented behaviour on failure is to
// fall back to the shared working dir, which is exactly the path under test.
jest.mock('../../lib/runtimes/worktree', () => ({
  prepareWorktree: () => ({ ok: false, error: 'worktree stubbed: this test must not run any git command' }),
  teardownWorktree: () => ({ ok: true }),
}))

const REPO_ROOT = join(__dirname, '..', '..')
const SQLITE_MIGRATIONS_DIR = join(REPO_ROOT, 'migrations', 'sqlite')

/** The watcher polls the pid every 5s, so a row cannot appear sooner than that. */
const ROW_TIMEOUT_MS = 45_000

describe('runtime adapters — the exit evidence reaches agent_run_records for real (pieces8 round 2)', () => {
  let scratchDir: string
  let dbPath: string
  let closeHandles: Array<() => void> = []
  const savedEnv: Record<string, string | undefined> = {}

  const ENV_KEYS = [
    'TODERO_DB_PROVIDER', 'TODERO_SQLITE_PATH', 'TEMP', 'TMP', 'TMPDIR',
    'CLAUDE_BIN', 'CODEX_BIN', 'CURSOR_BIN',
    'LLM_BASE_URL', 'OPENAI_BASE_URL', 'LLM_API_KEY', 'OPENAI_API_KEY', 'LLM_MODEL',
  ]

  beforeEach(() => {
    for (const k of ENV_KEYS) savedEnv[k] = process.env[k]

    scratchDir = mkdtempSync(join(tmpdir(), 'todero-adapter-exit-'))
    dbPath = join(scratchDir, 'db.sqlite')

    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Database = require('better-sqlite3') as typeof import('better-sqlite3')
    const db = new Database(dbPath)
    for (const file of readdirSync(SQLITE_MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort()) {
      db.exec(readFileSync(join(SQLITE_MIGRATIONS_DIR, file), 'utf8'))
    }
    db.close()

    process.env.TODERO_DB_PROVIDER = 'sqlite'
    process.env.TODERO_SQLITE_PATH = dbPath
    // Every mkdtempSync(tmpdir()) an adapter performs now lands inside the
    // scratch dir, so the prompt/runner files go away with it.
    process.env.TEMP = scratchDir
    process.env.TMP = scratchDir
    process.env.TMPDIR = scratchDir
    closeHandles = []
  })

  afterEach(() => {
    for (const close of closeHandles) close()
    closeHandles = []
    for (const k of ENV_KEYS) {
      if (savedEnv[k] === undefined) delete process.env[k]
      else process.env[k] = savedEnv[k]!
    }
    if (existsSync(scratchDir)) {
      try { rmSync(scratchDir, { recursive: true, force: true }) } catch { /* a child may still hold a handle */ }
    }
  })

  /**
   * Load the adapter, the DB seam and the memory loop as ONE isolated module
   * graph, after the env is set — `CLAUDE_BIN` and friends are read at module
   * load, and so is the sqlite path.
   */
  function loadAdapter<K extends 'claude-code' | 'codex' | 'cursor' | 'openai-api'>(which: K) {
    let mods: { runtime: import('../../lib/runtimes/types').AgentRuntime; db: typeof import('../../lib/db').db }
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-var-requires */
      const db = (require('../../lib/db') as typeof import('../../lib/db')).db
      const sqliteAdapter = require('../../lib/db/sqlite-adapter') as typeof import('../../lib/db/sqlite-adapter')
      const runtime =
        which === 'claude-code' ? (require('../../lib/runtimes/claude-code') as typeof import('../../lib/runtimes/claude-code')).claudeCodeRuntime
        : which === 'codex' ? (require('../../lib/runtimes/codex') as typeof import('../../lib/runtimes/codex')).codexRuntime
        : which === 'cursor' ? (require('../../lib/runtimes/cursor') as typeof import('../../lib/runtimes/cursor')).cursorRuntime
        : (require('../../lib/runtimes/openai-api') as typeof import('../../lib/runtimes/openai-api')).openaiApiRuntime
      /* eslint-enable @typescript-eslint/no-var-requires */
      closeHandles.push(() => sqliteAdapter.closeSqlite())
      mods = { runtime, db }
    })
    return mods!
  }

  async function seedIssue(db: typeof import('../../lib/db').db, id: string, taskKey: string) {
    const { error } = await db().from('issues').insert({
      id,
      task_key: taskKey,
      title: 'Fixture issue for the adapter exit-record proof',
      status: 'in_progress',
      project: 'Limiglow',
      sprint: 'fixture',
      rejection_count: 0,
    })
    expect(error).toBeNull()
  }

  /** Poll for the row the adapter's exit callback writes. */
  async function waitForRow(
    db: typeof import('../../lib/db').db,
    agentId: string,
    logFile: string,
  ): Promise<Record<string, unknown>> {
    const startedAt = Date.now()
    while (Date.now() - startedAt < ROW_TIMEOUT_MS) {
      const { data } = await db().from('agent_run_records').select('*').eq('agent_id', agentId)
      const rows = (data ?? []) as Array<Record<string, unknown>>
      if (rows.length > 0) return rows[0]
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    const log = existsSync(logFile) ? readFileSync(logFile, 'utf8') : '(no log file)'
    throw new Error(`no agent_run_records row for ${agentId} within ${ROW_TIMEOUT_MS}ms. Run log:\n${log}`)
  }

  /** The real exit code the OS reported, read back out of the run log. */
  function exitCodeFromLog(logFile: string): number | null {
    const m = readFileSync(logFile, 'utf8').match(/\[spawn-exit-code\][^\n]*code=(\d+)/)
    return m ? Number(m[1]) : null
  }

  function truthy(v: unknown): boolean {
    return v === true || v === 1
  }

  // ── claude-code / codex / cursor: a real child, a real non-zero exit ──────
  //
  // Each of the three is the same proof with a different adapter, so the
  // shared body says once what all three assert: the row is written at all,
  // it carries the child's REAL exit code (compared against the log line the
  // OS event produced, never a hardcoded number), `failed` is true, and
  // `attempted` is a provenance-stamped record naming the runtime rather than
  // the null this column held on every row ever written before this piece.
  async function assertFailedRunRecorded(
    which: 'claude-code' | 'codex' | 'cursor',
    binEnvVar: 'CLAUDE_BIN' | 'CODEX_BIN' | 'CURSOR_BIN',
    issueSuffix: string,
  ) {
    // A real binary that really exists and really exits non-zero on these
    // flags. `resolveBinary()` in detached-spawn accepts an explicit path.
    process.env[binEnvVar] = process.execPath
    const { runtime, db } = loadAdapter(which)
    const agentId = `exitrec-${which}`
    const logFile = join(scratchDir, `${which}.log`)
    await seedIssue(db, `issue-${issueSuffix}`, `TOD-97${issueSuffix}`)

    const spawned = await runtime.spawn({
      agentId: 'tester', // never a CODE_AGENT: no branch, no worktree, no git
      workingDir: scratchDir,
      prompt: 'fixture prompt for the adapter exit-record proof',
      logFile,
      taskId: `issue-${issueSuffix}`,
    })
    // The adapter must genuinely have launched something. If this fails the
    // rest of the test is meaningless, so it is asserted, not assumed.
    expect(spawned.ok).toBe(true)
    expect(typeof spawned.pid).toBe('number')

    // Overwrite the agent id the row is keyed by: spawn() takes it from
    // opts.agentId, so query on that.
    const row = await waitForRow(db, 'tester', logFile)

    const osCode = exitCodeFromLog(logFile)
    expect(osCode).not.toBeNull()
    expect(osCode).not.toBe(0)

    // THE ASSERTION THE WHOLE PIECE RESTS ON: the real code the OS reported
    // is the value in the column.
    expect(row.exit_status).toBe(osCode)
    expect(truthy(row.failed)).toBe(true)
    expect(truthy(row.succeeded)).toBe(false)
    expect(row.task_key).toBe(`TOD-97${issueSuffix}`)

    const attempted = String(row.attempted)
    expect(row.attempted).not.toBeNull()
    expect(attempted).toContain('[run-exit]')
    expect(attempted).toContain(`runtime=${which}`)
    expect(attempted).toContain(`exit_code=${osCode}`)
    expect(attempted).toContain('outcome=failed')
    // Unused here but named so a reader knows what agentId was passed.
    expect(agentId).toContain(which)
  }

  it('claude-code: a real spawn that exits non-zero writes its real exit code and attempted text', async () => {
    await assertFailedRunRecorded('claude-code', 'CLAUDE_BIN', '01')
  }, 90_000)

  it('codex: a real spawn that exits non-zero writes its real exit code and attempted text', async () => {
    await assertFailedRunRecorded('codex', 'CODEX_BIN', '02')
  }, 90_000)

  it('cursor: a real spawn that exits non-zero writes its real exit code and attempted text', async () => {
    await assertFailedRunRecorded('cursor', 'CURSOR_BIN', '03')
  }, 90_000)

  // ── openai-api: the whole loop, against a fake OpenAI-compatible server ───

  /**
   * Minimal OpenAI-compatible endpoint. `/models` is what `mapModel()` asks
   * before spawning; `/chat/completions` is what the spawned runner calls.
   * `replies` is consumed one per call, so a scripted tool call followed by a
   * final answer produces a genuine two-iteration trace.
   */
  async function startFakeLlm(replies: Array<Record<string, unknown>>): Promise<{ baseUrl: string; server: Server }> {
    let call = 0
    const server = createServer((req, res) => {
      if (req.url?.endsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'fixture-model', object: 'model' }] }))
        return
      }
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => {
        const reply = replies[Math.min(call, replies.length - 1)]
        call += 1
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(reply))
      })
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    closeHandles.push(() => server.close())
    return { baseUrl: `http://127.0.0.1:${port}/v1`, server }
  }

  it('openai-api: a run that really completes records succeeded, exit 0, and the tools it really called', async () => {
    const readable = join(scratchDir, 'fixture-target.txt')
    require('fs').writeFileSync(readable, 'fixture file contents\n')

    const { baseUrl } = await startFakeLlm([
      {
        id: 'chatcmpl-fixture-1',
        model: 'fixture-model',
        choices: [{
          finish_reason: 'tool_calls',
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read_file', arguments: JSON.stringify({ path: readable }) } }],
          },
        }],
        usage: { prompt_tokens: 11, completion_tokens: 3 },
      },
      {
        id: 'chatcmpl-fixture-2',
        model: 'fixture-model',
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'done reading the fixture file' } }],
        usage: { prompt_tokens: 20, completion_tokens: 7 },
      },
    ])
    process.env.LLM_BASE_URL = baseUrl
    delete process.env.OPENAI_BASE_URL
    process.env.LLM_API_KEY = 'fixture-key'
    process.env.LLM_MODEL = 'fixture-model'

    const { runtime, db } = loadAdapter('openai-api')
    const logFile = join(scratchDir, 'openai-ok.log')
    await seedIssue(db, 'issue-04', 'TOD-9704')

    const spawned = await runtime.spawn({
      agentId: 'tester',
      workingDir: scratchDir,
      prompt: 'fixture prompt: read the fixture file',
      logFile,
      taskId: 'issue-04',
    })
    expect(spawned.ok).toBe(true)

    const row = await waitForRow(db, 'tester', logFile)
    expect(row.exit_status).toBe(0)
    expect(truthy(row.succeeded)).toBe(true)
    expect(truthy(row.failed)).toBe(false)

    const attempted = String(row.attempted)
    expect(attempted).toContain('[run-exit]')
    expect(attempted).toContain('runtime=openai-api')
    expect(attempted).toContain('exit_code=0')
    // The run's OWN trace said it completed — the verdict does not come from
    // the exit code alone (see summarizeExit's precedence table).
    expect(attempted).toContain('reported_status=completed')
    // ...and the tool the run really invoked, read back out of the trace the
    // child itself wrote. This is the Hermes "what it TRIED" content.
    expect(attempted).toContain('tools invoked (1')
    expect(attempted).toContain('read_file')
  }, 90_000)

  it('openai-api: an upstream error records the real non-zero exit, never a success', async () => {
    const { baseUrl } = await startFakeLlm([{ error: { message: 'fixture upstream failure' } }])
    process.env.LLM_BASE_URL = baseUrl
    delete process.env.OPENAI_BASE_URL
    process.env.LLM_API_KEY = 'fixture-key'
    process.env.LLM_MODEL = 'fixture-model'

    const { runtime, db } = loadAdapter('openai-api')
    const logFile = join(scratchDir, 'openai-err.log')
    await seedIssue(db, 'issue-05', 'TOD-9705')

    const spawned = await runtime.spawn({
      agentId: 'tester',
      workingDir: scratchDir,
      prompt: 'fixture prompt: this run fails upstream',
      logFile,
      taskId: 'issue-05',
    })
    expect(spawned.ok).toBe(true)

    const row = await waitForRow(db, 'tester', logFile)
    expect(row.exit_status).toBe(exitCodeFromLog(logFile))
    expect(row.exit_status).not.toBe(0)
    expect(truthy(row.failed)).toBe(true)
    expect(truthy(row.succeeded)).toBe(false)
    expect(String(row.attempted)).toContain('runtime=openai-api')
    expect(String(row.attempted)).toContain('outcome=failed')
  }, 90_000)
})

/**
 * pieces8/memory-attempted — unit proof for the module that decides what a
 * run's exit actually says.
 *
 * The rule under test is a discipline, not a feature: `summarizeExit()` must
 * report `unknown` (both boolean columns false — the historical behaviour of
 * `recordRunOnExit`) whenever the exit produced no evidence, and must NEVER
 * upgrade an absent signal into a verdict. The tests below are therefore
 * weighted toward the negative cases: nothing observed, a run that exited 0
 * while its own record says it did not finish, a signal death, a spawn
 * failure.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  ATTEMPTED_MAX_CHARS,
  readClaudeCompletion,
  readLogTail,
  readSpawnFailures,
  summarizeExit,
} from '../runtimes/exit-evidence'

describe('summarizeExit — outcome verdicts come only from observed signals', () => {
  it('reports unknown, and a null attempted, when literally nothing was observed', () => {
    const e = summarizeExit({ runtime: 'codex' })
    expect(e.outcome).toBe('unknown')
    expect(e.succeeded).toBe(false)
    expect(e.failed).toBe(false)
    expect(e.exitStatus).toBeNull()
    // This is the load-bearing assertion of the whole module: no evidence
    // must produce no record, never a plausible-looking sentence.
    expect(e.attempted).toBeNull()
  })

  it('records the real exit code, not a placeholder, when one was observed', () => {
    const e = summarizeExit({ runtime: 'codex', exitCode: 7, durationSec: 12 })
    expect(e.exitStatus).toBe(7)
    expect(e.outcome).toBe('failed')
    expect(e.attempted).toContain('exit_code=7')
    expect(e.attempted).toContain('duration_sec=12')
  })

  it('says exit_code=not-observed rather than 0 when the exit event never fired', () => {
    const e = summarizeExit({ runtime: 'cursor', durationSec: 30 })
    expect(e.exitStatus).toBeNull()
    expect(e.attempted).toContain('exit_code=not-observed')
    expect(e.attempted).not.toContain('exit_code=0')
    expect(e.outcome).toBe('unknown')
  })

  it('treats a terminating signal as a failure even with no exit code', () => {
    const e = summarizeExit({ runtime: 'claude-code', signal: 'SIGKILL', durationSec: 3 })
    expect(e.failed).toBe(true)
    expect(e.succeeded).toBe(false)
    expect(e.attempted).toContain('signal=SIGKILL')
  })

  it('treats any [spawn-failure] line as a failure, outranking a clean exit code', () => {
    const e = summarizeExit({
      runtime: 'codex',
      exitCode: 0,
      spawnFailures: ['[spawn-failure] 2026-08-26T00:00:00.000Z spawn ENOENT (bin=codex)'],
    })
    expect(e.failed).toBe(true)
    expect(e.attempted).toContain('spawn failures (verbatim from the run log)')
    expect(e.attempted).toContain('ENOENT')
  })

  /**
   * The case that makes the run's OWN record outrank its exit code. An
   * openai-api run that hits MAX_ITER writes `run_end status:max_iterations`
   * and then falls off the end of main() — process exit 0. Filing that as a
   * success is exactly the fabricated outcome this module exists to prevent.
   */
  it('does NOT call an exit-0 run successful when its own terminal record says max_iterations', () => {
    const e = summarizeExit({ runtime: 'openai-api', exitCode: 0, reportedStatus: 'max_iterations', turns: 12 })
    expect(e.succeeded).toBe(false)
    expect(e.failed).toBe(true)
    expect(e.attempted).toContain('reported_status=max_iterations')
  })

  it('does NOT call an exit-0 claude run successful when its own record sets is_error', () => {
    const e = summarizeExit({ runtime: 'claude-code', exitCode: 0, reportedStatus: 'error_during_execution', reportedError: true })
    expect(e.failed).toBe(true)
    expect(e.attempted).toContain('reported_error=true')
  })

  it('calls a run successful only when its own record says so', () => {
    const e = summarizeExit({ runtime: 'claude-code', exitCode: 0, reportedStatus: 'success', reportedError: false, turns: 6 })
    expect(e.succeeded).toBe(true)
    expect(e.failed).toBe(false)
    expect(e.attempted).toContain('outcome=succeeded')
    expect(e.attempted).toContain('turns=6')
  })

  it('leaves a run with a non-terminal status ("running") unknown, not successful, when the exit code is unobserved', () => {
    const e = summarizeExit({ runtime: 'openai-api', reportedStatus: 'running', durationSec: 900 })
    expect(e.outcome).toBe('unknown')
    expect(e.succeeded).toBe(false)
    expect(e.failed).toBe(false)
  })

  it('falls back to exit 0 as the only outcome signal for a runtime that writes no terminal record', () => {
    const e = summarizeExit({ runtime: 'cursor', exitCode: 0, durationSec: 44 })
    expect(e.succeeded).toBe(true)
    expect(e.attempted).toContain('runtime=cursor')
  })

  it('records the tool calls a run actually made, as a fact from its own trace', () => {
    const e = summarizeExit({
      runtime: 'openai-api',
      exitCode: 0,
      reportedStatus: 'completed',
      toolsUsed: ['read_file', 'write_file', 'run_tests'],
    })
    expect(e.attempted).toContain("tools invoked (3, from the run's own trace): read_file, write_file, run_tests")
  })

  it("labels the agent's own final report as the agent's claim, never as a verified outcome", () => {
    const e = summarizeExit({
      runtime: 'claude-code',
      exitCode: 0,
      reportedStatus: 'success',
      reportedError: false,
      finalReport: 'Added exponential backoff to the webhook retry loop.',
    })
    expect(e.attempted).toContain('NOT a verified outcome')
    expect(e.attempted).toContain('Added exponential backoff to the webhook retry loop.')
  })

  it('uses a verbatim log tail only when there is no structured record, and never on top of one', () => {
    const withTail = summarizeExit({ runtime: 'codex', exitCode: 0, logTail: ['npm ERR! test failed', 'exiting'] })
    expect(withTail.attempted).toContain('no structured completion record for this runtime')
    expect(withTail.attempted).toContain('npm ERR! test failed')

    const withRecord = summarizeExit({
      runtime: 'claude-code',
      exitCode: 0,
      reportedStatus: 'success',
      reportedError: false,
      logTail: ['npm ERR! test failed', 'exiting'],
    })
    expect(withRecord.attempted).not.toContain('npm ERR! test failed')
  })

  it('bounds attempted and names the log file holding the untruncated text', () => {
    const e = summarizeExit({
      runtime: 'claude-code',
      exitCode: 0,
      reportedStatus: 'success',
      reportedError: false,
      finalReport: 'x'.repeat(50_000),
      logFile: '/logs/run-42.log',
    })
    expect(e.attempted!.length).toBeLessThan(ATTEMPTED_MAX_CHARS + 200)
    expect(e.attempted).toContain('[truncated,')
    expect(e.attempted).toContain('/logs/run-42.log')
  })
})

describe('log readers — real files, real formats', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'todero-exit-evidence-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  /** The exact log shape lib/runtimes/claude-code.ts writes around the child's stdout. */
  function writeClaudeLog(body: string): string {
    const f = join(dir, 'run.log')
    writeFileSync(
      f,
      '[spawn-start] 2026-08-26T00:00:00.000Z agentId=builder model=default workingDir=/repo\n' +
      '[spawn-start] prompt bytes: 59 (file: /tmp/prompt.txt)\n' +
      '[spawn-start] ---\n' +
      body,
    )
    return f
  }

  it('reads subtype, is_error, num_turns, result AND the token/cost fields from one completion object', () => {
    const f = writeClaudeLog(JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      num_turns: 9,
      duration_ms: 412_000,
      result: 'Fixed the retry backoff.',
      total_cost_usd: 0.4398,
      usage: { input_tokens: 13_402, output_tokens: 2_210 },
    }) + '\n')
    const c = readClaudeCompletion(f)!
    expect(c.subtype).toBe('success')
    expect(c.isError).toBe(false)
    expect(c.numTurns).toBe(9)
    expect(c.result).toBe('Fixed the retry backoff.')
    // The token-ledger half must be byte-identical to what
    // parseClaudeJsonOutput() returned before this module absorbed it.
    expect(c.inputTokens).toBe(13_402)
    expect(c.outputTokens).toBe(2_210)
    expect(c.costUsd).toBe(0.4398)
  })

  it('still parses the completion object when the parent has appended its [spawn-exit-code] line after it', () => {
    const f = writeClaudeLog(
      JSON.stringify({ subtype: 'success', is_error: false, usage: { input_tokens: 5, output_tokens: 6 } }) + '\n' +
      '[spawn-exit-code] 2026-08-26T00:00:10.000Z pid=1234 code=0 signal=none\n',
    )
    const c = readClaudeCompletion(f)!
    expect(c.subtype).toBe('success')
    expect(c.inputTokens).toBe(5)
  })

  it('returns null — never a verdict — when the log holds no completion object', () => {
    expect(readClaudeCompletion(writeClaudeLog('Killed by the user.\n'))).toBeNull()
    expect(readClaudeCompletion(join(dir, 'does-not-exist.log'))).toBeNull()
  })

  it('returns null on malformed JSON rather than throwing inside an exit callback', () => {
    expect(readClaudeCompletion(writeClaudeLog('{ "subtype": "success", \n'))).toBeNull()
  })

  it('finds the [spawn-failure] lines detached-spawn writes, and nothing else', () => {
    const f = join(dir, 'fail.log')
    writeFileSync(
      f,
      '[spawn-start] ---\n' +
      '[spawn-failure] 2026-08-26T00:00:00.000Z spawn ENOENT (bin=codex)\n' +
      'some ordinary output line\n',
    )
    const failures = readSpawnFailures(f)
    expect(failures).toHaveLength(1)
    expect(failures[0]).toContain('ENOENT')
    expect(readSpawnFailures(join(dir, 'nope.log'))).toEqual([])
  })

  it('tails real output lines and skips this system\'s own spawn bookkeeping markers', () => {
    const f = join(dir, 'tail.log')
    writeFileSync(
      f,
      '[spawn-start] header\n[spawn-start] ---\n' +
      'first\nsecond\n\nthird\n' +
      '[spawn-ok] child_pid=999\n[spawn-exit] agent=builder task=none\n',
    )
    expect(readLogTail(f, 5)).toEqual(['first', 'second', 'third'])
  })
})

/**
 * ROUND-2 REPAIRS. Every test in this block pins a behaviour that a mutation
 * survived in round 1 — i.e. code that could be reverted with the whole suite
 * still green. They are written as the mutant's obituary: each one names the
 * change it would catch.
 */
describe('summarizeExit — a run whose own trace never said it finished (round-2 repair)', () => {
  /**
   * THE FABRICATION THIS CLOSES. `decideOutcome()` had `running` and
   * `unknown` inside NON_TERMINAL_STATUSES, which made them SKIP the
   * status branch entirely and land on the exit-0 fallback. Measured on the
   * shipped code before the fix:
   *   summarizeExit({runtime:'openai-api', exitCode:0, durationSec:3, reportedStatus:'running'})
   *   → {"outcome":"succeeded","succeeded":true,
   *      "attempted":"[run-exit] runtime=openai-api exit_code=0 duration_sec=3
   *                   reported_status=running outcome=succeeded"}
   * — a stored row asserting, in one line, both that the run never finished
   * and that it succeeded.
   */
  it('records a "running" trace at exit 0 as unknown, never as a success', () => {
    const e = summarizeExit({ runtime: 'openai-api', exitCode: 0, durationSec: 3, reportedStatus: 'running' })
    expect(e.outcome).toBe('unknown')
    expect(e.succeeded).toBe(false)
    expect(e.failed).toBe(false)
    // exit_status is still the REAL observed code — the fix changes the
    // verdict, never the recorded fact.
    expect(e.exitStatus).toBe(0)
    expect(e.attempted).toContain('reported_status=running')
    expect(e.attempted).toContain('outcome=unknown')
    expect(e.attempted).not.toContain('outcome=succeeded')
    // ...and the disagreement between the two signals is spelled out, not
    // left for a reader of the row to reconstruct.
    expect(e.attempted).toContain('never recorded a terminal status')
  })

  it('records an unreadable/empty trace ("unknown") at exit 0 as unknown, never as a success', () => {
    // parseOpenAiTrace() returns 'unknown' when the trace file cannot be read
    // or holds no steps (lib/runtimes/openai-api.ts:625, :640).
    const e = summarizeExit({ runtime: 'openai-api', exitCode: 0, durationSec: 3, reportedStatus: 'unknown' })
    expect(e.outcome).toBe('unknown')
    expect(e.succeeded).toBe(false)
    expect(e.attempted).not.toContain('outcome=succeeded')
  })

  it('still treats exit 0 as success for a runtime that writes NO status word at all', () => {
    // The other direction of the same fix: absence of a status is silence
    // (codex/cursor never write one), and silence must not be turned into a
    // failure either. This test fails if the repair above is over-applied.
    const e = summarizeExit({ runtime: 'cursor', exitCode: 0, durationSec: 44 })
    expect(e.outcome).toBe('succeeded')
    expect(e.succeeded).toBe(true)
    expect(e.attempted).toContain('outcome=succeeded')
    expect(e.attempted).not.toContain('never recorded a terminal status')
  })

  it('keeps hard evidence above a non-terminal status: "running" with a non-zero exit is still failed', () => {
    const e = summarizeExit({ runtime: 'openai-api', exitCode: 137, reportedStatus: 'running', durationSec: 60 })
    expect(e.outcome).toBe('failed')
    expect(e.failed).toBe(true)
    expect(e.exitStatus).toBe(137)
  })
})

describe('ATTEMPTED_MAX_CHARS — the cap is load-bearing, not decorative (round-2 repair)', () => {
  /**
   * MUTANT THAT SURVIVED ROUND 1: `ATTEMPTED_MAX_CHARS` 1_200 → 120_000
   * (100x) left all 20 tests in this file green. Nothing asserted that the
   * cap does anything, so the one bound protecting the retrieval budget was
   * free to be raised or deleted.
   */
  it('clips a runaway log tail to the cap and names where the rest lives', () => {
    const huge = Array.from({ length: 40 }, (_, i) => `line ${i} ${'x'.repeat(190)}`)
    const e = summarizeExit({
      runtime: 'codex',
      exitCode: 0,
      durationSec: 5,
      logTail: huge,
      logFile: '/logs/TOD-9999.log',
    })
    const attempted = e.attempted!
    expect(attempted.length).toBeLessThan(ATTEMPTED_MAX_CHARS + 200)
    expect(attempted).toContain('[truncated')
    // Truncation is never silent: the marker says how much was dropped and
    // which file still holds all of it.
    expect(attempted).toContain('/logs/TOD-9999.log')
  })

  /**
   * WHY THE NUMBER ITSELF MATTERS. `attempted` is rendered by
   * `formatRecord()` inside the retrieval budget alongside the record's
   * rejection reason and reviewer notes. The cap has to leave most of that
   * budget for those. At 1,200 chars this excerpt is ~300 tokens of a 1,300
   * token budget; at the 120,000 the round-1 mutant used it would be ~30,000
   * — every row would blow the budget on its own and every dispatch would
   * 503. This assertion is what makes that mutation fail.
   */
  it('keeps one record\'s own excerpt to at most a quarter of the retrieval budget', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { estimateTokens, CONTEXT_BUDGET_TOKENS_DEFAULT } = require('../memory-retrieval') as typeof import('../memory-retrieval')
    const atCap = 'x'.repeat(ATTEMPTED_MAX_CHARS)
    expect(estimateTokens(atCap) * 4).toBeLessThanOrEqual(CONTEXT_BUDGET_TOKENS_DEFAULT)
  })
})

describe('readSpawnFailures — how many lines survive is a decision, not an accident (round-2 repair)', () => {
  /**
   * MUTANT THAT SURVIVED ROUND 1: `.slice(-3)` → `.slice(-1)`, all 20 tests
   * green. A cascade (ENOENT, then EACCES, then "no pid") would have been
   * recorded as its last line only.
   */
  let scratch: string
  beforeAll(() => { scratch = mkdtempSync(join(tmpdir(), 'todero-spawn-failures-')) })
  afterAll(() => { rmSync(scratch, { recursive: true, force: true }) })

  it('keeps the last three failure lines, in order, when a launch fails repeatedly', () => {
    const f = join(scratch, 'cascade.log')
    writeFileSync(
      f,
      ['one', 'two', 'three', 'four', 'five']
        .map(n => `[spawn-failure] 2026-08-26T00:00:00.000Z failure ${n}\n`)
        .join('') + 'ordinary output\n',
    )
    const failures = readSpawnFailures(f)
    expect(failures).toHaveLength(3)
    expect(failures[0]).toContain('failure three')
    expect(failures[2]).toContain('failure five')
  })
})

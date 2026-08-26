/**
 * pieces8/memory-attempted — the claim this whole piece rests on, proved with
 * a real OS process rather than by reasoning about Node's docs.
 *
 * For four rounds the codebase has recorded `agent_run_records.exit_status:
 * null` on every row, with the stated reason (lib/memory-loop.ts's own
 * comment, and pieces7/memory-loop.md §8) that `watchChildExit()` polls
 * `process.kill(pid, 0)` and therefore "does not capture a real exit code or
 * signal, so there is nothing honest to fill in".
 *
 * That is true of `watchChildExit`. It is NOT true of the exit moment: the
 * parent still holds the `ChildProcess` handle `spawn()` returned, and Node
 * delivers a genuine `'exit'` event on it — with the real code — even for a
 * `detached: true` child that has been `unref()`d. Nobody had ever attached a
 * listener.
 *
 * These tests spawn real `node` processes with known exit codes and assert
 * the observation matches. If Node ever stopped delivering that event for a
 * detached+unref'd child, this file goes red and the piece's central claim is
 * withdrawn — which is the point of testing it here rather than asserting it
 * in a comment.
 */

import { mkdtempSync, readFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawnDetached, type ChildExitObservation } from '../runtimes/detached-spawn'

jest.setTimeout(30_000)

/** Poll the observation until the exit event lands, or give up honestly. */
async function waitForExit(exit: ChildExitObservation | undefined, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (exit?.observed) return
    await new Promise(r => setTimeout(r, 25))
  }
}

describe('spawnDetached — the child\'s REAL exit code (previously never captured)', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'todero-exit-code-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('observes exit code 0 from a detached, unref\'d child', async () => {
    const logFile = join(dir, 'ok.log')
    const result = await spawnDetached(process.execPath, ['-e', 'process.exit(0)'], logFile)
    expect(result.ok).toBe(true)
    expect(result.exit).toBeDefined()
    // Before the exit event, the honest state is "not observed" — never 0.
    await waitForExit(result.exit)
    expect(result.exit!.observed).toBe(true)
    expect(result.exit!.code).toBe(0)
    expect(result.exit!.signal).toBeNull()
    expect(typeof result.exit!.at).toBe('number')
  })

  it('observes a real NON-ZERO exit code — the signal that makes `failed` honest', async () => {
    const logFile = join(dir, 'bad.log')
    const result = await spawnDetached(process.execPath, ['-e', 'process.exit(23)'], logFile)
    expect(result.ok).toBe(true)
    await waitForExit(result.exit)
    expect(result.exit!.observed).toBe(true)
    expect(result.exit!.code).toBe(23)
  })

  it('distinguishes a crashing child (exit 1) from a clean one, on the same code path', async () => {
    const crash = await spawnDetached(
      process.execPath,
      ['-e', 'throw new Error("boom")'],
      join(dir, 'crash.log'),
    )
    await waitForExit(crash.exit)
    expect(crash.exit!.observed).toBe(true)
    expect(crash.exit!.code).toBe(1)
  })

  it('writes a brace-free [spawn-exit-code] line so the completion-JSON reader is unaffected', async () => {
    const logFile = join(dir, 'marker.log')
    const result = await spawnDetached(process.execPath, ['-e', 'process.exit(5)'], logFile)
    await waitForExit(result.exit)
    // Give the append a beat — appendFileSync happens inside the listener.
    await new Promise(r => setTimeout(r, 100))
    const log = readFileSync(logFile, 'utf8')
    const line = log.split('\n').find(l => l.includes('[spawn-exit-code]'))
    expect(line).toBeDefined()
    expect(line).toContain('code=5')
    expect(line).toContain('signal=none')
    // readClaudeCompletion() scans this same file for the LAST '}'. A brace
    // in this line would make it swallow the marker as part of the JSON.
    expect(line).not.toContain('}')
    expect(line).not.toContain('{')
  })

  it('leaves observed:false — never a fabricated 0 — while the child is still running', async () => {
    const logFile = join(dir, 'slow.log')
    const result = await spawnDetached(
      process.execPath,
      ['-e', 'setTimeout(() => process.exit(0), 5000)'],
      logFile,
    )
    expect(result.ok).toBe(true)
    expect(result.exit!.observed).toBe(false)
    expect(result.exit!.code).toBeNull()
    // Don't leave a stray process behind for the rest of the suite.
    if (result.pid) { try { process.kill(result.pid) } catch { /* already gone */ } }
  })
})

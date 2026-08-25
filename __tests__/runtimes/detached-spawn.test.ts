// Proves the portable spawn actually detaches and logs on THIS host.
// The bug this guards against: `/bin/bash -c 'nohup … & disown'` is ENOENT on
// Windows, so every agent dispatch failed before the first HTTP call.

import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { isAlive, spawnDetached, watchChildExit } from '@/lib/runtimes/detached-spawn'

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Poll until `check` passes or the budget runs out. Returns whether it passed. */
async function until(check: () => boolean, budgetMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + budgetMs
  while (Date.now() < deadline) {
    if (check()) return true
    await wait(150)
  }
  return check()
}

describe('spawnDetached', () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'todero-spawn-test-'))
  })

  afterEach(() => {
    try { rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
  })

  it('runs a child with no shell and streams stdout+stderr into the log file', async () => {
    const logFile = join(dir, 'run.log')

    const result = spawnDetached(
      process.execPath,
      ['-e', 'process.stdout.write("STDOUT-OK\\n"); process.stderr.write("STDERR-OK\\n")'],
      logFile
    )

    expect(result.ok).toBe(true)
    expect(result.pid).toBeGreaterThan(0)
    expect(result.logFile).toBe(logFile)

    const grew = await until(() => {
      if (!existsSync(logFile)) return false
      const text = readFileSync(logFile, 'utf8')
      return text.includes('STDOUT-OK') && text.includes('STDERR-OK')
    })
    expect(grew).toBe(true)
  })

  it('passes argv verbatim — no shell escaping of quotes, $() or backticks', async () => {
    const logFile = join(dir, 'argv.log')
    // Every character here used to break the hand-escaped shell string.
    const hostile = `it's "quoted" $(echo pwned) \`backtick\` & | ;`

    const result = spawnDetached(
      process.execPath,
      ['-e', 'process.stdout.write(process.argv[1])', hostile],
      logFile
    )
    expect(result.ok).toBe(true)

    const verbatim = await until(
      () => existsSync(logFile) && readFileSync(logFile, 'utf8').includes(hostile)
    )
    expect(verbatim).toBe(true)
  })

  it('feeds stdinFile to the child instead of a giant argv', async () => {
    const logFile = join(dir, 'stdin.log')
    const promptFile = join(dir, 'prompt.txt')
    // Comfortably past the ~32k Windows command-line limit.
    const prompt = 'x'.repeat(40_000)
    writeFileSync(promptFile, prompt, 'utf8')

    const result = spawnDetached(
      process.execPath,
      ['-e', 'let b="";process.stdin.on("data",c=>b+=c).on("end",()=>process.stdout.write("STDIN-BYTES="+b.length))'],
      logFile,
      { stdinFile: promptFile }
    )
    expect(result.ok).toBe(true)

    const read = await until(
      () => existsSync(logFile) && readFileSync(logFile, 'utf8').includes('STDIN-BYTES=40000')
    )
    expect(read).toBe(true)
  })

  it('reports a missing binary in the log instead of crashing the server', async () => {
    const logFile = join(dir, 'missing.log')

    const result = spawnDetached('todero-definitely-not-a-real-binary', ['--version'], logFile)

    // The failure may surface synchronously or via the async 'error' event —
    // either way it must be recorded, and must never throw.
    const recorded = await until(
      () => existsSync(logFile) && readFileSync(logFile, 'utf8').includes('[spawn-failure]')
    )
    expect(result.ok === false || recorded).toBe(true)
  })

  it('watchChildExit fires once the child is gone', async () => {
    const logFile = join(dir, 'watch.log')
    const result = spawnDetached(process.execPath, ['-e', 'process.exit(0)'], logFile)
    expect(result.ok).toBe(true)

    let exited = false
    watchChildExit(result.pid, logFile, () => { exited = true }, { intervalMs: 100 })

    const fired = await until(() => exited)
    expect(fired).toBe(true)
    expect(readFileSync(logFile, 'utf8')).toContain('[spawn-exit]')
    expect(isAlive(result.pid!)).toBe(false)
  })
})

// Live proof that the production dispatch path launches a real detached child
// on THIS host and that the log file it names exists and grows.
//
// Everything under test is the code the API route calls - openaiApiRuntime.spawn
// (which goes through spawnDetached) and prepareWorktree (which goes through
// spawnSync git). Nothing is mocked. The provider is whatever LLM_BASE_URL
// points at; on this machine that is a local Ollama.

import { existsSync, readFileSync, statSync, rmSync } from 'fs'
import { join } from 'path'

// jest does not go through next.config, so .env.local is not loaded for us.
// The dev server reads it; this test must see the same LLM_BASE_URL / LLM_MODEL.
// Hand-parsed rather than adding a dotenv dependency for one test.
function loadEnvLocal(): void {
  let raw = ''
  try {
    raw = readFileSync(join(process.cwd(), '.env.local'), 'utf8')
  } catch {
    return
  }
  for (const rawLine of raw.split('\n')) {
    const line = rawLine.trim()
    const eq = line.indexOf('=')
    if (line.startsWith('#') || eq <= 0) continue
    const key = line.slice(0, eq)
    if (process.env[key] !== undefined) continue
    process.env[key] = line.slice(eq + 1).replace(/^["']|["']$/g, '')
  }
}
loadEnvLocal()

import { LOG_DIR, TODERO_DIR, WORKTREE_ROOT } from '@/lib/paths'
import { openaiApiRuntime, resolveProvider } from '@/lib/runtimes/openai-api'
import { prepareWorktree, teardownWorktree } from '@/lib/runtimes/worktree'

jest.setTimeout(180_000)

/**
 * This suite needs a real host: a reachable LLM endpoint, a writable log
 * directory, and a git checkout that can carry a worktree. CI has none of
 * those — no .env.local, no Ollama, a shallow clone — so both live tests
 * failed there and reported it as a product defect. They are not: they are a
 * measurement that could not be taken.
 *
 * That distinction is the one this whole rebuild keeps insisting on, and the
 * acceptance harness already makes it (an unreachable server yields SKIP, not
 * FAIL). This suite now makes it too, and says WHICH precondition is missing
 * rather than skipping silently — a suite that quietly skips everywhere is
 * indistinguishable from one that passes everywhere.
 */
function missingPrecondition(): string | null {
  if (process.env.TODERO_LIVE_SPAWN === '1') return null // opt in explicitly
  if (process.env.CI) return 'CI: no local LLM endpoint and no .env.local'
  if (!process.env.LLM_BASE_URL) return 'LLM_BASE_URL is not set (no .env.local?)'
  if (!existsSync(join(TODERO_DIR, '.git'))) return `${TODERO_DIR} is not a git checkout`
  return null
}

const skipReason = missingPrecondition()
const liveDescribe = skipReason ? describe.skip : describe
if (skipReason) {
  // Printed once, so a green run cannot be mistaken for a run that proved
  // anything about live dispatch.
  console.warn(`spawn-live: SKIPPED — ${skipReason}. Set TODERO_LIVE_SPAWN=1 to force.`)
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

describe('paths resolve to this host, not a Mac home directory', () => {
  it('TODERO_DIR is this checkout and it exists', () => {
    expect(existsSync(TODERO_DIR)).toBe(true)
    expect(existsSync(join(TODERO_DIR, 'package.json'))).toBe(true)
    expect(TODERO_DIR).not.toMatch(/kemuniagent/)
  })

  it('WORKTREE_ROOT is writable temp space, never a hardcoded home', () => {
    expect(WORKTREE_ROOT).not.toMatch(/kemuniagent/)
  })
})

liveDescribe('prepareWorktree runs git without a shell', () => {
  it('creates a real worktree from this repo and tears it down', () => {
    const result = prepareWorktree({
      agentId: 'spawn-live-test',
      taskKey: 'TOD-LIVE',
      branch: `test/spawn-live-${Date.now()}`,
    })

    expect(result.error ?? '').not.toMatch(/ENOENT/)
    expect(result.ok).toBe(true)
    expect(result.worktreePath).toBeTruthy()
    expect(existsSync(join(result.worktreePath as string, 'package.json'))).toBe(true)

    const down = teardownWorktree(result.worktreePath as string)
    expect(down.ok).toBe(true)
  })
})

liveDescribe('openai-api spawn launches a detached child that writes its log', () => {
  it('names a log file that exists on disk and grows', async () => {
    const provider = resolveProvider()
    const logFile = join(LOG_DIR, `spawn-live-${Date.now()}.log`)

    const result = await openaiApiRuntime.spawn({
      agentId: 'spawn-live-test',
      workingDir: TODERO_DIR,
      prompt: 'Reply with the single word OK and nothing else.',
      logFile,
      bypassPermissions: true,
    })

    // eslint-disable-next-line no-console
    console.log('SPAWN RESULT', JSON.stringify({
      ok: result.ok,
      pid: result.pid,
      logFile: result.logFile,
      command: result.command,
      error: result.error,
      provider: provider.baseUrl,
    }))

    expect(result.error ?? '').not.toMatch(/ENOENT|bin\/bash|cmd\.exe/)
    expect(result.ok).toBe(true)
    expect(typeof result.pid).toBe('number')
    expect(result.logFile).toBe(logFile)
    expect(existsSync(logFile)).toBe(true)

    const sizeAtSpawn = statSync(logFile).size
    let grew = false
    for (let i = 0; i < 60 && !grew; i++) {
      await sleep(2_000)
      grew = statSync(logFile).size > sizeAtSpawn
    }

    // eslint-disable-next-line no-console
    console.log('LOG TAIL', readFileSync(logFile, 'utf8').slice(-800))
    expect(grew).toBe(true)

    try { rmSync(logFile, { force: true }) } catch { /* best effort */ }
  })
})

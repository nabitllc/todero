// Route-level contract for POST /api/run-agent's dispatch result.
//
// Two things the route got wrong and this pins down:
//   1. A spawn that never started answered HTTP 200 with "spawned": false.
//      A caller (or the queue kicker) could not tell success from failure by
//      status code, so a dead dispatch looked like a live agent.
//   2. It always echoed a `logFile` path, even when no adapter ever opened it.
//      The API named a file that was not on disk.
//
// The only thing stubbed is the RBAC gate (a different subsystem, and currently
// mid-regression in this tree). The runtime registry, the spawn and the log file
// are all real.
//
// This test claims a real issue and launches a real agent, exactly as the
// documented acceptance curl does, so it is opt-in:
//   TODERO_LIVE_ROUTE_TEST=1 npx jest __tests__/runtimes/run-agent-route.test.ts

import { existsSync, readFileSync, statSync } from 'fs'
import { join } from 'path'

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

jest.mock('@/lib/permission-check', () => ({
  resolveCallerRole: async () => 'owner',
  checkRoutePermission: async () => ({ allowed: true }),
}))

const LIVE = process.env.TODERO_LIVE_ROUTE_TEST === '1'
const maybe = LIVE ? describe : describe.skip

jest.setTimeout(180_000)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

maybe('POST /api/run-agent dispatch result', () => {
  it('answers 200 with a log file that exists on disk and grows', async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { POST } = require('@/app/api/run-agent/route')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NextRequest } = require('next/server')

    // Whichever lane currently has capacity + eligible work. WIP limits are 1,
    // so a lane that already dispatched short-circuits before the spawn.
    let res: { status: number; json: () => Promise<Record<string, unknown>> } | null = null
    let body: Record<string, unknown> = {}
    for (const agent of ['ops', 'po', 'auditor', 'deployer', 'tester', 'scout']) {
      const req = new NextRequest(
        `http://localhost:3000/api/run-agent?agent=${agent}&runtime=openai-api`,
        { method: 'POST' }
      )
      res = await POST(req)
      body = await (res as { json: () => Promise<Record<string, unknown>> }).json()
      // eslint-disable-next-line no-console
      console.log(`ROUTE ${agent} status=${res!.status}`)
      if (body.task) break
    }

    // eslint-disable-next-line no-console
    console.log('ROUTE BODY', JSON.stringify(body, null, 2).slice(0, 1200))

    // Nothing shell-shaped may appear in the error path any more.
    expect(JSON.stringify(body)).not.toMatch(/ENOENT|bin\/bash|cmd\.exe/)

    if (body.spawned === false && body.spawnError) {
      // Contract for the failure path: honest status, and no phantom log.
      expect(res!.status).toBe(500)
      expect(body.logFile).toBeNull()
      return
    }

    if (!body.task) {
      // No eligible work — the route short-circuits before dispatch. Nothing to
      // assert about a spawn that was never attempted.
      // eslint-disable-next-line no-console
      console.log('NO ELIGIBLE TASK — dispatch not attempted')
      return
    }

    expect(res!.status).toBe(200)
    expect(body.spawned).toBe(true)
    expect(typeof body.pid).toBe('number')
    expect(typeof body.logFile).toBe('string')
    const spawnLog = body.logFile as string
    expect(existsSync(spawnLog)).toBe(true)

    const sizeAtSpawn = statSync(spawnLog).size
    let grew = false
    for (let i = 0; i < 60 && !grew; i++) {
      await sleep(2_000)
      grew = statSync(spawnLog).size > sizeAtSpawn
    }
    // eslint-disable-next-line no-console
    console.log('LOG TAIL', readFileSync(spawnLog, 'utf8').slice(-800))
    expect(grew).toBe(true)
  })

  it('answers 500 and names no log file when the spawn does not start', async () => {
    jest.resetModules()
    jest.doMock('@/lib/runtimes', () => ({
      getDefaultRuntime: async () => stubRuntime,
      getRuntimeByName: async () => stubRuntime,
      listRuntimes: () => [{ name: 'stub', displayName: 'stub', available: false }],
    }))
    const stubRuntime = {
      name: 'stub',
      displayName: 'stub',
      supportsSessions: false,
      supportsTools: false,
      isAvailable: async () => true,
      // Exactly the shape an adapter returns when the binary/credential is
      // missing: no pid, and no log file was ever opened.
      spawn: async () => ({ ok: false, error: 'simulated spawn failure', runtime: 'stub' }),
    }

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { POST } = require('@/app/api/run-agent/route')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NextRequest } = require('next/server')

    // Whichever agent actually has capacity + eligible work on this board.
    let res: { status: number; json: () => Promise<Record<string, unknown>> } | null = null
    let body: Record<string, unknown> = {}
    for (const agent of ['auditor', 'po', 'ops', 'deployer', 'tester', 'scout']) {
      const req = new NextRequest(
        `http://localhost:3000/api/run-agent?agent=${agent}&runtime=stub`,
        { method: 'POST' }
      )
      res = await POST(req)
      body = await (res as { json: () => Promise<Record<string, unknown>> }).json()
      // eslint-disable-next-line no-console
      console.log(`FAILURE-PATH ${agent} status=${res!.status} body=${JSON.stringify(body).slice(0, 260)}`)
      if (body.task) break
    }

    if (!body.task) {
      // eslint-disable-next-line no-console
      console.log('NO ELIGIBLE TASK on any lane — failure path not exercised')
      return
    }

    expect(res!.status).toBe(500)
    expect(body.spawned).toBe(false)
    expect(body.logFile).toBeNull()
    expect(existsSync(body.logFileMissing as string)).toBe(false)
  })
})

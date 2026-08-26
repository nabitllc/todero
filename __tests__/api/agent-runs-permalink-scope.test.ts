/**
 * __tests__/api/agent-runs-permalink-scope.test.ts — runs-need-urls piece.
 *
 * `GET /api/agent-runs/<id>` is the read a run permalink resolves through. It
 * is also a NEW per-row read on a table no scope guard was watching, so the
 * boundary it enforces has to be pinned somewhere a CI run can reach.
 *
 * The live probes in docs/rebuild/pieces/pieces8/runs-need-urls.md are the
 * primary evidence — real requests against the running app, which is the only
 * thing that proves middleware and the route agree. These tests are the part
 * that survives WITHOUT a dev server: they call the handler directly with the
 * headers middleware would have stamped, so a future edit that quietly drops
 * the scoped branch fails here even in an environment where the live probes
 * report SKIP.
 *
 * Deliberately NOT tested here: whether middleware actually stamps those
 * headers for a `…/runs/r/<id>` path. Calling the handler directly bypasses
 * middleware entirely, so asserting it in this file would be asserting a stub.
 * That half is measured live, and is written down as such in the piece doc.
 */

import { NextRequest } from 'next/server'

type Call = [string, ...unknown[]]

const calls: Call[] = []
/** Rows the stubbed seam hands back, keyed by table. */
let tableRows: Record<string, unknown> = {}
let lastTable = ''

jest.mock('@/lib/db', () => {
  const actual = jest.requireActual('@/lib/db')
  const builder: Record<string, unknown> = {}
  const proxy: unknown = new Proxy(builder, {
    get(_t, prop: string) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => unknown) =>
          Promise.resolve({ data: tableRows[lastTable] ?? null, error: null, count: null }).then(resolve)
      }
      if (prop === 'maybeSingle' || prop === 'single') {
        return () => Promise.resolve({ data: tableRows[lastTable] ?? null, error: null, count: null })
      }
      return (...args: unknown[]) => {
        calls.push([prop, ...args])
        return proxy
      }
    },
  })
  return {
    ...actual,
    db: () => ({
      provider: 'test',
      missingEnv: () => [],
      from: (table: string) => {
        lastTable = table
        calls.push(['from', table])
        return proxy
      },
      rpc: () => Promise.resolve({ data: null, error: null, count: null }),
    }),
  }
})

// Imported after the mock so the route picks it up.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const route = require('@/app/api/agent-runs/[id]/route') as typeof import('@/app/api/agent-runs/[id]/route')

const RUN_ID = 'aaaa1111-2222-4333-8444-555555555501'

function get(id: string, headers: Record<string, string> = {}) {
  const req = new NextRequest(`http://localhost:3000/api/agent-runs/${id}`, { headers })
  return route.GET(req, { params: Promise.resolve({ id }) })
}

/** middleware.ts's headers for a deliberately cross-project screen. */
const CROSS = { 'x-mc-all-projects': '1' }
/** middleware.ts's headers for a project-scoped screen. */
const SCOPED = { 'x-mc-project': 'Limiglow' }

function seed(run: Record<string, unknown> | null, issueProject: string | null) {
  tableRows = {
    agent_runs: run,
    issues: issueProject === null ? null : { project: issueProject },
  }
}

function runRow(overrides: Record<string, unknown> = {}) {
  return {
    id: RUN_ID,
    agent_id: 'builder',
    task_id: '20153e41-39c7-4b33-9119-5f8a1ba2a956',
    task_title: 'a run',
    status: 'completed',
    started_at: '2026-08-26T10:00:00.000Z',
    completed_at: '2026-08-26T10:00:30.000Z',
    finished_at: null,
    tokens_used: 1234,
    cost_usd: 0.42,
    stopped_reason: null,
    stopped_at: null,
    error: null,
    ...overrides,
  }
}

beforeEach(() => {
  calls.length = 0
  tableRows = {}
  lastTable = ''
})

describe('GET /api/agent-runs/<id> — the run permalink read', () => {
  it('answers with the run, its OWN project, and what the request resolved as', async () => {
    seed(runRow(), 'Limiglow')
    const res = await get(RUN_ID, CROSS)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.run.id).toBe(RUN_ID)
    expect(body.project).toBe('Limiglow')
    expect(body.scope).toBeNull()
    expect(body.crossProject).toBe(true)
  })

  // agent_runs has no project column. The ONLY honest source is
  // task_id -> issues.project, and this asserts the route actually goes there
  // rather than inferring a project from the request's own scope.
  it('resolves the project through issues, not from the caller', async () => {
    seed(runRow(), 'Todero')
    const body = await (await get(RUN_ID, CROSS)).json()
    expect(body.project).toBe('Todero')
    expect(calls).toContainEqual(['from', 'agent_runs'])
    expect(calls).toContainEqual(['from', 'issues'])
  })

  it('reports a run with no task as belonging to no project, never to the caller’s', async () => {
    seed(runRow({ task_id: null }), null)
    const body = await (await get(RUN_ID, CROSS)).json()
    expect(body.project).toBeNull()
    // No task means no lookup at all — an issues query here would be the route
    // guessing.
    expect(calls.filter(c => c[0] === 'from' && c[1] === 'issues')).toHaveLength(0)
  })

  // WHY THIS ASSERTS THE QUERY AND NOT THE RESPONSE.
  //
  // This test used to read `Object.keys(body.run)` and was DECORATIVE — proved
  // so, not suspected. `runRow()` below never contains `output` or `log_file`
  // whatever the route selects, so the assertion was about the stub, not about
  // the code. Measured 2026-08-26: appending `,output,log_file` to RUN_COLUMNS
  // in app/api/agent-runs/[id]/route.ts left this file at 50 passed / 50 total
  // while the live endpoint answered HTTP 200 with
  // `"output":"SECRET-TRANSCRIPT-LIMIGLOW","log_file":"/var/secret/limiglow.log"`.
  //
  // The only thing that decides what leaves the database is the string handed
  // to `.select(...)`, so that string is what is read back here. This assertion
  // fails on that exact mutation.
  it('never even ASKS the database for the agent transcript or the server log path', async () => {
    seed(runRow(), 'Limiglow')
    await get(RUN_ID, CROSS)

    const runSelect = calls.find(c => c[0] === 'select')
    expect(runSelect).toBeDefined()
    const requested = String(runSelect![1]).split(',').map(c => c.trim())
    // Guards the guard: if the shape of the recorded call ever changes, an
    // empty list must not read as "nothing sensitive was requested".
    expect(requested.length).toBeGreaterThan(5)
    expect(requested).toContain('id')
    expect(requested).not.toContain('output')
    expect(requested).not.toContain('log_file')

    // Second line of defence only. It is the assertion above that has teeth.
    const body = await (await get(RUN_ID, CROSS)).json()
    expect(Object.keys(body.run)).not.toContain('output')
    expect(Object.keys(body.run)).not.toContain('log_file')
  })

  // The issues lookup exists to answer ONE question — which project owns this
  // run. Selecting more than `project` from a table this route has no other
  // business reading is the same widening in a different table.
  it('asks the issues table for the project column and nothing else', async () => {
    seed(runRow(), 'Limiglow')
    await get(RUN_ID, CROSS)
    const selects = calls.filter(c => c[0] === 'select').map(c => String(c[1]))
    expect(selects).toHaveLength(2)
    expect(selects[1]).toBe('project')
  })
})

describe('the scope boundary', () => {
  // THE side channel this branch exists to close: without it, a project-scoped
  // screen could read another project's run titles and errors one id at a time
  // through a route no scope guard was watching.
  it('404s a foreign run asked for from a project-scoped screen', async () => {
    seed(runRow(), 'Todero')
    const res = await get(RUN_ID, SCOPED)
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.code).toBe('run_not_in_scope')
    // The human sentence has to be in `error`, because lib/fetch-json.ts reads
    // `body.error ?? body.message` for what it puts on screen.
    expect(body.error).toContain('Limiglow')
    expect(body.error).toContain('Todero')
  })

  it('allows a run from the scoped project itself', async () => {
    seed(runRow(), 'Limiglow')
    expect((await get(RUN_ID, SCOPED)).status).toBe(200)
  })

  // Fails closed. "No project" must not satisfy "belongs to Limiglow" — that
  // is the exact widening lib/scope.ts's Rule 1 forbids.
  it('404s a run with no project at all from a project-scoped screen', async () => {
    seed(runRow({ task_id: null }), null)
    const res = await get(RUN_ID, SCOPED)
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('run_not_in_scope')
  })

  it('lets a deliberately cross-project screen read any run', async () => {
    seed(runRow(), 'Todero')
    expect((await get(RUN_ID, CROSS)).status).toBe(200)
  })

  // Rule 1: absence of a boundary is never "every project".
  it('400s when neither header is present', async () => {
    seed(runRow(), 'Limiglow')
    const res = await get(RUN_ID, {})
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('unscoped_run_read')
  })

  // A scoped screen cannot widen itself by ALSO claiming to be cross-project.
  // middleware strips both inbound headers, so this pair can only arrive from
  // a caller trying it on; the scoped branch must still win.
  it('does not let a cross-project claim override a resolved scope', async () => {
    seed(runRow(), 'Todero')
    const res = await get(RUN_ID, { ...SCOPED, ...CROSS })
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('run_not_in_scope')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// The project-less Runs screen.
//
// middleware's `isCrossProjectRequest` calls `projectFromPathname` first and
// returns false whenever that is null — which it is for any path with no
// `/p/<slug>`. So `/runs/r/<id>`, the un-prefixed form of the exact screen a
// run permalink is reached from, arrived with NEITHER header. Measured live
// 2026-08-26 with a valid session: 400 unscoped_run_read, and the refusal text
// told the operator to use "/p/<project>/runs".
//
// These tests call the handler DIRECTLY with no headers at all — i.e. exactly
// what middleware leaves behind in that case — so they pin the route's own
// derivation. Whether middleware really stamps nothing is a live measurement,
// recorded in the piece doc; a stub cannot prove it and this file does not
// pretend to.
describe('the project-less Runs referer', () => {
  const ORIGIN = 'http://localhost:3000'
  const ref = (p: string) => ({ referer: `${ORIGIN}${p}` })

  it('reads a run from /runs/r/<id> with no project prefix', async () => {
    seed(runRow(), 'Limiglow')
    const res = await get(RUN_ID, ref(`/runs/r/${RUN_ID}`))
    expect(res.status).toBe(200)
    expect((await res.json()).crossProject).toBe(true)
  })

  it('reads a FOREIGN run from /runs — the whole point of a cross-project screen', async () => {
    seed(runRow(), 'Todero')
    const res = await get(RUN_ID, ref('/runs/all'))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.project).toBe('Todero')
    expect(body.scope).toBeNull()
  })

  it('tolerates a /b/<biz> prefix ahead of runs, as every other path shape does', async () => {
    seed(runRow(), 'Limiglow')
    expect((await get(RUN_ID, ref('/b/todero/runs/all'))).status).toBe(200)
  })

  // The widening is exactly the size of the bug and no larger. Each of these
  // stays a 400.
  it('does not fire for a project-scoped screen with no /p/ — e.g. /work/list', async () => {
    seed(runRow(), 'Limiglow')
    const res = await get(RUN_ID, ref('/work/list'))
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('unscoped_run_read')
  })

  it('does not fire for /fleet, which is middleware’s business and not this route’s', async () => {
    seed(runRow(), 'Limiglow')
    expect((await get(RUN_ID, ref('/fleet/roster'))).status).toBe(400)
  })

  it('does not fire for a cross-ORIGIN referer that names /runs', async () => {
    seed(runRow(), 'Limiglow')
    const res = await get(RUN_ID, { referer: 'https://evil.example/runs/all' })
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('unscoped_run_read')
  })

  // A resolved project scope must never be widened by a Referer. middleware
  // cannot produce this pair, so it can only come from a caller trying it on.
  it('never widens a request middleware already scoped to a project', async () => {
    seed(runRow(), 'Todero')
    const res = await get(RUN_ID, { ...SCOPED, ...ref(`/runs/r/${RUN_ID}`) })
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('run_not_in_scope')
  })

  // What makes the `!scope` guard in the route killable rather than decorative.
  // With a project scope resolved, the scoped branch already decides access —
  // so the guard's ONLY observable effect is the `crossProject` field the route
  // echoes back "so the client can label the screen honestly". A request that
  // middleware scoped to a project must not report itself as cross-project,
  // even when its Referer names /runs, or the label is a lie on a 200.
  it('echoes crossProject=false for a scoped request whose referer names /runs', async () => {
    seed(runRow(), 'Limiglow')
    const res = await get(RUN_ID, { ...SCOPED, ...ref(`/runs/r/${RUN_ID}`) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.scope).toBe('Limiglow')
    expect(body.crossProject).toBe(false)
  })

  it('still refuses a request with no referer at all', async () => {
    seed(runRow(), 'Limiglow')
    expect((await get(RUN_ID, {})).status).toBe(400)
  })

  // The refusal a caller CAN still hit must not name a screen that is refused.
  // The old text said "a deliberately cross-project screen such as
  // /p/<project>/runs" while /runs itself was being 400'd.
  it('refuses with a sentence that does not point at a screen it rejects', async () => {
    seed(runRow(), 'Limiglow')
    const body = await (await get(RUN_ID, {})).json()
    expect(body.error).toContain('…/runs/r/<id>')
    expect(body.error).toContain('with or without a /p/<project> prefix')
  })
})

describe('ids that are not runs', () => {
  it('400s a malformed id before any query runs', async () => {
    seed(runRow(), 'Limiglow')
    const res = await get('nope', CROSS)
    expect(res.status).toBe(400)
    expect((await res.json()).code).toBe('invalid_run_id')
    expect(calls).toHaveLength(0)
  })

  // A well-formed id that names nothing must be distinguishable from one that
  // names a run in another project — otherwise "deleted" and "not yours" look
  // identical to the operator.
  it('404s a well-formed id with no row, under its own code', async () => {
    seed(null, null)
    const res = await get(RUN_ID, CROSS)
    expect(res.status).toBe(404)
    expect((await res.json()).code).toBe('run_not_found')
  })
})

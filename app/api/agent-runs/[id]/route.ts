// app/api/agent-runs/[id]/route.ts
//
// PATCH — internal writer. Updates cost/token stats (and optionally status) on
// an agent_runs row after a builder session completes. Called by
// scripts/builder-with-cost.sh with x-internal-secret.
//
// GET — runs-need-urls piece (Navigation & Deep Linking). ONE run, by id, for
// the permalink `…/runs/r/<id>` (see lib/run-permalink.ts). Measured
// 2026-08-26 before this piece: `GET /api/agent-runs/<uuid>` answered 405 with
// an empty body — there was no way to read a single run at all, so a run
// permalink could only ever show a run that happened to be inside
// components/nav/RunsView.tsx's `order=started_at.desc&limit=100` window. A
// permalink to the 101st run rendered as "not found" with no way to tell that
// from a deleted run.
//
// ── THE SCOPE BOUNDARY ON GET, AND WHY IT IS SHAPED THIS WAY ─────────────────
//
// `agent_runs` has NO project column (verified 2026-08-26 against the live
// schema: PRAGMA table_info(agent_runs) -> id, agent_id, task_id, task_title,
// status, started_at, completed_at, finished_at, tokens_used, cost_usd,
// output, error, created_at, pid, stall_count, last_progress_hash,
// last_progress_at, stopped_reason, stopped_at, log_file). A run's project is
// derivable ONLY through `task_id -> issues.project`, and a run with no task
// has no project at all. Nothing here invents one.
//
// This route does NOT use lib/scope.ts's `resolveProjectScope`, and that is a
// deliberate reading of that file rather than an omission. Its header scopes
// itself to "the surfaces that have no cross-project mode" and says a surface
// that cannot state a reason to widen "does not belong in this file". Runs can
// state one, and middleware.ts already wrote it down: `runs/*` is exempted
// from project scoping because agent runs "span every project an agent has
// ever touched; scoping them would hide the cross-project picture they exist
// to show." Feeding runs through `resolveProjectScope` would 400 every read
// from the Runs screen — correctly, per that function's Rule 1, and uselessly.
//
// What this route enforces instead, from the two headers middleware computes
// and which a caller cannot forge (middleware DELETES any inbound copy of both
// before recomputing them):
//
//   x-mc-all-projects: 1   the request came from a deliberately cross-project
//                          screen (`runs/*`, `fleet/*`, `settings/projects`).
//                          Any run is readable. This is the ONLY header a run
//                          permalink itself produces.
//   x-mc-project: <name>   the request came from a project-scoped screen. The
//                          run must PROVE it belongs to that project: its
//                          task_id must resolve to an issue in <name>. A run
//                          with no task, or with a task in another project, is
//                          404 — absence is never "this project".
//   neither                400. A request that cannot say which boundary it is
//                          asking from is refused, exactly as lib/scope.ts's
//                          Rule 1 requires.
//
// ── CORRECTION, 2026-08-26: THE SENTENCE THAT USED TO BE HERE WAS FALSE ──────
//
// This comment used to read: "The scoped branch is not what the UI walks — a
// run permalink is always under `runs/*`, so it always arrives cross-project."
// That is not true, and it was measured false against the running server with
// a valid session cookie:
//
//   referer /p/limiglow/runs/r/<id>   -> 200  crossProject=true
//   referer /runs/r/<id>              -> 400  unscoped_run_read
//   referer /runs/all                 -> 400  unscoped_run_read
//   referer /b/todero/runs/all        -> 400  unscoped_run_read
//
// A run permalink under `runs/*` arrives cross-project only when a `/p/<slug>`
// ALSO happens to be in the address, because middleware's
// `isCrossProjectRequest` calls `projectFromPathname` first and that returns
// null without one. The project-less form of the very screen this endpoint
// serves was being refused by it, with a sentence telling the operator to use
// "/p/<project>/runs" — the prefixed form of the screen it was refusing.
// `isProjectlessRunsReferer` below is the compensating derivation, and the
// middleware one-liner that would make it unnecessary is written down as a seam
// request in docs/rebuild/pieces/pieces8/runs-need-urls.md §10.3.
//
// So the scoped branch is BOTH a path the UI can walk and a side-channel guard.
// Without it, any project-scoped
// screen (Work, Now, Memory), or any script holding a session cookie and a
// scoped Referer, could read another project's run titles and errors one id at
// a time through a route no scope guard was watching. That is the same class
// of hole scripts/no-unscoped-issues.mjs's header describes finding twice.

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/hub-client'
import { dbUnavailableResponse, dbQueryErrorResponse } from '@/lib/db-http'
import { RUN_ID_PATTERN, isProjectlessRunsReferer, normalizeRunId } from '@/lib/run-permalink'

const INTERNAL_SECRET = process.env.INTERNAL_SECRET ?? 'kaos-internal-2026'

/** middleware.ts's resolved project scope. Never client-supplied. */
const SCOPE_HEADER = 'x-mc-project'
/** middleware.ts's "this screen is deliberately cross-project" flag. */
const CROSS_PROJECT_HEADER = 'x-mc-all-projects'

/**
 * Columns GET returns. `output` and `log_file` are deliberately NOT here:
 * `output` is a full agent transcript and `log_file` is a server filesystem
 * path, and neither is anything components/nav/RunsView.tsx renders. A read
 * endpoint added for a permalink should not quietly become a wider read than
 * the list it drills out of.
 *
 * This constant is the ONLY thing that decides it, so it is what the test
 * asserts: __tests__/api/agent-runs-permalink-scope.test.ts reads back the
 * recorded `select(...)` ARGUMENT. It used to assert the RESPONSE KEYS
 * instead, which was decorative — the stubbed row never carried `output` or
 * `log_file` whatever the route selected, so appending them here left that
 * suite at 50 passed / 50 total while the live endpoint returned the agent
 * transcript and the server log path at HTTP 200. Reproduced today, then
 * reverted; the assertion that kills it is now in place.
 */
const RUN_COLUMNS =
  'id,agent_id,task_id,task_title,status,started_at,completed_at,finished_at,' +
  'tokens_used,cost_usd,stopped_reason,stopped_at,error'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const { id } = await params
  const runId = normalizeRunId(id ?? '')
  if (!runId) {
    return NextResponse.json(
      {
        // `error` carries the SENTENCE and `code` the machine string, not the
        // other way round: lib/fetch-json.ts's readApiError reads
        // `body.error ?? body.message` for what it shows a human, so putting
        // the code in `error` would render "run_not_in_scope" on screen and
        // throw the explanation away.
        error:
          `"${id}" is not an agent_runs id (expected ${RUN_ID_PATTERN.source}). ` +
          'A truncated or mistyped run permalink lands here — the id in the URL is wrong, ' +
          'not the run.',
        code: 'invalid_run_id',
      },
      { status: 400 },
    )
  }

  const scope = req.headers.get(SCOPE_HEADER)?.trim() || null
  const headerCrossProject = req.headers.get(CROSS_PROJECT_HEADER) === '1'
  // Compensating derivation for middleware's project-less blind spot — see the
  // CORRECTION block at the top of this file, and isProjectlessRunsReferer's own
  // docblock, which records both the measurement that it is needed and the
  // measurement that it grants nothing an invented /p/<slug> did not already.
  //
  // `!scope` is load-bearing, not defensive tidiness: a request middleware
  // resolved a PROJECT for must never widen itself to cross-project here, no
  // matter what its Referer says. The scoped branch further down still decides
  // that case, unchanged.
  const refererCrossProject =
    !scope && isProjectlessRunsReferer(req.headers.get('referer'), req.nextUrl.origin)
  const crossProject = headerCrossProject || refererCrossProject
  if (!scope && !crossProject) {
    return NextResponse.json(
      {
        error:
          'This run read has no resolvable scope — nothing in the request says which project ' +
          'boundary it is asking from. A run permalink resolves from the Runs screen ' +
          '(…/runs/r/<id>, with or without a /p/<project> prefix), or from a /p/<project> ' +
          'screen if the run belongs to that project. Absence of a scope is never treated as ' +
          '"every project".',
        code: 'unscoped_run_read',
      },
      { status: 400 },
    )
  }

  const db = createAdminClient()
  const { data: run, error: runError } = await db
    .from('agent_runs')
    .select(RUN_COLUMNS)
    .eq('id', runId)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped row from the db seam
    .maybeSingle<any>()

  if (runError) return dbQueryErrorResponse(runError, 'agent_runs')
  if (!run) {
    return NextResponse.json(
      {
        error: `No agent_runs row with id ${runId}. The run was never recorded, or it has been deleted.`,
        code: 'run_not_found',
      },
      { status: 404 },
    )
  }

  // The run's project, resolved the only way the schema allows. `null` is a
  // real answer meaning "this run was not attached to a task", never a stand-in
  // for the scoped project.
  let project: string | null = null
  if (run.task_id) {
    const { data: issue, error: issueError } = await db
      .from('issues')
      .select('project')
      .eq('id', run.task_id)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- untyped row from the db seam
      .maybeSingle<any>()
    if (issueError) return dbQueryErrorResponse(issueError, 'issues')
    project = typeof issue?.project === 'string' ? issue.project : null
  }

  // Fails closed: under a resolved project scope, a run is readable only if it
  // can prove it belongs. `project === null` (no task) does NOT satisfy that.
  if (scope && project !== scope) {
    return NextResponse.json(
      {
        error:
          `This screen is scoped to "${scope}" and run ${runId} ` +
          (project ? `belongs to "${project}".` : 'is not attached to any task, so it belongs to no project.') +
          ' Agent runs span every project an agent touches — open it from the Runs screen, ' +
          'which is deliberately cross-project, rather than from a project-scoped screen.',
        code: 'run_not_in_scope',
      },
      { status: 404 },
    )
  }

  return NextResponse.json({
    run,
    /** The run's own project, or null when it has no task. Never inferred. */
    project,
    /** What this request resolved as, echoed so the client can label the screen honestly. */
    scope: scope ?? null,
    crossProject,
  })
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const auth = req.headers.get('x-internal-secret')
  if (auth !== INTERNAL_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  // Same pattern this file has always enforced, now named once in
  // lib/run-permalink.ts so the id a permalink is willing to BUILD and the id
  // this route is willing to ACCEPT cannot drift apart. Byte-identical
  // behaviour: RUN_ID_PATTERN is `/^[0-9a-f-]{36}$/`, unchanged.
  if (!id || !RUN_ID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'Invalid run id' }, { status: 400 })
  }

  let body: {
    tokens_used?: number
    cost_usd?: number
    status?: string
    output?: string
    error?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const update: Record<string, unknown> = {}

  if (typeof body.tokens_used === 'number') update.tokens_used = body.tokens_used
  if (typeof body.cost_usd === 'number') update.cost_usd = body.cost_usd
  if (typeof body.status === 'string') update.status = body.status
  if (typeof body.output === 'string') update.output = body.output
  if (typeof body.error === 'string') update.error = body.error

  // Auto-stamp finished_at when the session reaches a terminal status
  if (body.status === 'done' || body.status === 'error') {
    update.finished_at = new Date().toISOString()
  }

  if (Object.keys(update).length === 0) {
    return NextResponse.json({ error: 'No recognised fields to update' }, { status: 400 })
  }

  const db = createAdminClient()
  const { data, error } = await db
    .from('agent_runs')
    .update(update)
    .eq('id', id)
    .select('id, status, tokens_used, cost_usd, finished_at')
    .single()

  if (error) {
    return dbQueryErrorResponse(error, 'agent_runs')
  }

  return NextResponse.json(data)
}

// /api/heartbeat/sweep — the supervisor-side trigger for the in-flight ceilings.
//
// PATCH /api/heartbeat is the agent's OWN beat, and until this route existed it
// was the only thing in the repo that called checkInFlightCeilings. That made
// the two ceilings which actually stop a run — wall clock and no-progress —
// conditional on the agent choosing to make a request. An agent that stopped
// beating was never stopped and its pid was never signalled, which is the exact
// behaviour of the detached self-respawning watcher lib/dispatch-guard.ts's own
// comment names as the threat lib/agent-budget.ts was built to bound.
//
// This route runs the SAME evaluation on the SAME rows for every
// `status='running'` agent_runs row inside the staleness window, whether or not
// a beat arrived. It is a POST because it writes: it can stop runs, block
// issues for triage, and send SIGTERM.
//
// AUTH: middleware.ts already requires either a session cookie or the internal
// shared secret (lib/internal-auth.ts, header x-todero-internal) on every
// /api/ path, and this route adds nothing on top of that. It is a supervisor
// action, so the intended caller is server-side: /api/cron/watchdog (see the
// seam note below) or an operator's own curl.
//
// SEAM — NOT YET WIRED. /api/cron/watchdog already runs on a timer and is the
// natural driver, but that route belongs to another lane this session. The
// exact one-line wiring is asserted by lib/__tests__/agent-budget-sweep-seam.test.ts,
// which FAILS until it lands and prints the diff to apply. Until then this
// route is reachable but nothing schedules it, and the piece doc says so.
//
// It is deliberately safe to call on a short interval: a run it stops is no
// longer status='running', so the next call does not see it, and the batch is
// bounded by SWEEP_BATCH_LIMIT.

import { NextRequest, NextResponse } from 'next/server'
import { dbUnavailableResponse } from '@/lib/db-http'
import { sweepInFlightCeilings, SWEEP_BATCH_LIMIT, ceilingConfigProblems } from '@/lib/agent-budget'

export async function POST(req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // An empty 200 here would read as "swept, nothing to stop", which is the one
  // answer a safety sweep must never give when it did not actually look.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const rawLimit = req.nextUrl.searchParams.get('limit')
  let limit = SWEEP_BATCH_LIMIT
  if (rawLimit !== null) {
    const parsed = Number(rawLimit)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return NextResponse.json(
        { error: `limit must be a positive number; got ${JSON.stringify(rawLimit)}`, field: 'limit' },
        { status: 422 },
      )
    }
    limit = Math.min(parsed, SWEEP_BATCH_LIMIT)
  }

  const result = await sweepInFlightCeilings({ limit })

  // `ok:false` when the sweep hit read errors: the caller must be able to tell
  // "looked at everything, stopped nothing" from "could not look".
  return NextResponse.json({
    ok: result.errors.length === 0,
    ts: new Date().toISOString(),
    limit,
    scanned: result.scanned,
    skipped: result.skipped,
    stopped: result.stopped,
    errors: result.errors,
    // Non-empty means an operator's env var was refused and a ceiling is
    // running on its built-in default instead of the number they set.
    configProblems: ceilingConfigProblems(),
  })
}

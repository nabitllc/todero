/**
 * SEAM TEST — this is EXPECTED TO FAIL until one line lands in a file this
 * lane does not own. Its failure message is the change request; there is no
 * prose version of it anywhere that can go quietly stale.
 *
 * What is missing: `sweepInFlightCeilings()` exists, is proven (see
 * lib/__tests__/agent-budget-ceilings.test.ts and
 * __tests__/api/heartbeat-ceilings-wired.test.ts), and is reachable over HTTP
 * at POST /api/heartbeat/sweep — but NOTHING SCHEDULES IT. A supervisor
 * trigger that has to be invoked by hand is not a supervisor trigger; it is a
 * button. The ceilings that stop a silent agent only actually stop one if
 * something runs on a timer.
 *
 * /api/cron/watchdog is that timer. It already runs every 30 minutes, already
 * queries stale claims, already resets dead-heartbeat rows, and already
 * carries the appUrl it would need — it is the one place in the repo whose job
 * is exactly this. app/api/cron/watchdog/route.ts belongs to another lane this
 * session, so this lane states the change as a gate instead of reaching into
 * it.
 *
 * NOTE FOR WHOEVER LANDS IT: a direct import is deliberate over an HTTP call
 * to /api/heartbeat/sweep. Same process, no auth handshake, no appUrl to get
 * wrong, and the errors come back as values instead of a status code. The
 * route stays for operators and for any out-of-process scheduler.
 */

import { readFileSync } from 'fs'
import { join } from 'path'

const WATCHDOG = join(__dirname, '..', '..', 'app', 'api', 'cron', 'watchdog', 'route.ts')

const DIFF = `
──────────────────────────────────────────────────────────────────────────────
SEAM REQUEST — app/api/cron/watchdog/route.ts   (owner: cron/watchdog lane)

Apply this diff. Two hunks, both additive, no existing behaviour changed.

  @@ imports @@
   import { createAdminClient } from '@/lib/hub-client'
   import { dbUnavailableResponse } from '@/lib/db-http'
+  import { sweepInFlightCeilings } from '@/lib/agent-budget'

  @@ inside GET(), anywhere after the isAuthorized() check @@
+  // The supervisor-side trigger for the in-flight run ceilings. Until this
+  // call existed, lib/agent-budget.ts's wall-clock and no-progress ceilings
+  // ran ONLY inside PATCH /api/heartbeat — a request the agent chooses to
+  // make — so an agent that stopped beating was never stopped and its pid
+  // was never signalled. That is the exact detached self-respawning watcher
+  // lib/dispatch-guard.ts's own comment names as the threat.
+  //
+  // Bounded (SWEEP_BATCH_LIMIT), idempotent (a stopped run is no longer
+  // status='running'), and it never throws: read failures come back in
+  // .errors so a sweep that could not look is distinguishable from a sweep
+  // that found nothing.
+  const ceilingSweep = await sweepInFlightCeilings()

  @@ the response body at the end of GET() @@
   return NextResponse.json({
     ok: failed.length === 0,
     ts: new Date().toISOString(),
     cleared: cleared.map(c => c.key),
     clearedDetail: cleared,
     failed,
     kicked,
     unblocked: unblockedKeys,
+    ceilingSweep,
   })

WHY THIS TEST EXISTS AT ALL: the one acceptance check covering this ground
(scripts/acceptance/checks-anywhere.mjs, id 'ceilings-exist', critical: true)
greps lib/ and app/api/ for the strings maxConcurrent|maxRunMs|noProgress and
prints "all three ceilings present". It printed that while every ceiling in
the module was mutated inert. This file asserts a CALL, not a spelling.
──────────────────────────────────────────────────────────────────────────────
`

describe('SEAM: the ceiling sweep needs a scheduled caller', () => {
  it('/api/cron/watchdog calls sweepInFlightCeilings()', () => {
    const source = readFileSync(WATCHDOG, 'utf8')
    const imported = /from\s+['"]@\/lib\/agent-budget['"]/.test(source)
    const called = /sweepInFlightCeilings\s*\(/.test(source)

    if (!imported || !called) {
      throw new Error(
        `app/api/cron/watchdog/route.ts does not run the ceiling sweep ` +
          `(imports lib/agent-budget: ${imported}; calls sweepInFlightCeilings(): ${called}).\n` +
          `The sweep is implemented and tested; it just has no scheduled caller, so the ` +
          `wall-clock and no-progress ceilings still only fire when the agent itself makes ` +
          `a request — which the failure mode they exist to catch does not do.\n` +
          DIFF,
      )
    }

    expect(imported && called).toBe(true)
  })
})

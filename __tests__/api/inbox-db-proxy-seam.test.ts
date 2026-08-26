/**
 * __tests__/api/inbox-db-proxy-seam.test.ts — SEAM-1, expressed as a gate.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THIS SUITE IS EXPECTED TO FAIL UNTIL THE SEAM DIFF BELOW LANDS.
 * It is red on purpose. Its failure message prints the exact diff that turns
 * it green. Do not delete it, skip it, or "fix" it by changing the assertion.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE DEFECT. The approval decision has TWO writers to `inbox.status` and
 * `inbox.resolved_by`, and only one of them is gated.
 *
 *   1. PATCH /api/inbox  — gated. Derives the role from the CREDENTIAL
 *      (app/api/inbox/actor.ts -> lib/approvals.ts resolveDecisionRole),
 *      refuses a forged `mc-role`, and files every attempt — permitted or
 *      refused — in `approval_decisions`.
 *
 *   2. PATCH /api/db/inbox — NOT gated. `inbox` is in WRITABLE_TABLES of
 *      app/api/db/[...path]/route.ts, whose only write gate is
 *
 *          function isViewer(req: NextRequest): boolean {
 *            return req.cookies.get('mc-role')?.value === 'viewer'
 *          }
 *
 *      — the exact client-typed cookie the gate in (1) exists to stop
 *      trusting, read with the polarity inverted: anything that is not the
 *      literal string "viewer" is treated as a writer.
 *
 * MEASURED over real HTTP on the running dev server, 2026-08-26, one
 * credential, one row, same shell, seconds apart:
 *
 *   Cookie: mc-auth=view2026; mc-role=owner        (view2026 is READ-ONLY)
 *
 *   PATCH /api/inbox {"id":"7b3b1c93-…","status":"approved","resolved_by":"lane5-spoof"}
 *     -> HTTP 403 {"code":"PERMISSION_DENIED","role":"viewer",
 *                  "ignored_role_claim":"owner"}
 *
 *   PATCH /api/db/inbox?id=eq.7b3b1c93-…
 *         {"status":"approved","resolved_by":"definitely-not-a-human-bot"}
 *     -> HTTP 200
 *        row: status="approved",
 *             resolved_by="definitely-not-a-human-bot",
 *             resolved_at=null
 *        GET /api/inbox/decisions?project=Limiglow afterwards: 0 rows.
 *
 *   DELETE /api/db/inbox?id=eq.1a8a040b-…   (a second pending row)
 *     -> HTTP 200, the pending approval request destroyed outright.
 *
 * So "the role IS provable" and "every attempt, permitted or refused, is on
 * the record" are both false of the COLUMN as shipped. They are true only of
 * what PATCH /api/inbox writes.
 *
 * WHY IT IS NOT FIXED IN THIS LANE. `app/api/db/[...path]/route.ts` is not in
 * the approval-surface lane's ownership. Wave 8 wrote its remaining exposure
 * up as a paragraph; that paragraph went stale and pointed at the wrong file
 * for a whole wave while the door stayed open. A test cannot go stale
 * quietly, which is why this is a test.
 *
 * WHAT THIS ASSERTS, and deliberately no more: a READ-ONLY credential must
 * not be able to write or delete `inbox` through the proxy — whatever
 * mechanism closes it. It does NOT pin `inbox` out of WRITABLE_TABLES, and it
 * does not pin the status code beyond "not a success", so the orchestrator
 * may close it either way (see the two options in the diff below).
 */

import { NextRequest } from 'next/server'

// ── db mock: the shape __tests__/api/db-proxy-route.test.ts uses ────────────
// Any query that reaches the seam is recorded. If the gate holds, NOTHING is
// recorded — "what did not get written" is half of what is asserted here.
const calls: Array<[string, ...unknown[]]> = []
const result = { data: [], error: null, count: null }

jest.mock('@/lib/db', () => {
  const actual = jest.requireActual('@/lib/db')
  const builder: Record<string, unknown> = {}
  const proxy: unknown = new Proxy(builder, {
    get(_t, prop: string) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve)
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
        calls.push(['from', table])
        return proxy
      },
      rpc: () => Promise.resolve(result),
    }),
  }
})

// eslint-disable-next-line @typescript-eslint/no-var-requires
const route = require('@/app/api/db/[...path]/route') as typeof import('@/app/api/db/[...path]/route')

const VIEWER_PASSWORD = process.env.MC_VIEWER_PASSWORD ?? 'view2026'

const OWNER_PASSWORD = process.env.MC_PASSWORD ?? 'kaos2026'

/**
 * A LEGITIMATE owner session. Added at TOD-2479 for the control below.
 *
 * The control used to send `forgedViewer` and expect 200, which asserted that a
 * read-only credential claiming `mc-role=owner` could still write
 * `notifications` — the same escalation this suite exists to close, one table
 * over, written down as expected behaviour. The orchestrator fixed the GATE as
 * well as the table list, so that assertion now fails, correctly.
 *
 * The control's PURPOSE is preserved exactly: if a fix refuses everything, this
 * still goes red and says so. Only the credential changed, from a forged one to
 * a real one.
 */
function owner(url: string, init: RequestInit = {}): NextRequest {
  const req = new NextRequest(`http://localhost:3000${url}`, init as never)
  req.cookies.set('mc-auth', OWNER_PASSWORD)
  req.cookies.set('mc-role', 'owner')
  return req
}

/** A read-only session whose `mc-role` cookie claims to be the owner. */
function forgedViewer(url: string, init: RequestInit = {}): NextRequest {
  const req = new NextRequest(`http://localhost:3000${url}`, init as never)
  req.cookies.set('mc-auth', VIEWER_PASSWORD)
  req.cookies.set('mc-role', 'owner') // the forgery, and the whole point
  return req
}

const SEAM_DIFF = `
────────────────────────────────────────────────────────────────────────────
SEAM-1 — a read-only credential can still write and delete approval requests.

FILE: app/api/db/[...path]/route.ts   (not owned by the approval-surface lane)

OPTION A — smallest possible diff, and the one this lane recommends.
Nothing in the app writes \`inbox\` through this proxy. Verified by grep over
app/, components/, hooks/, lib/ and scripts/: the ONLY occurrence of
"/api/db/inbox" anywhere outside tests and doc comments is a comment in
lib/runtimes/token-ledger.ts:28. Both UI callers that decide an approval
(components/tabs/InboxTab.tsx:196 and components/InboxDrawer.tsx:275) PATCH
/api/inbox, which is the gated route. Removing it costs nothing:

  -const WRITABLE_TABLES = new Set(['issues', 'notifications', 'inbox'])
  +// \`inbox\` is deliberately NOT writable here. Deciding an approval goes
  +// through PATCH /api/inbox, which resolves the role from the CREDENTIAL and
  +// files the attempt in \`approval_decisions\`. This route's only write gate
  +// is the client-typed \`mc-role\` cookie, so leaving \`inbox\` writable made
  +// that gate bypassable from a read-only session. See
  +// docs/rebuild/pieces/pieces9/approval-surface.md SEAM-1.
  +const WRITABLE_TABLES = new Set(['issues', 'notifications'])

OPTION B — if some future caller genuinely needs to write \`inbox\` here, fix
the gate itself instead, so it stops trusting the cookie:

  -function isViewer(req: NextRequest): boolean {
  -  return req.cookies.get('mc-role')?.value === 'viewer'
  -}
  +import { resolveDecisionRole } from '@/lib/approvals'
  +import { sessionCredentials } from '@/app/api/inbox/actor'
  +import { hasPermission } from '@/lib/rbac-types'
  +
  +/** May this request write? Derived from the CREDENTIAL; \`mc-role\` may only
  + *  narrow it. \`mc-role\` alone was trusted here, so \`mc-auth=<viewer>\` plus
  + *  \`mc-role=owner\` wrote freely — measured 2026-08-26. */
  +function mayWrite(req: NextRequest): boolean {
  +  const { role } = resolveDecisionRole({
  +    sessionPassword: req.cookies.get('mc-auth')?.value ?? null,
  +    claimedRole: req.cookies.get('mc-role')?.value ?? null,
  +    agentRoleHeader: req.headers.get('x-agent-role'),
  +  }, sessionCredentials())
  +  return !!role && hasPermission(role, 'issues:write')
  +}
  +
  +function isViewer(req: NextRequest): boolean {
  +  return !mayWrite(req)
  +}

Either one turns this suite green. Option A also removes the DELETE hole,
which Option B closes only for roles without issues:write.
────────────────────────────────────────────────────────────────────────────
`

function fail(what: string, detail: string): never {
  throw new Error(`${what}\n${detail}\n${SEAM_DIFF}`)
}

beforeEach(() => { calls.length = 0 })

describe('SEAM-1: /api/db/inbox is a second, ungated writer to the approval decision', () => {
  it('a read-only credential claiming mc-role=owner cannot PATCH an inbox row', async () => {
    const res = await route.PATCH(
      forgedViewer('/api/db/inbox?id=eq.7b3b1c93-54e3-4196-ba46-5a1c4a6fa2bb', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'approved', resolved_by: 'definitely-not-a-human-bot' }),
      }),
      { params: { path: ['inbox'] } },
    )
    if (res.status < 400) {
      fail(
        `EXPECTED a refusal, GOT HTTP ${res.status}.`,
        `A session holding only the READ-ONLY password approved an agent's request by ` +
        `naming itself "owner" in a cookie. Queries that reached the database: ` +
        `${JSON.stringify(calls)}`,
      )
    }
    // And nothing reached the database.
    if (calls.some(c => c[0] === 'update')) {
      fail('The write was refused but STILL executed.', JSON.stringify(calls))
    }
  })

  it('…nor DELETE one', async () => {
    const res = await route.DELETE(
      forgedViewer('/api/db/inbox?id=eq.1a8a040b-0000-0000-0000-000000000000', { method: 'DELETE' }),
      { params: { path: ['inbox'] } },
    )
    if (res.status < 400) {
      fail(
        `EXPECTED a refusal, GOT HTTP ${res.status}.`,
        `A read-only session destroyed a pending approval request outright. ` +
        `A request nobody can see is a request nobody can approve or refuse, and ` +
        `nothing is written to approval_decisions either way. ` +
        `Queries that reached the database: ${JSON.stringify(calls)}`,
      )
    }
    if (calls.some(c => c[0] === 'delete')) {
      fail('The delete was refused but STILL executed.', JSON.stringify(calls))
    }
  })

  // ── The discriminators ───────────────────────────────────────────────────
  // Without these, "refuse every request to this route" would turn the two
  // cases above green while breaking the surfaces that legitimately use it.

  it('READS through the proxy are unaffected — this is about writes', async () => {
    const res = await route.GET(
      forgedViewer('/api/db/inbox?select=id&status=eq.pending'),
      { params: { path: ['inbox'] } },
    )
    expect(res.status).toBe(200)
    expect(calls).toContainEqual(['from', 'inbox'])
  })

  it('an unauthenticated request is still a 401, not a 403 — the outer gate still runs first', async () => {
    const req = new NextRequest('http://localhost:3000/api/db/inbox?id=eq.x', { method: 'PATCH' })
    const res = await route.PATCH(req, { params: { path: ['inbox'] } })
    expect(res.status).toBe(401)
  })

  it('a table this seam does not touch is still writable by a real owner session', async () => {
    // `notifications` is the control: if a fix refuses everything, this fails
    // and says so, instead of the suite going green for the wrong reason.
    const res = await route.PATCH(
      owner('/api/db/notifications?id=eq.n1', {
        method: 'PATCH',
        body: JSON.stringify({ read: true }),
      }),
      { params: { path: ['notifications'] } },
    )
    expect(res.status).toBe(200)
  })
  it('and a FORGED viewer cannot write notifications either — TOD-2479', async () => {
    // The escalation is closed for every table, not just the one this seam
    // named. Before the gate was fixed this returned 200.
    const res = await route.PATCH(
      forgedViewer('/api/db/notifications?id=eq.n1', {
        method: 'PATCH',
        body: JSON.stringify({ read: true }),
      }),
      { params: { path: ['notifications'] } },
    )
    expect(res.status).toBe(403)
  })
})

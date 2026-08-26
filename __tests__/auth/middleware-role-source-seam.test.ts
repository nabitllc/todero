/**
 * __tests__/auth/middleware-role-source-seam.test.ts — identity-sessions.
 *
 * ── THIS SUITE IS RED ON PURPOSE AND STAYS RED UNTIL middleware.ts CHANGES ───
 *
 * READ THIS BEFORE TREATING THE FAILURE AS A DEFECT. It is not a broken test.
 * It is this lane's incompleteness, moved out of a prose paragraph and into
 * the gate.
 *
 * Round 2 of this piece fixed the role source in `lib/with-permission.ts` and
 * `lib/session-actor.ts` and then disclosed, in §10.4 and in three source
 * comments, that `middleware.ts` — the PRIMARY gate, which this lane does not
 * own — still reads the client-typed `mc-role` cookie and still decides writes
 * from it. Every gate stayed green while the channel's headline defect stayed
 * open. That is the failure mode this file exists to prevent: a disclosure
 * nothing enforces is a disclosure that ships.
 *
 * ── WHAT IS ACTUALLY BROKEN, MEASURED OVER REAL HTTP 2026-08-26 ─────────────
 *
 * All four requests below carry the READ-ONLY viewer password and nothing else.
 * The only thing that changes between them is the `mc-role` cookie, which the
 * attacker types.
 *
 *   DELETE /api/issues?id=TOD-NONEXISTENT-LANE9-PROBE
 *     Cookie: mc-auth=view2026; mc-role=viewer     -> 403  {"error":"Read-only access..."}
 *     Cookie: mc-auth=view2026; mc-role=owner      -> 200  {"ok":true}     FORGED
 *     Cookie: mc-auth=view2026                     -> 200  {"ok":true}     OMITTED
 *     Cookie: mc-auth=view2026; mc-role=notarole   -> 200  {"ok":true}     GARBAGE
 *
 * The forged variant is the one §10.4 describes. THE OTHER TWO ARE WORSE and
 * appear in no document this lane inherited: the viewer role is enforced only
 * when the attacker VOLUNTEERS the cookie that identifies them as a viewer.
 * `getRoleFromCookie()` answers null for both an absent and an unrecognised
 * value, and null falls through the `role === 'viewer'` check into the branch
 * commented "No cookie = server-side call (e.g. agent -> API) — pass through".
 * Absence of a claim is being read as proof of privilege. That is a fail-open,
 * and it is reached only AFTER `hasValidSession()` has already admitted a
 * human viewer, so the "server-side call" the comment describes is not who is
 * standing there.
 *
 * ── WHY THIS LANE CANNOT FIX IT ITSELF ──────────────────────────────────────
 *
 * `middleware.ts` is orchestrator-owned and outside this lane's file list.
 * There is no substitute inside the lane: `lib/with-permission.ts` is now
 * correct and is a per-route wrapper, and `app/api/issues/route.ts` — the route
 * the escalation lands on — does not call it. Checked, not assumed:
 *   grep -c "withPermission" app/api/issues/route.ts  ->  0
 * So middleware IS the whole gate on that path and the seam is the fix.
 *
 * ── HOW TO MAKE IT GREEN ────────────────────────────────────────────────────
 *
 * Apply the diff printed in the failure message below, and reproduced in
 * docs/rebuild/pieces/pieces9/identity-sessions.md §S1. Three edits to
 * middleware.ts. Nothing else in this piece needs to change: the decision
 * function it calls, `resolveDecisionRole()` in lib/approvals.ts, is already
 * landed, already used by two other modules, and already mutation-tested.
 */

import { NextRequest } from 'next/server'
import { middleware } from '@/middleware'

const VIEWER = process.env.MC_VIEWER_PASSWORD ?? 'view2026'
const OWNER = process.env.MC_PASSWORD ?? 'kaos2026'

/** A write request that is never allowed to touch a real row. */
const PROBE_URL = 'http://localhost:3000/api/issues?id=TOD-NONEXISTENT-SEAM-PROBE'

function writeAs(cookie: string, url = PROBE_URL, method = 'DELETE'): NextRequest {
  return new NextRequest(url, { method, headers: { cookie } })
}

/** True when middleware waved the request through to the route handler. */
function passedThrough(res: Response): boolean {
  return res.headers.get('x-middleware-next') === '1'
}

const DIFF = `
middleware.ts is missing the identity-sessions role-source seam.
Three edits. Full context in docs/rebuild/pieces/pieces9/identity-sessions.md §S1.

--- a/middleware.ts
+++ b/middleware.ts
@@ 1. import the decision function the rest of the app already uses
 import { isInternalCall } from '@/lib/internal-auth'
+import { resolveDecisionRole } from '@/lib/approvals'

@@ 2. ADD a credential-derived role. getRoleFromCookie STAYS — see edit 3.
 function getRoleFromCookie(req: NextRequest): Role | null { ...unchanged... }

+/**
+ * The role this request may act with, derived from the CREDENTIAL in
+ * \`mc-auth\`. \`mc-role\` is a string the client types: it may narrow this,
+ * never widen it. Null means no session credential was presented at all —
+ * which, past the gate above, means an internal-secret caller.
+ *
+ * \`agentRoleHeader\` is deliberately null. Honouring X-Agent-Role here would
+ * let an internal caller narrow itself into a 403 it does not get today; this
+ * seam is not the place to change machine behaviour.
+ */
+function resolveRequestRole(req: NextRequest): Role | null {
+  return resolveDecisionRole(
+    {
+      sessionPassword: req.cookies.get('mc-auth')?.value ?? null,
+      claimedRole: req.cookies.get('mc-role')?.value ?? null,
+      agentRoleHeader: null,
+    },
+    {
+      ownerPassword: ADMIN_PASSWORD,
+      viewerPassword: VIEWER_PASSWORD,
+      memberPassword: process.env.MC_MEMBER_PASSWORD || null,
+    },
+  ).role
+}

@@ 3. decide every write by an explicit GRANT, never by the absence of a cookie
     if (WRITE_METHODS.has(req.method)) {
-      const role = getRoleFromCookie(req)
+      const role = resolveRequestRole(req)

       // Roles management endpoints require roles:admin (owner only)
       if (pathname.startsWith('/api/roles')) {
-        if (!role || !canManageRoles(role)) {
+        // BOTH conditions, on purpose. The credential must GRANT roles:admin
+        // (that closes the forgery), AND the operator must still explicitly
+        // name a recognised role (that preserves today's denial of an owner
+        // credential sending no mc-role at all). Requiring only the first
+        // WIDENS this endpoint — caught by __tests__/rbac-middleware.test.ts
+        // AC-7, which went 2 RED on the first draft of this very diff. The
+        // cookie may narrow, or be REQUIRED. It may never widen.
+        const claimed = getRoleFromCookie(req)
+        if (!claimed || !role || !canManageRoles(role)) {
           return NextResponse.json(
             { error: 'Forbidden: owner role required to manage workspace roles' },
             { status: 403 }
           )
         }
         return NextResponse.next({ request: { headers: scopedHeaders } })
       }

-      // All other write endpoints: viewer is blocked; owner/member/admin/god pass through
-      if (role === 'viewer') {
-        return NextResponse.json(
-          { error: 'Read-only access: viewer role cannot modify data' },
-          { status: 403 }
-        )
-      }
-      // No cookie = server-side call (e.g. agent → API) — pass through
+      // A write is allowed by a GRANT, never by the absence of a claim. A
+      // viewer that simply omits \`mc-role\` used to fall through the
+      // \`role === 'viewer'\` check into the pass-through below; that is a
+      // fail-open reached only AFTER hasValidSession() admitted a human.
+      if (role && !canWrite(role)) {
+        return NextResponse.json(
+          { error: 'Read-only access: viewer role cannot modify data' },
+          { status: 403 }
+        )
+      }
+      // role === null: no session credential at all. Past the gate above that
+      // means an internal-secret caller, which keeps its pass-through. Making
+      // machine callers prove a per-principal identity is the agent-keys plan,
+      // not this seam.
     }

VERIFIED, NOT MERELY PROPOSED. This exact diff was applied to a SCRATCH COPY of
middleware.ts inside this lane's own directory and run. middleware.ts itself was
never modified (\`git status middleware.ts\` stayed clean throughout), and the
scratch copy was deleted afterwards. Results:
  * this suite                          9 / 9   pass  (4 red -> green, 5 guards stay green)
  * __tests__/rbac-middleware.test.ts  51 / 51  pass  (its baseline is also 51/51)

WHAT THIS DIFF DOES NOT CHANGE, checked rather than assumed:
  * No role that could write yesterday loses the ability. Every role except
    \`viewer\` holds \`issues:write\` in lib/rbac-types.ts, so \`canWrite(role)\`
    refuses exactly the role the deleted line refused — and now also refuses it
    when it declines to name itself.
  * The internal-secret pass-through is untouched.
  * /api/roles is exactly as strict as it is today, because of the \`claimed\`
    condition. Do not "simplify" it away.

WHAT IT STILL DOES NOT FIX, so a green suite is not read as a solved channel:
  * \`mc-auth\` is still the password, so \`hasValidSession()\` above remains an
    unthrottled password oracle: measured today, 30 wrong cookie values on
    GET /api/projects gave 30 immediate 401s and the right one gave 200. That
    needs the credential to stop being the password — piece doc §8, a schema
    change, not a middleware edit.
  * \`lib/rbac-middleware.ts\` resolveRole() still returns the raw \`mc-role\`
    cookie with no \`mc-auth\` check at all, and gives \`role === 'god'\` an
    unconditional bypass of every permission check. One call site today
    (app/api/memory/route.ts, memory:read, which viewer already holds), so it
    is latent rather than exploitable — but it is a THIRD module with this
    defect and it is outside this lane too. Piece doc §S3.
`

function fail(what: string): never {
  throw new Error(`SEAM NOT APPLIED — ${what}\n${DIFF}`)
}

describe('SEAM: middleware.ts must derive the write role from the credential', () => {
  it('a viewer credential that OMITS mc-role is still refused a write', async () => {
    const res = await middleware(writeAs(`mc-auth=${VIEWER}`))
    if (passedThrough(res)) {
      fail(
        'DELETE /api/issues with the read-only viewer password and NO mc-role ' +
          'cookie was waved through to the handler. Measured over HTTP the same ' +
          'request answers 200 {"ok":true}. The viewer role is enforced only when ' +
          'the caller volunteers the cookie identifying it as a viewer.',
      )
    }
    expect(res.status).toBe(403)
  })

  it('a viewer credential carrying an UNRECOGNISED mc-role is still refused', async () => {
    const res = await middleware(writeAs(`mc-auth=${VIEWER}; mc-role=notarole`))
    if (passedThrough(res)) {
      fail(
        'DELETE /api/issues with the viewer password and mc-role=notarole was ' +
          'waved through. getRoleFromCookie() answers null for an unrecognised ' +
          'value, and null means "pass through".',
      )
    }
    expect(res.status).toBe(403)
  })

  it('a viewer credential FORGING mc-role=owner is still refused a write', async () => {
    const res = await middleware(writeAs(`mc-auth=${VIEWER}; mc-role=owner`))
    if (passedThrough(res)) {
      fail(
        'DELETE /api/issues with the viewer password and mc-role=owner was waved ' +
          'through. This is the variant §10.4 already described.',
      )
    }
    expect(res.status).toBe(403)
  })

  it('a viewer credential FORGING mc-role=owner cannot reach /api/roles', async () => {
    const res = await middleware(
      writeAs(`mc-auth=${VIEWER}; mc-role=owner`, 'http://localhost:3000/api/roles', 'POST'),
    )
    if (passedThrough(res)) {
      fail(
        'POST /api/roles with the read-only viewer password and mc-role=owner ' +
          'reached the handler. Measured over HTTP: viewer -> 403, owner -> 400 ' +
          '(handler reached), god -> 400.',
      )
    }
    expect(res.status).toBe(403)
  })

  // ── The other half of every refusal: the allowed case must still succeed. ──
  //
  // A permission nobody is refused by is not a permission; a permission that
  // refuses everybody is not a fix. These four must be GREEN both before and
  // after the seam lands, and they are the guard against "fixing" the tests
  // above by denying writes outright.

  it('REGRESSION GUARD: the owner credential still writes', async () => {
    const res = await middleware(writeAs(`mc-auth=${OWNER}; mc-role=owner`))
    expect(passedThrough(res)).toBe(true)
  })

  it('REGRESSION GUARD: the owner credential still writes with NO mc-role cookie', async () => {
    // The seam must not turn "omitted cookie" into a blanket denial. An owner
    // that omits the cookie is an owner.
    const res = await middleware(writeAs(`mc-auth=${OWNER}`))
    expect(passedThrough(res)).toBe(true)
  })

  it('REGRESSION GUARD: an owner narrowing itself to mc-role=viewer is refused', async () => {
    // Narrowing is honoured on purpose and is fail-safe. True today and after.
    const res = await middleware(writeAs(`mc-auth=${OWNER}; mc-role=viewer`))
    expect(passedThrough(res)).toBe(false)
    expect(res.status).toBe(403)
  })

  it('REGRESSION GUARD: an unauthenticated write is still 401, not 403', async () => {
    const res = await middleware(writeAs('nothing=here'))
    expect(res.status).toBe(401)
  })

  it('REGRESSION GUARD: reads are unaffected for a viewer', async () => {
    const res = await middleware(
      new NextRequest('http://localhost:3000/api/projects', {
        method: 'GET',
        headers: { cookie: `mc-auth=${VIEWER}; mc-role=viewer` },
      }),
    )
    expect(passedThrough(res)).toBe(true)
  })
})

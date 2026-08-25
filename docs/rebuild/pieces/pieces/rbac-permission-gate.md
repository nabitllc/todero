# PIECE: Fix the inverted RBAC gate (owner denied, anonymous allowed)

id: rbac-permission-gate
baseline score: 0/10
effort: M

## Why this piece matters
Blocks literally everything downstream. No tab, board, agent surface or API can be judged while the owner role gets 403 on every route. It is also a live security hole in the opposite direction: anonymous callers get full read, write and delete. Nothing else in this wave is verifiable until this lands.

## Build instruction (from the Wave 1 audit — follow it, but you own the judgement)
Delete the DB lookup as the source of truth. In lib/permission-check.ts:105-124 and lib/rbac-middleware.ts:122-128, replace the .from('role_permissions') query with a call to hasPermission(role, required) using the ROLE_PERMISSIONS map that already exists at lib/rbac-types.ts:54-64 (optionally consult the table only as an override when it exists, never as the only source). Then invert the fail-open guards: at app/api/issues/route.ts:775, :877 and :1204 change `if (callerRole !== null)` to `if (callerRole === null) return NextResponse.json({error:'unauthenticated'},{status:401})` placed BEFORE the permission check, and apply the same pattern to every route using resolveCallerRole. Delete the anonymous X-Agent-Role branch at lib/with-permission.ts:50 and the 'No cookie = server-side call - pass through' bypass at middleware.ts:64 (server-internal calls should carry a signed internal header instead). Follow the default-deny-for-anonymous model Temporal and Mission Control use. Finally, replace the mock at __tests__/rbac-middleware.test.ts:42 with a test that runs with NO supabase mock at all.

## ACCEPTANCE — a critic will verify these against the RUNNING app
Against the running app: (1) `curl -s -o /dev/null -w '%{http_code}' -b 'mc-auth=kaos2026; mc-role=owner' http://localhost:3000/api/issues` -> 200; (2) the same URL with NO cookies -> 401 (currently 200); (3) `curl -X DELETE 'http://localhost:3000/api/issues?id=<any>'` with no cookies -> 401; (4) POST /api/issues with `mc-auth=view2026` and the mc-role cookie DELETED -> 401, not 400; (5) GET /api/memory and POST /api/run-agent with the owner cookie no longer return PERMISSION_DENIED. All five checked without creating any Supabase table.

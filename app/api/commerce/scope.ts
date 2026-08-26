/**
 * The request-level glue between middleware.ts's resolved scope and
 * lib/scope.ts's pure `resolveProjectScope()`.
 *
 * It lives here rather than in lib/scope.ts so that file stays free of
 * NextRequest and remains unit-testable; and it lives in ONE file rather than
 * three so the three commerce routes cannot drift into three different answers
 * to the same question — which is exactly how `/api/db/issues` and
 * `/api/issues` ended up 400-ing and 200-ing on the identical unscoped read.
 *
 * one-scope-answer: the rule itself used to be a second copy, in
 * `lib/commerce.ts:resolveCommerceScope()`, of the twelve lines in
 * `lib/conversations.ts:resolveScope()`. They differed in an error string
 * (`scope_mismatch` vs `scope_conflict`), a result field name (`why` vs
 * `message`), and one check commerce simply did not have — conversations
 * capped a project name at 120 characters and commerce did not. That last
 * difference is what a duplicated boundary always eventually looks like: not a
 * disagreement anyone chose, just one copy that never got the fix. Both
 * surfaces now call `resolveProjectScope()` and commerce has the cap.
 *
 * WHAT IT WILL NOT DO
 *   There is no `all_projects=1` here. Every other list read in this app has a
 *   widening escape because a fleet-wide view of agents is a real thing to
 *   want. A storefront read spanning every project is not — Todero operates
 *   one project's storefront — and a client-controlled query string must never
 *   widen a server-resolved boundary (TOD-2420: `?all_projects=1` used to
 *   defeat the task_key boundary on /api/issues for exactly that reason).
 *
 *   The `x-mc-all-projects` header is likewise NOT honoured here. middleware.ts
 *   sets it on the deliberately cross-project destinations (fleet/*, runs/*,
 *   settings/projects). None of those is a commerce screen, and a commerce read
 *   arriving from one of them is a request that cannot say which storefront it
 *   means — so it is refused, not widened.
 */

import { NextRequest, NextResponse } from 'next/server'
import { COMMERCE_READ_SCOPE, COMMERCE_WRITE_SCOPE, resolveProjectScope } from '@/lib/scope'

/** The header middleware.ts stamps the resolved project on. Never client-set. */
const SCOPE_HEADER = 'x-mc-project'

export interface CommerceScope {
  project: string
}

/**
 * Resolve the storefront, or return the response to send instead.
 *
 * `kind` only changes the error CODE ('unscoped_commerce_read' vs
 * '..._write') so a refused read and a refused write are distinguishable in a
 * log; the rule is identical for both, deliberately — a write that cannot say
 * which storefront it belongs to is worse than a read that cannot.
 */
export function commerceScope(
  req: NextRequest,
  kind: 'read' | 'write',
  requestedProject?: string | null,
): { scope: CommerceScope } | { refusal: NextResponse } {
  const resolved = req.headers.get(SCOPE_HEADER)
  const requested =
    requestedProject !== undefined
      ? requestedProject
      : req.nextUrl.searchParams.get('project')

  const verdict = resolveProjectScope(
    resolved,
    requested ?? null,
    kind === 'write' ? COMMERCE_WRITE_SCOPE : COMMERCE_READ_SCOPE,
  )
  if (!verdict.ok) {
    return {
      refusal: NextResponse.json(
        { error: verdict.error, message: verdict.message },
        { status: verdict.status },
      ),
    }
  }
  return { scope: { project: verdict.project } }
}

/** Who the action is recorded as. */
export function commerceActor(req: NextRequest): string {
  return req.cookies.get('mc-role')?.value ?? 'unknown'
}

/**
 * The request-level glue between middleware.ts's resolved scope and
 * lib/commerce.ts's pure `resolveCommerceScope()`.
 *
 * It lives here rather than in lib/commerce.ts so that file stays free of
 * NextRequest and remains unit-testable; and it lives in ONE file rather than
 * three so the three commerce routes cannot drift into three different answers
 * to the same question — which is exactly how `/api/db/issues` and
 * `/api/issues` ended up 400-ing and 200-ing on the identical unscoped read.
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
import { resolveCommerceScope } from '@/lib/commerce'

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

  const verdict = resolveCommerceScope(resolved, requested ?? null, kind)
  if (!verdict.ok) {
    return {
      refusal: NextResponse.json(
        { error: verdict.error, message: verdict.why },
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

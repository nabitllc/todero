/**
 * lib/scope.ts — the one answer to "what project is this request scoped to",
 * for the surfaces that have no cross-project mode.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 *
 * Six places in this app answered that question, and they disagreed. Two of
 * them — `lib/conversations.ts:resolveScope()` and
 * `lib/commerce.ts:resolveCommerceScope()` — were the same twelve lines twice,
 * differing in an error string and a field name. A boundary written twice is a
 * boundary that will hold in one place: the nine cross-project leaks this
 * rebuild closed at TOD-2407 were all instances of exactly that shape, and
 * TOD-2419 shipped `/api/issues` with project scoping disabled because the
 * guard watching it could not fail.
 *
 * So the rule lives here once, and the surfaces differ only in what they are
 * CALLED — a `ScopeSurface` descriptor carrying the surface's name and its two
 * error codes. The algorithm is identical for every surface, deliberately: a
 * commerce write that cannot say which storefront it belongs to and a
 * conversations read that cannot say which project it belongs to are the same
 * defect, and they should not be able to drift into two different answers.
 *
 * ── THE THREE RULES, IN ONE PLACE ───────────────────────────────────────────
 *
 *   1. NEITHER SIGNAL -> 400. Absence is never "every project". A request that
 *      cannot name its boundary is refused and told how to name one.
 *   2. BOTH SIGNALS, DISAGREEING -> 409. A resolved scope NARROWS and is never
 *      overridden. Answering the query param instead would make the address bar
 *      and the data on screen disagree, which is how a cross-project read looks
 *      to an operator right up until it is noticed.
 *   3. THERE IS NO WIDENING ESCAPE HATCH AT ALL. Not `all_projects=1` (which
 *      `app/api/issues/route.ts` accepts for genuinely fleet-wide screens), not
 *      the `x-mc-all-projects` header middleware.ts stamps on fleet/*, runs/*
 *      and settings/projects, not `*`, not an empty string. None of these
 *      surfaces has a cross-project view to widen INTO — a conversation belongs
 *      to exactly one project, and Todero operates one storefront at a time.
 *      TOD-2420: `?all_projects=1` once defeated the task_key boundary on
 *      /api/issues, so a client-controlled query string must never widen a
 *      server-resolved boundary here.
 *
 * ── WHAT IS AND IS NOT TRUSTED ──────────────────────────────────────────────
 *
 * `headerScope` is middleware.ts's `x-mc-project`. The client cannot forge it:
 * middleware DELETES any inbound copy before recomputing it from the request's
 * own path or its Referer. `queryProject` is an explicit `?project=` (or, for a
 * write, a `project` field in the body) — the deliberate way a caller with no
 * browser context, a script or a curl, says what it means.
 *
 * ── WHAT THIS FILE DOES NOT DECIDE ──────────────────────────────────────────
 *
 * `/api/issues` and `/api/db/issues` disagree about whether an explicit
 * `project=` filter satisfies scope from a cross-project destination. That is
 * the OPEN DECISION in docs/rebuild/LOOP-PLAN.md and picking wrong widens a
 * security boundary. It is not resolved here, and this file is deliberately not
 * imported by either of them.
 */

/** A refusal, or the one project the request may touch. */
export type ScopeVerdict =
  | { ok: true; project: string }
  | { ok: false; error: string; message: string; status: 400 | 409 }

/**
 * What a surface is called when it refuses.
 *
 * This is the ONLY thing that varies between surfaces. It is a data
 * description, not a strategy: nothing here can change WHETHER a request is
 * refused, only what the refusal calls itself. A surface cannot opt out of the
 * three rules by supplying a different descriptor.
 */
export interface ScopeSurface {
  /**
   * The surface, as a noun phrase, dropped into "This ___ has no project
   * scope." e.g. 'conversations request', 'commerce query'.
   */
  what: string
  /** Error code when nothing resolved at all. */
  unscopedError: string
  /** Error code when the resolved scope and the requested one disagree. */
  conflictError: string
  /**
   * One sentence saying why THIS surface has no all-projects mode. Every
   * surface here has a real reason; a surface that cannot state one does not
   * belong in this file.
   */
  noWidening: string
}

/**
 * Customer conversations. A conversation belongs to exactly one project, and no
 * screen in this product shows one customer's thread next to another project's.
 */
export const CONVERSATIONS_SCOPE: ScopeSurface = {
  what: 'conversations request',
  unscopedError: 'unscoped_conversations_read',
  conflictError: 'scope_conflict',
  noWidening:
    'There is no all-projects view of customer conversations: a conversation ' +
    'belongs to exactly one project.',
}

/** A commerce READ. Split from the write only so a log can tell them apart. */
export const COMMERCE_READ_SCOPE: ScopeSurface = {
  what: 'commerce query',
  unscopedError: 'unscoped_commerce_read',
  conflictError: 'scope_mismatch',
  noWidening:
    'There is no all-projects mode for commerce: Todero operates one ' +
    'storefront at a time.',
}

/**
 * A commerce WRITE. The rule is identical to the read's, deliberately — a write
 * that cannot say which storefront it belongs to is worse than a read that
 * cannot, never better.
 */
export const COMMERCE_WRITE_SCOPE: ScopeSurface = {
  what: 'commerce write',
  unscopedError: 'unscoped_commerce_write',
  conflictError: 'scope_mismatch',
  noWidening: COMMERCE_READ_SCOPE.noWidening,
}

/**
 * The longest project name this app will treat as a name rather than as an
 * attack on whatever is downstream of it. Conversations enforced this and
 * commerce did not; unifying gives commerce the cap. That direction — a
 * surface gaining a check it lacked — is the only direction this collapse is
 * allowed to move in.
 */
export const MAX_PROJECT_NAME_LENGTH = 120

/**
 * The refusal a caller gets when no project could be resolved.
 *
 * Exported so tests can pin the wording. A boundary that refuses without
 * saying how to ask deliberately just reads as a bug, and an operator who
 * cannot tell a refusal from an outage files the wrong ticket.
 */
export function unscopedScopeMessage(surface: ScopeSurface): string {
  return (
    `This ${surface.what} has no project scope. Request it from a /p/<project> screen, ` +
    `or pass ?project=<name> to name one deliberately. ${surface.noWidening}`
  )
}

/**
 * Resolve the one project this request may touch, or say why it cannot be.
 *
 * Fails closed in all three of the ways described at the top of this file. The
 * caller gets either a project or a response to send; there is no third state
 * and no value that means "all of them".
 */
export function resolveProjectScope(
  headerScope: string | null | undefined,
  queryProject: string | null | undefined,
  surface: ScopeSurface,
): ScopeVerdict {
  const header = headerScope?.trim() || null
  const query = queryProject?.trim() || null

  // Rule 2 first: a disagreement is refused before either value is used, so a
  // forged-looking query param can never win by being checked second.
  if (header && query && header !== query) {
    return {
      ok: false,
      error: surface.conflictError,
      status: 409,
      message:
        `This screen is scoped to "${header}" but the request asked for "${query}". ` +
        'A resolved scope narrows and is never overridden — ask from a /p/<project> ' +
        'screen for that project instead.',
    }
  }

  // Rule 1. Note what is NOT here: no branch that treats a missing scope as
  // every project, and no query value that means "all". `all_projects=1` is not
  // read; `*` is not a wildcard, it is a project name that matches nothing.
  const project = header ?? query
  if (!project) {
    return {
      ok: false,
      error: surface.unscopedError,
      status: 400,
      message: unscopedScopeMessage(surface),
    }
  }

  if (project.length > MAX_PROJECT_NAME_LENGTH) {
    return {
      ok: false,
      error: surface.unscopedError,
      status: 400,
      message: `project name is too long (${project.length} characters, maximum ${MAX_PROJECT_NAME_LENGTH}).`,
    }
  }

  return { ok: true, project }
}

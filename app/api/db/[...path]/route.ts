// ─── Session-gated database proxy for the browser ────────────────────────────
//
// Client components used to hold a full-privilege database key in the JS bundle
// and query the database host directly. They now call this route: credentials
// stay on the server, the caller must present a valid mc-auth session, and only
// the tables the UI actually reads are reachable.
//
// It does NOT forward the query string to a vendor. The filter grammar the
// client components were written against is parsed into `DbQueryBuilder` calls
// (see `lib/db/query-params.ts`) and executed through `db()`, so this route is
// on the same side of the seam as every other server module. Swapping the
// adapter swaps this route too, with no HTTP API to re-implement.
//
// TODO(db-seam): replace each caller with a purpose-built route and delete this
// route together with `lib/db/browser.ts` and `lib/db/query-params.ts`.

import { NextRequest, NextResponse } from 'next/server'
import { resolveDecisionRole } from '@/lib/approvals'
import { sessionCredentials } from '@/app/api/inbox/actor'
import { hasPermission } from '@/lib/rbac-types'
import { db, DbConfigurationError, type DbQueryBuilder, type DbResult } from '@/lib/db'
import {
  applyFilters,
  applyShaping,
  DbQueryParseError,
  readQueryShape,
} from '@/lib/db/query-params'

/** Tables the browser is allowed to reach through this shim. */
const READABLE_TABLES = new Set([
  'issues',
  'sprints',
  'agents',
  'agent_runs',
  'agent_cost_log',
  'agent_memory',
  'agent_memory_files',
  'agent_documents',
  'notifications',
  'projects',
  'milestones',
  'inbox',
  'token_ledger',
])

/** Subset of the above the browser may also write to. */
// TOD-2479. `inbox` is deliberately NOT writable here. Deciding an approval goes
// through PATCH /api/inbox, which resolves the role from the CREDENTIAL and files
// the attempt in `approval_decisions`. Nothing in the app ever wrote inbox
// through this proxy — the only occurrence of "/api/db/inbox" outside tests and
// comments is a comment in lib/runtimes/token-ledger.ts, and both UI callers that
// decide an approval PATCH the gated route instead.
//
// Leaving it writable meant a session holding only the READ-ONLY password could
// approve an agent's request by naming itself "owner" in a cookie. Measured: the
// update reached the database as
// {"status":"approved","resolved_by":"definitely-not-a-human-bot"}.
const WRITABLE_TABLES = new Set(['issues', 'notifications'])

// ─── scope-reaches-the-server ────────────────────────────────────────────────
//
// A fresh critic un-archived one issue and watched it reappear on nine
// surfaces: every one of them read `issues` through this proxy with a hand-
// rolled query string that may or may not have remembered to add
// `project=eq.<x>&archived_at=is.null` itself. That is a filter spread across
// N call sites, which is a filter the (N+1)th call site forgets — silently,
// because the failure mode is "the row just shows up", not an error.
//
// middleware.ts resolves the caller's scope (from this request's own path, or
// failing that, its Referer — see that file's block comment) and stamps it on
// this header. This route reads ONLY that header for scope, never the query
// string the client sent — see `scopedParams` below.
const SCOPE_HEADER = 'x-mc-project'
const CROSS_PROJECT_HEADER = 'x-mc-all-projects'
/**
 * OPEN DECISION (docs/rebuild/LOOP-PLAN.md), resolved as option 1: the project
 * middleware.ts saw named in THIS SAME request's own path/Referer, stamped
 * only when that destination is deliberately cross-project (fleet/*, runs/*)
 * — see middleware.ts's `crossProjectDestinationName`. It is not a scope by
 * itself (see `scopedParams` below for the one place it is trusted, and only
 * in agreement with the caller's OWN explicit filter).
 */
const CROSS_PROJECT_HINT_HEADER = 'x-mc-cross-project-hint'

/**
 * Every READ of the `issues` table through this proxy is scoped HERE, ONCE,
 * regardless of what the caller's own query string asked for — this is the
 * fix that lets the client call sites become correct WITHOUT being edited.
 * `project=eq.<scoped>` and `archived_at=is.null` are injected
 * UNCONDITIONALLY whenever a scope is resolvable: any client-supplied
 * `project`/`archived_at` for THIS table is deleted first, so a caller cannot
 * un-scope itself by asking directly, or by adding a second value for the
 * same key.
 *
 * Writes are deliberately NOT touched: a write already targets one row
 * (`id=eq.<id>`), not a query boundary, and forcing `archived_at=is.null`
 * onto a write would make it impossible to ever un-archive a row through this
 * endpoint — the row's `archived_at` is NOT null right up until the very
 * write that clears it.
 *
 * When no scope is resolvable (no `/p/<slug>` anywhere in this request's own
 * path or its Referer), the query passes through unfiltered, exactly as
 * before this piece. That is not a leak: it is the same "genuinely nothing to
 * scope by" case documented on GET /api/issues, and it is what acceptance
 * item 2 (the counterfactual) tests directly — the SAME read, without a
 * resolvable scope, must still return an archived-and-restored row, proving
 * this clause is what excludes it in the scoped case, not the archive itself.
 */
/** `all_projects=1|true|yes` — the deliberate, documented cross-project opt-out. */
const ALL_PROJECTS = /^(1|true|yes)$/i

/** Returns null when an issues read has no resolvable scope and did not ask for one. */
function scopedParams(req: NextRequest, table: string, isWrite: boolean): URLSearchParams | null {
  const params = new URLSearchParams(req.nextUrl.searchParams)
  // Read it, then strip it: everything left in `params` is treated as a
  // PostgREST filter downstream, and `all_projects=1` is not one — it parsed as
  // a malformed filter and 400'd the very call it was meant to allow.
  const wantsAllProjects = ALL_PROJECTS.test(params.get('all_projects') ?? '')
  params.delete('all_projects')
  if (table !== 'issues') return params

  if (isWrite) {
    // Writes used to return here untouched, and this endpoint echoes affected
    // rows back — so PATCH was a fully unscoped READ channel for a table the
    // same caller is refused on GET. `PATCH ?task_number=gte.0` matched every
    // row in every project and handed them over, mutating them on the way.
    //
    // The original carve-out only ever justified dropping `archived_at`, and
    // that part is right: forcing archived_at=is.null onto a write would make
    // un-archiving impossible through this endpoint. It never justified
    // dropping the project clause.
    const writeScope = req.headers.get(SCOPE_HEADER)
    if (writeScope) {
      params.delete('project')
      params.set('project', `eq.${writeScope}`)
    }
    return params
  }
  const scope = req.headers.get(SCOPE_HEADER)
  if (!scope) {
    // FAIL CLOSED. This used to `return params` — i.e. an unresolvable scope
    // meant "every project", which is the behaviour the whole piece exists to
    // remove. It made the boundary only as strong as the Referer header: with
    // no referer, a strict Referrer-Policy, a script, or any page without a
    // /p/<slug> segment, the request fell fully open and returned another
    // project's rows. Verified before this change — no referer returned TOD-1.
    //
    // A boundary that holds only in the common case is a default, not a
    // boundary. Refusing costs a caller one explicit parameter; widening
    // silently costs the operator their trust in every number on the screen.
    if (wantsAllProjects) return params
    // OPEN DECISION, option 1: a cross-project destination (Fleet/Runs) with
    // NO resolved scope can still satisfy the boundary itself, by repeating
    // the SAME project the request's own path/Referer already names, as an
    // EXPLICIT `project=eq.<x>` filter. `CROSS_PROJECT_HINT_HEADER` carries
    // that project name — never the caller's own claim, middleware computed
    // it from the request's own path/Referer, the same way it computes
    // `SCOPE_HEADER` for a non-cross-project destination.
    //
    // This is deliberately an EQUALITY check against the hint, not "any
    // project filter satisfies scope": a filter naming a DIFFERENT project
    // still falls through to the refusal below — the caller named a boundary
    // it does not occupy, not the one it does. A filter with any operator
    // other than a bare `eq.<exact value>` (`eq.*`, `eq.`, `in.(...)`,
    // `neq.X`, a case variant, …) does not match the hint string and also
    // falls through, for the same reason. And with NO project filter at all,
    // there is nothing to check equality against, so this is skipped
    // entirely and the request still refuses below — an unresolved scope is
    // never forgiven just because the destination happens to be cross-project.
    const hint = req.headers.get(CROSS_PROJECT_HINT_HEADER)
    if (hint && params.get('project') === `eq.${hint}`) {
      params.delete('project')
      params.delete('archived_at')
      params.set('project', `eq.${hint}`)
      params.set('archived_at', 'is.null')
      return params
    }
    // A destination the middleware identified as deliberately global — but that
    // signal is keyed by DESTINATION, never by table, and it was justified for
    // agent-level aggregates (agent_runs, agents, agent_cost_log) that span
    // every project an agent touched. It was then handing out `issues` too.
    //
    // That is live in the UI, not a curl curiosity: SearchOverlay is mounted
    // unconditionally, so Cmd-K pressed on the Fleet screen returned another
    // project's backlog while the same keystroke on Work returned nothing. The
    // same component, the same query, a different answer decided by which page
    // the operator happened to be standing on.
    //
    // A Fleet screen has no business reading another project's issues. Widening
    // `issues` now takes the explicit, deliberate opt-out above and nothing else.
    if (table !== 'issues' && req.headers.get(CROSS_PROJECT_HEADER) === '1') return params
    return null
  }
  params.delete('project')
  params.delete('archived_at')
  params.set('project', `eq.${scope}`)
  params.set('archived_at', 'is.null')
  return params
}

function isAuthenticated(req: NextRequest): boolean {
  const auth = req.cookies.get('mc-auth')?.value
  if (!auth) return false
  const allowed = [
    process.env.MC_PASSWORD ?? 'kaos2026',
    process.env.MC_VIEWER_PASSWORD ?? 'view2026',
    process.env.MC_MEMBER_PASSWORD ?? '',
  ].filter(Boolean)
  return allowed.includes(auth)
}

/**
 * TOD-2479. May this request write through the proxy?
 *
 * Derived from the CREDENTIAL in `mc-auth`. `mc-role` is a string the client
 * types: it may NARROW this, never widen it.
 *
 * The predecessor, `isViewer()`, asked only whether the client had volunteered
 * `mc-role=viewer` — so `mc-auth=<the read-only password>` plus `mc-role=owner`
 * wrote freely, and so did omitting `mc-role` altogether. Measured over HTTP on
 * 2026-08-26 against /api/issues, where the identical defect deleted a real row.
 *
 * BOTH halves of this fix matter and neither replaces the other. Removing
 * `inbox` from WRITABLE_TABLES above closes the one table that was reachable;
 * this closes the CLASS, so the next table added to that set does not reopen it.
 * middleware.ts now derives the role the same way, but a route that is only safe
 * because something in front of it is safe is not safe — this handler is called
 * directly by tests today and could be called directly by anything tomorrow.
 */
function mayWrite(req: NextRequest): boolean {
  const { role } = resolveDecisionRole(
    {
      sessionPassword: req.cookies.get('mc-auth')?.value ?? null,
      claimedRole: req.cookies.get('mc-role')?.value ?? null,
      agentRoleHeader: req.headers.get('x-agent-role'),
    },
    sessionCredentials(),
  )
  return !!role && hasPermission(role, 'issues:write')
}

/**
 * `['issues']` → `'issues'`. Leading `rest` / `v1` segments are accepted for
 * older callers that still spell the path that way. Anything else — nested
 * paths, stored procedures, schema switching — is rejected.
 */
function parseTable(segments: string[]): string | null {
  const parts = [...segments]
  while (parts.length > 1 && (parts[0] === 'rest' || parts[0] === 'v1')) parts.shift()
  if (parts.length !== 1) return null
  const table = parts[0]
  return /^[a-z_][a-z0-9_]*$/.test(table) ? table : null
}

/** `Prefer: resolution=merge-duplicates` turns an insert into an upsert. */
function prefers(req: NextRequest, token: string): boolean {
  return (req.headers.get('prefer') ?? '').includes(token)
}

async function readBody(req: NextRequest): Promise<unknown> {
  const text = await req.text()
  if (!text.trim()) return {}
  try {
    return JSON.parse(text)
  } catch {
    throw new DbQueryParseError('Request body is not valid JSON.')
  }
}

/** Rows arrive untyped: the seam has no generated schema types. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>

function asRows(body: unknown): Row | Row[] {
  if (Array.isArray(body)) return body as Row[]
  if (body && typeof body === 'object') return body as Row
  throw new DbQueryParseError('Request body must be an object or an array of objects.')
}

async function handle(req: NextRequest, segments: string[]): Promise<NextResponse> {
  if (!isAuthenticated(req)) {
    return NextResponse.json({ error: 'Unauthorized: sign in to Mission Control first' }, { status: 401 })
  }

  const table = parseTable(segments)
  if (!table || !READABLE_TABLES.has(table)) {
    return NextResponse.json(
      { error: `Not proxied: /${segments.join('/')}. Allowed tables: ${Array.from(READABLE_TABLES).sort().join(', ')}` },
      { status: 404 },
    )
  }

  const isWrite = req.method !== 'GET' && req.method !== 'HEAD'
  if (isWrite && (!mayWrite(req) || !WRITABLE_TABLES.has(table))) {
    return NextResponse.json({ error: `Read-only through this endpoint: ${table}` }, { status: 403 })
  }

  const params = scopedParams(req, table, isWrite)
  if (params === null) {
    return NextResponse.json(
      {
        error: 'unscoped_issues_read',
        message:
          'This issues query has no project scope. Navigate from a /p/<project> screen, ' +
          'or pass all_projects=1 to read across every project deliberately.',
      },
      { status: 400 },
    )
  }
  const shape = readQueryShape(params)

  let result: DbResult
  try {
    let builder: DbQueryBuilder = db().from(table)

    switch (req.method) {
      case 'GET':
      case 'HEAD':
        builder = builder.select(shape.select)
        break
      case 'POST': {
        const values = asRows(await readBody(req))
        builder = prefers(req, 'merge-duplicates')
          ? builder.upsert(values, shape.onConflict ? { onConflict: shape.onConflict } : undefined)
          : builder.insert(values)
        break
      }
      case 'PATCH': {
        const values = asRows(await readBody(req))
        if (Array.isArray(values)) {
          throw new DbQueryParseError('PATCH body must be a single object.')
        }
        builder = builder.update(values)
        break
      }
      case 'DELETE':
        builder = builder.delete()
        break
      default:
        return NextResponse.json({ error: `Method not allowed: ${req.method}` }, { status: 405 })
    }

    builder = applyFilters(builder, params)
    builder = applyShaping(builder, params)
    // Writes return the affected rows so callers can refresh without a re-read.
    if (isWrite) builder = builder.select(shape.select)

    result = await builder
  } catch (e) {
    if (e instanceof DbConfigurationError) {
      return NextResponse.json({ error: e.message, missingEnv: e.missingEnv }, { status: 503 })
    }
    if (e instanceof DbQueryParseError) {
      return NextResponse.json({ error: e.message }, { status: 400 })
    }
    throw e
  }

  if (result.error) {
    return NextResponse.json(
      { error: result.error.message, code: result.error.code ?? null, details: result.error.details ?? null },
      { status: result.status && result.status >= 400 ? result.status : 400 },
    )
  }

  return NextResponse.json(result.data ?? [])
}

type Ctx = { params: { path: string[] } }

export async function GET(req: NextRequest, { params }: Ctx) {
  return handle(req, params.path)
}
export async function POST(req: NextRequest, { params }: Ctx) {
  return handle(req, params.path)
}
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return handle(req, params.path)
}
export async function DELETE(req: NextRequest, { params }: Ctx) {
  return handle(req, params.path)
}

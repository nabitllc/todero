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
const WRITABLE_TABLES = new Set(['issues', 'notifications', 'inbox'])

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

function isViewer(req: NextRequest): boolean {
  return req.cookies.get('mc-role')?.value === 'viewer'
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
  if (isWrite && (isViewer(req) || !WRITABLE_TABLES.has(table))) {
    return NextResponse.json({ error: `Read-only through this endpoint: ${table}` }, { status: 403 })
  }

  const params = req.nextUrl.searchParams
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

// ─── Session-gated database proxy for the browser ────────────────────────────
//
// Client components used to hold a full-privilege database key in the JS bundle and query
// the database host directly. They now call this route instead: the credentials
// stay on the server, the caller must present a valid mc-auth session, and only
// the tables the UI actually reads are reachable.
//
// This is a compatibility shim, not an API. It forwards the PostgREST query
// string verbatim so migrating a component is a one-line base-URL change.
// TODO(db-seam): replace each caller with a purpose-built route and delete this.

import { NextRequest, NextResponse } from 'next/server'
import { dbRestBase, dbServiceHeaders } from '@/lib/db/rest'
import { DbConfigurationError } from '@/lib/db/errors'

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

/** Request headers worth forwarding; everything else is dropped. */
const FORWARD_REQUEST_HEADERS = ['content-type', 'prefer', 'range', 'accept']

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
 * `['v1','issues']` → `{ ok: true, table: 'issues' }`.
 * Anything that is not a single table under `v1` is rejected — no `/rpc/`,
 * no nested paths, no schema switching.
 */
function parseTable(segments: string[]): string | null {
  if (segments.length !== 2 || segments[0] !== 'v1') return null
  const table = segments[1]
  return /^[a-z_][a-z0-9_]*$/.test(table) ? table : null
}

async function proxy(req: NextRequest, segments: string[]): Promise<NextResponse> {
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

  let base: string
  let headers: Record<string, string>
  try {
    base = dbRestBase()
    headers = dbServiceHeaders()
  } catch (e) {
    if (e instanceof DbConfigurationError) {
      return NextResponse.json({ error: e.message, missingEnv: e.missingEnv }, { status: 503 })
    }
    throw e
  }

  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = req.headers.get(name)
    if (value) headers[name] = value
  }

  const target = `${base}/rest/v1/${table}${req.nextUrl.search}`
  const body = isWrite ? await req.text() : undefined

  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body,
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  })

  const text = await upstream.text()
  return new NextResponse(text, {
    status: upstream.status,
    headers: {
      'content-type': upstream.headers.get('content-type') ?? 'application/json',
      ...(upstream.headers.get('content-range') ? { 'content-range': upstream.headers.get('content-range') as string } : {}),
    },
  })
}

type Ctx = { params: { path: string[] } }

export async function GET(req: NextRequest, { params }: Ctx) {
  return proxy(req, params.path)
}
export async function POST(req: NextRequest, { params }: Ctx) {
  return proxy(req, params.path)
}
export async function PATCH(req: NextRequest, { params }: Ctx) {
  return proxy(req, params.path)
}
export async function DELETE(req: NextRequest, { params }: Ctx) {
  return proxy(req, params.path)
}

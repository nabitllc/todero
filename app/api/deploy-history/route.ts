// INF-210: Deploy history log — API routes
import { NextRequest, NextResponse } from 'next/server'
import { listDeploys, insertDeploy, updateDeploy } from '@/lib/deploy-history'
import { dbUnavailableResponse, dbQueryErrorResponse } from '@/lib/db-http'

const TABLE = 'deploy_history'

export async function GET(req: NextRequest) {
  // Name the missing credential in the body rather than letting a
  // DbConfigurationError escape as a bare 500 with nothing in it.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const project = req.nextUrl.searchParams.get('project') ?? undefined
  const limit = Number(req.nextUrl.searchParams.get('limit')) || 50
  const { data, error } = await listDeploys({ project, limit })
  if (error) return dbQueryErrorResponse(error, TABLE)
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  // Name the missing credential in the body rather than letting a
  // DbConfigurationError escape as a bare 500 with nothing in it.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const body = await req.json()
  const { project, branch, commit_sha, commit_message, status, source, url, triggered_by, duration_ms, error_message, finished_at } = body

  if (!project || !branch || !status || !source) {
    return NextResponse.json({ error: 'project, branch, status, and source are required' }, { status: 422 })
  }

  const { data, error } = await insertDeploy({
    project, branch,
    commit_sha: commit_sha ?? null,
    commit_message: commit_message ?? null,
    status, source,
    url: url ?? null,
    triggered_by: triggered_by ?? null,
    duration_ms: duration_ms ?? null,
    error_message: error_message ?? null,
    finished_at: finished_at ?? null,
  })
  if (error) return dbQueryErrorResponse(error, TABLE)
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  // Name the missing credential in the body rather than letting a
  // DbConfigurationError escape as a bare 500 with nothing in it.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const body = await req.json()
  const { id, ...fields } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { data, error } = await updateDeploy(id, fields)
  if (error) return dbQueryErrorResponse(error, TABLE)
  return NextResponse.json(data)
}

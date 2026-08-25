import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { dbUnavailableResponse, dbQueryErrorResponse } from '@/lib/db-http'

const RELEASE_CHANNEL = '1492003782605930560' // #release-notes
const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN!

function supabaseAdmin() {
  return db()
}

function bumpVersion(current: string, hasFeature: boolean, hasBreaking: boolean): string {
  const [maj, min, pat] = current.split('.').map(Number)
  if (hasBreaking) return `${maj + 1}.0.0`
  if (hasFeature)  return `${maj}.${min + 1}.0`
  return `${maj}.${min}.${pat + 1}`
}

function groupIssues(issues: Record<string, unknown>[]) {
  const g: Record<string, Record<string, unknown>[]> = {
    feature: [], bug: [], ops: [], research: [], other: []
  }
  for (const i of issues) {
    const t = (i.type as string | undefined)?.toLowerCase() ?? ''
    if (t in g) g[t].push(i)
    else g.other.push(i)
  }
  return g
}

function postDiscord(content: string) {
  fetch(`https://discord.com/api/v10/channels/${RELEASE_CHANNEL}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ content: content.slice(0, 2000) }),
  }).catch(err => console.error('[releases] discord post failed:', err))
}

// ── POST /api/releases ────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  let body: {
    pr_number?: number
    pr_url?: string
    commit_sha?: string
    repo?: string
    issue_ids?: string[]
    merged_at?: string
  }
  try { body = await req.json() }
  catch { return NextResponse.json({ error: 'invalid JSON' }, { status: 400 }) }

  const { pr_number, pr_url, commit_sha, repo = 'nabitllc/todero', issue_ids = [] } = body

  const sb = supabaseAdmin()

  // Fetch issues
  const issues: Record<string, unknown>[] = []
  if (issue_ids.length > 0) {
    const { data } = await sb.from('issues')
      .select('id, task_key, title, type, severity, priority')
      .in('id', issue_ids)
    if (data) issues.push(...data)
  }

  // Determine version
  const { data: latest } = await sb.from('releases')
    .select('version')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const currentVersion = latest?.version ?? '0.1.0'
  const groups = groupIssues(issues)
  const hasFeature  = groups.feature.length > 0
  const hasBreaking = issues.some(i => (i.severity as string | undefined)?.toUpperCase() === 'S0')
  const version = bumpVersion(currentVersion, hasFeature, hasBreaking)

  const issueKeys = issues.map(i => i.task_key as string).filter(Boolean)

  // Persist
  const { data: release, error } = await sb.from('releases').insert({
    version,
    pr_number:  pr_number  ?? null,
    pr_url:     pr_url     ?? null,
    commit_sha: commit_sha ?? null,
    repo,
    issue_keys: issueKeys,
    issue_ids,
    groups: {
      features: groups.feature.map(i => ({ key: i.task_key, title: i.title })),
      bugs:     groups.bug.map(i =>     ({ key: i.task_key, title: i.title })),
      ops:      groups.ops.map(i =>     ({ key: i.task_key, title: i.title })),
      research: groups.research.map(i => ({ key: i.task_key, title: i.title })),
      other:    groups.other.map(i =>   ({ key: i.task_key, title: i.title })),
    },
  }).select().maybeSingle()

  if (error) return dbQueryErrorResponse(error, 'releases')

  // Discord
  const now = new Date().toLocaleString('en-US', {
    timeZone: 'America/New_York',
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  }) + ' EST'

  const lines = [`📦 **Release v${version}** — ${issues.length} issue(s)`]
  if (groups.feature.length)   lines.push(`↳ ✨ ${groups.feature.length} feature(s)`)
  if (groups.bug.length)       lines.push(`↳ 🐛 ${groups.bug.length} bug fix(es)`)
  if (groups.ops.length)       lines.push(`↳ ⚙️ ${groups.ops.length} improvement(s)`)
  if (groups.research.length)  lines.push(`↳ 🔬 ${groups.research.length} research`)
  if (hasBreaking)             lines.push(`↳ 💥 breaking change(s)`)

  const keyList = issueKeys.slice(0, 8).join(', ') + (issueKeys.length > 8 ? `, +${issueKeys.length - 8} more` : '')
  if (keyList) lines.push(`↳ ${keyList}`)
  lines.push(`↳ ${now}`)
  if (pr_url) lines.push(`<${pr_url}>`)

  postDiscord(lines.join('\n'))

  return NextResponse.json(release, { status: 201 })
}

// ── GET /api/releases ─────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  // The database is either configured or it is not — say which, in the body.
  // A DbConfigurationError left to escape becomes a bare 500 with nothing in
  // it, and an empty 200 is worse: it looks like real, empty data.
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const limit = Number(req.nextUrl.searchParams.get('limit')) || 20
  const sb = supabaseAdmin()
  const { data, error } = await sb.from('releases')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) return dbQueryErrorResponse(error, 'releases')
  return NextResponse.json(data)
}

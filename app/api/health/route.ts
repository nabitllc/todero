// TOD-XXX (Gap 10): /api/health — JSON summary of the Todero stack.
// Unauthenticated — middleware has an explicit bypass for this path.
import { NextResponse } from 'next/server'
import { readFileSync, existsSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { listRuntimes } from '@/lib/runtimes'
import { listWorktrees } from '@/lib/runtimes/worktree'

const SUPA_URL = 'https://twthgapiouiqhavrcnry.supabase.co'
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''

export async function GET() {
  const result: Record<string, unknown> = { ok: true, ts: new Date().toISOString() }

  const dbStart = Date.now()
  try {
    const res = await fetch(
      `${SUPA_URL}/rest/v1/issues?status=neq.closed&select=status&limit=500`,
      { headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${SUPA_KEY}` }, signal: AbortSignal.timeout(5000) }
    )
    const dbLatency = Date.now() - dbStart
    if (res.ok) {
      const rows = await res.json() as Array<{ status: string }>
      result.db = { reachable: true, latencyMs: dbLatency }
      result.counts = {
        open:       rows.filter(r => r.status === 'open').length,
        inProgress: rows.filter(r => r.status === 'in_progress').length,
        codeReview: rows.filter(r => r.status === 'code_review').length,
        approved:   rows.filter(r => r.status === 'approved').length,
        released:   rows.filter(r => r.status === 'released').length,
        backlog:    rows.filter(r => r.status === 'backlog').length,
      }
    } else {
      result.ok = false
      result.db = { reachable: false, latencyMs: dbLatency, error: `HTTP ${res.status}` }
    }
  } catch (e) {
    result.ok = false
    result.db = { reachable: false, error: e instanceof Error ? e.message : String(e) }
  }

  try { result.runtimes = await listRuntimes() } catch { result.runtimes = [] }

  try {
    const heartbeatPath = join(homedir(), 'todero', 'config', 'self-improving', 'heartbeat-state.md')
    if (existsSync(heartbeatPath)) {
      const content = readFileSync(heartbeatPath, 'utf8')
      const parsed: Record<string, string> = {}
      for (const line of content.split('\n')) {
        const m = line.match(/^(\w+):\s*(.+)$/)
        if (m) parsed[m[1]] = m[2].trim()
      }
      result.lastHeartbeat = parsed
    }
  } catch {}

  try {
    const worktrees = listWorktrees()
    result.worktrees = { count: worktrees.length, agents: worktrees.map(w => w.agentId) }
  } catch {}

  return NextResponse.json(result, {
    status: result.ok ? 200 : 503,
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  })
}

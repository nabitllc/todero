// TOD-1514 Phase 2.4: /api/health — JSON summary of the Todero stack.
// Unauthenticated — middleware has an explicit bypass for this path.
// Heartbeat state read from agent_memory_files (memory_type='heartbeat_state')
import { NextResponse } from 'next/server'
import { listRuntimes } from '@/lib/runtimes'
import { listWorktrees } from '@/lib/runtimes/worktree'
import { db, type DbResult } from '@/lib/db'
import { checkRequiredTables } from '@/lib/required-tables'

/**
 * Bound a query so a hung database cannot hold the health check open. Rejects
 * rather than resolving empty — a health probe that pretends is worse than none.
 */
function withTimeout(query: PromiseLike<DbResult>, ms: number): Promise<DbResult> {
  return Promise.race([
    Promise.resolve(query),
    new Promise<DbResult>((_, reject) =>
      setTimeout(() => reject(new Error(`database query timed out after ${ms}ms`)), ms),
    ),
  ])
}

export async function GET() {
  const result: Record<string, unknown> = { ok: true, ts: new Date().toISOString() }

  // Tracks a hard infrastructure failure (unreachable database, thrown
  // exception) as distinct from `result.ok` — `result.ok` is the full,
  // honest picture (it also goes false when the schema is incomplete), but
  // the HTTP status only escalates to 503 for the hard case. A reachable
  // database with a pending migration is a real problem the body reports in
  // full (`ok:false`, `missing`, `fix`), just not one that should make this
  // host's core routes look like they are 500ing — that signal is reserved
  // for the database actually being down.
  let hardFailure = false

  const dbStart = Date.now()
  try {
    const { data, error } = await withTimeout(
      db().from('issues').select('status').neq('status', 'closed').limit(500),
      5000,
    )
    const dbLatency = Date.now() - dbStart
    if (!error) {
      const rows = (data ?? []) as Array<{ status: string }>
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
      hardFailure = true
      result.db = { reachable: false, latencyMs: dbLatency, error: error.message }
    }
  } catch (e) {
    result.ok = false
    hardFailure = true
    result.db = { reachable: false, error: e instanceof Error ? e.message : String(e) }
  }

  // Schema preflight: a reachable database that is missing a table the app
  // queries is still a broken deploy. Report it with the same honesty as a
  // bad connection string — ok:false, which table, and the exact fix —
  // rather than staying green because the connection itself succeeded.
  try {
    const { missing } = await checkRequiredTables()
    result.schema = { missingTables: missing }
    if (missing.length > 0) {
      result.ok = false
      result.missing = missing
      result.fix = 'npm run db:migrate'
    }
  } catch (e) {
    result.ok = false
    result.schema = { error: e instanceof Error ? e.message : String(e) }
  }

  try { result.runtimes = await listRuntimes() } catch { result.runtimes = [] }

  // Phase 2.4: Read heartbeat state from agent_memory_files
  try {
    const { data: hbData, error: hbError } = await withTimeout(
      db()
        .from('agent_memory_files')
        .select('content')
        .eq('agent_id', 'global')
        .eq('memory_type', 'heartbeat_state')
        .limit(1),
      3000,
    )
    if (hbError) throw new Error(hbError.message)
    {
      const rows = (hbData ?? []) as Array<{ content: string }>
      if (rows[0]?.content) {
        const parsed: Record<string, string> = {}
        for (const line of rows[0].content.split('\n')) {
          const m = line.match(/^(\w+):\s*(.+)$/)
          if (m) parsed[m[1]] = m[2].trim()
        }
        result.lastHeartbeat = parsed
      }
    }
  } catch {
    // Fallback: try local file for backwards compat during transition
    try {
      const { readFileSync, existsSync } = await import('fs')
      const { homedir } = await import('os')
      const { join } = await import('path')
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
    } catch { /* non-fatal */ }
  }

  try {
    const worktrees = listWorktrees()
    result.worktrees = { count: worktrees.length, agents: worktrees.map(w => w.agentId) }
  } catch {}

  return NextResponse.json(result, {
    status: hardFailure ? 503 : 200,
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  })
}

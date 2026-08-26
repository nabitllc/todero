// TOD-1514 Phase 2.4: /api/health — JSON summary of the Todero stack.
// Unauthenticated — middleware has an explicit bypass for this path.
// Heartbeat state read from agent_memory_files (memory_type='heartbeat_state')
import { NextResponse } from 'next/server'
import { listRuntimes } from '@/lib/runtimes'
import { listWorktrees } from '@/lib/runtimes/worktree'
import { db, type DbResult } from '@/lib/db'
import { checkRequiredTables } from '@/lib/required-tables'
import { isMissingTableError } from '@/lib/db-http'

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
    } else if (isMissingTableError(error)) {
      // The connection itself is fine — the schema just hasn't been
      // migrated onto it yet. Report it the same honest, named way every
      // other route does (which table + the fix), never the vendor's raw
      // "schema cache" string. The full missing-table list still comes from
      // the schema preflight below; this just keeps this probe itself from
      // misreporting a missing table as a dead connection.
      result.ok = false
      result.db = { reachable: true, latencyMs: dbLatency, missingTable: 'issues', fix: 'npm run db:migrate' }
    } else {
      result.ok = false
      result.db = { reachable: false, latencyMs: dbLatency, error: error.message }
    }
  } catch (e) {
    result.ok = false
    result.db = { reachable: false, error: e instanceof Error ? e.message : String(e) }
  }

  // Schema preflight: a reachable database that is missing a table the app
  // queries is still a broken deploy. Report it with the same honesty as a
  // bad connection string — ok:false, which table, and the exact fix —
  // rather than staying green because the connection itself succeeded.
  try {
    const { missing, malformed, unprobed } = await checkRequiredTables()
    result.schema = { missingTables: missing, malformedTables: malformed, unprobedTables: unprobed }
    if (missing.length > 0) {
      result.ok = false
      result.missing = missing
      result.fix = 'npm run db:migrate'
    }
    // A table that EXISTS at the wrong shape is just as broken a deploy as one
    // that is absent, and used to report green — `agent_memory` carried the
    // daily-notes shape while /api/settings/cost-history 502'd and
    // /api/agent-pause 500'd against it. See lib/required-tables.ts.
    if (malformed.length > 0) {
      result.ok = false
      result.malformed = malformed
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

  // 503 whenever the body says ok:false, full stop — a reachable database
  // with a pending migration is still a broken deploy, and an uptime probe /
  // load balancer / readiness gate reads the status code, not the JSON body.
  // A green 200 over a body admitting missing tables would tell every
  // machine consumer this host is fine when it is not.
  return NextResponse.json(result, {
    status: result.ok === false ? 503 : 200,
    headers: { 'Cache-Control': 'no-store, no-cache, must-revalidate' },
  })
}

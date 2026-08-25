// TOD-489 repair (memory-loop-write piece) — HTTP entry point for the same
// promotion pass scripts/promote-hot-patterns.mjs runs from the CLI. Exists
// so the pass can also be triggered on a schedule (a cron route, the way the
// original script's header said "Intended to be run by KAOS during sprint
// review or on a schedule") without a shell needing to be available.
//
// Logic lives in lib/memory-loop.ts — this route and the CLI script are both
// thin callers of the same function, so the two can never drift apart.

import { NextRequest, NextResponse } from 'next/server'
import { dbUnavailableResponse, dbQueryErrorResponse } from '@/lib/db-http'
import { promoteHotPatterns, type PromotionSummary } from '@/lib/memory-loop'

export const dynamic = 'force-dynamic'

const DEFAULT_AGENTS = ['builder', 'tester', 'designer']

export async function POST(req: NextRequest) {
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable

  const secret = process.env.CRON_SECRET
  const host = req.headers.get('host') || ''
  const isLocalhost = host.includes('localhost') || host.includes('127.0.0.1')
  if (secret && !isLocalhost && req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = (await req.json().catch(() => ({}))) as { agents?: string[] }
  const agents = body.agents?.length ? body.agents : DEFAULT_AGENTS

  const results: PromotionSummary[] = []
  for (const agentId of agents) {
    results.push(await promoteHotPatterns(agentId))
  }

  // Round-2 repair: promoteHotPatterns() used to swallow a failed
  // agent_run_records read into a clean `{ rowsExamined: 0 }` summary, so
  // this route reported the same cheerful 200 whether nothing had happened
  // yet or the table did not exist at all. Surface the first real DB error
  // the same honest way GET /api/agent-run-records already does — a 424 for
  // a missing table, a 500 for anything else — instead of a false "0 rows
  // examined for a table that does not exist".
  const failed = results.find(r => r.dbError)
  if (failed?.dbError) return dbQueryErrorResponse(failed.dbError, 'agent_run_records')

  return NextResponse.json({ results })
}

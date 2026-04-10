// TOD-806: Worktree visibility endpoint.
// GET  /api/run-agent/worktrees — list active worktrees
// POST /api/run-agent/worktrees/gc — force GC of stale worktrees
import { NextRequest, NextResponse } from 'next/server'
import { listWorktrees, gcStaleWorktrees } from '@/lib/runtimes/worktree'

export async function GET() {
  const worktrees = listWorktrees()
  return NextResponse.json({
    worktrees,
    count: worktrees.length,
  })
}

export async function POST(req: NextRequest) {
  const url = new URL(req.url)
  const maxAgeHours = parseInt(url.searchParams.get('maxAgeHours') ?? '24', 10)
  const result = gcStaleWorktrees(maxAgeHours)
  return NextResponse.json(result)
}

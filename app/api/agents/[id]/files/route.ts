import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const BASE = '/Users/kemuniagent/.openclaw'

function readFile(filePath: string): string {
  try {
    return fs.readFileSync(filePath, 'utf-8')
  } catch {
    return ''
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = params.id
  // Validate agent id - only alphanum and dash
  if (!/^[a-z0-9-]+$/.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

  const workspaceDir = id === 'main'
    ? path.join(BASE, 'workspace')
    : path.join(BASE, `workspace-${id}`)

  const soul = readFile(path.join(workspaceDir, 'SOUL.md'))
  const heartbeat = readFile(path.join(workspaceDir, 'HEARTBEAT.md'))
  const agents = readFile(path.join(workspaceDir, 'AGENTS.md'))

  return NextResponse.json(
    { soul, heartbeat, agents },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}

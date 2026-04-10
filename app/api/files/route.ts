import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

// TOD-798: kaos-config is the canonical workspace since 2026-04-09.
// Do not revert to .openclaw/workspace — that path was moved and will not exist.
const WORKSPACE = '/Users/kemuniagent/kaos-config'

export async function GET(req: NextRequest) {
  const sub = new URL(req.url).searchParams.get('path') || ''
  const dir = path.join(WORKSPACE, sub)
  // Security: must stay within workspace
  if (!dir.startsWith(WORKSPACE)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.'))
      .map(e => ({ name: e.name, isDir: e.isDirectory(), path: path.join(sub, e.name) }))
    return NextResponse.json(entries)
  } catch {
    return NextResponse.json([])
  }
}

export async function POST(req: NextRequest) {
  // Read a file's content
  const { path: filePath } = await req.json()
  const abs = path.join(WORKSPACE, filePath)
  if (!abs.startsWith(WORKSPACE)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  try {
    const content = fs.readFileSync(abs, 'utf-8')
    return NextResponse.json({ content: content.slice(0, 32768) })
  } catch {
    return NextResponse.json({ error: 'Could not read file' }, { status: 500 })
  }
}

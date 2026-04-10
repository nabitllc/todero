import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

// TOD-798: kaos-config is the canonical workspace since 2026-04-09.
// Do not revert to .openclaw/workspace — that path was moved and will not exist.
const WORKSPACE = '/Users/kemuniagent/kaos-config'

export async function GET(req: NextRequest) {
  const sub = new URL(req.url).searchParams.get('path') || ''
  const abs = path.join(WORKSPACE, sub)
  // Security: must stay within workspace
  if (!abs.startsWith(WORKSPACE)) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  try {
    // If path is a file, return its contents as plain text (not JSON).
    // This is how Michael's link `?path=docs/todero-workflow-graph.md` renders.
    const stat = fs.statSync(abs)
    if (stat.isFile()) {
      const content = fs.readFileSync(abs, 'utf8')
      const ext = path.extname(abs).toLowerCase()
      const contentType = ext === '.md' ? 'text/markdown; charset=utf-8'
        : ext === '.json' ? 'application/json; charset=utf-8'
        : ext === '.ts' || ext === '.js' || ext === '.tsx' || ext === '.jsx' ? 'text/plain; charset=utf-8'
        : 'text/plain; charset=utf-8'
      return new NextResponse(content, {
        status: 200,
        headers: { 'Content-Type': contentType, 'Cache-Control': 'no-store' },
      })
    }
    // Directory listing (original behavior)
    const entries = fs.readdirSync(abs, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.'))
      .map(e => ({ name: e.name, isDir: e.isDirectory(), path: path.join(sub, e.name) }))
    return NextResponse.json(entries)
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'not found' }, { status: 404 })
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

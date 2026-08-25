import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { WORKSPACE_DIR } from '@/lib/paths'

// TOD-798: todero/config is the canonical workspace since 2026-04-09.
// Do not revert to .openclaw/workspace — that path was moved and will not exist.
// The location itself is host-dependent, so it resolves through lib/paths
// (TODERO_WORKSPACE_DIR) instead of naming one developer's home directory.
const WORKSPACE = path.resolve(WORKSPACE_DIR)

/**
 * Join a caller-supplied relative path onto the workspace and confirm the
 * result is still inside it. Uses path.relative rather than a string prefix
 * check so it is correct with mixed separators on Windows.
 */
function resolveInsideWorkspace(sub: string): string | null {
  const abs = path.resolve(WORKSPACE, sub)
  const rel = path.relative(WORKSPACE, abs)
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null
  return abs
}

/** One directory entry as the browser renders it. */
type FileEntry = { name: string; isDir: boolean; path: string }

/**
 * Every directory response has this shape — success and failure alike — so the
 * UI can always tell "this host is not configured" apart from "this folder is
 * empty" instead of both collapsing into an empty array.
 */
type ListingResponse = {
  entries: FileEntry[]
  workspace: string
  configured: boolean
  error: string | null
}

function listing(body: ListingResponse, status = 200) {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function GET(req: NextRequest) {
  const sub = new URL(req.url).searchParams.get('path') || ''
  const abs = resolveInsideWorkspace(sub)
  if (!abs) {
    return listing(
      { entries: [], workspace: WORKSPACE, configured: true, error: 'forbidden' },
      403
    )
  }

  // A host that has never been configured simply has no workspace. That is an
  // empty browser, not a server error — report it honestly instead of 500/404.
  if (!fs.existsSync(WORKSPACE)) {
    return listing({
      entries: [],
      workspace: WORKSPACE,
      configured: false,
      error: 'Workspace directory does not exist. Set TODERO_WORKSPACE_DIR.',
    })
  }

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
    // Directory listing (original behavior).
    // Child paths are always '/'-joined: they go straight back into a query
    // string, and path.join would emit backslashes on Windows.
    const prefix = sub.replace(/\\/g, '/').replace(/\/+$/, '')
    const entries: FileEntry[] = fs.readdirSync(abs, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.'))
      .map(e => ({ name: e.name, isDir: e.isDirectory(), path: prefix ? `${prefix}/${e.name}` : e.name }))
    return listing({ entries, workspace: WORKSPACE, configured: true, error: null })
  } catch (err) {
    // The workspace root exists but this sub-path does not (or is unreadable).
    // Still the configured host — surface the real fs message, not a guess.
    return listing(
      {
        entries: [],
        workspace: WORKSPACE,
        configured: true,
        error: err instanceof Error ? err.message : 'not found',
      },
      404
    )
  }
}

export async function POST(req: NextRequest) {
  // Read a file's content
  const { path: filePath } = await req.json()
  const abs = resolveInsideWorkspace(filePath ?? '')
  if (!abs) return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  try {
    const content = fs.readFileSync(abs, 'utf-8')
    return NextResponse.json({ content: content.slice(0, 32768) })
  } catch (err) {
    // Report what the filesystem actually said (ENOENT / EACCES / EISDIR) so an
    // operator can act on it. 'Could not read file' hid every one of these.
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err), workspace: WORKSPACE },
      { status: 500 }
    )
  }
}

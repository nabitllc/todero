import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'
import { withPermission } from '@/lib/with-permission'

// TOD-798: todero/config is the canonical workspace since 2026-04-09.
// Do not revert to .openclaw/workspace — that path was moved and will not exist.
const MEMORY_DIR = '/Users/kemuniagent/todero/config/memory'

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function parseEntries(content: string) {
  // Split on ## headings — each becomes a journal entry
  // First element is the H1 header block — skip it
  const sections = content.split(/^## /m).filter(Boolean).slice(1)
  return sections.map(section => {
    const lines = section.split('\n')
    const title = lines[0].trim()
    const body = lines.slice(1).join('\n').trim()
    // Extract bullet points as sub-items
    const bullets = body.split('\n')
      .filter(l => l.trim().startsWith('-'))
      .map(l => l.replace(/^[\s-]+/, '').trim())
    return { title, body, bullets }
  })
}

function groupLabel(filename: string): 'today' | 'yesterday' | 'week' | 'month' | 'older' {
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const yest  = new Date(now.getTime() - 86400000).toISOString().slice(0, 10)
  const week  = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10)
  const month = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10)
  const d = filename.replace('.md', '').slice(0, 10)
  if (d === today)  return 'today'
  if (d === yest)   return 'yesterday'
  if (d >= week)    return 'week'
  if (d >= month)   return 'month'
  return 'older'
}

function friendlyDate(filename: string) {
  const d = filename.replace('.md', '').slice(0, 10)
  try {
    return new Date(d + 'T12:00:00').toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric'
    })
  } catch { return d }
}

// withPermission('memory:read') ensures only roles with memory:read can access this endpoint.
// Unauthenticated callers receive 403 with {error:"forbidden", code:"PERMISSION_DENIED", message:"..."}.
// See docs/permission-middleware.md for the full usage guide.
export const GET = withPermission('memory:read', async (_req: NextRequest) => {
  try {
    if (!fs.existsSync(MEMORY_DIR)) return NextResponse.json({ files: [] })

    const files = fs.readdirSync(MEMORY_DIR)
      .filter(f => f.endsWith('.md'))
      .sort()
      .reverse()
      .slice(0, 30)
      .map(filename => {
        const full = fs.readFileSync(path.join(MEMORY_DIR, filename), 'utf-8')
        const stat = fs.statSync(path.join(MEMORY_DIR, filename))
        const words = wordCount(full)
        const kb = (stat.size / 1024).toFixed(1)
        const entries = parseEntries(full)
        const group = groupLabel(filename)
        const label = friendlyDate(filename)
        // First H1 line as title
        const h1 = full.match(/^#\s+(.+)/m)
        const title = h1 ? h1[1].trim() : label

        return {
          filename,
          date: filename.replace('.md', '').slice(0, 10),
          label,
          title,
          group,
          words,
          kb,
          modifiedMs: stat.mtimeMs,
          entries,
          preview: full.slice(0, 400),
        }
      })

    return NextResponse.json({ files })
  } catch (e) {
    return NextResponse.json({ files: [], error: String(e) })
  }
})

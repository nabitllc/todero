import { NextRequest, NextResponse } from 'next/server'
import { withPermission } from '@/lib/rbac-middleware'
import { db } from '@/lib/db'
import { dbErrorResponse, dbUnavailableResponse } from '@/lib/db-http'

// Memory is now read from Supabase agent_memory_files (AGENT_CONTEXT_SOURCE=db).
// FS fallback removed — getFromFS() was dead code once DB mode was activated.

function wordCount(text: string) {
  return text.trim().split(/\s+/).filter(Boolean).length
}

function parseEntries(content: string) {
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

export async function GET(req: NextRequest) {
  const REQUIRED_PERMISSION = 'memory:read' as const
  const denied = await withPermission(REQUIRED_PERMISSION)(req)
  if (denied) return denied
  const unavailable = dbUnavailableResponse()
  if (unavailable) return unavailable
  return getFromDB()
}

async function getFromDB() {
  try {
    const { data, error } = await db()
      .from('agent_memory_files')
      .select('date_key,content,updated_at')
      .eq('agent_id', 'global')
      .eq('memory_type', 'daily')
      .order('date_key', { ascending: false })
      .limit(30)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as Array<{ date_key: string; content: string; updated_at: string }>

    const now = new Date()
    const today = now.toISOString().slice(0, 10)
    const yest  = new Date(now.getTime() - 86400000).toISOString().slice(0, 10)
    const week  = new Date(now.getTime() - 7 * 86400000).toISOString().slice(0, 10)
    const month = new Date(now.getTime() - 30 * 86400000).toISOString().slice(0, 10)

    const groupLabelDB = (d: string): 'today' | 'yesterday' | 'week' | 'month' | 'older' => {
      if (d === today)  return 'today'
      if (d === yest)   return 'yesterday'
      if (d >= week)    return 'week'
      if (d >= month)   return 'month'
      return 'older'
    }

    const files = rows.map(row => {
      const words = row.content.trim().split(/\s+/).filter(Boolean).length
      const kb = (new TextEncoder().encode(row.content).length / 1024).toFixed(1)
      const h1 = row.content.match(/^#\s+(.+)/m)
      const label = new Date(row.date_key + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
      const sections = row.content.split(/^## /m).filter(Boolean).slice(1)
      const entries = sections.map(s => {
        const lines = s.split('\n')
        const title = lines[0].trim()
        const body = lines.slice(1).join('\n').trim()
        const bullets = body.split('\n').filter(l => l.trim().startsWith('-')).map(l => l.replace(/^[\s-]+/, '').trim())
        return { title, body, bullets }
      })
      return {
        filename: `${row.date_key}.md`,
        date: row.date_key,
        label,
        title: h1 ? h1[1].trim() : label,
        group: groupLabelDB(row.date_key),
        words,
        kb,
        modifiedMs: new Date(row.updated_at).getTime(),
        entries,
        preview: row.content.slice(0, 400),
      }
    })

    return NextResponse.json({ files })
  } catch (e) {
    // Never answer 200 with an empty list when the read failed — an empty array
    // and "there is no memory" are different facts, and the caller cannot tell
    // them apart. A missing credential names its variable; anything else is 500.
    const unconfigured = dbErrorResponse(e)
    if (unconfigured) return unconfigured
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    )
  }
}


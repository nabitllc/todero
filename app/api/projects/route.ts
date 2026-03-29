import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const SUPA = 'https://twthgapiouiqhavrcnry.supabase.co'
const KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'

export async function GET() {
  // Base project definitions
  const baseProjects = [
    { id:'vespera', name:'Vespera Sprint', desc:'Colombia Goth Community', emoji:'🦇', startDate:'2026-03-22', deadline:'2026-03-29', totalDays:7, color:'#a855f7', borderColor:'border-purple-900/30', bg:'#0f0a14', bgDark:'#0f0a14', supabaseProject:'Vespera' },
    { id:'kemuni', name:'Kemuni Launch', desc:'Community & Property SaaS', emoji:'🚀', startDate:'2026-03-21', deadline:'2026-04-20', totalDays:30, color:'#3b82f6', borderColor:'border-blue-900/30', bg:'#0a0f14', bgDark:'#0a0f14', supabaseProject:'Kemuni' },
    { id:'mission-control', name:'Mission Control', desc:'Internal Dashboard', emoji:'🧠', startDate:'2026-03-21', deadline:'2026-04-30', totalDays:40, color:'#10b981', borderColor:'border-emerald-900/30', bg:'#0a140f', bgDark:'#0a140f', supabaseProject:'Mission Control' },
    { id:'infrastructure', name:'Infrastructure', desc:'Agent System & Ops', emoji:'⚙️', startDate:'2026-03-21', deadline:'2026-04-30', totalDays:40, color:'#6b7280', borderColor:'border-zinc-800/60', bg:'#0f0f0f', bgDark:'#0f0f0f', supabaseProject:'Infrastructure' },
  ]

  // Fetch task counts per project
  try {
    const res = await fetch(
      `${SUPA}/rest/v1/issues?select=project,status&limit=1000`,
      { headers: { apikey: KEY, Authorization: `Bearer ${KEY}` }, cache: 'no-store' }
    )
    if (res.ok) {
      const tasks: any[] = await res.json()
      const counts: Record<string, { total: number; done: number; inProgress: number; open: number }> = {}
      for (const t of tasks) {
        const p = t.project || 'Unknown'
        if (!counts[p]) counts[p] = { total: 0, done: 0, inProgress: 0, open: 0 }
        counts[p].total++
        if (t.status === 'done' || t.status === 'closed') counts[p].done++
        else if (t.status === 'in_progress' || t.status === 'in_review') counts[p].inProgress++
        else if (t.status === 'open' || t.status === 'backlog') counts[p].open++
      }
      const enriched = baseProjects.map(p => ({
        ...p,
        taskCounts: counts[p.supabaseProject] ?? { total: 0, done: 0, inProgress: 0, open: 0 },
        taskProgress: counts[p.supabaseProject]
          ? Math.round((counts[p.supabaseProject].done / Math.max(counts[p.supabaseProject].total, 1)) * 100)
          : 0,
      }))
      return NextResponse.json(enriched, { headers: { 'Cache-Control': 'no-store' } })
    }
  } catch { /* fallback */ }

  // Fallback: try static file, else return base
  try {
    const filePath = path.join(process.cwd(), 'data', 'projects.json')
    const raw = fs.readFileSync(filePath, 'utf-8')
    return NextResponse.json(JSON.parse(raw), { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json(baseProjects, { headers: { 'Cache-Control': 'no-store' } })
  }
}

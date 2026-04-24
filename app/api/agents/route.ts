import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { exec } from 'child_process'
import { promisify } from 'util'
import { readFileSync } from 'fs'
import { join } from 'path'

const execAsync = promisify(exec)

const SUPABASE_URL = 'https://twthgapiouiqhavrcnry.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Maps agent IDs to UI display metadata — emoji, color, capabilities, floor, queue_filter
// model and role are sourced from AGENTS.md; values here serve as fallback only
const AGENT_META: Record<string, { name: string; emoji: string; role: string; color: string; capabilities: string[]; floor: boolean; model: string; queue_filter: string[] }> = {
  'main':        { name: 'KAOS',        emoji: '🧠', role: 'Chief Orchestrator',   color: '#6b7280', capabilities: ['Orchestration', 'Memory', 'Strategy', 'Comms', 'Delegation'], floor: true,  model: 'claude-sonnet-4-6', queue_filter: [] },
  'scout':       { name: 'Scout',       emoji: '🔍', role: 'Research Agent',        color: '#a855f7', capabilities: ['Web Research', 'Summarization', 'Trends'], floor: true,                   model: 'claude-sonnet-4-6', queue_filter: ['open'] },
  'ops':         { name: 'Ingo',        emoji: '⚙️', role: 'Infrastructure Watchdog', color: '#10b981', capabilities: ['Infrastructure', 'Monitoring', 'Alerts'], floor: true,                  model: 'claude-haiku-4-5',  queue_filter: ['open'] },
  'kemuni-sme':  { name: 'Kemuni SME',  emoji: '🚀', role: 'Kemuni Product Expert', color: '#3b82f6', capabilities: ['Product Strategy', 'Kemuni', 'PropTech'], floor: true,                   model: 'claude-sonnet-4-6', queue_filter: [] },
  'vespera-sme': { name: 'Vespera SME', emoji: '🖤', role: 'Vespera Product Expert', color: '#ec4899', capabilities: ['Product Strategy', 'Vespera', 'Community'], floor: true,                model: 'claude-sonnet-4-6', queue_filter: [] },
  'builder':     { name: 'Builder',     emoji: '🔨', role: 'Coding Agent',           color: '#f59e0b', capabilities: ['Coding', 'PRs', 'Refactoring', 'Next.js', 'Supabase'], floor: true,     model: 'claude-sonnet-4-6', queue_filter: ['open'] },
  'tester':      { name: 'Tester',      emoji: '🧪', role: 'QA Agent',               color: '#06b6d4', capabilities: ['Code Review', 'QA', 'Test Suites', 'DoD Enforcement'], floor: true,     model: 'claude-haiku-4-5',  queue_filter: ['code_review'] },
  'deployer':    { name: 'Deployer',    emoji: '🚀', role: 'Deploy Agent',            color: '#8b5cf6', capabilities: ['Deployments', 'Webhooks', 'Release Notes'], floor: true,                model: 'claude-haiku-4-5',  queue_filter: ['approved'] },
  'ux':          { name: 'UX Designer',     emoji: '🎨', role: 'UX & Design Agent',       color: '#ec4899', capabilities: ['UI Review', 'Mobile UX', 'Design System', 'Accessibility'], floor: false, model: 'claude-sonnet-4-6', queue_filter: [] },
  'designer':    { name: 'Designer',        emoji: '🖌️', role: 'Design Review Agent',     color: '#d946ef', capabilities: ['Design System', 'UI Review', 'Visual QA', 'Accessibility'], floor: false, model: 'claude-haiku-4-5',  queue_filter: ['code_review'] },
  'po':          { name: 'Product Owner',   emoji: '📋', role: 'Product Owner',            color: '#f59e0b', capabilities: ['PRDs', 'Backlog Grooming', 'Sprint Facilitation', 'DoR'], floor: false,  model: 'claude-sonnet-4-6', queue_filter: ['defined'] },
  'growth':      { name: 'Growth',          emoji: '📈', role: 'Growth Strategist',        color: '#10b981', capabilities: ['Monetization', 'GTM', 'Pricing', 'LATAM'], floor: false,           model: 'claude-sonnet-4-6', queue_filter: [] },
  'security':    { name: 'Security',        emoji: '🔐', role: 'Security Auditor',         color: '#ef4444', capabilities: ['OWASP', 'Auth Review', 'RLS Audit', 'CVE Scanning'], floor: false,   model: 'claude-sonnet-4-6', queue_filter: [] },
  'community':   { name: 'Community Mgr',   emoji: '🖤', role: 'Community Manager',        color: '#a78bfa', capabilities: ['Social Content', 'Brand Voice', 'Colombia Goth'], floor: false,      model: 'claude-sonnet-4-6', queue_filter: [] },
  'content':     { name: 'Content Creator', emoji: '✍️', role: 'Content Creator',          color: '#60a5fa', capabilities: ['Blog', 'SEO', 'Email', 'Help Docs'], floor: false,                  model: 'claude-sonnet-4-6', queue_filter: [] },
  'auditor':     { name: 'Auditor',     emoji: '🔎', role: 'System Truth Enforcer',  color: '#ef4444', capabilities: ['Drift Detection', 'Config Audit', 'Task Hygiene'], floor: true,            model: 'claude-sonnet-4-6', queue_filter: ['released'] },
}

interface ParsedAgent {
  id: string
  name: string
  role: string
  model: string
}

// Parse the Agent Roster table from kaos-config/AGENTS.md at request time.
// This is the authoritative source for id, name, role, and model.
const AGENTS_MD_PATH = join(process.env.HOME ?? '/Users/kemuniagent', 'kaos-config', 'AGENTS.md')

function parseAgentsFromMd(): ParsedAgent[] {
  const content = readFileSync(AGENTS_MD_PATH, 'utf-8')
  const lines = content.split('\n')
  const headerIdx = lines.findIndex(l => /\|\s*Agent\s*\|\s*Model\s*\|\s*Notes\s*\|/i.test(l))
  if (headerIdx === -1) throw new Error('Agent Roster table not found in AGENTS.md')
  const agents: ParsedAgent[] = []
  // Skip header + separator
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line.startsWith('|')) break
    const cols = line.split('|').map(c => c.trim()).filter(Boolean)
    if (cols.length < 3) continue
    const [agentCol, modelCol, notesCol] = cols
    // "main (KAOS)" → id="main", name="KAOS"; "builder" → id="builder", name="Builder"
    const parenMatch = agentCol.match(/^(.+?)\s*\((.+?)\)$/)
    const id = parenMatch ? parenMatch[1].trim().toLowerCase() : agentCol.toLowerCase()
    const name = parenMatch ? parenMatch[2].trim() : agentCol.charAt(0).toUpperCase() + agentCol.slice(1)
    agents.push({ id, name, role: notesCol, model: modelCol })
  }
  if (agents.length === 0) throw new Error('No agents parsed from AGENTS.md roster table')
  return agents
}

export async function GET() {
  // Parse AGENTS.md first — fail fast with 500 if it can't be read/parsed
  let parsedAgents: ParsedAgent[]
  try {
    parsedAgents = parseAgentsFromMd()
  } catch (e: any) {
    return NextResponse.json(
      { error: `Failed to parse AGENTS.md: ${e.message}` },
      { status: 500, headers: { 'Cache-Control': 'no-store' } }
    )
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
    const now = Date.now()

    // 1. Fetch issues that are actively being worked on (in_progress, code_review)
    const { data: activeIssues } = await supabase
      .from('issues')
      .select('task_key, title, status, assignee, worked_by, updated_at, started_at')
      .in('status', ['open', 'in_progress', 'code_review', 'product_review', 'approved'])
      .order('updated_at', { ascending: false })
      .limit(50)

    // 2. Fetch recent agent_runs for last-activity tracking
    const { data: recentRuns } = await supabase
      .from('agent_runs')
      .select('agent_id, started_at, completed_at, status')
      .order('started_at', { ascending: false })
      .limit(50)

    // Build lookup: agent → most recent activity timestamp
    const agentLastActive: Record<string, number> = {}
    for (const run of recentRuns ?? []) {
      const ts = new Date(run.completed_at ?? run.started_at).getTime()
      if (!agentLastActive[run.agent_id] || ts > agentLastActive[run.agent_id]) {
        agentLastActive[run.agent_id] = ts
      }
    }

    // Build lookup: agent → current issue (prefer in_progress over review statuses)
    const agentIssue: Record<string, { key: string; title: string; status: string; startedAt: number | null }> = {}
    // Sort: in_progress first, then code_review, then product_review
    const statusPriority = (s: string) => s === 'in_progress' ? 0 : s === 'code_review' ? 1 : s === 'product_review' ? 2 : s === 'open' ? 3 : 4
    const sortedIssues = [...(activeIssues ?? [])].sort((a, b) => statusPriority(a.status) - statusPriority(b.status))
    for (const iss of sortedIssues) {
      const owner = iss.worked_by || iss.assignee
      if (owner && !agentIssue[owner]) {
        // started_at: when agent started working on THIS issue (reset on assignee/status change)
        // Fall back to updated_at if started_at is null
        const startedAt = iss.started_at ? new Date(iss.started_at).getTime()
                        : iss.updated_at ? new Date(iss.updated_at).getTime()
                        : null
        agentIssue[owner] = {
          key: iss.task_key ?? '?',
          title: iss.title ?? '',
          status: iss.status ?? '',
          startedAt,
        }
      }
      // Track activity from issue updates for all issues
      if (owner) {
        const issTs = new Date(iss.updated_at).getTime()
        if (!agentLastActive[owner] || issTs > agentLastActive[owner]) {
          agentLastActive[owner] = issTs
        }
      }
    }

    // 3. Check for running claude CLI agent processes (real-time detection)
    // Only match spawned agent sessions, NOT the main Claude Desktop session
    const runningAgents = new Set<string>()
    try {
      const { stdout } = await execAsync(
        'ps aux | grep "[c]laude" | grep -v "Claude.app" | grep -v "disclaimer" | grep -v "ShipIt"',
        { timeout: 3000 }
      )
      const lines = stdout.trim().split('\n').filter(Boolean)
      for (const line of lines) {
        // Only match lines that contain explicit agent identifiers (from spawn commands)
        const lower = line.toLowerCase()
        if (lower.includes('you are builder') || lower.includes('agent builder')) runningAgents.add('builder')
        else if (lower.includes('you are tester') || lower.includes('agent tester')) runningAgents.add('tester')
        else if (lower.includes('you are ops') || lower.includes('agent ops')) runningAgents.add('ops')
        else if (lower.includes('you are scout') || lower.includes('agent scout')) runningAgents.add('scout')
        else if (lower.includes('you are deployer') || lower.includes('agent deployer')) runningAgents.add('deployer')
        else if (lower.includes('you are designer') || lower.includes('agent designer')) runningAgents.add('designer')
        else if (lower.includes('you are po') || lower.includes('agent po')) runningAgents.add('po')
      }
    } catch { /* no agent processes running */ }

    // 4. Build agent list:
    //    - AGENTS.md roster is authoritative for id/name/role/model
    //    - AGENT_META provides emoji/color/capabilities/floor/queue_filter overrides
    //    - Agents in AGENT_META but not in AGENTS.md are deprecated (active=false)
    const agentMdIds = new Set(parsedAgents.map(a => a.id))
    const allIdSet = new Set([...parsedAgents.map(a => a.id), ...Object.keys(AGENT_META)])
    const allIds = Array.from(allIdSet)

    const agents = allIds.map(id => {
      const parsed = parsedAgents.find(a => a.id === id)
      const meta = AGENT_META[id]
      const inAgentsMd = agentMdIds.has(id)

      const issue = agentIssue[id]
      const lastTs = agentLastActive[id] ?? 0
      const agoMin = lastTs ? Math.round((now - lastTs) / 60000) : null

      const isRunning = runningAgents.has(id)
      const hasInProgressIssue = !!issue && issue.status === 'in_progress'
      // Deprecated agents (not in AGENTS.md) are never active
      const isActive = inAgentsMd && (isRunning || hasInProgressIssue)
      const isScheduled = inAgentsMd && id === 'ops' && !isActive

      // Compute next scheduled run based on fixed 30-min intervals anchored to the hour
      // Ops heartbeat fires at :00 and :30 of every hour (fixed schedule, not relative)
      let nextRunTs: number | null = null
      if (isScheduled) {
        const d = new Date(now)
        const min = d.getMinutes()
        const nextMin = min < 30 ? 30 : 60
        const msUntilNext = (nextMin - min) * 60 * 1000 - d.getSeconds() * 1000 - d.getMilliseconds()
        nextRunTs = now + msUntilNext
      }

      const model = parsed?.model ?? meta?.model ?? ''
      const role = parsed?.role ?? meta?.role ?? ''

      return {
        id,
        name: meta?.name ?? parsed?.name ?? id,
        emoji: meta?.emoji ?? '🤖',
        role,
        model,
        active: isActive,
        status: isActive ? 'active' : isScheduled ? 'scheduled' : 'idle',
        isRunning,
        nextRunTs,
        modelShort: model.includes('haiku') ? 'Haiku 4.5' : 'Sonnet 4.6',
        queue_filter: meta?.queue_filter ?? [],
        color: meta?.color ?? '#6b7280',
        desc: role,
        capabilities: meta?.capabilities ?? [],
        floor: meta?.floor ?? false,
        workspace: null,
        sessions: 0,
        ago: agoMin,
        lastUpdatedAt: lastTs,
        currentTask: issue ? `${issue.key}: ${issue.title}`.slice(0, 80) : null,
        workStartedAt: issue?.startedAt ?? null,
      }
    })

    return NextResponse.json(agents, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return NextResponse.json([], { headers: { 'Cache-Control': 'no-store' } })
  }
}

// INF-237: Agent capability registry — persist capabilities to Supabase agent_memory
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { agent_id, capabilities, role, description } = body
    if (!agent_id) return NextResponse.json({ error: 'agent_id required' }, { status: 400 })

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
    const value = JSON.stringify({
      capabilities: capabilities ?? [],
      role: role ?? null,
      description: description ?? null,
      updated_at: new Date().toISOString(),
    })
    const { error } = await supabase.from('agent_memory').upsert(
      { agent_id, key: 'capability_registry', value },
      { onConflict: 'agent_id,key' }
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// INF-237: Update agent capabilities
export async function PATCH(req: NextRequest) {
  try {
    const body = await req.json()
    const { agent_id, capabilities, role, description, floor } = body
    if (!agent_id) return NextResponse.json({ error: 'agent_id required' }, { status: 400 })

    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

    // Read existing
    const { data: existing } = await supabase
      .from('agent_memory')
      .select('value')
      .eq('agent_id', agent_id)
      .eq('key', 'capability_registry')
      .single()

    const current = existing?.value ? (typeof existing.value === 'string' ? JSON.parse(existing.value) : existing.value) : {}
    const merged = {
      ...current,
      ...(capabilities !== undefined ? { capabilities } : {}),
      ...(role !== undefined ? { role } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(floor !== undefined ? { floor } : {}),
      updated_at: new Date().toISOString(),
    }

    const { error } = await supabase.from('agent_memory').upsert(
      { agent_id, key: 'capability_registry', value: JSON.stringify(merged) },
      { onConflict: 'agent_id,key' }
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, data: merged })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

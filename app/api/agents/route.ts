import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

const SUPABASE_URL = 'https://twthgapiouiqhavrcnry.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InR3dGhnYXBpb3VpcWhhdnJjbnJ5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDUzMTY3NiwiZXhwIjoyMDkwMTA3Njc2fQ.EyNdtvECdcHx3RuaizdfLGNRY4OJotzjE2QeOQ9Yf4Q'

// Maps OpenClaw agent IDs to display metadata
const AGENT_META: Record<string, { name: string; emoji: string; role: string; color: string; capabilities: string[]; floor: boolean; [key: string]: any }> = {
  'main':        { name: 'KAOS',        emoji: '🧠', role: 'Chief Orchestrator',   color: '#6b7280', capabilities: ['Orchestration', 'Memory', 'Strategy', 'Comms', 'Delegation'], floor: true },
  'scout':       { name: 'Scout',       emoji: '🔍', role: 'Research Agent',        color: '#a855f7', capabilities: ['Web Research', 'Summarization', 'Trends'], floor: true },
  'ops':         { name: 'Ops',         emoji: '⚙️', role: 'Infrastructure Watchdog', color: '#10b981', capabilities: ['Infrastructure', 'Monitoring', 'Alerts'], floor: true },
  'kemuni-sme':  { name: 'Kemuni SME',  emoji: '🚀', role: 'Kemuni Product Expert', color: '#3b82f6', capabilities: ['Product Strategy', 'Kemuni', 'PropTech'], floor: true },
  'vespera-sme': { name: 'Vespera SME', emoji: '🖤', role: 'Vespera Product Expert', color: '#ec4899', capabilities: ['Product Strategy', 'Vespera', 'Community'], floor: true },
  'builder':     { name: 'Builder',     emoji: '🔨', role: 'Coding Agent',           color: '#f59e0b', capabilities: ['Coding', 'PRs', 'Refactoring', 'Next.js', 'Supabase'], floor: true },
  'tester':      { name: 'Tester',      emoji: '🧪', role: 'QA Agent',               color: '#06b6d4', capabilities: ['Code Review', 'QA', 'Test Suites', 'DoD Enforcement'], floor: true },
  'deployer':    { name: 'Deployer',    emoji: '🚀', role: 'Deploy Agent',            color: '#8b5cf6', capabilities: ['Deployments', 'Webhooks', 'Release Notes'], floor: true },
  'ux':          { name: 'UX Designer',      emoji: '🎨', role: 'UX & Design Agent',        color: '#ec4899', capabilities: ['UI Review', 'Mobile UX', 'Design System', 'Accessibility'], floor: false },
  'designer':    { name: 'Designer',        emoji: '🖌️', role: 'Design Review Agent',      color: '#d946ef', capabilities: ['Design System', 'UI Review', 'Visual QA', 'Accessibility'], floor: false },
  'po':          { name: 'Product Owner',    emoji: '📋', role: 'Product Owner',             color: '#f59e0b', capabilities: ['PRDs', 'Backlog Grooming', 'Sprint Facilitation', 'DoR'], floor: false },
  'growth':      { name: 'Growth',           emoji: '📈', role: 'Growth Strategist',         color: '#10b981', capabilities: ['Monetization', 'GTM', 'Pricing', 'LATAM'], floor: false },
  'security':    { name: 'Security',         emoji: '🔐', role: 'Security Auditor',          color: '#ef4444', capabilities: ['OWASP', 'Auth Review', 'RLS Audit', 'CVE Scanning'], floor: false },
  'community':   { name: 'Community Mgr',    emoji: '🖤', role: 'Community Manager',         color: '#a78bfa', capabilities: ['Social Content', 'Brand Voice', 'Colombia Goth'], floor: false },
  'content':     { name: 'Content Creator',  emoji: '✍️', role: 'Content Creator',           color: '#60a5fa', capabilities: ['Blog', 'SEO', 'Email', 'Help Docs'], floor: false },
  'auditor':     { name: 'Auditor',     emoji: '🔎', role: 'System Truth Enforcer',  color: '#ef4444', capabilities: ['Drift Detection', 'Config Audit', 'Task Hygiene'], floor: true },
}

export async function GET() {
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)
    const now = Date.now()

    // 1. Fetch issues that are actively being worked on (in_progress, code_review)
    const { data: activeIssues } = await supabase
      .from('issues')
      .select('task_key, title, status, assignee, worked_by, updated_at')
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
    const agentIssue: Record<string, { key: string; title: string; status: string }> = {}
    // Sort: in_progress first, then code_review, then product_review
    const statusPriority = (s: string) => s === 'in_progress' ? 0 : s === 'code_review' ? 1 : s === 'product_review' ? 2 : s === 'open' ? 3 : 4
    const sortedIssues = [...(activeIssues ?? [])].sort((a, b) => statusPriority(a.status) - statusPriority(b.status))
    for (const iss of sortedIssues) {
      const owner = iss.worked_by || iss.assignee
      if (owner && !agentIssue[owner]) {
        agentIssue[owner] = { key: iss.task_key ?? '?', title: iss.title ?? '', status: iss.status ?? '' }
      }
      // Track activity from issue updates for all issues
      if (owner) {
        const issTs = new Date(iss.updated_at).getTime()
        if (!agentLastActive[owner] || issTs > agentLastActive[owner]) {
          agentLastActive[owner] = issTs
        }
      }
    }

    // 3. Check for running claude CLI processes (real-time detection)
    const runningAgents = new Set<string>()
    try {
      const { stdout } = await execAsync('ps aux | grep "[c]laude" | grep -v "grep"', { timeout: 3000 })
      const lines = stdout.trim().split('\n').filter(Boolean)
      for (const line of lines) {
        for (const agentId of Object.keys(AGENT_META)) {
          if (line.toLowerCase().includes(agentId) || line.includes(`agent ${agentId}`)) {
            runningAgents.add(agentId)
          }
        }
      }
      // If claude processes exist but none matched a specific agent, attribute to builder
      if (lines.length > 0 && runningAgents.size === 0) {
        runningAgents.add('builder')
      }
    } catch { /* no claude processes running */ }

    // 4. Build agent list from AGENT_META + active issue data + process status
    const agents = Object.entries(AGENT_META).map(([id, meta]) => {
      const issue = agentIssue[id]
      const lastTs = agentLastActive[id] ?? 0
      const agoMin = lastTs ? Math.round((now - lastTs) / 60000) : null

      // Agent is "active" if they have a running process OR assigned work in the pipeline
      const isRunning = runningAgents.has(id)
      const hasActiveIssue = !!issue
      const isActive = isRunning || hasActiveIssue
      const isScheduled = id === 'ops' && !isActive

      // Compute next scheduled run timestamp for scheduled agents (ops = heartbeat every 30min)
      let nextRunTs: number | null = null
      if (isScheduled && lastTs > 0) {
        nextRunTs = lastTs + 30 * 60 * 1000
        if (nextRunTs < now) nextRunTs = now + 30 * 60 * 1000 // if overdue, assume next window
      } else if (isScheduled) {
        nextRunTs = now + 30 * 60 * 1000
      }

      return {
        id,
        name: meta.name,
        emoji: meta.emoji,
        role: meta.role,
        status: isActive ? 'active' : isScheduled ? 'scheduled' : 'idle',
        isRunning,
        nextRunTs,
        model: 'anthropic/claude-sonnet-4-6',
        modelShort: 'Sonnet 4.6',
        color: meta.color,
        desc: meta.role,
        capabilities: meta.capabilities,
        floor: meta.floor,
        workspace: null,
        sessions: 0,
        ago: agoMin,
        lastUpdatedAt: lastTs,
        currentTask: issue ? `${issue.key}: ${issue.title}`.slice(0, 80) : null,
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

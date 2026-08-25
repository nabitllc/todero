import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { processListCommand } from '@/lib/paths'
import { AGENT_META, parseAgentsFromMd, type ParsedAgent } from '@/lib/agent-roster'

const execFileAsync = promisify(execFile)

const SUPABASE_URL = 'https://twthgapiouiqhavrcnry.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!


/**
 * Every running process's command line. `ps aux | grep ...` is a POSIX-only
 * pipeline, so the command comes from lib/paths; a host where the lookup fails
 * simply reports no running agents rather than breaking the endpoint.
 */
async function listProcessCommandLines(): Promise<string[]> {
  const { command, args } = processListCommand()
  try {
    const { stdout } = await execFileAsync(command, args, {
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    })
    return stdout.split(/\r?\n/).filter(Boolean)
  } catch {
    return []
  }
}

export async function GET() {
  // AGENTS.md is the preferred roster, but it is a host artifact: a fresh clone
  // on another machine may have none. Missing/unparseable is not a server error
  // — fall back to the built-in registry and say so via `rosterSource`.
  let parsedAgents: ParsedAgent[] = []
  let rosterSource: 'agents-md' | 'builtin' = 'builtin'
  let rosterWarning: string | null = null
  try {
    parsedAgents = parseAgentsFromMd()
    rosterSource = 'agents-md'
  } catch (e) {
    rosterWarning = e instanceof Error ? e.message : String(e)
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
    {
      const processLines = await listProcessCommandLines()
      for (const line of processLines) {
        const lower = line.toLowerCase()
        // Skip everything that is not a spawned CLI agent — the desktop app and
        // its installer helpers used to be filtered out by chained greps.
        if (!lower.includes('claude')) continue
        if (lower.includes('claude.app') || lower.includes('disclaimer') || lower.includes('shipit')) continue
        // Only match lines that contain explicit agent identifiers (from spawn commands)
        if (lower.includes('you are builder') || lower.includes('agent builder')) runningAgents.add('builder')
        else if (lower.includes('you are tester') || lower.includes('agent tester')) runningAgents.add('tester')
        else if (lower.includes('you are ops') || lower.includes('agent ops')) runningAgents.add('ops')
        else if (lower.includes('you are scout') || lower.includes('agent scout')) runningAgents.add('scout')
        else if (lower.includes('you are deployer') || lower.includes('agent deployer')) runningAgents.add('deployer')
        else if (lower.includes('you are designer') || lower.includes('agent designer')) runningAgents.add('designer')
        else if (lower.includes('you are po') || lower.includes('agent po')) runningAgents.add('po')
      }
    }

    // 4. Build agent list:
    //    - AGENTS.md roster is authoritative for id/name/role/model
    //    - AGENT_META provides emoji/color/capabilities/floor/queue_filter overrides
    //    - Agents in AGENT_META but not in AGENTS.md are deprecated (active=false)
    //    - With no AGENTS.md on this host, AGENT_META *is* the roster, so every
    //      registered agent stays eligible instead of all reading as deprecated
    const agentMdIds = rosterSource === 'agents-md'
      ? new Set(parsedAgents.map(a => a.id))
      : new Set(Object.keys(AGENT_META))
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
        // Where id/name/role/model came from, so the UI never implies a roster
        // file exists when it does not.
        rosterSource,
        rosterWarning,
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

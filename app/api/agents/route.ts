import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { processListCommand } from '@/lib/paths'
import { AGENT_META, parseAgentsFromMd, type ParsedAgent } from '@/lib/agent-roster'

const execFileAsync = promisify(execFile)


/**
 * Nullable on purpose. This used to be `process.env.SUPABASE_SERVICE_ROLE_KEY!`,
 * which made the database client throw "key is required" on every host but the
 * author's — and the GET handler swallowed that into an empty 200. A machine
 * that was never configured then looked identical to a machine with no agents.
 * Keep it null-able so the route can say which one it is.
 */
const SUPABASE_KEY: string | null = process.env.SUPABASE_SERVICE_ROLE_KEY ?? null

const NO_KEY_ERROR =
  'SUPABASE_SERVICE_ROLE_KEY is not set — agent run state unavailable'

const NO_STORE = { 'Cache-Control': 'no-store' } as const

type RosterSource = 'agents-md' | 'builtin'

/** One agent row as the dashboard renders it. */
type AgentDto = {
  id: string
  name: string
  emoji: string
  role: string
  model: string
  active: boolean
  status: 'active' | 'scheduled' | 'idle'
  isRunning: boolean
  nextRunTs: number | null
  modelShort: string
  queue_filter: string[]
  color: string
  desc: string
  capabilities: string[]
  floor: boolean
  workspace: string | null
  sessions: number
  ago: number | null
  lastUpdatedAt: number
  currentTask: string | null
  workStartedAt: number | null
  rosterSource: RosterSource
  rosterWarning: string | null
}

/** Live run state: from Supabase (issues/runs) plus the local process table. */
type RunState = {
  agentIssue: Record<string, { key: string; title: string; status: string; startedAt: number | null }>
  agentLastActive: Record<string, number>
  runningAgents: Set<string>
}

/**
 * Every GET response has this shape — success and failure alike — so the Team
 * tab can tell "this host is not configured" apart from "this host has no
 * agents" instead of both collapsing into an empty array.
 */
type AgentsResponse = {
  agents: AgentDto[]
  rosterSource: RosterSource
  rosterWarning: string | null
  configured: boolean
  error: string | null
}

function emptyRunState(): RunState {
  return { agentIssue: {}, agentLastActive: {}, runningAgents: new Set() }
}

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

/**
 * Which agents have a spawned CLI session right now. Purely local — needs no
 * database — so it stays truthful even on a host with no Supabase key.
 */
async function detectRunningAgents(): Promise<Set<string>> {
  const runningAgents = new Set<string>()
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
  return runningAgents
}

/**
 * Merge the roster with whatever run state was collectable.
 *   - AGENTS.md roster is authoritative for id/name/role/model
 *   - AGENT_META provides emoji/color/capabilities/floor/queue_filter overrides
 *   - Agents in AGENT_META but not in AGENTS.md are deprecated (active=false)
 *   - With no AGENTS.md on this host, AGENT_META *is* the roster, so every
 *     registered agent stays eligible instead of all reading as deprecated
 * Run state may be empty (unconfigured host); the roster is still real, so the
 * operator sees who exists next to the reason their state is not live.
 */
function buildAgents(
  parsedAgents: ParsedAgent[],
  rosterSource: RosterSource,
  rosterWarning: string | null,
  state: RunState,
): AgentDto[] {
  const now = Date.now()
  const agentMdIds = rosterSource === 'agents-md'
    ? new Set(parsedAgents.map(a => a.id))
    : new Set(Object.keys(AGENT_META))
  const allIdSet = new Set([...parsedAgents.map(a => a.id), ...Object.keys(AGENT_META)])
  const allIds = Array.from(allIdSet)

  return allIds.map((id): AgentDto => {
    const parsed = parsedAgents.find(a => a.id === id)
    const meta = AGENT_META[id]
    const inAgentsMd = agentMdIds.has(id)

    const issue = state.agentIssue[id]
    const lastTs = state.agentLastActive[id] ?? 0
    const agoMin = lastTs ? Math.round((now - lastTs) / 60000) : null

    const isRunning = state.runningAgents.has(id)
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
      // file exists when it does not. Also on the envelope; kept per-row for
      // components that only ever hold a single agent.
      rosterSource,
      rosterWarning,
    }
  })
}

export async function GET() {
  // AGENTS.md is the preferred roster, but it is a host artifact: a fresh clone
  // on another machine may have none. Missing/unparseable is not a server error
  // — fall back to the built-in registry and say so via `rosterSource`.
  let parsedAgents: ParsedAgent[] = []
  let rosterSource: RosterSource = 'builtin'
  let rosterWarning: string | null = null
  try {
    parsedAgents = parseAgentsFromMd()
    rosterSource = 'agents-md'
  } catch (e) {
    rosterWarning = e instanceof Error ? e.message : String(e)
  }

  const respond = (state: RunState, configured: boolean, error: string | null, status = 200) => {
    const body: AgentsResponse = {
      agents: buildAgents(parsedAgents, rosterSource, rosterWarning, state),
      rosterSource,
      rosterWarning,
      configured,
      error,
    }
    return NextResponse.json(body, { status, headers: NO_STORE })
  }

  // Unconfigured host: the roster is still real and process detection is still
  // local, so return both — with 503 and the reason, never a bare empty 200.
  if (!SUPABASE_KEY) {
    const state = emptyRunState()
    state.runningAgents = await detectRunningAgents()
    return respond(state, false, NO_KEY_ERROR, 503)
  }

  try {
    const supabase = db()
    const state = emptyRunState()

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
    for (const run of recentRuns ?? []) {
      const ts = new Date(run.completed_at ?? run.started_at).getTime()
      if (!state.agentLastActive[run.agent_id] || ts > state.agentLastActive[run.agent_id]) {
        state.agentLastActive[run.agent_id] = ts
      }
    }

    // Build lookup: agent → current issue (prefer in_progress over review statuses)
    // Sort: in_progress first, then code_review, then product_review
    const statusPriority = (s: string) => s === 'in_progress' ? 0 : s === 'code_review' ? 1 : s === 'product_review' ? 2 : s === 'open' ? 3 : 4
    const sortedIssues = [...(activeIssues ?? [])].sort((a, b) => statusPriority(a.status) - statusPriority(b.status))
    for (const iss of sortedIssues) {
      const owner = iss.worked_by || iss.assignee
      if (owner && !state.agentIssue[owner]) {
        // started_at: when agent started working on THIS issue (reset on assignee/status change)
        // Fall back to updated_at if started_at is null
        const startedAt = iss.started_at ? new Date(iss.started_at).getTime()
                        : iss.updated_at ? new Date(iss.updated_at).getTime()
                        : null
        state.agentIssue[owner] = {
          key: iss.task_key ?? '?',
          title: iss.title ?? '',
          status: iss.status ?? '',
          startedAt,
        }
      }
      // Track activity from issue updates for all issues
      if (owner) {
        const issTs = new Date(iss.updated_at).getTime()
        if (!state.agentLastActive[owner] || issTs > state.agentLastActive[owner]) {
          state.agentLastActive[owner] = issTs
        }
      }
    }

    // 3. Check for running claude CLI agent processes (real-time detection)
    //    Only spawned agent sessions match, NOT the main Claude Desktop session.
    state.runningAgents = await detectRunningAgents()

    return respond(state, true, null)
  } catch (e) {
    // Never swallow. A host that cannot reach its database answers 503 with the
    // reason, and still shows the roster it does know about.
    return respond(emptyRunState(), false, e instanceof Error ? e.message : String(e), 503)
  }
}

// INF-237: Agent capability registry — persist capabilities to Supabase agent_memory
export async function POST(req: NextRequest) {
  if (!SUPABASE_KEY) return NextResponse.json({ error: NO_KEY_ERROR }, { status: 503 })
  try {
    const body = await req.json()
    const { agent_id, capabilities, role, description } = body
    if (!agent_id) return NextResponse.json({ error: 'agent_id required' }, { status: 400 })

    const supabase = db()
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
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

// INF-237: Update agent capabilities
export async function PATCH(req: NextRequest) {
  if (!SUPABASE_KEY) return NextResponse.json({ error: NO_KEY_ERROR }, { status: 503 })
  try {
    const body = await req.json()
    const { agent_id, capabilities, role, description, floor } = body
    if (!agent_id) return NextResponse.json({ error: 'agent_id required' }, { status: 400 })

    const supabase = db()

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
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

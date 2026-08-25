import { NextRequest, NextResponse } from 'next/server'
import { db, dbStatusMessage, isDbConfigured } from '@/lib/db'
import { dbQueryErrorResponse } from '@/lib/db-http'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { processListCommand } from '@/lib/paths'
import { AGENT_META, loadAgentRoster, type ParsedAgent } from '@/lib/agent-roster'

const execFileAsync = promisify(execFile)


/**
 * Asked of the seam, never of the environment. This route used to read the
 * credential itself, which made the database client throw "key is required" on
 * every host but the author's — and the GET handler swallowed that into an
 * empty 200. A machine that was never configured then looked identical to a
 * machine with no agents. `dbStatusMessage()` says which one it is, naming the
 * variables the active adapter actually wants.
 */
const NO_KEY_ERROR = () => `${dbStatusMessage()} — agent run state unavailable`

const NO_STORE = { 'Cache-Control': 'no-store' } as const

/**
 * Where the roster came from. There is no 'builtin' any more: this route used
 * to union AGENTS.md with the 16-entry AGENT_META registry and, on a host with
 * no roster file at all, serve AGENT_META *as* the roster. Both made the API
 * report agents that no file on the host declares. AGENT_META is now strictly
 * display metadata for agents the roster names.
 */
type RosterSource = 'agents-md' | 'none'

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
  rosterPath: string | null
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
  /** The AGENTS.md actually read, so an empty roster can name the file it wanted. */
  rosterPath: string | null
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
 * The process table is the slow part of this endpoint: on Windows the listing
 * shells out to PowerShell, which costs ~0.75s of interpreter startup on its
 * own and dominated the response time. The scan is cached for PROC_SCAN_TTL_MS
 * and refreshed in the background, so a poll inside the window answers from
 * memory instead of paying for a fresh interpreter. One in-flight scan is
 * shared by every concurrent request rather than spawning a shell per caller.
 *
 * The TTL is well under the UI's 30s refresh, so what is served is at worst a
 * few seconds stale — never the previous poll's state.
 */
const PROC_SCAN_TTL_MS = 5000
let procScanAt = 0
let procScanValue: Set<string> | null = null
let procScanInFlight: Promise<Set<string>> | null = null

function scanRunningAgents(): Promise<Set<string>> {
  if (procScanInFlight) return procScanInFlight
  procScanInFlight = detectRunningAgents()
    .then(result => {
      procScanValue = result
      procScanAt = Date.now()
      return result
    })
    .finally(() => { procScanInFlight = null })
  return procScanInFlight
}

/**
 * Cached view of which agents have a live CLI session. Returns the cached set
 * immediately when it is fresh; kicks off a refresh and returns the stale set
 * when it is not; only blocks on the very first call of a process's life.
 */
async function runningAgentsCached(): Promise<Set<string>> {
  const fresh = procScanValue !== null && Date.now() - procScanAt < PROC_SCAN_TTL_MS
  if (fresh) return procScanValue as Set<string>
  if (procScanValue !== null) {
    // Stale-while-revalidate: never make an operator wait on a shell spawn for
    // a signal that only changes when an agent starts or stops.
    void scanRunningAgents()
    return procScanValue
  }
  return scanRunningAgents()
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
 * A short badge for the model column.
 *
 * This used to be `model.includes('haiku') ? 'Haiku 4.5' : 'Sonnet 4.6'`, which
 * labelled every non-Haiku agent "Sonnet 4.6" — including Scout, whose roster
 * entry says Gemma 3 4B on Ollama, and any local model an operator configures.
 * A badge that contradicts the roster it was derived from is worse than no
 * badge, so an unrecognised model now shortens its own name instead.
 */
function shortModelLabel(model: string): string {
  const m = model.trim()
  if (!m) return ''
  const lower = m.toLowerCase()
  if (lower.includes('haiku')) return 'Haiku 4.5'
  if (lower.includes('sonnet')) return 'Sonnet 4.6'
  if (lower.includes('opus')) return 'Opus'
  // e.g. "Gemma 3 4B (Ollama)" -> "Gemma 3 4B", "qwen2.5-coder:14b" -> as-is.
  const withoutParens = m.replace(/\s*\(.*\)\s*$/, '').trim()
  return withoutParens.length > 18 ? `${withoutParens.slice(0, 17)}…` : withoutParens
}

/**
 * Merge the roster with whatever run state was collectable.
 *   - AGENTS.md is the ONLY source of who exists: one row in, one row out
 *   - AGENT_META supplies presentation only (emoji/color/capabilities/floor/
 *     queue_filter), and falls back to neutral defaults for an agent it has
 *     never heard of, so a roster can add an agent without a code change
 * Run state may be empty (unconfigured host); the roster is still real, so the
 * operator sees who exists next to the reason their state is not live.
 */
function buildAgents(
  parsedAgents: ParsedAgent[],
  rosterSource: RosterSource,
  rosterWarning: string | null,
  rosterPath: string | null,
  state: RunState,
): AgentDto[] {
  const now = Date.now()

  return parsedAgents.map((parsed): AgentDto => {
    const id = parsed.id
    const meta = AGENT_META[id]

    const issue = state.agentIssue[id]
    const lastTs = state.agentLastActive[id] ?? 0
    const agoMin = lastTs ? Math.round((now - lastTs) / 60000) : null

    const isRunning = state.runningAgents.has(id)
    const hasInProgressIssue = !!issue && issue.status === 'in_progress'
    const isActive = isRunning || hasInProgressIssue
    const isScheduled = id === 'ops' && !isActive

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

    const model = parsed.model || meta?.model || ''
    const role = parsed.role || meta?.role || ''

    return {
      id,
      name: parsed.name || meta?.name || id,
      emoji: meta?.emoji ?? '🤖',
      role,
      model,
      active: isActive,
      status: isActive ? 'active' : isScheduled ? 'scheduled' : 'idle',
      isRunning,
      nextRunTs,
      modelShort: shortModelLabel(model),
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
      rosterPath,
    }
  })
}

export async function GET() {
  // AGENTS.md is the roster, and it is a host artifact: a fresh clone on
  // another machine may have none, or AGENTS_MD_PATH may point somewhere that
  // does not exist. Neither is a server fault, so neither is a 500 — the
  // response is a 200 carrying an empty roster and a warning naming the path,
  // which lets the UI say "no agents configured" instead of inventing some.
  const roster = loadAgentRoster()
  const parsedAgents: ParsedAgent[] = roster.agents
  const rosterSource: RosterSource = roster.agents.length > 0 ? 'agents-md' : 'none'
  const rosterWarning = roster.warning
  const rosterPath = roster.path

  const respond = (state: RunState, configured: boolean, error: string | null, status = 200) => {
    const body: AgentsResponse = {
      agents: buildAgents(parsedAgents, rosterSource, rosterWarning, rosterPath, state),
      rosterSource,
      rosterWarning,
      rosterPath,
      configured,
      error,
    }
    return NextResponse.json(body, { status, headers: NO_STORE })
  }

  // Unconfigured host: the roster is still real and process detection is still
  // local, so return both — with 503 and the reason, never a bare empty 200.
  if (!isDbConfigured()) {
    const state = emptyRunState()
    state.runningAgents = await runningAgentsCached()
    return respond(state, false, NO_KEY_ERROR(), 503)
  }

  try {
    const supabase = db()
    const state = emptyRunState()

    // The process scan and the two queries are independent, so they run
    // together. Awaiting them in sequence added the shell-spawn cost on top of
    // the round trips instead of hiding it behind them.
    const [{ data: activeIssues }, { data: recentRuns }, runningAgents] = await Promise.all([
      // 1. Issues that are actively being worked on (in_progress, code_review)
      supabase
        .from('issues')
        .select('task_key, title, status, assignee, worked_by, updated_at, started_at')
        .in('status', ['open', 'in_progress', 'code_review', 'product_review', 'approved'])
        .order('updated_at', { ascending: false })
        .limit(50),
      // 2. Recent agent_runs for last-activity tracking
      supabase
        .from('agent_runs')
        .select('agent_id, started_at, completed_at, status')
        .order('started_at', { ascending: false })
        .limit(50),
      // 3. Running claude CLI agent processes (real-time, local, cached).
      //    Only spawned agent sessions match, NOT the main Claude Desktop session.
      runningAgentsCached(),
    ])
    state.runningAgents = runningAgents

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

    return respond(state, true, null)
  } catch (e) {
    // Never swallow. A host that cannot reach its database answers 503 with the
    // reason, and still shows the roster it does know about.
    return respond(emptyRunState(), false, e instanceof Error ? e.message : String(e), 503)
  }
}

// INF-237: Agent capability registry — persist capabilities to Supabase agent_memory
export async function POST(req: NextRequest) {
  if (!isDbConfigured()) return NextResponse.json({ error: NO_KEY_ERROR() }, { status: 503 })
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
    if (error) return dbQueryErrorResponse(error, 'agent_memory')
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

// INF-237: Update agent capabilities
export async function PATCH(req: NextRequest) {
  if (!isDbConfigured()) return NextResponse.json({ error: NO_KEY_ERROR() }, { status: 503 })
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
    if (error) return dbQueryErrorResponse(error, 'agent_memory')
    return NextResponse.json({ ok: true, data: merged })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

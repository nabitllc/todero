import { NextRequest, NextResponse } from 'next/server'
import { db, dbStatusMessage, isDbConfigured } from '@/lib/db'
import { dbQueryErrorResponse } from '@/lib/db-http'
import { AGENT_META, loadAgentRoster, type ParsedAgent } from '@/lib/agent-roster'
import { loadVaultAgentRoster, localRoutingFor, type VaultAgent } from '@/lib/vault-agents'
import {
  classifyLiveness,
  readHeartbeats,
  type Heartbeat,
  type HeartbeatStore,
  type Liveness,
} from '@/lib/agent-heartbeats'
import { readRegistrations, type AgentRegistration } from '@/lib/agent-registrations'
import { internalHeaders } from '@/lib/internal-auth'
import { getCeilingStatus, type CeilingName } from '@/lib/agent-budget'
import { LLM_PROVIDER_ID } from '@/lib/llm-provider'
import { resolveVaultBadge, type VaultBadgeInfo } from '@/lib/vault-badge'
import { getQueueConfig } from '@/lib/agent-queue'
import { ensureVaultDispatchConfigs } from '@/lib/agent-manifests'

/**
 * Whether THIS host's configured LLM endpoint is a local one (Ollama, LM
 * Studio, or an unrecognized loopback/IP server) rather than a cloud vendor.
 * `lib/vault-badge.ts`'s `resolveVaultBadge()` is the one place this feeds
 * into a UI decision: a vault agent's `local_eligible`/`fallback_local` only
 * means a local run is what would actually happen when the host is actually
 * pointed at a local endpoint — the manifest carrying a local fallback name
 * is not itself evidence of that.
 */
const LOCAL_LLM_PROVIDER_IDS = new Set(['ollama', 'lmstudio', 'local'])

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
 *
 * Widened from the original 'agents-md' | 'none' now that `agent_registrations`
 * is a second, independent source of "who exists": an agent that self-
 * registered through POST /api/connect but is not named in any AGENTS.md
 * (or vice versa) is real and must be reported, not silently dropped because
 * it does not match the one source this type used to allow for.
 *
 * Widened again (docs/brain2-integration.md) for a third source: the Brain2
 * vault's `Global_Agents/<id>/manifest.json` registry (lib/vault-agents.ts).
 * A vault agent is only added as its own row when no roster or registration
 * row already claims its id — see `respond()` — so this never double-counts
 * an agent that happens to exist in two sources.
 *   'agents-md'  — every agent came from the roster file only
 *   'registered' — every agent came from agent_registrations only
 *   'vault'      — every agent came from the Brain2 vault only
 *   'both'       — rows came from more than one source
 *   'none'       — no source had anything
 */
type RosterSource = 'agents-md' | 'registered' | 'vault' | 'both' | 'none'

/**
 * Where "is this agent running?" was answered from.
 *   'heartbeat' — the server has a heartbeat store it could read
 *   'none'      — it could not read one, so no liveness claim is made at all
 *
 * There is deliberately no third value. This route used to infer liveness by
 * grepping the local process table for prompt text, which could only ever see
 * agents on this one host and answered "not running" for everything else — a
 * guess wearing the same UI as a fact.
 */
type LivenessSource = 'heartbeat' | 'none'

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
  /** Epoch ms of this agent's last heartbeat, or null if it never sent one. */
  lastSeenAt: number | null
  /** live / stale / idle / never — see lib/agent-heartbeats.ts. */
  liveness: Liveness
  /** How that was determined. 'none' means the claim could not be made. */
  livenessSource: LivenessSource
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
  /**
   * TOD-2381 (agent-budget-stop): the same over-ceiling verdict
   * `checkDispatchCeilings` would give this agent right now, read-only
   * (`getCeilingStatus` — never writes an inbox/agent_memory row for a mere
   * roster poll). Null when the agent is within every ceiling. Piece brief
   * #3: "An agent that is over budget is marked as such in the roster with
   * the reason visible" — this is that field.
   */
  overCeiling?: { ceiling: CeilingName; reason: string } | null
  /**
   * Brain2 vault manifest data for this agent's id, when
   * `Global_Agents/<id>/manifest.json` exists — null for every agent the
   * vault does not name (including when the vault itself is absent). This is
   * the "tier drives model selection, local_eligible drives whether a run may
   * be routed to Ollama, fallback_local names the model" mapping from the
   * piece brief, exposed for any caller (dispatch, UI) that wants it — this
   * route only reports it, it does not itself route a run anywhere.
   */
  vault: {
    tier: string
    claudeCodeAlias: string
    preferred: string
    fallbackLocal: string
    localEligible: boolean
    /** Resolved from `localEligible`/`fallbackLocal` — null unless a local run is actually allowed. */
    localModel: string | null
    description: string
  } | null
  /**
   * registry-reaches-dispatch piece: whether `getQueueConfig(id)` — the exact
   * function POST /api/run-agent calls before dispatching — resolves a
   * config for this agent right now. Computed server-side, after
   * `ensureVaultDispatchConfigs()` has registered every vault manifest's
   * derived config, so this is never stale the way a client-side
   * `a.vault && !getQueueConfig(a.id)` check would be: that check ran
   * against the BROWSER's own copy of lib/agent-queue.ts, which has no way
   * to see a config this route registered server-side. ChatTab.tsx and
   * IssuesTab.tsx read this field instead of recomputing the check
   * themselves — see their updated comments.
   */
  dispatchable: boolean
}

/** Live run state: issue/run history from the database, plus recorded heartbeats. */
type RunState = {
  agentIssue: Record<string, { key: string; title: string; status: string; startedAt: number | null }>
  agentLastActive: Record<string, number>
  /** Latest check-in per agent id. Absent id = that agent never checked in. */
  heartbeats: Map<string, Heartbeat>
  /** 'none' when the heartbeat store could not be read at all. */
  livenessSource: LivenessSource
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
  /** How liveness was determined for every row. See `LivenessSource`. */
  livenessSource: LivenessSource
  /** Which table served the heartbeats, or null when none could be read. */
  heartbeatStore: HeartbeatStore | null
  /** Why liveness is degraded or unavailable, when it is. */
  heartbeatWarning: string | null
  /**
   * The Brain2 vault's Global_Agents/ directory actually scanned, or null
   * when the vault (or that directory) was not found on this host — see
   * lib/vault-agents.ts. Envelope-level, same pattern as rosterPath, so an
   * empty vault contribution can still name the path it looked in.
   */
  vaultPath: string | null
  /** Operator-facing reason the vault contributed no agents, naming the path searched. Null when it did. */
  vaultWarning: string | null
  /**
   * Whether this host's configured LLM endpoint is local (Ollama/LM Studio)
   * rather than a cloud vendor — see `LOCAL_LLM_PROVIDER_IDS` above. The one
   * input `resolveVaultBadge()` (lib/vault-badge.ts) needs beyond a row's own
   * `vault` field to decide whether `vault.localModel` is what would really
   * run, or just a fallback name a cloud-configured host cannot act on.
   */
  localProviderConfigured: boolean
}

function emptyRunState(): RunState {
  return { agentIssue: {}, agentLastActive: {}, heartbeats: new Map(), livenessSource: 'none' }
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
/**
 * `status: 'scheduled'` and `nextRunTs` used to be computed by assuming
 * `ops` fires at :00/:30 of every hour — a rule invented in this file, never
 * read from anything a scheduler on the host actually promised. On a host
 * where `ops` was idle it rendered a live ticking countdown on the Overview
 * to a run nothing had scheduled — the same class of invented state this
 * route was already rewritten to stop returning for the roster itself.
 *
 * /api/automations is the one place this codebase has already earned the
 * right to say "a job is really scheduled": it only sets `scheduled: true`
 * when it proved a scheduler is live on this host (Vercel's own cron runner
 * when `process.env.VERCEL` is set, or `launchctl list` reporting a
 * LaunchAgent label loaded) and only sets `nextRunAtMs` when it parsed a
 * real cron/schedule expression. This calls that route in-process — with the
 * same internal-call secret every other server-to-server call in this
 * codebase presents (lib/internal-auth.ts) — and keeps only the jobs whose
 * `name` equals an agent id, which is the only association between an
 * automation entry and an agent id this route can trust; nothing here is
 * pattern-matched or guessed. Any failure to reach /api/automations (secret
 * unconfigured, network error, bad JSON) leaves the map empty rather than
 * inventing a fallback schedule — every agent then reports `idle` with
 * `nextRunTs: null`, which is the truthful answer when nothing could be
 * verified.
 */
async function fetchVerifiedAgentSchedule(): Promise<Map<string, number>> {
  const schedule = new Map<string, number>()
  try {
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
    const res = await fetch(`${appUrl}/api/automations`, {
      headers: internalHeaders(),
      cache: 'no-store',
    })
    if (!res.ok) return schedule
    const body = await res.json()
    const items: unknown[] = Array.isArray(body?.automations) ? body.automations : []
    for (const item of items) {
      if (typeof item !== 'object' || item === null) continue
      const row = item as { name?: unknown; scheduled?: unknown; nextRunAtMs?: unknown }
      if (row.scheduled !== true) continue
      if (typeof row.nextRunAtMs !== 'number') continue
      if (typeof row.name !== 'string' || !row.name) continue
      schedule.set(row.name, row.nextRunAtMs)
    }
  } catch {
    // /api/automations unreachable or unparseable: no schedule is knowable
    // this cycle, which is exactly what an empty map already expresses.
  }
  return schedule
}

/** Build one row's `vault` field from its Global_Agents manifest, when it has one. */
function vaultInfoFor(agent: VaultAgent): AgentDto['vault'] {
  const routing = localRoutingFor(agent)
  return {
    tier: agent.model.tier,
    claudeCodeAlias: agent.model.claude_code_alias,
    preferred: agent.model.preferred,
    fallbackLocal: agent.model.fallback_local,
    localEligible: agent.local_eligible,
    localModel: routing.model,
    description: agent.description,
  }
}

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
  schedule: Map<string, number>,
  vaultById: Map<string, VaultAgent>,
): AgentDto[] {
  const now = Date.now()

  return parsedAgents.map((parsed): AgentDto => {
    const id = parsed.id
    const meta = AGENT_META[id]

    const issue = state.agentIssue[id]
    const lastTs = state.agentLastActive[id] ?? 0
    const agoMin = lastTs ? Math.round((now - lastTs) / 60000) : null

    // Liveness comes from the heartbeat this agent sent, and from nothing else.
    // An assigned in_progress issue used to be enough to render an agent as
    // "active", which is a claim about a process — a ticket sitting in a column
    // is not evidence that anything is running. `currentTask` below still
    // reports the issue; it just no longer masquerades as liveness.
    const beat = state.heartbeats.get(id) ?? null
    const lastSeenAt = beat?.lastSeen ?? null
    const liveness: Liveness =
      state.livenessSource === 'none' ? 'never' : classifyLiveness(lastSeenAt, now)
    const isRunning = liveness === 'live'
    const isActive = isRunning

    // Real only: a value here means /api/automations proved a scheduler on
    // this host is live for a job named exactly this agent's id AND parsed a
    // real nextRunAtMs from that job's schedule expression. No host on this
    // team currently runs a scheduler by that convention, so this is `null`
    // on every machine that hasn't wired one up — which is the truth, not a
    // gap to paper over with a guessed cadence.
    const verifiedNextRunTs = schedule.get(id) ?? null
    const isScheduled = !isActive && verifiedNextRunTs !== null
    const nextRunTs = isScheduled ? verifiedNextRunTs : null

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
      lastSeenAt,
      liveness,
      livenessSource: state.livenessSource,
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
      // The assigned issue if there is one, else whatever the agent named in
      // its own last heartbeat. Both are things somebody stated; neither is
      // inferred from a run row that was never closed.
      currentTask: issue ? `${issue.key}: ${issue.title}`.slice(0, 80) : beat?.task ?? null,
      workStartedAt: issue?.startedAt ?? null,
      // Where id/name/role/model came from, so the UI never implies a roster
      // file exists when it does not. Also on the envelope; kept per-row for
      // components that only ever hold a single agent.
      rosterSource,
      rosterWarning,
      rosterPath,
      vault: (() => {
        const v = vaultById.get(id)
        return v ? vaultInfoFor(v) : null
      })(),
      dispatchable: getQueueConfig(id) !== undefined,
    }
  })
}

/**
 * An AgentDto for a registration with no matching AGENTS.md row — the
 * concrete thing this piece exists to make possible: an agent that only ever
 * self-registered through POST /api/connect must be visible in the Crew tab
 * and the Office roster, not invisible because it does not match the one
 * source `buildAgents()` reads. Reuses the exact liveness derivation
 * `buildAgents()` uses below, so a registration-only agent is not held to a
 * different truth standard than a roster one.
 *
 * The heartbeat store is the first choice for `lastSeenAt` — it is the
 * dedicated liveness table and the one every other row here reads — and
 * `reg.lastSeenAt` (kept moving by recordHeartbeat() -> touchRegistration(),
 * see lib/agent-heartbeats.ts) is the fallback for the gap right after POST
 * /api/connect, before this agent's first explicit heartbeat has landed in
 * that table.
 *
 * BUT: once `reg.status` reads 'offline' — i.e. `agent_registrations.
 * last_seen_at` is already outside STALE_WINDOW_MS, which is exactly what a
 * clean DELETE /api/connect backdates it to — the heartbeat store is no
 * longer trusted on its own. DELETE /api/connect also calls clearHeartbeat()
 * to erase that row in the same request, but the two writes are not one
 * transaction: a host degraded to the `agent_memory` fallback for one store
 * and not the other, or a request that failed partway, can leave a beat from
 * moments before the disconnect still sitting there, inside LIVE_WINDOW_MS.
 * Taking the OLDER of the two timestamps once the registration says offline
 * means a leftover heartbeat can only ever make a disconnected agent look
 * MORE offline, never resurrect it as live — a disconnect can never be
 * silently undone by whichever store happened to answer first.
 */
function buildRegistrationAgent(reg: AgentRegistration, state: RunState, vaultById: Map<string, VaultAgent>): AgentDto {
  const now = Date.now()
  const beat = state.heartbeats.get(reg.id) ?? null
  const beatSeen = beat?.lastSeen ?? null
  const regSeen = state.livenessSource === 'none' ? null : reg.lastSeenAt
  const lastSeenAt =
    reg.status === 'offline'
      ? beatSeen === null
        ? regSeen
        : regSeen === null
          ? beatSeen
          : Math.min(beatSeen, regSeen)
      : beatSeen ?? regSeen
  const liveness: Liveness = state.livenessSource === 'none' ? 'never' : classifyLiveness(lastSeenAt, now)
  const isRunning = liveness === 'live'
  const agoMin = lastSeenAt ? Math.round((now - lastSeenAt) / 60000) : null
  const capabilities = reg.capabilities.filter((c): c is string => typeof c === 'string')

  return {
    id: reg.id,
    name: reg.name,
    // Neutral display: AGENT_META has no entry for an agent no AGENTS.md
    // names, and inventing one would be exactly the fabricated metadata this
    // route was already rewritten once to stop doing for the roster itself.
    emoji: '🔌',
    role: 'self-registered',
    model: reg.runtime,
    active: isRunning,
    status: isRunning ? 'active' : 'idle',
    isRunning,
    lastSeenAt,
    liveness,
    livenessSource: state.livenessSource,
    nextRunTs: null,
    modelShort: shortModelLabel(reg.runtime),
    queue_filter: [],
    color: '#6b7280',
    desc: `runtime: ${reg.runtime}`,
    capabilities,
    floor: false,
    workspace: null,
    sessions: 0,
    ago: agoMin,
    lastUpdatedAt: lastSeenAt ?? reg.registeredAt,
    currentTask: beat?.task ?? null,
    workStartedAt: null,
    rosterSource: 'registered',
    rosterWarning: null,
    rosterPath: null,
    vault: (() => {
      const v = vaultById.get(reg.id)
      return v ? vaultInfoFor(v) : null
    })(),
    dispatchable: getQueueConfig(reg.id) !== undefined,
  }
}

/**
 * A synthesized row for a Brain2 vault agent with no AGENTS.md row and no
 * self-registration — the concrete union this piece exists to add: an agent
 * the vault names, and nothing else on this host does, still shows up. Reuses
 * `state.heartbeats` for liveness the same way every other row does (it may
 * still have none — a vault agent that has never been dispatched has no
 * heartbeat to read, same as any other agent with no run history — but see
 * `dispatchable` below: registry-reaches-dispatch made dispatch itself
 * possible, which is a separate fact from whether a run has happened yet),
 * so it is not held to a different truth standard than a roster row.
 *
 * `model`/`modelShort` are resolved through the same `resolveVaultBadge()`
 * every client-side badge uses (lib/vault-badge.ts), not the manifest's raw
 * cloud `preferred` name — a vault-only row used to print `preferred`
 * (e.g. "claude-opus-5") here while its own badge, computed independently on
 * the client, showed the local/alias label two inches away. Any consumer
 * that reads `.model`/`.modelShort` off this row instead of recomputing the
 * badge itself (a config panel, a search result, an export) now gets the
 * same label the badge shows, so the same bug cannot resurface in a fourth
 * file the way it already had in three.
 */
function buildVaultOnlyAgent(
  agent: VaultAgent,
  state: RunState,
  rosterWarning: string | null,
  rosterPath: string | null,
  localProviderConfigured: boolean,
): AgentDto {
  const now = Date.now()
  const beat = state.heartbeats.get(agent.id) ?? null
  const lastSeenAt = beat?.lastSeen ?? null
  const liveness: Liveness = state.livenessSource === 'none' ? 'never' : classifyLiveness(lastSeenAt, now)
  const isRunning = liveness === 'live'
  const agoMin = lastSeenAt ? Math.round((now - lastSeenAt) / 60000) : null
  const vault = vaultInfoFor(agent)
  // vaultInfoFor() only returns null through its `AgentDto['vault']` return
  // type when a caller looked an id up in a map and found nothing (see the
  // `v ? vaultInfoFor(v) : null` call sites above) — called directly on a
  // real VaultAgent, as here, it always builds the object.
  const model = resolveVaultBadge(vault as VaultBadgeInfo, localProviderConfigured).label

  return {
    id: agent.id,
    name: agent.name,
    // Neutral display, distinct from the registration glyph — this agent is
    // named by the vault, not by a live connection or a Todero roster row.
    emoji: '🗂️',
    role: agent.model.tier ? `${agent.model.tier} tier` : '',
    model,
    active: isRunning,
    status: isRunning ? 'active' : 'idle',
    isRunning,
    lastSeenAt,
    liveness,
    livenessSource: state.livenessSource,
    nextRunTs: null,
    modelShort: shortModelLabel(model),
    queue_filter: [],
    color: agent.model.tier === 'frontier' ? '#8b5cf6' : agent.model.tier === 'mid' ? '#3b82f6' : '#6b7280',
    desc: agent.description,
    capabilities: agent.tools,
    floor: false,
    workspace: null,
    sessions: 0,
    ago: agoMin,
    lastUpdatedAt: lastSeenAt ?? 0,
    currentTask: beat?.task ?? null,
    workStartedAt: null,
    rosterSource: 'vault',
    rosterWarning,
    rosterPath,
    vault,
    // registry-reaches-dispatch piece: this used to be unconditionally
    // false ("nothing dispatches a vault-only agent yet" — see the comment
    // above this function). ensureVaultDispatchConfigs(), called before this
    // function runs, has registered a config for every agent the vault
    // named, so this now reads the same true/false POST /api/run-agent
    // would give this exact id.
    dispatchable: getQueueConfig(agent.id) !== undefined,
  }
}

export async function GET() {
  // AGENTS.md is one of two sources of "who exists" now — see RosterSource
  // above. It is a host artifact: a fresh clone on another machine may have
  // none, or AGENTS_MD_PATH may point somewhere that does not exist. Neither
  // is a server fault, so neither is a 500 — the response is a 200 carrying
  // an empty roster and a warning naming the path, which lets the UI say
  // "no agents configured" instead of inventing some.
  const roster = loadAgentRoster()
  const parsedAgents: ParsedAgent[] = roster.agents
  const baseRosterSource: 'agents-md' | 'none' = roster.agents.length > 0 ? 'agents-md' : 'none'
  const rosterWarning = roster.warning
  const rosterPath = roster.path

  // Brain2 vault registry (docs/brain2-integration.md) — a third, independent
  // source of "who exists". Never throws by construction (lib/vault-agents.ts
  // catches every fs error internally); the extra try/catch is defense in
  // depth so a future change there still cannot 500 this route — a vault
  // read is exactly the kind of optional-infrastructure failure this route
  // has already promised never crashes it.
  let vaultRoster: ReturnType<typeof loadVaultAgentRoster>
  try {
    vaultRoster = loadVaultAgentRoster()
  } catch (e) {
    vaultRoster = { agents: [], path: null, warning: e instanceof Error ? e.message : String(e) }
  }
  const vaultById = new Map(vaultRoster.agents.map((a) => [a.id, a]))

  // registry-reaches-dispatch piece: registers a dispatchable config for
  // every vault agent into lib/agent-queue.ts's runtime cache — the same
  // scan `vaultRoster` above already did, run again here (cheap: ~13 small
  // files) so the *dispatch* half of the vault registry is populated from
  // the exact code path POST /api/run-agent also calls, not duplicated ad
  // hoc. Never throws (see that function's own comment); its `dispatchable`
  // per-row field below reads true iff a real spawn would find a config too.
  await ensureVaultDispatchConfigs()

  // Independent of the roster and of Supabase — fetched once and reused by
  // every response branch below, success or failure alike.
  const schedule = await fetchVerifiedAgentSchedule()

  // Computed once and reused everywhere a vault-backed row needs it: both by
  // buildVaultOnlyAgent() (to resolve `model`/`modelShort` the same way the
  // client-side badge does) and by the response envelope below.
  const localProviderConfigured = LOCAL_LLM_PROVIDER_IDS.has(LLM_PROVIDER_ID)

  const respond = async (
    state: RunState,
    configured: boolean,
    error: string | null,
    status = 200,
    heartbeatStore: HeartbeatStore | null = null,
    heartbeatWarning: string | null = null,
    registrations: Map<string, AgentRegistration> = new Map(),
  ) => {
    // Every registration that AGENTS.md does not already name — the union
    // this piece was built for. An agent named in both sources renders once,
    // as its roster row (display metadata from AGENT_META is real; a
    // registration has none), so its heartbeat still drives that one row.
    const rosterIds = new Set(parsedAgents.map((a) => a.id))
    const registrationOnly = Array.from(registrations.values()).filter((r) => !rosterIds.has(r.id))

    // Vault agents not already named by AGENTS.md or a live registration —
    // the third leg of the same union `registrationOnly` above already does.
    // An id present in either of the other two sources is enriched via the
    // per-row `vault` field instead (buildAgents/buildRegistrationAgent both
    // look it up), so it never renders twice.
    const knownIds = new Set(rosterIds)
    for (const id of Array.from(registrations.keys())) knownIds.add(id)
    const vaultOnly = vaultRoster.agents.filter((v) => !knownIds.has(v.id))

    const agents: AgentDto[] = [
      ...buildAgents(parsedAgents, baseRosterSource, rosterWarning, rosterPath, state, schedule, vaultById),
      ...registrationOnly.map((r) => buildRegistrationAgent(r, state, vaultById)),
      ...vaultOnly.map((v) => buildVaultOnlyAgent(v, state, vaultRoster.warning, vaultRoster.path, localProviderConfigured)),
    ]

    // TOD-2381 round 3: over-ceiling flag per agent, only when the database
    // is actually reachable (`configured`) — an unconfigured/error path has
    // no database to ask and every agent should just render with no flag
    // rather than a second, unrelated error. Best-effort per agent: one
    // ceiling check throwing must never take down the whole roster response.
    if (configured) {
      await Promise.all(agents.map(async (a) => {
        try {
          const result = await getCeilingStatus(a.id)
          a.overCeiling = result.allowed ? null : { ceiling: result.ceiling as CeilingName, reason: result.reason ?? '' }
        } catch {
          a.overCeiling = null
        }
      }))
    } else {
      for (const a of agents) a.overCeiling = null
    }

    const sourcesPresent = [
      parsedAgents.length > 0 && 'agents-md',
      registrations.size > 0 && 'registered',
      vaultOnly.length > 0 && 'vault',
    ].filter((s): s is 'agents-md' | 'registered' | 'vault' => s !== false)
    const rosterSource: RosterSource =
      sourcesPresent.length > 1 ? 'both' : sourcesPresent.length === 1 ? sourcesPresent[0] : 'none'

    const body: AgentsResponse = {
      agents,
      rosterSource,
      rosterWarning,
      rosterPath,
      configured,
      error,
      livenessSource: state.livenessSource,
      heartbeatStore,
      heartbeatWarning,
      vaultPath: vaultRoster.path,
      vaultWarning: vaultRoster.warning,
      localProviderConfigured,
    }
    return NextResponse.json(body, { status, headers: NO_STORE })
  }

  // Unconfigured host: the roster is still real, so return it — with 503 and
  // the reason, never a bare empty 200. Liveness lives in the database, so
  // without one there is no liveness to report and `livenessSource` stays
  // 'none': every agent reads "never checked in", not "Idle". Registrations
  // live in the same database, so an unconfigured host has none to union in
  // either — `respond()`'s default empty map is correct here.
  if (!isDbConfigured()) {
    return respond(emptyRunState(), false, NO_KEY_ERROR(), 503)
  }

  try {
    const supabase = db()
    const state = emptyRunState()

    // The heartbeat read, the registration read, and the two queries are all
    // independent, so they run together rather than stacking their round trips.
    const [{ data: activeIssues }, { data: recentRuns }, beats, registrations] = await Promise.all([
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
      // 3. Recorded heartbeats — the only source of "is this agent running?".
      //    Works for agents on any host, not just this one.
      readHeartbeats(),
      // 4. Registered agents — the roster's second source. Its own liveness
      //    fields (last_seen_at, and the status derived from it) are kept
      //    honest by recordHeartbeat()/rowToRegistration(). This route decides
      //    who from here is missing from AGENTS.md and needs a row
      //    synthesized for them — and buildRegistrationAgent() DOES recompute
      //    that row's liveness rather than trusting either source alone: once
      //    the registration reads 'offline' it floors `lastSeenAt` at the
      //    OLDER of the registration's own timestamp and the heartbeat
      //    store's, so a heartbeat left over from just before a disconnect
      //    can never out-vote it. See that function's docstring.
      readRegistrations(),
    ])
    state.heartbeats = beats.data
    state.livenessSource = beats.store === null ? 'none' : 'heartbeat'

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

    return respond(state, true, null, 200, beats.store, beats.warning, registrations.data)
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

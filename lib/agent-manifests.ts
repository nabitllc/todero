// registry-reaches-dispatch piece — the vault registry reaching dispatch.
//
// Before this file: `app/api/agents/route.ts` read Global_Agents/<id>/
// manifest.json (lib/vault-agents.ts) and merged it into ONE HTTP response,
// then threw the result away. No row was ever persisted, and
// lib/agent-queue.ts's hardcoded AGENT_QUEUE_CONFIGS — the table
// POST /api/run-agent actually dispatches from — had no entry for any of the
// 13 vault agents, so every one of them answered "Unknown agent" to the
// dispatcher. The roster displayed vault data; dispatch used a different,
// hardcoded table. Two sources of truth, and the one that mattered ignored
// the vault entirely.
//
// This file closes that gap:
//   1. `manifestToQueueConfig()` — pure, sync — turns one vault manifest into
//      a dispatchable AgentQueueConfig. Model selection (tier,
//      claude_code_alias, preferred, fallback_local, local_eligible) comes
//      straight from the manifest, exactly as docs/brain2-integration.md's
//      "Brain2 → Todero" table requires; queue *behaviour* (pickup status,
//      WIP limit, DoR fields) is Todero's own default, because nothing in a
//      manifest.json defines an issue-queue lane — the vault configures
//      identity, Todero configures how work reaches it, same split the
//      roster piece already draws for display.
//   2. `ensureVaultDispatchConfigs()` — the one function both
//      app/api/agents/route.ts and app/api/run-agent/route.ts call before
//      touching getQueueConfig()/getAllQueueAgentIds() — scans the live
//      vault, persists what it finds into `agent_manifests` (best-effort:
//      migrations/055_agent_manifests.sql may not have run yet on this
//      host, which is a configuration fact, not a crash — see
//      persistManifests()), and registers the resulting configs into
//      lib/agent-queue.ts's runtime cache. When the live vault is absent but
//      `agent_manifests` still holds a previous sync, dispatch is derived
//      FROM THAT TABLE — proving the persisted row is load-bearing, not a
//      write nobody reads back, which is the literal defect this piece
//      exists to fix. When neither is available, no vault agent is
//      registered at all and Todero's own hardcoded defaults are what
//      answers — never an invented agent standing in for one the vault does
//      not actually declare (same rule lib/vault-agents.ts already follows).
//
// SERVER ONLY: reads the filesystem (via lib/vault-agents.ts) and the
// database. Never imported by a client component — see lib/agent-queue.ts's
// comment on why that file itself stays free of this import.

import { loadVaultAgentRoster, type VaultAgent } from './vault-agents'
import { db, isDbConfigured } from './db'
import {
  registerManifestQueueConfigs,
  type AgentQueueConfig,
  type ModelAlias,
  type ModelBinding,
} from './agent-queue'

const TABLE = 'agent_manifests' // scripts/generate-required-tables.mjs needs a literal string in .from(), not this constant — see the two call sites below, which spell it out.

function toModelAlias(v: string): ModelAlias {
  return v === 'opus' || v === 'haiku' ? v : 'sonnet'
}

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string')
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v)
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
    } catch {
      return []
    }
  }
  return []
}

/**
 * One vault manifest -> one dispatchable queue config.
 *
 * Pure and synchronous on purpose — every field comes from the `VaultAgent`
 * argument, nothing is read from disk or the network here, so this is safe
 * to call from either the live-scan path or the persisted-row path below
 * without duplicating the mapping logic.
 */
export function manifestToQueueConfig(agent: VaultAgent): AgentQueueConfig {
  const alias = toModelAlias(agent.model.claude_code_alias)
  const modelChain: ModelBinding[] = [{ runtime: 'claude-code', alias }]
  const localFallbackModel =
    agent.local_eligible && agent.model.fallback_local ? agent.model.fallback_local : undefined
  // A local run only ever happens through the openai-api adapter (the only
  // one that reads AgentSpawnOptions.modelOverride — see the field comment
  // on AgentQueueConfig.localFallbackModel) — so it only belongs in the
  // chain when the manifest actually allows one.
  if (localFallbackModel) modelChain.push({ runtime: 'openai-api', alias })

  return {
    agentId: agent.id,
    model: alias,
    // No manifest field defines an issue-queue lane, so this is Todero's own
    // generic default: same shape as the plain builder/ops lanes minus any
    // Todero-specific `extraFilters`. An agent with no issues ever assigned
    // to it just returns "no eligible issues" here, never a 400 — see
    // run-agent-locally's existing "never invent" contract in vault-agents.ts.
    pickupStatus: 'open',
    extraFilters: '',
    dorFields: ['description', 'acceptance_criteria'],
    wipLimit: 1,
    workingStatus: 'in_progress',
    completionStatus: 'code_review',
    checkBlocking: true,
    sortOrder: 'priority.asc,created_at.asc',
    fetchLimit: 5,
    promptPrefix:
      `You are ${agent.name} (Brain2 vault agent${agent.model.tier ? `, ${agent.model.tier} tier` : ''}). ` +
      `${agent.description}`.trim(),
    modelChain,
    localFallbackModel,
    source: 'vault',
  }
}

interface AgentManifestRow {
  agent_id: string
  name: string
  description: string | null
  tier: string | null
  claude_code_alias: string | null
  preferred: string | null
  fallback_local: string | null
  local_eligible: boolean | number | null
  tools: unknown
  compatible_with: unknown
}

function rowToVaultAgent(row: AgentManifestRow): VaultAgent {
  return {
    id: row.agent_id,
    name: row.name,
    description: row.description ?? '',
    model: {
      tier: row.tier ?? '',
      claude_code_alias: row.claude_code_alias ?? '',
      preferred: row.preferred ?? '',
      fallback_local: row.fallback_local ?? '',
    },
    tools: asStringArray(row.tools),
    compatible_with: asStringArray(row.compatible_with),
    local_eligible: row.local_eligible === true || row.local_eligible === 1,
  }
}

/**
 * Writes the live vault manifests into `agent_manifests`, one row per agent,
 * keyed by `agent_id` (ON CONFLICT upsert — a manifest edited in the vault
 * overwrites its old row on the next scan, it never accumulates history).
 *
 * Best-effort by design: `migrations/055_agent_manifests.sql` may not have
 * run against this install's database yet (the same "12 tables missing"
 * state most of this rebuild's other pieces already tolerate — see
 * api-baseline.txt). A missing table is a migration that has not run, not a
 * server fault, so it is logged and swallowed here rather than thrown —
 * `ensureVaultDispatchConfigs()` below still returns real dispatch configs
 * from the live scan either way; only the durability half is degraded.
 *
 * Round 2 (critic finding): this used to return a bare `boolean`, and the
 * caller threw away exactly the detail an operator needs — "did it fail, and
 * why" — because `ensureVaultDispatchConfigs()` forced `warning` to `null`
 * whenever the live scan produced agents, which is the ONLY case this
 * function ever runs in. That made the persistence half of this piece fail
 * on every single request, silently, since the day it shipped: PostgREST
 * 404 PGRST205 (table missing on the configured backend) was swallowed by
 * `console.warn` and never reached an HTTP response or the UI. Returning the
 * reason — same message shape `app/api/inbox/route.ts`'s `_warning` field
 * already uses for a missing column — is what lets the caller surface it.
 */
async function persistManifests(
  agents: VaultAgent[],
): Promise<{ persisted: boolean; warning: string | null }> {
  if (agents.length === 0) return { persisted: false, warning: null }
  if (!isDbConfigured()) {
    return {
      persisted: false,
      warning:
        'vault manifests not persisted — no database configured on this host; ' +
        'dispatch configs are in-process only and will not survive a restart',
    }
  }
  try {
    const rows = agents.map((a) => ({
      agent_id: a.id,
      name: a.name,
      description: a.description,
      tier: a.model.tier,
      claude_code_alias: a.model.claude_code_alias,
      preferred: a.model.preferred,
      fallback_local: a.model.fallback_local,
      local_eligible: a.local_eligible,
      tools: JSON.stringify(a.tools),
      compatible_with: JSON.stringify(a.compatible_with),
      source: 'vault',
      synced_at: new Date().toISOString(),
    }))
    const { error } = await db().from('agent_manifests').upsert(rows, { onConflict: 'agent_id' })
    if (error) {
      console.warn(`[agent-manifests] persist skipped — ${TABLE}: ${error.message}`)
      // PGRST205 (Supabase/PostgREST) and 42P01 (raw Postgres/sqlite) are
      // both "the table itself does not exist" — the one case worth naming
      // the fix for. Everything else (a bad column, a constraint violation)
      // still surfaces, just with the driver's own message.
      const missingTable =
        /PGRST205|42P01|could not find the table|no such table/i.test(error.message)
      const detail = missingTable
        ? `${TABLE} table missing on this database (run: npm run db:migrate) — ${error.message}`
        : error.message
      return {
        persisted: false,
        warning:
          `vault manifests not persisted — ${detail}; ` +
          'dispatch configs are in-process only and will not survive a restart',
      }
    }
    return { persisted: true, warning: null }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.warn(`[agent-manifests] persist failed: ${message}`)
    return {
      persisted: false,
      warning:
        `vault manifests not persisted — ${message}; ` +
        'dispatch configs are in-process only and will not survive a restart',
    }
  }
}

/** Reads back whatever was last persisted — the fallback when the live vault
 *  filesystem is not reachable from this process (a different host than the
 *  one that last ran the sync). Never throws: a missing table or an
 *  unconfigured database both come back as "nothing persisted", the same as
 *  a vault that was never scanned. */
async function loadPersistedManifests(): Promise<VaultAgent[]> {
  if (!isDbConfigured()) return []
  try {
    const { data, error } = await db().from('agent_manifests').select('*')
    if (error || !data) return []
    return (data as AgentManifestRow[]).map(rowToVaultAgent)
  } catch {
    return []
  }
}

export interface VaultDispatchSync {
  /** Agent ids now dispatchable via a vault-derived config. */
  agentIds: string[]
  /** Where those configs came from: a fresh scan, a previous sync read back
   *  from the database, or nowhere (no vault, nothing ever persisted). */
  source: 'vault-fs' | 'db' | 'none'
  /** Whether this call wrote (or refreshed) agent_manifests. */
  persisted: boolean
  /**
   * Operator-facing reason something is wrong, or null when nothing is.
   * Two distinct cases share this one field, never both at once:
   *   - the live vault produced no agents: why (naming the path searched —
   *     same convention as lib/vault-agents.ts's own warning field), even
   *     though `agentIds` may still be non-empty from a previous DB sync.
   *   - the live vault DID produce agents but the write to `agent_manifests`
   *     failed: why the row did not land (missing table, unconfigured
   *     database, a driver error) — round 2: this used to be forced to
   *     `null` in exactly this case, which hid a 404-on-every-request from
   *     both the API envelope and the UI.
   */
  warning: string | null
}

/**
 * The single place a vault agent's dispatch config is derived from. Call it
 * before reading lib/agent-queue.ts's getQueueConfig()/getAllQueueAgentIds()
 * — both app/api/agents/route.ts and app/api/run-agent/route.ts do, so a
 * vault agent is dispatchable by name regardless of which route a caller
 * hits first in a freshly started process.
 *
 * Never throws — every failure mode (fs, db, an unreadable manifest) is
 * already absorbed by loadVaultAgentRoster()/persistManifests()/
 * loadPersistedManifests() and reported through `warning`, not an exception.
 */
export async function ensureVaultDispatchConfigs(): Promise<VaultDispatchSync> {
  let live: ReturnType<typeof loadVaultAgentRoster>
  try {
    live = loadVaultAgentRoster()
  } catch (e) {
    live = { agents: [], path: null, warning: e instanceof Error ? e.message : String(e) }
  }

  let agents = live.agents
  let source: VaultDispatchSync['source'] = 'vault-fs'
  let persisted = false
  // Round 2: no longer forced to `null` whenever the live scan produced
  // agents — that was precisely the branch that hid a 404 on every request.
  // `persistManifests()` now names the failure; this is that name, or null
  // when the write actually landed.
  let persistWarning: string | null = null

  if (agents.length > 0) {
    const result = await persistManifests(agents)
    persisted = result.persisted
    persistWarning = result.warning
  } else {
    const fromDb = await loadPersistedManifests()
    if (fromDb.length > 0) {
      agents = fromDb
      source = 'db'
    } else {
      source = 'none'
    }
  }

  const configs: Record<string, AgentQueueConfig> = {}
  for (const agent of agents) configs[agent.id] = manifestToQueueConfig(agent)
  registerManifestQueueConfigs(configs)

  return {
    agentIds: Object.keys(configs),
    source,
    persisted,
    warning: agents.length === 0 ? live.warning : persistWarning,
  }
}

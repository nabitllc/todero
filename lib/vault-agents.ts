// Brain2 vault agent registry — read-only.
//
// docs/brain2-integration.md is the binding contract: the vault at VAULT_DIR
// (lib/paths.ts, defaults to C:\Development\Mich-Brain2, override with
// TODERO_VAULT_DIR) is READ-ONLY to this app. This module only ever reads
// `Global_Agents/<agent>/manifest.json` — it must never create, modify, or
// delete anything under the vault, `_pending/` included; this piece does not
// touch `_pending/` at all.
//
// The vault is optional infrastructure, not a hard dependency: a host with no
// vault, or a vault with no Global_Agents directory, degrades to an empty
// roster and a warning naming the exact path searched. Never throws, and
// never invents an agent that has no manifest.json backing it.
//
// SERVER ONLY: reads the filesystem.

import { readdirSync, readFileSync, statSync } from 'fs'
import path from 'path'
import { VAULT_DIR } from './paths'

const GLOBAL_AGENTS_DIRNAME = 'Global_Agents'
// Not agents: _template is the manifest scaffold new agents are copied from,
// and any dotfile/README the directory may carry alongside real agent dirs.
const SKIP_DIRS = new Set(['_template'])

export interface VaultAgentModel {
  /** Cost-of-being-wrong tier — see Playbooks/Multi_Agent_Fanout.md. */
  tier: string
  claude_code_alias: string
  preferred: string
  /** The Ollama model name to route to when local_eligible is true. */
  fallback_local: string
}

/** One Global_Agents/<id>/manifest.json, mapped 1:1 onto Todero's shape. */
export interface VaultAgent {
  /** The manifest's directory name — the id every other field is keyed by. */
  id: string
  name: string
  description: string
  model: VaultAgentModel
  /** Tool names declared in the manifest (e.g. "filesystem_read", "shell_exec"). */
  tools: string[]
  compatible_with: string[]
  /** Whether a run for this agent may be routed to a local model (Ollama). */
  local_eligible: boolean
}

/** What the vault roster loader found, and — when it found nothing — why. */
export interface VaultRosterLoad {
  agents: VaultAgent[]
  /** Global_Agents/ actually scanned, or null when the vault was not found there. */
  path: string | null
  /** Operator-facing reason the roster is empty. Names the path searched. Null when agents were found. */
  warning: string | null
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback
}

/** A manifest.json's content, mapped onto VaultAgent — or null when it does not parse. */
function parseManifest(dirId: string, raw: string): VaultAgent | null {
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    return null
  }
  if (!isPlainObject(json)) return null

  const model = isPlainObject(json.model) ? json.model : {}
  const toolsRaw = Array.isArray(json.tools) ? json.tools : []
  const tools = toolsRaw
    .map((t) => (isPlainObject(t) ? asString(t.name) : typeof t === 'string' ? t : ''))
    .filter((n): n is string => n.length > 0)
  const compatibleWith = Array.isArray(json.compatible_with)
    ? json.compatible_with.filter((c): c is string => typeof c === 'string')
    : []

  return {
    id: dirId,
    name: asString(json.name, dirId),
    description: asString(json.description),
    model: {
      tier: asString(model.tier),
      claude_code_alias: asString(model.claude_code_alias),
      preferred: asString(model.preferred),
      fallback_local: asString(model.fallback_local),
    },
    tools,
    compatible_with: compatibleWith,
    local_eligible: json.local_eligible === true,
  }
}

/**
 * Load the vault's agent registry without ever throwing.
 *
 * Resolution: `<VAULT_DIR>/Global_Agents/<id>/manifest.json`. A missing vault,
 * a missing Global_Agents directory, or a directory with no readable manifest
 * are all *configuration* facts, not server faults — same contract as
 * lib/agent-roster.ts's loadAgentRoster(): an empty roster plus a warning
 * naming the exact path searched, never a crash, and never a substituted or
 * invented agent standing in for one the vault does not actually declare.
 */
export function loadVaultAgentRoster(): VaultRosterLoad {
  const globalAgentsDir = path.join(VAULT_DIR, GLOBAL_AGENTS_DIRNAME)

  let entries: string[]
  try {
    entries = readdirSync(globalAgentsDir)
  } catch {
    return {
      agents: [],
      path: null,
      warning: `Brain2 vault agent registry not found — looked in: ${globalAgentsDir}. Set TODERO_VAULT_DIR to point at the vault, or ignore this if the host has none.`,
    }
  }

  const agents: VaultAgent[] = []
  const unreadable: string[] = []
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry) || entry.startsWith('.')) continue
    const dirPath = path.join(globalAgentsDir, entry)
    let isDir = false
    try {
      isDir = statSync(dirPath).isDirectory()
    } catch {
      continue
    }
    if (!isDir) continue

    const manifestPath = path.join(dirPath, 'manifest.json')
    let raw: string
    try {
      raw = readFileSync(manifestPath, 'utf-8')
    } catch {
      // Not every directory under Global_Agents has to carry a manifest.
      continue
    }
    const parsed = parseManifest(entry, raw)
    if (parsed) agents.push(parsed)
    else unreadable.push(entry)
  }

  agents.sort((a, b) => a.id.localeCompare(b.id))

  if (agents.length === 0) {
    return {
      agents: [],
      path: globalAgentsDir,
      warning: `Brain2 vault Global_Agents/ exists at ${globalAgentsDir} but no readable manifest.json was found in it.`,
    }
  }
  return {
    agents,
    path: globalAgentsDir,
    warning:
      unreadable.length > 0
        ? `${unreadable.length} vault agent director${unreadable.length === 1 ? 'y' : 'ies'} had an unparseable manifest.json: ${unreadable.join(', ')}`
        : null,
  }
}

/**
 * Local-model routing for one vault agent: whether a run may go to Ollama,
 * and which model to use if so. `fallback_local` only means anything when
 * `local_eligible` is true — a tier-appropriate cloud model with a local
 * fallback name still is not eligible to run locally unless the manifest
 * says so explicitly.
 */
export function localRoutingFor(agent: Pick<VaultAgent, 'local_eligible' | 'model'>): {
  eligible: boolean
  model: string | null
} {
  return {
    eligible: agent.local_eligible,
    model: agent.local_eligible && agent.model.fallback_local ? agent.model.fallback_local : null,
  }
}

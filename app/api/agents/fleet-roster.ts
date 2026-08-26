// ─── app/api/agents/fleet-roster.ts — ONE definition of "who is in the fleet" ─
//
// THE DEFECT THIS EXISTS TO CLOSE
//
// Two surfaces under the same Fleet destination reported two different fleet
// sizes, and neither was arithmetically wrong — they were answering the same
// question from different sources:
//
//   Fleet ▸ Roster  (components/tabs/CrewTab.tsx → GET /api/agents)
//       unions THREE sources: the host's AGENTS.md, `agent_registrations`
//       (POST /api/connect), and the Brain2 vault registry.
//       Measured 2026-08-26 on this host: 28 agents
//       (14 agents-md · 1 registered · 13 vault).
//
//   Fleet ▸ Roles   (components/tabs/ResponsibilitiesCard.tsx →
//                    GET /api/agent-responsibilities)
//       asks `loadAgentRoster()` and nothing else — AGENTS.md alone.
//       Measured the same minute: 14 agents.
//
// So "which number is wrong" has an answer, and it is not "one of them is off
// by fourteen". The union is the truth about who exists; Roles was answering a
// narrower question using the wider question's word ("fleet").
//
// The consequence was real and invisible: the Roles assignment dropdown is
// built from `fleet.agents`, so fourteen agents that genuinely exist — every
// Brain2 vault agent and every self-registered one — could never be made
// accountable for an area, and nothing on screen said why.
//
// The rule below is therefore written ONCE and imported, rather than
// re-derived per surface. A second copy of a union rule is how the two numbers
// drifted apart in the first place.
//
// PRECEDENCE, and why it is not arbitrary: an id may be named by more than one
// source, and it must render exactly once.
//   agents-md  wins  — it is the host's own declaration, and it is the only
//                      source with display metadata (AGENT_META) behind it.
//   registered next  — a live connection is a stronger claim than a manifest
//                      file, and it carries a runtime and a connection id.
//   vault      last  — a manifest says an agent is DEFINED, not that anything
//                      has ever connected it.
// A losing source is not discarded: the winning row is enriched with the vault
// manifest (`AgentDto.vault`) where one exists. Rendering once is not the same
// as dropping data.
//
// SERVER ONLY: loadFleetRoster() reads the filesystem and the database.
// `unionFleetIds()` is pure, so it is testable without either.

import { loadAgentRoster } from '@/lib/agent-roster'
import { loadVaultAgentRoster } from '@/lib/vault-agents'
import { readRegistrations } from '@/lib/agent-registrations'

/**
 * Which source a given id was claimed by, after precedence is applied.
 * Mirrors GET /api/agents' per-row `rosterSource`.
 */
export type FleetIdSource = 'agents-md' | 'registered' | 'vault'

/**
 * The envelope-level answer. 'both' means "more than one source contributed a
 * row" — deliberately not 'many', because the wire value predates the third
 * source and renaming it would break every consumer that switches on it.
 */
export type FleetRosterSource = FleetIdSource | 'both' | 'none'

/** Precedence order, highest first. See the header comment. */
export const SOURCE_PRECEDENCE: readonly FleetIdSource[] = ['agents-md', 'registered', 'vault'] as const

export interface FleetIdInput {
  /** Ids declared by the host's AGENTS.md, in file order. */
  rosterIds: readonly string[]
  /** Ids present in `agent_registrations`. */
  registrationIds: readonly string[]
  /** Ids with a readable `Global_Agents/<id>/manifest.json`. */
  vaultIds: readonly string[]
}

export interface FleetIdUnion {
  /**
   * Every id in the fleet, each exactly once, in precedence order: every
   * agents-md id, then every registration-only id, then every vault-only id.
   * This is the same order GET /api/agents emits rows in, so a consumer can
   * zip the two without sorting.
   */
  ids: string[]
  /** id → the source that claimed it. Exactly `ids.length` entries. */
  sourceById: Record<string, FleetIdSource>
  /** Ids each source contributed AFTER precedence — these three are disjoint. */
  bySource: Record<FleetIdSource, string[]>
  /** The envelope-level value GET /api/agents reports as `rosterSource`. */
  rosterSource: FleetRosterSource
}

/**
 * The union rule, pure.
 *
 * `rosterSource` counts sources that CONTRIBUTED A ROW, not sources that had
 * something to say. That distinction is load-bearing and easy to get wrong: a
 * host whose vault names only ids AGENTS.md already declares contributed no
 * row of its own, so the answer is 'agents-md', not 'both' — the operator is
 * being told where the rows they can SEE came from, and there is no
 * vault-sourced row on screen to explain.
 *
 * Duplicate ids WITHIN one source are collapsed too; a roster file that lists
 * an agent twice is a typo, not two agents.
 */
export function unionFleetIds(input: FleetIdInput): FleetIdUnion {
  const sourceById: Record<string, FleetIdSource> = {}
  const bySource: Record<FleetIdSource, string[]> = { 'agents-md': [], registered: [], vault: [] }
  const ids: string[] = []

  const listFor: Record<FleetIdSource, readonly string[]> = {
    'agents-md': input.rosterIds,
    registered: input.registrationIds,
    vault: input.vaultIds,
  }

  for (const source of SOURCE_PRECEDENCE) {
    for (const id of listFor[source]) {
      // Claimed by a higher-precedence source, or a duplicate within this one.
      if (!id || Object.prototype.hasOwnProperty.call(sourceById, id)) continue
      sourceById[id] = source
      bySource[source].push(id)
      ids.push(id)
    }
  }

  const contributing = SOURCE_PRECEDENCE.filter((s) => bySource[s].length > 0)
  const rosterSource: FleetRosterSource =
    contributing.length > 1 ? 'both' : contributing.length === 1 ? contributing[0] : 'none'

  return { ids, sourceById, bySource, rosterSource }
}

/** Everything a surface needs to name the fleet AND say where it looked. */
export interface FleetRosterLoad extends FleetIdUnion {
  /** The AGENTS.md actually read, or null when none was found. */
  rosterPath: string | null
  /** Why AGENTS.md contributed nothing, naming the paths searched. */
  rosterWarning: string | null
  /** The `Global_Agents/` actually scanned, or null when none was found. */
  vaultPath: string | null
  /** Why the vault contributed nothing, naming the path searched. */
  vaultWarning: string | null
  /** Why `agent_registrations` contributed nothing (unconfigured db, etc.). */
  registrationWarning: string | null
}

/**
 * Load the whole fleet, from every source, without ever throwing.
 *
 * Each leg is independently optional and each failure is a CONFIGURATION fact
 * carried in its own warning — never a 500, and never a silently shorter list.
 * That is the contract lib/agent-roster.ts and lib/vault-agents.ts already
 * keep individually; this keeps it for the union.
 *
 * `includeRegistrations: false` exists for a caller with no database to ask.
 * It unions the two file-backed sources only and SAYS SO in
 * `registrationWarning`, rather than quietly returning a fleet that is short
 * by however many agents self-registered.
 */
export async function loadFleetRoster(
  opts: { includeRegistrations?: boolean } = {},
): Promise<FleetRosterLoad> {
  const includeRegistrations = opts.includeRegistrations !== false

  const roster = loadAgentRoster()

  // lib/vault-agents.ts catches every fs error internally and cannot throw by
  // construction; this is defense in depth so a future change there still
  // cannot take down a caller — the vault is optional infrastructure.
  let vault: ReturnType<typeof loadVaultAgentRoster>
  try {
    vault = loadVaultAgentRoster()
  } catch (e) {
    vault = { agents: [], path: null, warning: e instanceof Error ? e.message : String(e) }
  }

  let registrationIds: string[] = []
  let registrationWarning: string | null = null
  if (includeRegistrations) {
    try {
      const reg = await readRegistrations()
      registrationIds = Array.from(reg.data.keys())
      // `reg.error` is a structured DbError, not a string. Flattened to its
      // message here rather than stringified wholesale, so the warning reads
      // as a sentence instead of "[object Object]" — which is what a bare
      // `?? reg.error` would have put on screen.
      registrationWarning =
        reg.warning ?? (reg.error ? (reg.error.message ?? JSON.stringify(reg.error)) : null)
    } catch (e) {
      registrationWarning = e instanceof Error ? e.message : String(e)
    }
  } else {
    registrationWarning = 'agent_registrations was not consulted by this caller'
  }

  const union = unionFleetIds({
    rosterIds: roster.agents.map((a) => a.id),
    registrationIds,
    vaultIds: vault.agents.map((a) => a.id),
  })

  return {
    ...union,
    rosterPath: roster.path,
    rosterWarning: roster.warning,
    vaultPath: vault.path,
    vaultWarning: vault.warning,
    registrationWarning,
  }
}

/**
 * One sentence naming every place the fleet was looked for, for a surface that
 * must show its work. Written here so Roster and Roles cannot describe the
 * same search differently.
 *
 * The separator is U+222A SET UNION, the same character this file's header
 * comment and every test in the suite use for the union. It shipped as a
 * literal ASCII `u` (` u `) — "AGENTS.md u Global_Agents u agent_registrations"
 * — in a sentence whose entire job is showing its work. Fixed 2026-08-26 and
 * pinned by `__tests__/api/fleet-roster-union.test.ts` so it cannot regress to
 * a letter again.
 *
 * NO PRODUCTION CALLER YET, stated plainly rather than left to be discovered:
 * this exists for the `app/api/agent-responsibilities/route.ts` seam diff in
 * §4 of docs/rebuild/pieces/pieces8/fleet-liveness.md, which is not applied.
 * It is tested, not merely compiled.
 */
export function fleetSearchLine(load: FleetRosterLoad): string {
  const parts = [
    load.rosterPath ?? 'no AGENTS.md was found on this host',
    load.vaultPath ?? 'no Brain2 vault registry was found on this host',
    load.registrationWarning === null
      ? 'agent_registrations'
      : `agent_registrations (${load.registrationWarning})`,
  ]
  return `fleet = ${parts.join(' ∪ ')}`
}

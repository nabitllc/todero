'use client'
// The one roster every client-side agent picker reads.
//
// Before this hook, four separate files each shipped their own hand-written
// agent list — lib/agents-config.ts (13 entries, two of which no AGENTS.md on
// any host declares), ChatTab's AGENT_OPTIONS (5), IssuesTab's
// ASSIGNEE_OPTIONS (7) and PipelineTab's AGENTS (4). Every one of them
// disagreed with the 16 agents GET /api/agents actually serves, so the Chat
// selector offered agents that do not exist while the Issues assignee dropdown
// hid nine that do. Deleting one of those lists just moves the lie to the next
// file, so all of them now come through here.
//
// The rule this hook exists to enforce: when the host has no roster, callers
// get an EMPTY list and a warning naming the path that was searched. There is
// no built-in fallback to fall back to — "no agents configured" is a truthful
// answer and an invented default agent is not.

import { useMemo } from 'react'
import { useApiData, type ApiError } from '@/hooks/useApiData'
import type { RosterMeta } from '@/components/tabs/AgentsTab'
import type { VaultBadgeInfo } from '@/lib/vault-badge'

/**
 * One roster row as the API serves it. This is the client-side view of the
 * route's `AgentDto`: identity and display only. Liveness fields exist on the
 * wire but pickers have no business rendering them, so they are not restated
 * here — components that need them read /api/agents directly.
 *
 * `vault` IS restated, unlike the liveness fields: it is the one field this
 * hook's whole reason for existing (docs/brain2-integration.md) hinges on —
 * a picker needs it to know an id came from the Brain2 vault rather than any
 * roster/registration a dispatcher actually knows how to run.
 */
export interface RosterAgent {
  id: string
  name: string
  emoji: string
  role: string
  color: string
  model: string
  modelShort: string
  floor: boolean
  /** Brain2 vault manifest data for this id, or null when the vault does not name it. */
  vault: VaultBadgeInfo | null
  /**
   * registry-reaches-dispatch piece: whether POST /api/run-agent?agent=<id>
   * would find a config for this id right now — computed server-side (see
   * app/api/agents/route.ts's AgentDto.dispatchable), never recomputed from
   * a client-side import of lib/agent-queue.ts. That file's getQueueConfig()
   * only knows Todero's own hardcoded lanes in the BROWSER's copy of the
   * module; it has no way to see a config the server registered from a
   * Brain2 vault manifest. A picker that wants to say "not dispatchable"
   * must read this field, not call getQueueConfig() itself.
   */
  dispatchable: boolean
}

interface AgentsEnvelope {
  agents: RosterAgent[]
  rosterSource: string
  rosterWarning: string | null
  rosterPath: string | null
  /** Global_Agents/ actually scanned, or null when the vault was not found there — see app/api/agents/route.ts. */
  vaultPath: string | null
  /** Operator-facing reason the vault contributed no agents, naming the path searched. Null when it did. */
  vaultWarning: string | null
  /** registry-reaches-dispatch piece, round 2: the dispatch-side persist result. See RosterMeta's docstring. */
  vaultSync?: { source: 'vault-fs' | 'db' | 'none'; persisted: boolean; warning: string | null } | null
  /** Whether this host's configured LLM endpoint is local — see lib/vault-badge.ts's resolveVaultBadge(). */
  localProviderConfigured: boolean
}

export interface AgentRosterState {
  /** Every agent the host's AGENTS.md declares. Empty means empty — never a default. */
  agents: RosterAgent[]
  /** 'agents-md' when a roster file was read, 'none' when none was found. */
  rosterSource: string
  /** Operator-facing reason the roster is empty, naming the path searched. */
  rosterWarning: string | null
  rosterPath: string | null
  /** Global_Agents/ actually scanned, or null when the vault was not found there. */
  vaultPath: string | null
  /** Operator-facing reason the vault contributed no agents, naming the path searched. Null when it did. */
  vaultWarning: string | null
  /** registry-reaches-dispatch piece, round 2: the dispatch-side persist result. See RosterMeta's docstring. */
  vaultSync: { source: 'vault-fs' | 'db' | 'none'; persisted: boolean; warning: string | null } | null
  /** Whether this host's configured LLM endpoint is local — see lib/vault-badge.ts's resolveVaultBadge(). */
  localProviderConfigured: boolean
  /** Non-null when the request itself failed. `agents` is empty in that case. */
  error: ApiError | null
  loading: boolean
  refetch: () => void
  /** id → row, for the common "render the selected agent" lookup. */
  byId: Record<string, RosterAgent>
  /** The same three fields AgentsTab passes around as `rosterMeta`. */
  meta: RosterMeta
}

/**
 * Fetch the roster once per mounting component.
 *
 * Deliberately not cached in a module-level singleton: /api/agents is
 * `Cache-Control: no-store` because it also carries live run state, and a
 * stale shared copy is how a picker ends up offering an agent the operator
 * removed from AGENTS.md an hour ago.
 */
export function useAgentRoster(): AgentRosterState {
  const { data, error, loading, refetch } = useApiData<AgentsEnvelope>('/api/agents')

  const agents = useMemo<RosterAgent[]>(
    () => (Array.isArray(data?.agents) ? data.agents : []),
    [data],
  )

  const byId = useMemo(
    () => Object.fromEntries(agents.map(a => [a.id, a])) as Record<string, RosterAgent>,
    [agents],
  )

  const rosterSource = data?.rosterSource ?? 'none'
  const rosterWarning = data?.rosterWarning ?? null
  const rosterPath = data?.rosterPath ?? null
  const vaultPath = data?.vaultPath ?? null
  const vaultWarning = data?.vaultWarning ?? null
  const vaultSync = data?.vaultSync ?? null
  const localProviderConfigured = data?.localProviderConfigured ?? false

  const meta = useMemo<RosterMeta>(
    () => ({ source: rosterSource, warning: rosterWarning, path: rosterPath, vaultPath, vaultWarning, vaultSync, localProviderConfigured }),
    [rosterSource, rosterWarning, rosterPath, vaultPath, vaultWarning, vaultSync, localProviderConfigured],
  )

  return {
    agents, rosterSource, rosterWarning, rosterPath, vaultPath, vaultWarning, vaultSync, localProviderConfigured,
    error, loading, refetch, byId, meta,
  }
}

/**
 * The sentence a picker shows in place of options when the roster is empty.
 * Shared so the Chat selector, the Issues assignee filter and the Pipeline
 * lanes all say the same thing rather than three different empty states.
 */
export function rosterEmptyReason(state: Pick<AgentRosterState, 'rosterWarning'>): string {
  return (
    state.rosterWarning ??
    'No AGENTS.md roster was found on this host. Set AGENTS_MD_PATH to point at one.'
  )
}

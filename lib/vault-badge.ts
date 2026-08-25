// Shared client-side resolution for "what model badge does a vault-backed
// agent row actually show?" — docs/brain2-integration.md's mapping
// (`tier` drives model selection, `local_eligible` drives whether a run may
// be routed to Ollama, `fallback_local` names the model) applied at render
// time, not just computed once by the API and left unread.
//
// One rule, used everywhere a vault-backed row renders a model badge
// (components/tabs/AgentsTab.tsx, components/tabs/AgentDetailView.tsx,
// components/crew/AgentDetailView.tsx, components/office/OfficeSidebar.tsx):
// a card that shows the manifest's cloud `preferred` name (e.g. "Opus")
// directly above its tier (e.g. "mid tier") is self-contradictory. Fixing
// that in one file and leaving the others reading `preferred` is the exact
// "Goodharted the gate" failure mode this piece was rejected for — see
// BRIEF.md directive #5 — so every caller goes through this one function.

/** The `vault` field GET /api/agents attaches to a row — see app/api/agents/route.ts's AgentDto. */
export interface VaultBadgeInfo {
  tier: string
  claudeCodeAlias: string
  preferred: string
  fallbackLocal: string
  localEligible: boolean
  /** Resolved server-side from localEligible/fallbackLocal — null unless a local run is actually allowed. */
  localModel: string | null
  description?: string
}

export interface ResolvedVaultBadge {
  /** The model label to render in place of the generic `modelShort`. */
  label: string
  /** Where the label came from — never rendered directly, but lets a caller style the three cases differently if it wants to. */
  via: 'local' | 'claude-alias' | 'preferred'
}

/**
 * Resolve the model badge for one vault-backed row.
 *
 * `vault.localModel` wins only when the manifest allows local routing AND
 * this host's configured LLM provider is actually local (Ollama / LM
 * Studio) — GET /api/agents' `localProviderConfigured`. A tier-appropriate
 * cloud alias with a local fallback name is not "the model that would
 * actually run" on a host pointed at a cloud endpoint.
 *
 * Otherwise the Claude Code alias (e.g. "sonnet") is the honest label — it
 * is what a Claude Code run for this agent actually binds to. The generic
 * `preferred` name (e.g. "Opus") is only a last resort when the manifest
 * carries no alias at all; showing it unconditionally is what produced
 * "Opus" printed directly above "mid tier" on six cards.
 */
export function resolveVaultBadge(vault: VaultBadgeInfo, localProviderConfigured: boolean): ResolvedVaultBadge {
  if (vault.localEligible && localProviderConfigured && vault.localModel) {
    return { label: vault.localModel, via: 'local' }
  }
  if (vault.claudeCodeAlias) {
    return { label: vault.claudeCodeAlias, via: 'claude-alias' }
  }
  return { label: vault.preferred || '—', via: 'preferred' }
}

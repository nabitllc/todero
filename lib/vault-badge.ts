// Type shared by every surface that carries a row's Brain2 vault manifest
// data (GET /api/agents' `vault` field — see app/api/agents/route.ts's
// AgentDto).
//
// agent-config-panel-truth piece (round 3): this file used to also export
// `resolveVaultBadge()` — a client-side "what model badge should this
// vault-backed row show?" resolution keyed on `localProviderConfigured`, an
// env-URL heuristic ("does LLM_BASE_URL's port look like Ollama's") that
// answers a different question than "which runtime actually wins
// selection". That let a vault-backed agent's header badge disagree with
// its own Configuration panel in the same modal — the panel called a
// resolver that walks the real dispatch chain (lib/resolve-dispatch-
// model.ts's `resolveDispatchModel()`), the badge called this file's
// heuristic instead, and the two routinely picked different runtimes.
//
// `resolveDispatchModel()` is now the ONLY model resolver in the app.
// GET /api/agents computes every row's `model`/`modelShort` from it
// server-side (one runtime probe + one live-models fetch, reused across the
// whole roster — see app/api/agents/route.ts's GET handler), so every
// client-side badge — the Team tab card, the modal header, the office
// sidebar — just renders the field the server already resolved. There is
// nothing left for a client-side resolver to do; this file keeps only the
// type its callers still need.

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

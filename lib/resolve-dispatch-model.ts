// agent-config-panel-truth piece (round 3): the chain-walk + mapModel
// resolution that used to live only inside GET /api/run-agent?info=1
// (app/api/run-agent/route.ts), extracted so every surface that claims to
// show "the model that would actually run" — the Configuration panel, the
// modal header badge, the Team tab card, the office sidebar, and GET
// /api/agents' own `model`/`modelShort` fields — computes it exactly the
// same way, from the same probe, instead of four of those five reading a
// separate env-URL heuristic (the deleted lib/vault-badge.ts) that answers
// "does LLM_BASE_URL's port look like Ollama's", not "which runtime
// actually wins selection".
//
// `probeRuntimes()` and the `liveModels` fetch are both meant to be called
// ONCE per request and threaded through every `resolveDispatchModel()` call
// that request makes (GET /api/agents resolves up to ~42 rows this way) —
// neither this module nor its callers may call `listRuntimes()` or
// `fetchLiveModels()` per row, or a full roster render turns into dozens of
// live probes against the runtime registry and the LLM endpoint.

import type { AgentQueueConfig, ModelAlias } from './agent-queue'
import { listRuntimes, type RuntimeListEntry } from './runtimes'
import { mapModel } from './runtimes/openai-api'
import { fetchLiveModels, LLM_BASE_URL, type LiveModelsResult } from './llm-provider'

export interface DispatchModelAlternative {
  label: string
  reason: string
}

export interface ResolvedDispatchModel {
  /** Runtime the chain walk actually picked, or null when nothing in the
   *  chain — and nothing in the registry — reports available. */
  resolvedRuntime: string | null
  modelAlias: ModelAlias
  /** The concrete model id, only meaningful (and only ever set) when
   *  `resolvedRuntime === 'openai-api'` — the same mapModel() call the real
   *  spawn path makes, against the same live model roster. */
  resolvedModelId: string | null
  /** Set iff `resolvedRuntime === 'openai-api'` and mapModel() came back
   *  null — the endpoint's own reason, never a guess. */
  resolvedModelError: string | null
  /** Every other chain binding, plus the manifest's `preferred` display
   *  name when the config carries one, each labelled with why it did not
   *  win. Never includes the winner. */
  alternatives: DispatchModelAlternative[]
  chainLength: number
  /**
   * The one line every UI surface should render verbatim — never re-derive
   * a label from `agent.model`, `vault.preferred`, or any other manifest
   * field. Either "<runtime> · <alias>", the concrete model id when the
   * winner is openai-api, or "not resolvable — <reason>" when this agent
   * cannot actually be dispatched right now.
   */
  label: string
}

/**
 * One probe of every registered runtime (priority + live availability +
 * the sensor's own unavailableReason) — call this once per request and
 * pass the result into every `resolveDispatchModel()` call that request
 * makes.
 */
export async function probeRuntimes(): Promise<Map<string, RuntimeListEntry>> {
  const list = await listRuntimes()
  return new Map(list.map(r => [r.name, r]))
}

/**
 * Highest-priority AVAILABLE runtime in the probe, honoring TODERO_RUNTIME
 * first — mirrors lib/runtimes/index.ts's selectRuntime(), but reads the
 * already-probed data instead of re-querying isAvailable() per call. Unlike
 * selectRuntime(), this does NOT fall back to naming an unavailable runtime
 * as a "last resort": a caller that gets `null` back must say so, not print
 * a runtime name that would fail to actually dispatch.
 */
function pickAvailableRuntime(runtimeByName: Map<string, RuntimeListEntry>): { name: string | null; reason: string | null } {
  const envName = process.env.TODERO_RUNTIME
  if (envName) {
    const entry = runtimeByName.get(envName)
    if (entry?.available) return { name: envName, reason: null }
  }
  const sorted = Array.from(runtimeByName.values()).filter(r => r.available).sort((a, b) => b.priority - a.priority)
  if (sorted[0]) return { name: sorted[0].name, reason: null }
  const reasons = Array.from(runtimeByName.values()).map(r => `${r.name}: ${r.unavailableReason ?? 'unavailable'}`).join('; ')
  return { name: null, reason: runtimeByName.size > 0 ? reasons : 'no runtime is registered' }
}

/**
 * The exact chain walk + mapModel resolution GET /api/run-agent?info=1 and
 * the POST spawn path both perform (POST's walk is at app/api/run-agent/
 * route.ts's `runtime` selection block; this mirrors it via the guard-free
 * probe instead of getRuntimeByName so it can run outside the dispatch
 * guard, same as the read-only info endpoint always has).
 *
 * `runtimeByName` must be a `probeRuntimes()` result. `liveModels`, when
 * given, is reused instead of `mapModel()` issuing its own live GET against
 * the endpoint's `/models` — pass a single `fetchLiveModels()` result when
 * resolving many agents in one request.
 */
export async function resolveDispatchModel(
  config: AgentQueueConfig,
  runtimeByName: Map<string, RuntimeListEntry>,
  liveModels?: LiveModelsResult,
): Promise<ResolvedDispatchModel> {
  let resolvedRuntime: string | null
  let modelAlias: ModelAlias
  let pickedIndex = -1
  let fallbackReason: string | null = null

  if (config.modelChain && config.modelChain.length > 0) {
    for (let i = 0; i < config.modelChain.length; i++) {
      if (runtimeByName.get(config.modelChain[i].runtime)?.available) {
        pickedIndex = i
        break
      }
    }
    if (pickedIndex >= 0) {
      resolvedRuntime = config.modelChain[pickedIndex].runtime
      modelAlias = config.modelChain[pickedIndex].alias
    } else {
      const fb = pickAvailableRuntime(runtimeByName)
      resolvedRuntime = fb.name
      fallbackReason = fb.reason
      modelAlias = config.model
    }
  } else {
    const fb = pickAvailableRuntime(runtimeByName)
    resolvedRuntime = fb.name
    fallbackReason = fb.reason
    modelAlias = config.model
  }

  let resolvedModelId: string | null = null
  let resolvedModelError: string | null = null
  if (resolvedRuntime === 'openai-api') {
    const mapped = await mapModel(modelAlias, config.localFallbackModel, liveModels)
    if (mapped) {
      resolvedModelId = mapped
    } else {
      const live = liveModels ?? await fetchLiveModels()
      resolvedModelError = !live.ok
        ? live.error
        : live.models.length === 0
          ? `${LLM_BASE_URL}/models returned no models — pull one first (e.g. \`ollama pull qwen2.5-coder:7b\`)`
          : `none of ${[config.localFallbackModel, modelAlias].filter(Boolean).map(c => `"${c}"`).join(', ')} ` +
            `match any id ${LLM_BASE_URL}/models reports (${live.models.map(m => m.id).join(', ') || 'none'})`
    }
  }

  const alternatives: DispatchModelAlternative[] = []
  if (config.modelChain) {
    config.modelChain.forEach((binding, i) => {
      if (i === pickedIndex) return
      const isFallbackLocal = binding.runtime === 'openai-api' && !!config.localFallbackModel
      const label = isFallbackLocal ? `fallback_local ${config.localFallbackModel}` : `${binding.runtime} · ${binding.alias}`
      const reason = pickedIndex >= 0 && i > pickedIndex
        ? `not selected: ${resolvedRuntime} (priority ${runtimeByName.get(resolvedRuntime ?? '')?.priority ?? '?'}) is available and wins runtime selection`
        : `not selected: ${runtimeByName.get(binding.runtime)?.unavailableReason ?? `${binding.runtime} is unavailable`}`
      alternatives.push({ label, reason })
    })
  }
  if (config.preferred) {
    alternatives.push({
      label: `preferred (manifest) ${config.preferred}`,
      reason:
        `not selected: "preferred" is the manifest's display name for this agent's tier, not a ` +
        `dispatchable runtime binding — this agent dispatches via claude_code_alias "${config.model}" ` +
        `(runtime claude-code) or fallback_local (runtime openai-api), never a raw preferred id`,
    })
  }

  let label: string
  if (resolvedRuntime === null) {
    label = `not resolvable — ${fallbackReason ?? 'no runtime available'}`
  } else if (resolvedRuntime === 'openai-api') {
    label = resolvedModelId ?? `not resolvable — ${resolvedModelError ?? 'model could not be mapped'}`
  } else {
    label = `${resolvedRuntime} · ${modelAlias}`
  }

  return {
    resolvedRuntime,
    modelAlias,
    resolvedModelId,
    resolvedModelError,
    alternatives,
    chainLength: config.modelChain?.length ?? 0,
    label,
  }
}

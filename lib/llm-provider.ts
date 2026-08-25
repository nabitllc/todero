// The chat feature's LLM seam. One place that knows how to reach the
// OpenAI-compatible endpoint configured by LLM_BASE_URL — Ollama by default
// on this machine, but any server speaking the same chat-completions /
// models shape works by changing the env var, not this file.
//
// Owner directive (2026-08): no hosted LLM gateway, no cloud vendor SDK.
// The local endpoint is the only one wired up for now. There is deliberately
// no hardcoded vendor model list anywhere in this seam — every model id it
// will accept comes from a live GET against `${LLM_BASE_URL}/models`, so an
// unknown id is rejected by name rather than silently rewritten to a model
// that happens to exist.

export const LLM_BASE_URL = (process.env.LLM_BASE_URL || 'http://localhost:11434/v1').replace(/\/+$/, '')
export const LLM_API_KEY = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || 'local'
// A local server has its own model names (qwen2.5-coder:7b); there is no
// vendor default to fall back to, so an unset LLM_MODEL means "use whatever
// the live /models call reports first."
export const LLM_DEFAULT_MODEL = process.env.LLM_MODEL || ''

/**
 * Short name for whatever is answering at LLM_BASE_URL. Only used to let a
 * caller write a model id provider-qualified (`ollama/qwen2.5-coder:7b`)
 * instead of bare (`qwen2.5-coder:7b`) — it is NOT a vendor branch, and
 * nothing routes on it. Derived from the configured URL so pointing
 * LLM_BASE_URL somewhere else does not require a code change; override with
 * LLM_PROVIDER_ID when the derivation is wrong for your server.
 */
function deriveProviderId(baseUrl: string): string {
  let u: URL
  try {
    u = new URL(baseUrl)
  } catch {
    return 'local'
  }
  // The default ports of the local servers this seam is used with.
  if (u.port === '11434') return 'ollama'
  if (u.port === '1234') return 'lmstudio'
  // A bare IP or loopback name has no vendor in it — `127.0.0.1` must not
  // become the provider id `127`.
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || /^[\d.]+$/.test(host) || host.includes(':')) return 'local'
  // `api.together.xyz` -> `together`: drop a leading `api`/`www` label and any
  // TLD, leaving the recognizable name.
  const labels = host.split('.').filter(l => l && l !== 'api' && l !== 'www')
  return labels[0] || 'local'
}
export const LLM_PROVIDER_ID = (process.env.LLM_PROVIDER_ID || deriveProviderId(LLM_BASE_URL)).toLowerCase()

/**
 * Map a requested model id onto one the configured endpoint actually reports.
 *
 * Accepts the id bare (`qwen2.5-coder:7b`) or qualified with THIS provider's
 * name (`ollama/qwen2.5-coder:7b`). A prefix naming any other provider is
 * never stripped, so `anthropic/claude-sonnet-4-5` stays unknown instead of
 * being silently answered by whichever model is running locally.
 *
 * Returns null when nothing matches — callers report the id by name.
 */
export function resolveModelId(requested: string, known: Iterable<string>): string | null {
  const ids = known instanceof Set ? known : new Set(known)
  if (ids.has(requested)) return requested
  const slash = requested.indexOf('/')
  if (slash > 0) {
    const prefix = requested.slice(0, slash).toLowerCase()
    const rest = requested.slice(slash + 1)
    if (prefix === LLM_PROVIDER_ID && ids.has(rest)) return rest
  }
  return null
}

/**
 * The one way any route turns a caller-supplied model id (or its absence)
 * into an id this install can actually reach.
 *
 * Every branch is explicit. `undefined` means "use the configured default",
 * which is LLM_MODEL or the first id the endpoint reports — never a vendor
 * name. An id the roster does not contain comes back as a 400 naming it, and
 * an endpoint that will not answer comes back as a 502 naming the URL. No
 * path through here can produce a model the operator did not configure.
 */
export async function resolveConfiguredModel(
  requested?: string | null,
): Promise<
  | { ok: true; model: string }
  | { ok: false; status: 400 | 502; error: string; id?: string }
> {
  const live = await fetchLiveModels()
  if (!live.ok) return { ok: false, status: 502, error: live.error }
  if (live.models.length === 0) {
    return {
      ok: false,
      status: 502,
      error: `${LLM_BASE_URL}/models returned no models — pull one first (e.g. \`ollama pull qwen2.5-coder:7b\`)`,
    }
  }
  const ids = live.models.map(m => m.id)
  const wanted = requested && requested !== 'default' ? requested : (LLM_DEFAULT_MODEL || ids[0])
  const model = resolveModelId(wanted, ids)
  if (!model) {
    return {
      ok: false,
      status: 400,
      error: `unknown model "${wanted}" — not present in ${LLM_BASE_URL}/models`,
      id: wanted,
    }
  }
  return { ok: true, model }
}

export interface LlmModel {
  id: string
  /** The context window the running server has ACTUALLY allocated for this
   *  model right now, read live from Ollama's `/api/ps`. This — not the
   *  trained window — is the number a conversation gets truncated against,
   *  so it is the only one any budget meter may be drawn from.
   *
   *  Absent when the model is not currently loaded (`/api/ps` only lists
   *  resident models) or when the endpoint doesn't speak that API. Absent
   *  means unknown: it is never backfilled from trainedContextLength. */
  servedContextLength?: number
  /** The window the model was TRAINED with, from `/api/show` model_info.
   *  Informational only — a 32768-token trained window says nothing about
   *  what the loaded slot will accept (this host serves 4096). Never use it
   *  as a budget denominator. */
  trainedContextLength?: number
}

export type LiveModelsResult =
  | { ok: true; models: LlmModel[] }
  | { ok: false; error: string }

// The OpenAI-compat `/v1/models` list (what fetchLiveModels queries) never
// carries context-window size. Two different Ollama endpoints do, and they
// report two DIFFERENT numbers:
//
//   GET  /api/ps    -> models[].context_length — the window of the slot the
//                      server has loaded right now. Prompts are truncated
//                      against THIS. Only lists resident models.
//   POST /api/show  -> model_info["<family>.context_length"] — the window the
//                      weights were trained with. Frequently much larger than
//                      what is served (32768 trained vs 4096 served here).
//
// Reporting the trained number as if it were the budget is exactly the kind of
// pretending this seam exists to remove, so the two are kept apart by name and
// the served one is the only one callers are allowed to meter against.
const OLLAMA_NATIVE_BASE = LLM_BASE_URL.replace(/\/v1$/, '')

/**
 * Map of model id -> the context window its currently-loaded slot has.
 * Models that are not loaded simply do not appear; an endpoint that doesn't
 * speak `/api/ps` yields an empty map. Either way the answer is "unknown",
 * never a substituted trained value.
 */
async function fetchServedContextLengths(timeoutMs: number): Promise<Map<string, number>> {
  const served = new Map<string, number>()
  try {
    const res = await fetch(`${OLLAMA_NATIVE_BASE}/api/ps`, {
      headers: { Authorization: `Bearer ${LLM_API_KEY}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return served
    const body = await res.json().catch(() => null)
    const running = Array.isArray(body?.models) ? body.models : []
    for (const entry of running) {
      const len = entry?.context_length
      if (typeof len !== 'number' || len <= 0) continue
      // `/api/ps` carries the id under both `model` and `name`; they can
      // differ from each other in tag form, so index whichever are present.
      for (const key of [entry?.model, entry?.name]) {
        if (typeof key === 'string' && key) served.set(key, len)
      }
    }
  } catch {
    // Not an Ollama-shaped endpoint — leave the map empty.
  }
  return served
}

/** The window the weights were trained with. Informational; see the note above. */
async function fetchTrainedContextLength(modelId: string, timeoutMs: number): Promise<number | undefined> {
  try {
    const res = await fetch(`${OLLAMA_NATIVE_BASE}/api/show`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${LLM_API_KEY}` },
      body: JSON.stringify({ model: modelId }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!res.ok) return undefined
    const body = await res.json().catch(() => null)
    const info = body?.model_info
    if (!info || typeof info !== 'object') return undefined
    // Family-prefixed key (`qwen2.context_length`, `llama.context_length`, …),
    // so match on the suffix rather than hardcoding an architecture.
    const key = Object.keys(info).find(k => k.endsWith('.context_length'))
    const val = key ? info[key] : undefined
    return typeof val === 'number' && val > 0 ? val : undefined
  } catch {
    // Endpoint doesn't speak the native Ollama API (e.g. a different
    // OpenAI-compatible server behind LLM_BASE_URL) — unknown, not a guess.
    return undefined
  }
}

/**
 * Live GET against `${LLM_BASE_URL}/models`. Never a hardcoded list — an
 * unreachable endpoint or an empty roster is reported by name so a caller
 * can show it to the operator instead of guessing.
 */
export async function fetchLiveModels(
  timeoutMs = 5000,
  opts: { includeContextLength?: boolean } = {},
): Promise<LiveModelsResult> {
  let res: Response
  try {
    res = await fetch(`${LLM_BASE_URL}/models`, {
      headers: { Authorization: `Bearer ${LLM_API_KEY}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return { ok: false, error: `${LLM_BASE_URL} is unreachable — ${detail}` }
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return { ok: false, error: `${LLM_BASE_URL}/models responded ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}` }
  }
  const body = await res.json().catch(() => null)
  const models: LlmModel[] = Array.isArray(body?.data) ? body.data : []
  if (opts.includeContextLength) {
    const served = await fetchServedContextLengths(timeoutMs)
    await Promise.all(models.map(async m => {
      const loaded = served.get(m.id)
      if (loaded !== undefined) m.servedContextLength = loaded
      const trained = await fetchTrainedContextLength(m.id, timeoutMs)
      if (trained !== undefined) m.trainedContextLength = trained
    }))
  }
  return { ok: true, models }
}

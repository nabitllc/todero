// The chat feature's LLM seam. One place that knows how to reach the
// OpenAI-compatible endpoint configured by LLM_BASE_URL — Ollama by default
// on this machine, but any server speaking the same chat-completions /
// models shape works by changing the env var, not this file.
//
// Owner directive (2026-08): no OpenRouter, no cloud LLM. Local Ollama only,
// for now. There is deliberately no hardcoded vendor model list anywhere in
// this seam — every model id it will accept comes from a live GET against
// `${LLM_BASE_URL}/models`, so an unknown id is rejected by name rather than
// silently rewritten to a model that exists.

export const LLM_BASE_URL = (process.env.LLM_BASE_URL || 'http://localhost:11434/v1').replace(/\/+$/, '')
export const LLM_API_KEY = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || 'local'
// A local server has its own model names (qwen2.5-coder:7b); there is no
// vendor default to fall back to, so an unset LLM_MODEL means "use whatever
// the live /models call reports first."
export const LLM_DEFAULT_MODEL = process.env.LLM_MODEL || ''

export interface LlmModel {
  id: string
  /** Real context window in tokens, measured live from the endpoint's own
   *  metadata. Absent — never guessed or defaulted — when the endpoint
   *  doesn't report one, so callers can render "unknown" instead of a made
   *  up ceiling. */
  contextLength?: number
}

export type LiveModelsResult =
  | { ok: true; models: LlmModel[] }
  | { ok: false; error: string }

// The OpenAI-compat `/v1/models` list (what fetchLiveModels queries) never
// carries context-window size. Ollama's native `/api/show` does, under
// `model_info["<family>.context_length"]` — family-prefixed because the key
// name depends on the model architecture (qwen2, llama, etc.), so this reads
// whichever key actually ends in `.context_length` rather than hardcoding a
// family name.
const OLLAMA_NATIVE_BASE = LLM_BASE_URL.replace(/\/v1$/, '')

async function fetchContextLength(modelId: string, timeoutMs: number): Promise<number | undefined> {
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
    await Promise.all(models.map(async m => {
      const cl = await fetchContextLength(m.id, timeoutMs)
      if (cl !== undefined) m.contextLength = cl
    }))
  }
  return { ok: true, models }
}

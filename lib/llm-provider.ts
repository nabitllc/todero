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

export interface LlmModel { id: string }

export type LiveModelsResult =
  | { ok: true; models: LlmModel[] }
  | { ok: false; error: string }

/**
 * Live GET against `${LLM_BASE_URL}/models`. Never a hardcoded list — an
 * unreachable endpoint or an empty roster is reported by name so a caller
 * can show it to the operator instead of guessing.
 */
export async function fetchLiveModels(timeoutMs = 5000): Promise<LiveModelsResult> {
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
  return { ok: true, models }
}

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
  | { ok: false; status: 400 | 502; error: string; id?: string; kind?: LiveModelsFailureKind }
> {
  const live = await fetchLiveModels()
  // `kind` rides along so a caller can branch on WHY without string-matching
  // prose. 'not-openai-compatible' in particular is a configuration fault the
  // operator has to fix, not a transient outage to retry.
  if (!live.ok) return { ok: false, status: 502, error: live.error, kind: live.kind }
  if (live.models.length === 0) {
    // No `kind`: an empty roster is not a fetch FAILURE — fetchLiveModels
    // reported ok — it is this function's own refusal to invent a model id.
    return { ok: false, status: 502, error: noModelsError() }
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

/**
 * Why a live roster read failed, as a value rather than only as prose.
 *
 * `not-openai-compatible` is the one this enum exists for. It used to be
 * indistinguishable from success: `fetchLiveModels` parsed the body with
 * `res.json().catch(() => null)` and then took `Array.isArray(body?.data) ?
 * body.data : []`, so ANY 200 — an HTML index page, a proxy login screen, a
 * 404 page served with status 200, Ollama's NATIVE `/api/tags` shape when
 * LLM_BASE_URL is missing its `/v1` suffix — came back as
 * `{ ok: true, models: [] }`: byte-for-byte what a healthy Ollama with
 * nothing pulled reports. Measured on 2026-08-26 against seven deliberately
 * wrong servers; four separate causes produced that one identical answer.
 *
 * Those are not the same problem and do not have the same fix ("pull a model"
 * vs "LLM_BASE_URL points at the wrong thing"), and the one an operator would
 * actually act on was the invisible one. `scripts/lib/env-report.mjs`'s
 * `probeOpenAiShape()` already told them apart at DIAGNOSIS time; this makes
 * the PRODUCT path say it too, at the moment of failure, in the message the
 * user sees.
 */
export type LiveModelsFailureKind =
  /** The socket never produced a response: refused, DNS failure, timeout. */
  | 'unreachable'
  /** A response arrived carrying a non-2xx status. */
  | 'error-status'
  /** A 2xx arrived, but it is not the OpenAI `/models` shape at all. */
  | 'not-openai-compatible'

export type LiveModelsResult =
  | { ok: true; models: LlmModel[] }
  // `kind` is REQUIRED, not optional. It was optional for one round because
  // lib/runtimes/openai-api.ts hand-rolled its own copy of this result and set
  // no kind — which is exactly how that file kept the original defect alive
  // after this one was fixed (a plain HTML page came back from its
  // `fetchModelsFrom()` as `{ ok: true, models: [] }`, so /api/health and the
  // runtimes registry called an HTML page a reachable provider). The
  // duplicated parser is gone: both callers now go through
  // `readModelsResponse()` / `unreachableModelsResult()` below, so the
  // compiler — not a comment — is what stops the next hand-rolled copy from
  // reporting a failure with no reason attached.
  | { ok: false; error: string; kind: LiveModelsFailureKind }

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

/** First ~120 printable characters of a body, whitespace collapsed, so an
 *  HTML page is recognisable in an error string without pasting a page into
 *  a toast. */
function bodySnippet(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return '(empty body)'
  return flat.length > 120 ? `${flat.slice(0, 120)}…` : flat
}

/**
 * The one sentence for "this endpoint IS OpenAI-compatible and genuinely has
 * nothing loaded". Shared by every chat route so the three of them cannot
 * drift into three different phrasings of the same state — and, more to the
 * point, so this sentence is now reachable ONLY from that state. Before the
 * shape check above, four unrelated misconfigurations printed it too.
 */
export function noModelsError(): string {
  return `${LLM_BASE_URL}/models returned no models — the endpoint is OpenAI-compatible but its roster is empty; pull one first (e.g. \`ollama pull qwen2.5-coder:7b\`)`
}

/**
 * The failure a caller reports when the socket never produced a response at
 * all: connection refused, DNS failure, TLS failure, timeout.
 *
 * Exported so every place in the repo that dials a `/models` endpoint returns
 * the SAME shape with the SAME kind. `lib/runtimes/openai-api.ts` used to
 * hand-roll this (and the parser below); see the note on `LiveModelsResult`.
 */
export function unreachableModelsResult(baseUrl: string, err: unknown): LiveModelsResult {
  const detail = err instanceof Error ? err.message : String(err)
  return { ok: false, kind: 'unreachable', error: `${baseUrl} is unreachable — ${detail}` }
}

/**
 * Turn a `GET ${baseUrl}/models` Response into a verdict — the one and only
 * place in this repo that decides whether something answering at a base URL
 * is an OpenAI-compatible endpoint.
 *
 * A 2xx is NOT evidence that the thing on the other end speaks this API, so
 * the body is checked for the OpenAI `/models` shape before any of it is
 * believed, and a body that fails that check becomes a NAMED failure rather
 * than an empty roster. See the long note on `LiveModelsFailureKind` for the
 * measurement that motivated it.
 *
 * `baseUrl` is passed in rather than read from the module constant because
 * `openai-api.ts`'s `resolveProvider()` also honours `OPENAI_BASE_URL`, so the
 * URL actually dialled can differ from `LLM_BASE_URL` — and probing a URL the
 * adapter would not dispatch to is its own kind of lie.
 */
export async function readModelsResponse(baseUrl: string, res: Response): Promise<LiveModelsResult> {
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    return {
      ok: false,
      kind: 'error-status',
      error: `${baseUrl}/models responded ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
    }
  }

  // `res.headers?.get` rather than `res.headers.get`: a real Response always
  // has headers, but the Content-Type is only decoration on the message here,
  // and the seam should not throw on a partial Response stand-in when the
  // actual answer is already knowable from the body.
  const contentType = res.headers?.get?.('content-type') ?? ''
  const text = await res.text().catch(() => '')
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return {
      ok: false,
      kind: 'not-openai-compatible',
      error:
        `${baseUrl}/models answered ${res.status} but the body is not JSON` +
        `${contentType ? ` (Content-Type: ${contentType})` : ''} — this is not an OpenAI-compatible endpoint. ` +
        `LLM_BASE_URL must point at a server that serves GET /models as {"data":[{"id":…}]}. ` +
        `Body starts: ${bodySnippet(text)}`,
    }
  }
  const data = (body as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) {
    // Valid JSON, wrong API. The overwhelmingly common cause on this machine
    // is a base URL missing its `/v1` suffix, which reaches Ollama's own
    // `/api/tags`-style payload (`{"models":[{"name":…}]}`) — so say that.
    //
    // The hint is CONDITIONAL on the URL not already ending in `/v1`. Naming a
    // missing suffix on a URL that has one would be a confident wrong answer,
    // which is the failure mode this whole seam exists to remove; when the
    // suffix is already there the cause is something else and the message says
    // only what it knows.
    const keys = body && typeof body === 'object' ? Object.keys(body).slice(0, 6).join(', ') : String(body)
    const suffixHint = /\/v1$/.test(baseUrl)
      ? ''
      : ` If this is Ollama, the base URL needs its /v1 suffix — set LLM_BASE_URL to ${baseUrl}/v1.`
    return {
      ok: false,
      kind: 'not-openai-compatible',
      error:
        `${baseUrl}/models answered ${res.status} with JSON that has no top-level "data" array — ` +
        `the OpenAI /models shape is {"data":[{"id":…}]}, so this endpoint speaks a different API. ` +
        `Top-level keys: ${keys || '(none)'}.${suffixHint}`,
    }
  }
  const models: LlmModel[] = data.filter(
    (m): m is LlmModel => !!m && typeof (m as LlmModel).id === 'string' && (m as LlmModel).id !== '',
  )
  if (data.length > 0 && models.length === 0) {
    // A `data` array is present but nothing in it is addressable by id, so
    // there is no roster here either — and reporting zero would again mean
    // "pull a model", which is not the fix.
    return {
      ok: false,
      kind: 'not-openai-compatible',
      error:
        `${baseUrl}/models answered ${res.status} with a "data" array of ${data.length} entr` +
        `${data.length === 1 ? 'y' : 'ies'}, none carrying a string "id" — not the OpenAI /models shape.`,
    }
  }
  return { ok: true, models }
}

/**
 * Live GET against `${LLM_BASE_URL}/models`. Never a hardcoded list — an
 * unreachable endpoint or an empty roster is reported by name so a caller
 * can show it to the operator instead of guessing.
 *
 * Four outcomes, each distinguishable by the caller:
 *   { ok: true,  models: [...] }                       a real roster
 *   { ok: true,  models: [] }                          OpenAI-shaped, empty
 *   { ok: false, kind: 'unreachable' | 'error-status' } no usable response
 *   { ok: false, kind: 'not-openai-compatible' }        a 200 from something
 *                                                       that isn't this API
 */
export async function fetchLiveModels(
  timeoutMs = 5000,
  opts: { includeContextLength?: boolean } = {},
): Promise<LiveModelsResult> {
  let res: Response
  try {
    res = await fetch(`${LLM_BASE_URL}/models`, {
      // TOD-2456: the Next fetch cache made a 'live' roster permanent.
      cache: 'no-store' as RequestCache,
      headers: { Authorization: `Bearer ${LLM_API_KEY}` },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    return unreachableModelsResult(LLM_BASE_URL, err)
  }

  // ── The 200 that is not an answer ──────────────────────────────────────────
  // The shape check lives in `readModelsResponse()` above, shared with
  // lib/runtimes/openai-api.ts's provider probe. It was inlined here for one
  // round, and the duplicate in that file went on returning
  // `{ ok: true, models: [] }` for an HTML page the whole time this function
  // was reporting it honestly — so the parser is now in one place by
  // construction, not by convention.
  const shaped = await readModelsResponse(LLM_BASE_URL, res)
  if (!shaped.ok) return shaped
  const models = shaped.models
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

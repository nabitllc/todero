// ─── One definition of "is this install configured?" ─────────────────────────
//
// Shared by `npm run setup` and `npm run doctor` so the two commands can never
// disagree about what is required, what is missing, or which models the
// configured endpoint actually serves.
//
// Everything here delegates to the app's own modules through the TypeScript
// loader — `lib/db.ts` decides which database variables a provider needs, and
// `lib/llm-provider.ts` decides what a live model roster looks like. This file
// re-implements neither.

import { importTs } from './ts-import.mjs'
import { isPlaceholder } from './env-file.mjs'

/**
 * Variables that have a working default in code, so the app boots without
 * them, but that a real install should still set. Reported, never fatal.
 */
export const RECOMMENDED_ENV = [
  { name: 'MC_PASSWORD', why: 'owner login password (falls back to a public default)' },
  { name: 'MC_VIEWER_PASSWORD', why: 'read-only login password (falls back to a public default)' },
  { name: 'INTERNAL_SECRET', why: 'authenticates server-to-server calls' },
  { name: 'CRON_SECRET', why: 'authenticates the /api/cron/* endpoints' },
  { name: 'NEXT_PUBLIC_APP_URL', why: 'the URL agents call back on' },
]

/**
 * Strip every placeholder value out of process.env.
 *
 * A fresh `npm run setup` copies the template verbatim, so `YOUR_ANON_KEY` is
 * *present* — and every "is it set?" check downstream, including the app's own
 * `dbMissingEnv()`, would pass. Removing them first makes one honest rule apply
 * everywhere: a value nobody filled in is not a value.
 *
 * Returns the names removed.
 */
export function dropPlaceholderEnv() {
  const dropped = []
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && value !== '' && isPlaceholder(value)) {
      dropped.push(name)
      delete process.env[name]
    }
  }
  return dropped.sort()
}

/**
 * Database configuration, straight from the seam that owns it.
 * `{ ok, provider, missing[], detail }` — `missing` is named by `lib/db.ts`
 * itself, so this file never spells a vendor's variable names.
 *
 * Which variables count as required is therefore a per-provider question and
 * always was: under `sqlite` there are none, which is exactly why a clone with
 * no account can report zero missing required variables and mean it.
 */
export async function databaseStatus() {
  const mod = await importTs('lib/db.ts')
  if (!mod.ok) return { ok: false, provider: 'unknown', missing: [], error: mod.reason }
  const missing = mod.module.dbMissingEnv()
  const provider = mod.module.DB_PROVIDER
  return { ok: missing.length === 0, provider, missing, detail: await providerDetail(provider) }
}

/**
 * One line naming where the data actually is, for the providers that can say
 * so without a round trip. A provider name alone does not tell an operator
 * which file is about to be read.
 */
async function providerDetail(provider) {
  if (provider !== 'sqlite') return null
  const mod = await importTs('lib/db/sqlite-adapter.ts')
  if (!mod.ok) return null
  const file = mod.module.sqlitePath()
  const { existsSync, statSync } = await import('node:fs')
  if (!existsSync(file)) return `${file}  (not created yet — run \`npm run db:migrate\`)`
  return `${file}  (${statSync(file).size} bytes)`
}

/**
 * `llmStatus()` (via `lib/llm-provider.ts`) parses `${baseUrl}/models` with
 * `res.json().catch(() => null)` and defaults a parse failure to an empty
 * model list — so a 200-OK response from ANY server, OpenAI-shaped or not,
 * reports `{ ok: true, models: [] }`. Measured directly (see
 * docs/rebuild/pieces/pieces7/clone-and-run.md): pointing `LLM_BASE_URL` at a
 * plain HTTP server that answers with an HTML page reports the exact same
 * "reachable yes — 0 models" a real Ollama with nothing pulled yet would.
 * Those are not the same problem and do not have the same fix, so when the
 * model list comes back empty, both `setup` and `doctor` make this separate,
 * read-only request and look at what actually came back before repeating the
 * same "0 models" sentence for both.
 *
 * Returns `{ looksOpenAiShaped: true | false | null, detail }` — `null` means
 * this second probe itself failed and the caller should say "unknown", not
 * fold it into either verdict.
 */
export async function probeOpenAiShape(baseUrl) {
  try {
    const res = await fetch(`${baseUrl}/models`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    const contentType = res.headers.get('content-type') ?? ''
    const text = await res.text()
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      return {
        looksOpenAiShaped: false,
        detail: `responded ${res.status}, Content-Type: ${contentType || '(none)'} — body is not JSON, so this is not an OpenAI-compatible endpoint`,
      }
    }
    if (!Array.isArray(parsed?.data)) {
      return {
        looksOpenAiShaped: false,
        detail: `responded ${res.status} with valid JSON, but no top-level "data" array — the OpenAI \`/v1/models\` shape is {"data":[...]}, so this endpoint is answering a different API`,
      }
    }
    return { looksOpenAiShaped: true, detail: 'valid OpenAI /v1/models shape, genuinely zero models listed' }
  } catch (err) {
    // The shared fetch that got the caller here already succeeded once
    // (status.ok was true), so a failure on this second, independent request
    // is reported as unknown rather than folded into either verdict.
    return {
      looksOpenAiShaped: null,
      detail: `could not re-probe: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/**
 * Live model roster from whatever answers at LLM_BASE_URL.
 * `{ ok, baseUrl, models[] }` or `{ ok: false, baseUrl, error }`.
 */
export async function llmStatus() {
  const mod = await importTs('lib/llm-provider.ts')
  if (!mod.ok) {
    return {
      ok: false,
      baseUrl: process.env.LLM_BASE_URL ?? '(unset)',
      models: [],
      error: mod.reason,
    }
  }
  const baseUrl = mod.module.LLM_BASE_URL
  try {
    const live = await mod.module.fetchLiveModels()
    if (!live.ok) return { ok: false, baseUrl, models: [], error: live.error }
    return { ok: true, baseUrl, models: live.models.map(m => m.id).sort() }
  } catch (err) {
    return {
      ok: false,
      baseUrl,
      models: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * The required-variable verdict both commands print.
 *
 * Required means: without it, a core surface returns an error rather than a
 * page — the database the whole app reads, and the LLM endpoint every agent
 * and the chat go through. Integrations (Discord, Telegram, GitHub) are not
 * required and are never counted here.
 */
export async function requiredEnvReport() {
  const db = await databaseStatus()
  const missing = [...db.missing]
  if (isPlaceholder(process.env.LLM_BASE_URL)) missing.push('LLM_BASE_URL')
  return { provider: db.provider, dbError: db.error, dbDetail: db.detail, missing }
}

/** Recommended variables that are unset or still a placeholder. */
export function recommendedGaps() {
  return RECOMMENDED_ENV.filter(entry => isPlaceholder(process.env[entry.name]))
}

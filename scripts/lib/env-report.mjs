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
 * Second, independent look at what is actually answering at `baseUrl`.
 *
 * HISTORY, because the comment that used to be here described code that no
 * longer exists and was therefore its own defect: `fetchLiveModels()` once
 * parsed the body with `res.json().catch(() => null)` and defaulted a parse
 * failure to an empty model list, so a 200 from ANY server reported
 * `{ ok: true, models: [] }`. That is fixed in the seam itself — it now
 * returns a required `kind` of 'unreachable' | 'error-status' |
 * 'not-openai-compatible' — so this function is no longer the only thing
 * standing between an operator and a wrong answer.
 *
 * It is kept because `doctor` and `setup` run WITHOUT the app, and because a
 * second opinion from an independent request is worth having in a diagnostic.
 * But it no longer hand-rolls the shape rule: it delegates to the seam's
 * `readModelsResponse()`, which is the one place in the repo allowed to decide
 * what an OpenAI-compatible `/models` answer looks like. The hand-rolled copy
 * it used to contain had drifted — it reported an HTTP 401 (a real endpoint
 * with a bad key) as "this endpoint is answering a different API", and its
 * success string claimed "genuinely zero models listed" without ever counting
 * them. Both measured 2026-08-26.
 *
 * Returns `{ looksOpenAiShaped: true | false | null, detail }` — `null` means
 * this probe itself could not reach the endpoint and the caller should say
 * "unknown", not fold it into either verdict.
 */
export async function probeOpenAiShape(baseUrl) {
  const mod = await importTs('lib/llm-provider.ts')
  try {
    const res = await fetch(`${baseUrl}/models`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    if (!mod.ok) {
      return { looksOpenAiShaped: null, detail: `could not load the shape rule: ${mod.reason}` }
    }
    const verdict = await mod.module.readModelsResponse(baseUrl, res)
    if (verdict.ok) {
      const n = verdict.models.length
      return {
        looksOpenAiShaped: true,
        detail:
          n === 0
            ? 'valid OpenAI /v1/models shape, genuinely zero models listed'
            : `valid OpenAI /v1/models shape, ${n} model${n === 1 ? '' : 's'} listed`,
      }
    }
    // 'unreachable' cannot occur here (the fetch above already succeeded), and
    // 'error-status' is NOT a shape verdict: a 401 is a real OpenAI endpoint
    // refusing a credential, so calling it "a different API" would be the same
    // confident wrong answer this file exists to prevent. Only the shape kind
    // answers the shape question.
    if (verdict.kind === 'not-openai-compatible') {
      return { looksOpenAiShaped: false, detail: verdict.error }
    }
    return { looksOpenAiShaped: null, detail: verdict.error }
  } catch (err) {
    return {
      looksOpenAiShaped: null,
      detail: `could not re-probe: ${err instanceof Error ? err.message : String(err)}`,
    }
  }
}

/**
 * Live model roster from whatever answers at LLM_BASE_URL.
 * `{ ok, baseUrl, models[] }` or `{ ok: false, baseUrl, error, kind }`.
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
    // `kind` rides along: the seam went to the trouble of deciding WHY, and
    // dropping it here made `doctor` print one undifferentiated sentence for
    // an unreachable socket, a 401 and an HTML page.
    if (!live.ok) return { ok: false, baseUrl, models: [], error: live.error, kind: live.kind }
    return { ok: true, baseUrl, models: live.models.map(m => m.id).sort() }
  } catch (err) {
    return {
      ok: false,
      baseUrl,
      models: [],
      error: err instanceof Error ? err.message : String(err),
      kind: 'unreachable',
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

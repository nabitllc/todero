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
 * `{ ok, provider, missing[] }` — `missing` is named by `lib/db.ts` itself, so
 * this file never spells a vendor's variable names.
 */
export async function databaseStatus() {
  const mod = await importTs('lib/db.ts')
  if (!mod.ok) return { ok: false, provider: 'unknown', missing: [], error: mod.reason }
  const missing = mod.module.dbMissingEnv()
  return { ok: missing.length === 0, provider: mod.module.DB_PROVIDER, missing }
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
  return { provider: db.provider, dbError: db.error, missing }
}

/** Recommended variables that are unset or still a placeholder. */
export function recommendedGaps() {
  return RECOMMENDED_ENV.filter(entry => isPlaceholder(process.env[entry.name]))
}

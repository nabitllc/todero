// ─── .env.local reading for plain Node scripts ───────────────────────────────
//
// Next.js loads .env.local for the app. Nothing loads it for `node
// scripts/*.mjs`, so `npm run setup` and `npm run doctor` would otherwise
// report a machine that has no LLM and no database while the running app is
// perfectly configured. Same flat KEY=VALUE grammar the repo already writes —
// no new dependency.
//
// A real shell/CI environment variable always wins; these files only fill in
// what is not already set, which is the same precedence Next.js uses.

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Files consulted, highest precedence first. */
export const ENV_FILES = ['.env.local', '.env']

/** Parse one .env-style file's text into a plain key/value object. */
export function parseEnvText(text) {
  const out = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    if (!key) continue
    let value = line.slice(eq + 1).trim()
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1)
    }
    out[key] = value
  }
  return out
}

/**
 * Load .env.local then .env into process.env without clobbering anything the
 * real environment already provides. Returns the files that existed.
 */
export function loadEnvFiles(repoRoot) {
  const loaded = []
  for (const name of ENV_FILES) {
    const file = join(repoRoot, name)
    if (!existsSync(file)) continue
    loaded.push(name)
    const parsed = parseEnvText(readFileSync(file, 'utf8'))
    for (const [key, value] of Object.entries(parsed)) {
      if (process.env[key] === undefined) process.env[key] = value
    }
  }
  return loaded
}

/**
 * True when a value is one of the template's fill-me-in markers rather than a
 * real setting.
 *
 * This matters more than it looks: `npm run setup` copies the template
 * verbatim, so after a fresh clone every variable is *present* and every naive
 * "is it set?" check passes. Reporting `NEXT_PUBLIC_SUPABASE_URL` as configured
 * when it still reads `https://YOUR_PROJECT.supabase.co` is precisely the
 * green-check-over-a-broken-thing this repo keeps having to delete.
 */
export function isPlaceholder(value) {
  if (value === undefined || value === null) return true
  const trimmed = String(value).trim()
  if (trimmed === '') return true
  if (/YOUR_[A-Z0-9_]/.test(trimmed)) return true
  if (/^(changeme|todo|xxx+)$/i.test(trimmed)) return true
  if (/^<.+>$/.test(trimmed)) return true
  return false
}

/** The configured value of `name`, or null when unset or still a placeholder. */
export function configuredValue(name) {
  const value = process.env[name]
  return isPlaceholder(value) ? null : String(value).trim()
}

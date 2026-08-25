// ─── Import a TypeScript module from a plain Node script ─────────────────────
//
// `npm run setup` and `npm run doctor` have to report what the APP resolves —
// the same paths, the same database env rule — not a second copy of that logic
// that drifts out of date. The app's logic lives in .ts files, and this repo is
// `"type": "commonjs"`, so Node's built-in type stripping refuses them
// ("Cannot use import statement outside a module").
//
// So: register an ESM loader hook that transpiles .ts/.tsx on the fly with the
// TypeScript compiler already in devDependencies, and that understands the two
// import forms the repo uses — extensionless relative paths, and the `@/` alias
// from tsconfig.json. No new dependency, and no duplicated logic.
//
// Types are only stripped here, never checked. `npx tsc --noEmit` is the type
// gate; this is a runtime loader.

import { register } from 'node:module'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

let registered = false

/**
 * Turn the loader on. Idempotent.
 *
 * Returns `{ ok: true }`, or `{ ok: false, reason }` when TypeScript is not
 * installed — so a caller degrades to a clearly-labelled "unavailable" section
 * rather than crashing the whole report.
 */
export function enableTsImports() {
  if (registered) return { ok: true }

  if (!existsSync(join(REPO_ROOT, 'node_modules', 'typescript'))) {
    return {
      ok: false,
      reason: 'typescript is not installed — run `npm install` (it is a devDependency)',
    }
  }

  register(pathToFileURL(join(REPO_ROOT, 'scripts', 'lib', 'ts-loader.mjs')))
  registered = true
  return { ok: true }
}

/**
 * Import one of the app's TypeScript modules by repo-relative path, e.g.
 * `importTs('lib/paths.ts')`. Resolves to `{ ok, module }` / `{ ok, reason }`
 * so callers can print an honest "could not read this section" line.
 */
export async function importTs(repoRelativePath) {
  const enabled = enableTsImports()
  if (!enabled.ok) return { ok: false, reason: enabled.reason }

  const absolute = join(REPO_ROOT, repoRelativePath)
  if (!existsSync(absolute)) {
    return { ok: false, reason: `${repoRelativePath} does not exist in this checkout` }
  }

  try {
    return { ok: true, module: await import(pathToFileURL(absolute).href) }
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }
}

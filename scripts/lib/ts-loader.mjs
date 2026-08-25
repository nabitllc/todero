// ─── ESM loader hooks: resolve + transpile the app's TypeScript ──────────────
//
// Registered by scripts/lib/ts-import.mjs. Runs on Node's loader thread, so it
// keeps its own TypeScript handle and its own path resolution.
//
// Two jobs:
//   resolve — the repo writes `./errors`, `../db` and `@/lib/paths` without
//             file extensions. Node's ESM resolver requires them. Try the
//             extensions the repo actually uses, then an index file.
//   load    — strip types from .ts/.tsx and hand Node back an ES module.
//
// Anything this does not recognise falls through to Node's default behaviour,
// so node builtins and node_modules packages resolve exactly as usual.

import { readFileSync, existsSync, statSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.js', '.mjs']

function isFile(candidate) {
  try {
    return existsSync(candidate) && statSync(candidate).isFile()
  } catch {
    return false
  }
}

/** `lib/db` -> `lib/db.ts`; `lib/db/` -> `lib/db/index.ts`. Null when neither. */
function resolveOnDisk(basePath) {
  if (isFile(basePath)) return basePath
  for (const ext of EXTENSIONS) {
    if (isFile(basePath + ext)) return basePath + ext
  }
  for (const ext of EXTENSIONS) {
    const indexed = join(basePath, 'index' + ext)
    if (isFile(indexed)) return indexed
  }
  return null
}

export async function resolve(specifier, context, nextResolve) {
  // `@/lib/paths` — the tsconfig path alias, rooted at the repo.
  if (specifier.startsWith('@/')) {
    const found = resolveOnDisk(join(REPO_ROOT, specifier.slice(2)))
    if (found) return { url: pathToFileURL(found).href, format: 'module', shortCircuit: true }
  }

  // Relative import from a file we already loaded.
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const parentUrl = context.parentURL
    if (parentUrl && parentUrl.startsWith('file:')) {
      const found = resolveOnDisk(resolvePath(dirname(fileURLToPath(parentUrl)), specifier))
      if (found) return { url: pathToFileURL(found).href, format: 'module', shortCircuit: true }
    }
  }

  return nextResolve(specifier, context)
}

export async function load(url, context, nextLoad) {
  if (!/\.(ts|tsx|mts)(\?|$)/.test(url)) return nextLoad(url, context)

  const filePath = fileURLToPath(url)
  const transpiled = ts.transpileModule(readFileSync(filePath, 'utf8'), {
    fileName: filePath,
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      // The app's own .ts modules are ES modules regardless of the package
      // type, which is exactly what this loader exists to bridge.
      verbatimModuleSyntax: false,
    },
  })

  return { format: 'module', source: transpiled.outputText, shortCircuit: true }
}

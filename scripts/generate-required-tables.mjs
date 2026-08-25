#!/usr/bin/env node
// ─── Generate lib/required-tables.generated.ts ─────────────────────────────
//
// REQUIRED_TABLES used to be a hand-picked list of 3 tables. That is exactly
// how a health check goes stale: a route starts querying a new table and
// nobody remembers to add it here, so /api/health stays green while that
// route 424s. This script derives the list mechanically instead — every
// `.from('<table>')` call site under app/ and lib/ (excluding tests and this
// generated file's own consumer) is a table the running app actually
// depends on existing.
//
// Run manually with `npm run generate:required-tables`, or automatically as
// part of `npm run build` (wired into the `prebuild` script) so the list
// can't silently drift from the code that was just built.

import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(__dirname, '..')
const OUT_FILE = join(REPO_ROOT, 'lib', 'required-tables.generated.ts')

const SCAN_ROOTS = ['app', 'lib']
const SKIP_DIR_NAMES = new Set(['__tests__', 'node_modules', '.next'])
const FILE_EXTENSIONS = new Set(['.ts', '.tsx'])

// Same call shape the app's own db seam uses everywhere: db().from('table').
const FROM_CALL = /\.from\(\s*['"]([a-zA-Z_][a-zA-Z0-9_]*)['"]\s*\)/g

function walk(dir, files) {
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIR_NAMES.has(entry)) continue
    const full = join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) {
      walk(full, files)
    } else if (FILE_EXTENSIONS.has(entry.slice(entry.lastIndexOf('.')))) {
      files.push(full)
    }
  }
}

function collectTables() {
  const files = []
  for (const root of SCAN_ROOTS) {
    const abs = join(REPO_ROOT, root)
    try {
      walk(abs, files)
    } catch {
      // root doesn't exist — nothing to scan
    }
  }

  const tables = new Set()
  for (const file of files) {
    // Skip this generator's own output and hand-written wrapper — neither
    // should be able to nominate itself as a "table" by containing the
    // literal call shape in a comment.
    if (file === OUT_FILE) continue

    const text = readFileSync(file, 'utf8')
    let m
    FROM_CALL.lastIndex = 0
    while ((m = FROM_CALL.exec(text))) {
      tables.add(m[1])
    }
  }
  return [...tables].sort()
}

function main() {
  const tables = collectTables()

  const body =
    '// ─── AUTO-GENERATED — do not hand-edit ─────────────────────────────────────\n' +
    '//\n' +
    `// Produced by scripts/generate-required-tables.mjs from every ${'.from(\'<table>\')'} call\n` +
    '// site under app/ and lib/ (excluding __tests__). Regenerate with:\n' +
    '//   npm run generate:required-tables\n' +
    '// Wired into `npm run build` via the `prebuild` script so this list tracks\n' +
    '// the code that was just built rather than drifting from it.\n' +
    '\n' +
    '/** Every table the running app queries directly, derived mechanically. */\n' +
    'export const GENERATED_REQUIRED_TABLES = [\n' +
    tables.map(t => `  '${t}',`).join('\n') +
    '\n] as const\n'

  writeFileSync(OUT_FILE, body, 'utf8')
  console.log(
    `[generate-required-tables] wrote ${relative(REPO_ROOT, OUT_FILE)} — ${tables.length} table(s): ${tables.join(', ')}`,
  )
}

main()

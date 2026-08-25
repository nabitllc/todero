#!/usr/bin/env node
// ─── scripts/no-silent-empty.mjs — TOD-654 guard ─────────────────────────────
//
// WHY THIS EXISTS
// ---------------
// The single most damaging UI bug in this repo was not a crash. It was this:
//
//     fetch('/api/issues').then(r => r.json()).then(d => setIssues(d?.data ?? []))
//
// A 403 body is an object, `d?.data` is undefined, `?? []` makes it an empty
// array, and the tab renders "No issues found" over a permission error. The
// operator cannot tell a working-but-empty system from a dead one, and neither
// can an auditor. Every loader must therefore branch on `res.ok`.
//
// This guard fails the build if the raw pattern reappears anywhere under app/ or
// components/. The sanctioned replacements are:
//
//   * hooks/useApiData.ts  -> useApiData / useApiList  (React components)
//   * lib/fetch-json.ts    -> fetchJson / fetchJsonOrNull / fetchJsonOrThrow
//
// Both keep the failure instead of coercing it into emptiness. Render it with
// <ApiErrorBanner error={error} onRetry={refetch} />.
//
// WHY NODE AND NOT BASH
// ---------------------
// This is a port of the original scripts/no-silent-empty.sh, which `prebuild`
// used to invoke as `bash scripts/no-silent-empty.sh`. A plain Windows host has
// no bash on PATH, so `npm run build` — the command the README calls the
// production command on every platform — died at the guard before Next.js ever
// started. A guard that only runs on the maintainer's machine is not a guard.
// Node is already a hard prerequisite of a Next.js app, so it is the only
// interpreter this repo may assume. Same pattern, same allowlist, same exit
// codes; `rg`/`grep` are replaced by `git ls-files` plus a JS RegExp.
//
// Usage: node scripts/no-silent-empty.mjs   (exit 0 = clean, 1 = violations)

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Directories whose loaders must never parse a response they have not checked. */
const SCAN_DIRS = ['app', 'components']

/** Only source files can contain the pattern; skip assets, JSON and Tiled maps. */
const SCAN_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

// `.then(x => x.json())` in any single-expression form: `r`, `res`, `(r)`, `(res)`.
// A block body — `.then(async r => { if (!r.ok) throw ... })` — is deliberately
// NOT matched: it has already looked at the response.
const PATTERN =
  /\.then\(\s*\(?[A-Za-z_$][A-Za-z0-9_$]*\)?\s*=>\s*[A-Za-z_$][A-Za-z0-9_$]*\.json\(\)\s*\)/

/** The two modules that are allowed to touch a raw Response body. */
const ALLOWLIST = new Set(['hooks/useApiData.ts', 'lib/fetch-json.ts'])

/**
 * Tracked files plus new files that are not gitignored — the same reach the
 * shell version had by scanning the working tree, minus node_modules/.next.
 * A brand-new file therefore cannot smuggle a violation past the guard.
 */
function scanFiles() {
  const out = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...SCAN_DIRS],
    { cwd: REPO_ROOT, encoding: 'utf8' }
  )
  return [...new Set(out.split('\n').map((l) => l.trim()).filter(Boolean))]
    .filter((f) => SCAN_EXTENSIONS.some((ext) => f.endsWith(ext)))
    .filter((f) => !ALLOWLIST.has(f))
    .sort()
}

const hits = []
for (const file of scanFiles()) {
  const abs = join(REPO_ROOT, file)
  if (!existsSync(abs)) continue // listed by --cached but deleted in the worktree
  const lines = readFileSync(abs, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (PATTERN.test(line)) hits.push(`${file}:${i + 1}:${line.trim()}`)
  })
}

if (hits.length > 0) {
  console.error("FAIL: raw '.then(r => r.json())' found — a non-ok response would be parsed as data.")
  console.error('')
  for (const hit of hits) console.error(hit)
  console.error('')
  console.error('Fix: use useApiData/useApiList from hooks/useApiData.ts (components) or')
  console.error('     fetchJson/fetchJsonOrNull/fetchJsonOrThrow from lib/fetch-json.ts,')
  console.error('     and render <ApiErrorBanner error={error} onRetry={refetch} /> instead')
  console.error('     of falling through to an empty state.')
  process.exit(1)
}

console.log('PASS: no unchecked JSON parsing under app/ or components/')

// Second check: the shared error surface must still exist and be wired up.
const REQUIRED_FILES = ['hooks/useApiData.ts', 'lib/fetch-json.ts', 'components/ApiErrorBanner.tsx']
let missing = false
for (const f of REQUIRED_FILES) {
  if (!existsSync(join(REPO_ROOT, f))) {
    console.error(`FAIL: ${f} is missing — the honest-error contract has been deleted.`)
    missing = true
  }
}
if (missing) process.exit(1)

const wordingSources = ['hooks/useApiData.ts', 'lib/fetch-json.ts']
  .map((f) => readFileSync(join(REPO_ROOT, f), 'utf8'))
  .join('\n')
if (!wordingSources.includes('data unavailable')) {
  console.error("FAIL: the 'data unavailable — <status> from <endpoint>: <message>' wording is gone.")
  process.exit(1)
}

console.log('PASS: shared error surface intact (useApiData + fetch-json + ApiErrorBanner)')
process.exit(0)

#!/usr/bin/env node
// ─── no-dead-modules — fail when a module nothing can reach is still in the tree ──
//
// WHY THIS EXISTS
//   `HANDOFF.md` records a hardcoded emoji table that survived THREE sweeps
//   whose stated job was removing exactly it. The reason generalises: a sweep
//   asks "what breaks if this goes?", dead code correctly answers "nothing",
//   and the sweep moves on. Dead code survives not despite being unreferenced
//   but BECAUSE of it. The most recent cost was `lib/issue-type-config.ts`
//   declaring a `test_status` field for a column that does not exist — a
//   phantom field, inert only until somebody wired it up, then a 500.
//
//   So this guard does not ask what breaks. It resolves the import graph from
//   the real entry points and asks which modules nothing can reach.
//
// WHAT IT DOES
//   1. Collects entry points that exist because the FRAMEWORK or the TEST
//      RUNNER loads them by filesystem convention, not because anything
//      imports them:
//        - app/**/{page,layout,template,route,loading,error,global-error,
//          not-found,default}.{ts,tsx}
//        - middleware.ts, instrumentation.ts at the repo root
//        - **/__tests__/**/*.test.{ts,tsx}
//        - every `importTs('lib/x.ts')` STRING LITERAL in scripts/** — these
//          are real edges from plain .mjs scripts into TypeScript, invisible
//          to any import-statement scan (see scripts/lib/ts-import.mjs).
//   2. Walks imports from there, resolving the `@/*` tsconfig alias and
//      extensionless relative paths the way the app does.
//   3. Reports every in-scope module (lib/**/*.ts, components/**/*.tsx) that
//      the walk never reaches.
//
// VALUE vs TYPE
//   A type-only importer does NOT make a runtime module alive: `import type
//   { Foo } from '@/components/Bar'` erases at compile time and never loads
//   Bar. So the walk is run twice — once over value edges only, once over all
//   edges — and a module reached ONLY by type edges is an error IF it exports
//   runtime values. A module that exports only types and is imported only as
//   types is legitimately alive and passes.
//
// THE ALLOWLIST
//   Some files are deliberately unreferenced. Each needs a `reason`. And an
//   allowlist entry that is no longer needed is an ERROR, not silence — an
//   allowlist that quietly outlives its reason is the same defect as the dead
//   code it excuses. A stale entry fails the run in both directions: the file
//   became reachable, or the file no longer exists.
//
// ─── WHAT THIS DOES **NOT** COVER ────────────────────────────────────────────
//   Stated explicitly, because a guard whose comment describes enforcement it
//   does not perform is worse than no guard: it is trusted.
//
//   * NOT a per-export check. It proves a FILE is reachable, never that every
//     symbol in it is used. A live file full of dead functions passes.
//   * NOT a runtime proof. Reachability in the import graph is not proof the
//     code ever executes — a module imported behind a feature flag that is
//     always off is "reachable" here.
//   * Import parsing is REGEX, not a TypeScript AST. It strips `/*…*/` and
//     whole-line `//` comments, then matches import/export/require/import()
//     forms. A commented-out import on the same line as code, or an import
//     written in a way the patterns miss, is counted as a REAL edge — which
//     makes a dead file look ALIVE. That is the deliberately safe direction:
//     this guard under-reports rather than provoking a wrong deletion.
//   * Only `lib/**/*.ts` and `components/**/*.tsx` are IN SCOPE for the dead
//     report. A dead `app/**` route, a dead hook, a dead script is not
//     reported. Next.js publishes every `route.ts` as a URL, so an unused
//     route is a product question, not a graph question.
//   * A module reached only from a TEST is reported as reachable. Whether a
//     module that exists solely to be tested is worth keeping is a human call.
//   * `.d.ts` files, `__tests__` directories, and `*.generated.ts` are
//     excluded from scope, not analysed.
//   * It cannot see reflection: a component chosen by `eval`, by a string
//     assembled at runtime, or by a bundler glob would be missed. None of
//     those forms exist in this repo today; if one is added, this guard goes
//     blind to it without saying so.
//
// USAGE
//   node scripts/no-dead-modules.mjs          exit 0 clean, exit 1 on findings
//   node scripts/no-dead-modules.mjs --list   print the reachable set and exit 0
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, dirname, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// ─── Allowlist ───────────────────────────────────────────────────────────────
// Files that are deliberately unreferenced. Every entry needs a reason a human
// can check. An entry that is no longer needed FAILS THE RUN — see above.
const ALLOWLIST = [
  {
    file: 'components/tabs/AgentsTab.tsx',
    reason:
      'Its default export (the legacy roster grid) is genuinely unrendered — the ' +
      'fleet-cards piece replaced it with CrewTab and says so at ' +
      'components/tabs/CrewTab.tsx:32. But the file is still the DECLARATION SITE of ' +
      'the `RosterMeta` type, which app/page.tsx:21, components/tabs/CrewTab.tsx:56 ' +
      'and hooks/useAgentRoster.ts:20 all import as a type. So deleting the file ' +
      'breaks three live importers; the real fix is to move `RosterMeta` to a types ' +
      'module and THEN delete the component, which is a piece of its own. ' +
      'Owned by the fleet-cards piece, not by dead-code-sweep — flagged, not touched. ' +
      'When RosterMeta moves and this file is deleted, this entry goes stale and ' +
      'fails the run, which is the intended prompt to remove it.',
  },
]

// ─── Scope ───────────────────────────────────────────────────────────────────
const IN_SCOPE = [
  { dir: 'lib', ext: ['.ts'] },
  { dir: 'components', ext: ['.tsx'] },
]

const EXCLUDE_RE = /(^|[\\/])(__tests__|node_modules)([\\/]|$)|\.d\.ts$|\.generated\.ts$/

const ENTRY_BASENAMES = new Set([
  'page', 'layout', 'template', 'route',
  'loading', 'error', 'global-error', 'not-found', 'default',
])

const RESOLVE_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

// ─── Filesystem walk ─────────────────────────────────────────────────────────
function walk(dir, out = []) {
  const abs = join(REPO_ROOT, dir)
  if (!existsSync(abs)) return out
  for (const name of readdirSync(abs)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const rel = `${dir}/${name}`
    if (statSync(join(REPO_ROOT, rel)).isDirectory()) walk(rel, out)
    else out.push(rel)
  }
  return out
}

const norm = (p) => p.split(sep).join('/')

// ─── Import extraction ───────────────────────────────────────────────────────
/**
 * Blank out comments, keeping strings intact (we need their quotes).
 *
 * This is a character scanner, not a regex pair, and it has to be. The regex
 * version stripped `/*…*\/` first and `//…` second, which meant a LINE comment
 * containing `migrations/*.sql` — one really is at lib/db/pg-adapter.ts:16 —
 * opened a phantom block comment that swallowed 1026 characters, including
 * that file's entire import block, and made its live dependency
 * `lib/db/pg-sql.ts` look dead. Reversing the order just moves the bug (a
 * `//` inside a block comment then breaks it instead). Only a scanner that
 * knows which state it is in gets both right.
 *
 * Comments become spaces so byte offsets and line structure survive.
 */
function stripComments(src) {
  const out = new Array(src.length)
  let i = 0
  const S = { CODE: 0, LINE: 1, BLOCK: 2, SQ: 3, DQ: 4, TPL: 5 }
  let state = S.CODE
  while (i < src.length) {
    const c = src[i], d = src[i + 1]
    if (state === S.CODE) {
      if (c === '/' && d === '/') { state = S.LINE; out[i] = ' '; out[i + 1] = ' '; i += 2; continue }
      if (c === '/' && d === '*') { state = S.BLOCK; out[i] = ' '; out[i + 1] = ' '; i += 2; continue }
      if (c === "'") state = S.SQ
      else if (c === '"') state = S.DQ
      else if (c === '`') state = S.TPL
      out[i] = c; i++; continue
    }
    if (state === S.LINE) {
      if (c === '\n') { state = S.CODE; out[i] = c } else out[i] = ' '
      i++; continue
    }
    if (state === S.BLOCK) {
      if (c === '*' && d === '/') { state = S.CODE; out[i] = ' '; out[i + 1] = ' '; i += 2; continue }
      out[i] = c === '\n' ? c : ' '
      i++; continue
    }
    // Inside a string literal: copy verbatim, honour backslash escapes.
    if (c === '\\') { out[i] = c; out[i + 1] = src[i + 1] ?? ''; i += 2; continue }
    if ((state === S.SQ && c === "'") || (state === S.DQ && c === '"') || (state === S.TPL && c === '`')) state = S.CODE
    out[i] = c; i++
  }
  return out.join('')
}

/** @returns {{spec: string, type: boolean}[]} */
function extractImports(src) {
  const code = stripComments(src)
  const edges = []

  // import … from 'x'   /   export … from 'x'
  //
  // The clause is restricted to the characters a real import clause can
  // contain — identifiers, braces, commas, `*`, whitespace. It deliberately
  // CANNOT cross `(`, `;`, `:`, `=`, a quote or a backtick. An earlier version
  // used a lazy `[\s\S]*?` here and silently spanned from an `export interface`
  // across 12 KB of lib/db/pg-adapter.ts to a `from '${…}'` inside a SQL
  // template literal — swallowing every real import in the file and reporting
  // its genuinely-live dependency `lib/db/pg-sql.ts` as dead. Keep the class
  // tight; a loose one here makes the whole guard lie in the dangerous
  // direction.
  const FROM_RE = /(?:^|[\s;})])(import|export)\s+([A-Za-z0-9_$*{},\s]*?[}\s])from\s*(['"])([^'"]+)\3/g
  for (const m of code.matchAll(FROM_RE)) {
    const clause = m[2].trim()
    edges.push({ spec: m[4], type: isTypeOnlyClause(clause) })
  }

  // bare side-effect import: import 'x'   (always a value edge — it runs)
  for (const m of code.matchAll(/(?:^|[\s;})])import\s*(['"])([^'"]+)\1/g)) {
    edges.push({ spec: m[2], type: false })
  }

  // dynamic import('x') and require('x')
  for (const m of code.matchAll(/import\s*\(\s*(['"])([^'"]+)\1/g)) {
    edges.push({ spec: m[2], type: false })
  }
  for (const m of code.matchAll(/require\s*\(\s*(['"])([^'"]+)\1/g)) {
    edges.push({ spec: m[2], type: false })
  }

  return edges
}

/** `import type {A}` — or `import {type A, type B}` where EVERY specifier is a type. */
function isTypeOnlyClause(clause) {
  if (/^type\b/.test(clause)) return true
  const braces = clause.match(/\{([\s\S]*)\}/)
  if (!braces) return false
  // A default or namespace binding alongside the braces is a value import.
  if (clause.slice(0, clause.indexOf('{')).replace(/[\s,]/g, '') !== '') return false
  const specs = braces[1].split(',').map((s) => s.trim()).filter(Boolean)
  if (specs.length === 0) return false
  return specs.every((s) => /^type\b/.test(s))
}

// ─── Specifier resolution ────────────────────────────────────────────────────
/** @returns {string|null} repo-relative path, or null for a bare package. */
function resolveSpec(spec, fromFile) {
  let base
  if (spec.startsWith('@/')) base = join(REPO_ROOT, spec.slice(2))
  else if (spec.startsWith('./') || spec.startsWith('../')) base = resolve(REPO_ROOT, dirname(fromFile), spec)
  else return null // bare package specifier — not our graph

  for (const cand of [base, ...RESOLVE_EXT.map((e) => base + e), ...RESOLVE_EXT.map((e) => join(base, 'index' + e))]) {
    if (existsSync(cand) && statSync(cand).isFile()) return norm(relative(REPO_ROOT, cand))
  }
  return null
}

// ─── Entry points ────────────────────────────────────────────────────────────
function collectEntryPoints() {
  const entries = new Set()

  for (const f of walk('app')) {
    const m = f.match(/\/([^/]+)\.(tsx?|jsx?)$/)
    if (m && ENTRY_BASENAMES.has(m[1])) entries.add(f)
  }

  for (const f of ['middleware.ts', 'instrumentation.ts', 'middleware.tsx']) {
    if (existsSync(join(REPO_ROOT, f))) entries.add(f)
  }

  for (const dir of ['app', 'lib', 'components', 'hooks', 'scripts', '__tests__']) {
    for (const f of walk(dir)) {
      if (/__tests__[\\/].*\.test\.tsx?$/.test(f)) entries.add(f)
    }
  }

  // String-keyed edges: importTs('lib/x.ts') in plain .mjs scripts.
  for (const f of walk('scripts')) {
    if (!/\.(mjs|js|cjs)$/.test(f)) continue
    const src = stripComments(readFileSync(join(REPO_ROOT, f), 'utf8'))
    for (const m of src.matchAll(/importTs\s*\(\s*(['"])([^'"]+)\1/g)) {
      const target = norm(m[2])
      if (existsSync(join(REPO_ROOT, target))) entries.add(target)
    }
  }

  return [...entries]
}

// ─── Graph walk ──────────────────────────────────────────────────────────────
/** BFS from entries. `valueOnly` ignores `import type` edges. */
function reachableFrom(entries, valueOnly) {
  const seen = new Set(entries)
  const queue = [...entries]
  while (queue.length) {
    const file = queue.shift()
    const abs = join(REPO_ROOT, file)
    if (!existsSync(abs) || !/\.(tsx?|jsx?|mjs|cjs)$/.test(file)) continue
    let src
    try { src = readFileSync(abs, 'utf8') } catch { continue }
    for (const edge of extractImports(src)) {
      if (valueOnly && edge.type) continue
      const target = resolveSpec(edge.spec, file)
      if (target && !seen.has(target)) { seen.add(target); queue.push(target) }
    }
  }
  return seen
}

/** Does this module export anything that exists at RUNTIME? */
function hasRuntimeExports(file) {
  const src = stripComments(readFileSync(join(REPO_ROOT, file), 'utf8'))
  if (/export\s+(default|abstract\s+class|async\s+function|function|const|let|var|class|enum)\b/.test(src)) return true
  // `export { A, B }` — runtime unless every specifier is `type`.
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    const specs = m[1].split(',').map((s) => s.trim()).filter(Boolean)
    if (specs.length && !specs.every((s) => /^type\b/.test(s))) return true
  }
  return false
}

// ─── Run ─────────────────────────────────────────────────────────────────────
const entries = collectEntryPoints()
const valueReachable = reachableFrom(entries, true)
const anyReachable = reachableFrom(entries, false)

const scoped = []
for (const { dir, ext } of IN_SCOPE) {
  for (const f of walk(dir)) {
    if (EXCLUDE_RE.test(f)) continue
    if (ext.some((e) => f.endsWith(e))) scoped.push(f)
  }
}

const allowed = new Map(ALLOWLIST.map((a) => [norm(a.file), a.reason]))
const findings = []
const staleAllowlist = []

for (const f of scoped) {
  const isAllowed = allowed.has(f)
  let problem = null

  if (!anyReachable.has(f)) {
    problem = 'unreachable — no entry point reaches it by any import edge'
  } else if (!valueReachable.has(f) && hasRuntimeExports(f)) {
    problem = 'reached ONLY by `import type` edges, but it exports runtime values — nothing loads it'
  }

  if (problem && !isAllowed) findings.push({ file: f, problem })
  if (!problem && isAllowed) {
    staleAllowlist.push({ file: f, reason: allowed.get(f), why: 'this file IS reachable now — remove the allowlist entry' })
  }
}

for (const [file, reason] of allowed) {
  if (!existsSync(join(REPO_ROOT, file))) {
    staleAllowlist.push({ file, reason, why: 'this file no longer exists — remove the allowlist entry' })
  }
}

for (const a of ALLOWLIST) {
  if (!a.reason || !String(a.reason).trim()) {
    staleAllowlist.push({ file: a.file, reason: '(none)', why: 'allowlist entry has no reason string' })
  }
}

if (process.argv.includes('--list')) {
  console.log(`entry points: ${entries.length}`)
  console.log(`value-reachable files: ${valueReachable.size}`)
  console.log(`in-scope modules: ${scoped.length}`)
  for (const f of scoped) {
    const tag = valueReachable.has(f) ? 'live' : anyReachable.has(f) ? 'type-only' : 'DEAD'
    if (tag !== 'live') console.log(`  ${tag.padEnd(9)} ${f}`)
  }
  process.exit(0)
}

if (findings.length === 0 && staleAllowlist.length === 0) {
  console.log(
    `no-dead-modules: OK — ${scoped.length} modules in scope, ` +
    `all reachable from ${entries.length} entry points` +
    (allowed.size ? ` (${allowed.size} allowlisted)` : ''),
  )
  process.exit(0)
}

console.error('no-dead-modules: FAIL\n')
if (findings.length) {
  console.error(`  ${findings.length} unreachable module(s):`)
  for (const f of findings) console.error(`    ${f.file}\n      ${f.problem}`)
  console.error('\n  Delete them, or add an allowlist entry WITH A REASON in scripts/no-dead-modules.mjs.')
}
if (staleAllowlist.length) {
  console.error(`\n  ${staleAllowlist.length} stale allowlist entry/entries:`)
  for (const s of staleAllowlist) console.error(`    ${s.file}\n      reason on file: ${s.reason}\n      ${s.why}`)
}
process.exit(1)

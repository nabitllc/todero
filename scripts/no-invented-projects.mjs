#!/usr/bin/env node
/**
 * no-invented-projects.mjs — fail the build when live code names a project or an
 * SME agent that this installation does not have.
 *
 * WHY THIS EXISTS
 * ---------------
 * Todero shipped registries, queue lanes, emoji tables and dropdown options for
 * two agents (`kemuni-sme`, `vespera-sme`) and two projects (`Kemuni`,
 * `Vespera`) that exist nowhere. One of those queue lanes carried prompt text
 * instructing an agent to POST issues under `project:Kemuni`; only the dispatch
 * kill switch (lib/dispatch-guard.ts) kept it out of the database.
 * docs/rebuild/HANDOFF.md records that a hardcoded emoji table of the same shape
 * already survived TWO rounds of a sweep whose job was removing it. Reading a
 * file is evidently not enough, so this runs instead.
 *
 * WHERE "REAL" COMES FROM
 * -----------------------
 * From ONE existing named constant: `PROJECT_PREFIX` in lib/constants.ts. This
 * script parses that single declaration and uses its keys. It contains no second
 * list of project names of its own — replacing one hardcoded list with another
 * would just move the defect. If the declaration cannot be parsed, or parses to
 * fewer than two projects, this script EXITS NON-ZERO with an error. It never
 * degrades to "found nothing, all clear" — a guard that passes because it could
 * not read its own input is worse than no guard.
 *
 * WHAT IT CHECKS  (each is reported with file:line and the offending token)
 * -----------------------------------------------------------------------
 *   1. SME AGENT IDS.  Every `<x>-sme` token in scanned code. `<x>` must be a
 *      case-insensitive prefix of some canonical project name (so `infra-sme` is
 *      valid against `Infrastructure`, `todero-sme` against `Todero`, and
 *      `kemuni-sme` is valid against nothing). Derived, not listed.
 *   2. PROJECT NAMES IN PROJECT POSITION.  `project=eq.X`, `project=X`,
 *      `project:X`, `project: 'X'`, `"project": "X"`, and `<something>project
 *      === 'X'` comparisons. The value must be a canonical project.
 *   3. PROJECT-KEYED TABLES.  Any object literal assigned to an identifier whose
 *      name contains PROJECT (e.g. `PROJECT_EMOJI`, `PROJECT_COLORS`,
 *      `PROGRESS_PROJECTS`). Every key must be a canonical project. This is the
 *      table shape that survived two sweeps.
 *   4. `project` FIELD OPTION LISTS.  A `{ name: 'project', ... options: [...] }`
 *      field definition (lib/issue-type-config.ts's shape). Every option must be
 *      a canonical project.
 *   5. lib/constants.ts SELF-CHECK.  Every VALUE in `PROJECT_ALIASES` must be a
 *      key of `PROJECT_PREFIX`, so an alias cannot reintroduce a project name.
 *
 * WHAT IT DOES *NOT* COVER — read this before trusting a green run
 * ----------------------------------------------------------------
 *   - COMMENTS ARE STRIPPED BEFORE SCANNING, DELIBERATELY. Tombstone comments —
 *     the ones that record what was deleted and why — must survive, and this
 *     repo has twice graded its own explanatory comment as a defect and lost a
 *     round to it. A consequence: a reference hidden in a comment is invisible
 *     here, which is the intended trade.
 *   - DIRECTORIES IT NEVER OPENS: __tests__/ (fixtures may legitimately name a
 *     removed id to prove it stays removed), node_modules, .next-anything, exports/,
 *     config/, data/, docs/, migrations/, supabase/, scripts/, public/, and any
 *     dotfile directory. `scripts/` is skipped in particular because
 *     scripts/acceptance/checks.mjs and checks-anywhere.mjs carry a mac home-dir
 *     DETECTOR pattern built from the invented agent's name — that string is the
 *     thing those checks hunt for, so flagging it would be a false positive. (The
 *     literal is deliberately NOT reproduced in this comment: the same acceptance
 *     check scans this file too, and a guard whose documentation trips a sibling
 *     guard is exactly the self-inflicted failure TOD-2410 already cost a round
 *     to.) data/*.json is skipped because it
 *     is unreferenced legacy seed data (no .ts/.tsx imports it) whose bare
 *     `name`/`id` fields this script has no way to validate; it is a real
 *     defect, tracked separately, not something a green run here clears.
 *   - PROSE INSIDE STRINGS. `"we used to build Vespera"` in a user-facing string
 *     is not in project position and is not flagged.
 *   - AGENT IDS THAT ARE NOT `*-sme`. A future invented agent named `foo-agent`
 *     would pass. The `-sme` family is what the fabrications used.
 *   - OBJECT LITERALS NOT NAMED `*PROJECT*`. A project-keyed map called `BIZ` or
 *     `HUBS` is invisible to check 3.
 *   - REGEX LITERALS. The comment stripper treats `/` heuristically; a project
 *     name inside a regex literal may or may not be seen.
 *   - AGENTS.md, and any other Markdown. The roster file is data this app reads
 *     at runtime, not code, and is owned elsewhere. This host's AGENTS.md still
 *     lists `kemuni-sme` and `vespera-sme`, so loadAgentRoster() can still name
 *     them at runtime. A green run here does not mean the roster is clean.
 *   - ITS OWN SOURCE OF TRUTH. Adding `Kemuni: 'KEM'` back to PROJECT_PREFIX
 *     would make `Kemuni` canonical and silence every check about it. That is
 *     unavoidable in any derive-from-a-constant design and is the whole reason
 *     lib/constants.ts carries a written tombstone saying why those two entries
 *     went: the guard stops accidental reintroduction, the tombstone is what
 *     stops a deliberate one. Review any diff that edits PROJECT_PREFIX.
 *
 * USAGE
 *   node scripts/no-invented-projects.mjs            # scan the default roots
 *   node scripts/no-invented-projects.mjs lib app    # scan only these paths
 * Exit 0 = clean. Exit 1 = violations (listed). Exit 2 = the guard itself could
 * not run (could not read or parse lib/constants.ts).
 *
 * NOT WIRED INTO ANY OTHER SCRIPT ON PURPOSE. scripts/smoke-test-layout.sh is
 * owned by another agent this session; wiring is the orchestrator's call.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const CONSTANTS_FILE = join(REPO_ROOT, 'lib', 'constants.ts')

const DEFAULT_ROOTS = ['app', 'lib', 'components', 'hooks']
const SKIP_DIRS = new Set([
  '__tests__', 'node_modules', 'exports', 'config', 'data', 'docs',
  'migrations', 'supabase', 'scripts', 'public', 'design',
])
const SCAN_EXT = /\.(ts|tsx|mjs|cjs|js|jsx)$/

// ── 1. Derive the canonical project set from ONE named constant ─────────────

/** Parse `export const PROJECT_PREFIX ... = { ... }` and return its keys. */
function readCanonicalProjects() {
  let src
  try {
    src = readFileSync(CONSTANTS_FILE, 'utf8')
  } catch (e) {
    fail(`cannot read ${rel(CONSTANTS_FILE)}: ${e.message}`)
  }
  const body = objectLiteralAfter(src, /\bPROJECT_PREFIX\b[^=\n]*=\s*/)
  if (!body) fail(`could not locate the PROJECT_PREFIX object literal in ${rel(CONSTANTS_FILE)}`)
  const keys = objectKeys(body)
  if (keys.length < 2) {
    fail(
      `parsed only ${keys.length} project name(s) from PROJECT_PREFIX in ${rel(CONSTANTS_FILE)}. ` +
      `Refusing to run: an almost-empty canonical set would make every check trivially pass.`
    )
  }
  return keys
}

/** Same trick for PROJECT_ALIASES, used by the self-check. Returns [k, v] pairs. */
function readAliasPairs(strippedSrc) {
  const body = objectLiteralAfter(strippedSrc, /\bPROJECT_ALIASES\b[^=\n]*=\s*/)
  if (!body) return null
  return objectEntries(body)
}

function fail(msg) {
  console.error(`\n  no-invented-projects: GUARD COULD NOT RUN — ${msg}\n`)
  process.exit(2)
}

// ── 2. Tiny source utilities ────────────────────────────────────────────────

const rel = (p) => relative(REPO_ROOT, p).split(sep).join('/')

/**
 * Replace comment bodies with spaces, preserving line/column offsets so reported
 * line numbers stay true. Tracks quote and template state so a `//` inside a
 * string is not mistaken for a comment. Regex literals are not modelled — see
 * the coverage note in the header.
 */
function stripComments(src) {
  const out = src.split('')
  let i = 0
  let state = 'code' // code | sq | dq | tpl | line | block
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; out[i] = ' '; out[i + 1] = ' '; i += 2; continue }
      if (c === '/' && n === '*') { state = 'block'; out[i] = ' '; out[i + 1] = ' '; i += 2; continue }
      if (c === "'") state = 'sq'
      else if (c === '"') state = 'dq'
      else if (c === '`') state = 'tpl'
    } else if (state === 'sq' || state === 'dq' || state === 'tpl') {
      if (c === '\\') { i += 2; continue }
      if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) state = 'code'
    } else if (state === 'line') {
      if (c === '\n') state = 'code'
      else out[i] = ' '
    } else if (state === 'block') {
      if (c === '*' && n === '/') { out[i] = ' '; out[i + 1] = ' '; state = 'code'; i += 2; continue }
      if (c !== '\n') out[i] = ' '
    }
    i++
  }
  return out.join('')
}

/** Find the first `{...}` after `pattern`, brace-matched (not regex-guessed). */
function objectLiteralAfter(src, pattern) {
  const m = pattern.exec(src)
  if (!m) return null
  let i = m.index + m[0].length
  while (i < src.length && src[i] !== '{') {
    if (src[i] === '\n') return null
    i++
  }
  if (src[i] !== '{') return null
  const start = i
  let depth = 0
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(start, i + 1) }
  }
  return null
}

const ENTRY_RE = /(?:^|[{,])\s*(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*:\s*(?:'([^']*)'|"([^"]*)")?/g

function objectEntries(body) {
  const out = []
  let m
  ENTRY_RE.lastIndex = 0
  while ((m = ENTRY_RE.exec(body))) {
    const key = m[1] ?? m[2] ?? m[3]
    const val = m[4] ?? m[5] ?? null
    if (key) out.push([key, val])
  }
  return out
}

const objectKeys = (body) => objectEntries(body).map(([k]) => k)

/** 1-based line number of a character offset. */
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length

function walk(dir, acc) {
  let entries
  try { entries = readdirSync(dir) } catch { return acc }
  for (const name of entries) {
    if (name.startsWith('.')) continue
    const full = join(dir, name)
    let st
    try { st = statSync(full) } catch { continue }
    if (st.isDirectory()) {
      if (SKIP_DIRS.has(name)) continue
      walk(full, acc)
    } else if (SCAN_EXT.test(name)) {
      acc.push(full)
    }
  }
  return acc
}

// ── 3. The checks ───────────────────────────────────────────────────────────

const CANONICAL = readCanonicalProjects()
const CANON_SET = new Set(CANONICAL)
const CANON_LOWER = CANONICAL.map((p) => p.toLowerCase())

const isCanonicalProject = (name) => CANON_SET.has(name.trim())
/** `infra` matches `Infrastructure`; `kemuni` matches nothing. */
const isProjectSlugPrefix = (slug) => CANON_LOWER.some((p) => p.startsWith(slug.toLowerCase()))

const violations = []
const record = (file, src, idx, token, why) =>
  violations.push({ file: rel(file), line: lineOf(src, idx), token, why })

// 1. `<x>-sme` agent ids
const SME_RE = /\b([A-Za-z][A-Za-z0-9]*)-sme\b/g
// 2. project in project position
const PROJECT_POS_RE =
  /(?:\bproject\s*=\s*(?:eq\.)?|["']?\bproject["']?\s*:\s*|[Pp]roj(?:ect)?\s*===?\s*)\s*(?:'([^'\n]{1,40})'|"([^"\n]{1,40})"|([A-Za-z][A-Za-z ]{0,30}?))(?=['"&,}\n\)]|\s*$)/g
// 3. object literals named *PROJECT*
const PROJECT_TABLE_RE = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]*)?=\s*(?=\{)/g
// 4. `{ name: 'project', ... options: [...] }`
const PROJECT_FIELD_RE = /name\s*:\s*['"]project['"][\s\S]{0,400}?options\s*:\s*\[([^\]]*)\]/g

function checkFile(file) {
  const raw = readFileSync(file, 'utf8')
  const src = stripComments(raw)
  let m

  SME_RE.lastIndex = 0
  while ((m = SME_RE.exec(src))) {
    if (!isProjectSlugPrefix(m[1])) {
      record(file, src, m.index, m[0], `no project matches "${m[1]}" — agent id names a project that does not exist`)
    }
  }

  PROJECT_POS_RE.lastIndex = 0
  while ((m = PROJECT_POS_RE.exec(src))) {
    const value = (m[1] ?? m[2] ?? m[3] ?? '').trim()
    if (!value) continue
    // Skip anything that is plainly not a literal project name.
    if (/^(?:[a-z_$][\w$]*|[A-Z_]{2,})$/.test(value) && !isCanonicalProject(value)) {
      // identifiers / variables / SCREAMING_CASE — a value, not a name
      if (!/^[A-Z][a-z]/.test(value)) continue
    }
    if (!isCanonicalProject(value)) {
      record(file, src, m.index, value, `project "${value}" is not in PROJECT_PREFIX (lib/constants.ts)`)
    }
  }

  PROJECT_TABLE_RE.lastIndex = 0
  while ((m = PROJECT_TABLE_RE.exec(src))) {
    const ident = m[1]
    if (!/project/i.test(ident)) continue
    // lib/constants.ts is this guard's own source of truth; PROJECT_PREFIX would
    // trivially validate against itself and PROJECT_ALIASES keys are lowercase
    // shorthands, not names. That file gets the dedicated self-check instead.
    if (rel(file) === 'lib/constants.ts') continue
    const body = objectLiteralAfter(src.slice(m.index), /=\s*/)
    if (!body) continue
    for (const key of objectKeys(body)) {
      if (!isCanonicalProject(key)) {
        record(file, src, m.index, `${ident}.${key}`, `project-keyed table "${ident}" has key "${key}", which is not a real project`)
      }
    }
  }

  PROJECT_FIELD_RE.lastIndex = 0
  while ((m = PROJECT_FIELD_RE.exec(src))) {
    for (const opt of m[1].split(',')) {
      const v = opt.trim().replace(/^['"]|['"]$/g, '')
      if (!v) continue
      if (!isCanonicalProject(v)) {
        record(file, src, m.index, v, `the "project" field offers option "${v}", which is not a real project`)
      }
    }
  }
}

function selfCheckConstants() {
  const raw = readFileSync(CONSTANTS_FILE, 'utf8')
  const src = stripComments(raw)
  const pairs = readAliasPairs(src)
  if (!pairs) {
    fail(`could not locate the PROJECT_ALIASES object literal in ${rel(CONSTANTS_FILE)}`)
  }
  for (const [key, val] of pairs) {
    if (val === null) continue
    if (!isCanonicalProject(val)) {
      record(CONSTANTS_FILE, src, src.indexOf(`${val}`), `PROJECT_ALIASES.${key}`, `alias resolves to "${val}", which is not a key of PROJECT_PREFIX`)
    }
  }
}

// ── 4. Run ──────────────────────────────────────────────────────────────────

const argRoots = process.argv.slice(2)
const roots = (argRoots.length ? argRoots : DEFAULT_ROOTS).map((r) => join(REPO_ROOT, r))

const files = []
for (const root of roots) {
  let st
  try { st = statSync(root) } catch { continue }
  if (st.isDirectory()) walk(root, files)
  else if (SCAN_EXT.test(root)) files.push(root)
}

if (files.length === 0) {
  fail(`no source files found under: ${roots.map(rel).join(', ')}`)
}

for (const f of files) checkFile(f)
selfCheckConstants()

console.log(`no-invented-projects: real projects = [${CANONICAL.join(', ')}] (from PROJECT_PREFIX in lib/constants.ts)`)
console.log(`no-invented-projects: scanned ${files.length} files under ${roots.map(rel).join(', ')}`)

if (violations.length) {
  console.error(`\n  ${violations.length} invented project/agent reference(s) in live code:\n`)
  for (const v of violations) {
    console.error(`    ${v.file}:${v.line}  ${v.token}`)
    console.error(`        ${v.why}`)
  }
  console.error(
    `\n  These are LIVE code, not comments — comments were stripped before scanning,\n` +
    `  so a tombstone recording a past deletion is never reported here.\n` +
    `  See docs/rebuild/pieces/pieces6/no-invented-projects-sweep.md\n`
  )
  process.exit(1)
}

console.log('no-invented-projects: OK — no invented project or SME agent in live code.')

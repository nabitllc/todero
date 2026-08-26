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
 * From TWO existing declarations, neither of them written for this script:
 *
 *   PROJECTS — `PROJECT_PREFIX` in lib/constants.ts. This script parses that
 *   single declaration and uses its keys. It contains no second list of project
 *   names of its own — replacing one hardcoded list with another would just move
 *   the defect.
 *
 *   AGENTS — the roster table in AGENTS.md, parsed the way
 *   `lib/agent-roster.ts:parseAgentsFromMd()` parses it, because that is the
 *   table the running app actually reads. Same reasoning: the set of agents that
 *   exist is not this script's opinion.
 *
 * If either cannot be parsed — or PROJECT_PREFIX yields fewer than two projects,
 * or the roster yields fewer than two agents — this script EXITS 2 with an
 * error. It never degrades to "found nothing, all clear": a guard that passes
 * because it could not read its own input is worse than no guard, and an
 * almost-empty canonical set would make every check trivially pass.
 *
 * WHAT IT CHECKS  (each is reported with file:line and the offending token)
 * -----------------------------------------------------------------------
 *   1. SME AGENT IDS.  Every `<x>-sme` token in scanned code must be a DECLARED
 *      AGENT — an id in the AGENTS.md roster table. Derived, not listed.
 *
 *      This check used to ask a different question: it asked whether `<x>` was a
 *      case-insensitive prefix of a canonical PROJECT name. That question passed
 *      `todero-sme` and `infra-sme` — because `Todero` and `Infrastructure` are
 *      both real projects — while both ids were declared by NO AGENTS.md in this
 *      repo (measured 2026-08-26: 19 such files, one roster table, 14 rows,
 *      neither id among them) and both held a live dispatch lane in
 *      lib/agent-queue.ts, a full record in /api/agent-config, and an
 *      auto-assign in /api/issues. A real project does not make an agent real.
 *      They are two different fabrications and the guard now separates them:
 *      the violation message says whether `<x>` names no project at all, or
 *      names a real project but no declared agent.
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
 *   - REGEX LITERALS are now modelled (see stripComments), including character
 *     classes and the `</div>` / `=> /re/` cases that the plain lexical
 *     heuristic gets wrong in .tsx. Their CONTENTS are still scanned as live
 *     code — a project name inside a regex is a project name — but a quote or
 *     backtick inside one no longer desynchronises the stripper for the rest of
 *     the file. An unterminated regex resyncs at the end of its line rather than
 *     swallowing the file.
 *   - THE CONTENTS OF AGENTS.md, and any other Markdown. The roster file is now
 *     this script's source of truth for agents, not something it validates —
 *     exactly as PROJECT_PREFIX is for projects, and with the same unavoidable
 *     consequence: adding a `| todero-sme | Todero SME | … |` row to the roster
 *     makes that id declared and silences every check about it. That is correct
 *     — declaring an agent IS the deliberate act this guard wants to force — but
 *     it means a diff that edits the AGENTS.md roster table deserves the same
 *     review as one that edits PROJECT_PREFIX. (An earlier version of this note
 *     claimed this host's AGENTS.md "still lists kemuni-sme and vespera-sme".
 *     Measured 2026-08-26: it does not. The table has 14 rows and neither id,
 *     nor `todero-sme`, nor `infra-sme`, is among them.)
 *   - WHICH AGENTS.md THE RUNNING APP PICKS. lib/paths.ts:agentsMdCandidates()
 *     searches four locations, the last being `~/kaos-config/AGENTS.md`, so at
 *     runtime the roster can come from outside this repo. This script reads the
 *     repo's own AGENTS.md (honouring AGENTS_MD_PATH / TODERO_AGENTS_MD) on
 *     purpose: a guard whose verdict depends on the developer's home directory
 *     would pass on one machine and fail on another. A green run here means the
 *     repo's code agrees with the repo's roster, not with every host's.
 *   - AGENT IDS DECLARED ONLY BY DISPLAY NAME. A roster row with no `Id` column
 *     contributes both its explicit id (when present) and the slugified agent
 *     name, so a legacy table naming "Todero SME" declares `todero-sme`. This is
 *     deliberately the permissive direction: a false positive here blocks a
 *     commit on correct code, which is how guards get deleted.
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

/**
 * Where the roster comes from. Mirrors lib/paths.ts:agentsMdCandidates() for
 * the two entries that live inside this repo, and honours the same env
 * overrides so this check is testable without moving files around. See the
 * coverage note about `~/kaos-config/AGENTS.md` in the header.
 */
function agentsMdCandidates() {
  const override = (process.env.AGENTS_MD_PATH ?? process.env.TODERO_AGENTS_MD)?.trim()
  if (override) return [override]
  return [join(REPO_ROOT, 'AGENTS.md'), join(REPO_ROOT, 'config', 'AGENTS.md')]
}

/** First path in the list that exists as a file, or null. */
function firstExistingPath(candidates) {
  for (const p of candidates) {
    try {
      if (statSync(p).isFile()) return p
    } catch { /* next candidate */ }
  }
  return null
}

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

/**
 * Parse the AGENTS.md roster table and return the set of declared agent ids.
 *
 * Deliberately mirrors lib/agent-roster.ts:parseAgentsFromMd(): find the header
 * row that has an "Agent" column plus one of Model/Role/Notes, then read every
 * row beneath it until the table ends. A row contributes its explicit `Id`
 * column when the table has one, AND the slugified Agent cell — see the
 * permissiveness note in the header.
 *
 * Refuses (exit 2) rather than returning an empty set. An empty roster would
 * make EVERY `<x>-sme` in the codebase a violation, which looks like a working
 * guard right up until someone silences it by deleting the check.
 */
function readDeclaredAgentIds() {
  const candidates = agentsMdCandidates()
  const mdPath = firstExistingPath(candidates)
  if (!mdPath) {
    fail(
      `no AGENTS.md found — looked in: ${candidates.map(rel).join(', ')}. ` +
      `Set AGENTS_MD_PATH to point at the roster file.`
    )
  }

  let lines
  try {
    lines = readFileSync(mdPath, 'utf8').split('\n')
  } catch (e) {
    fail(`cannot read ${rel(mdPath)}: ${e.message}`)
  }

  const cellsOf = (line) => line.split('|').map((c) => c.trim()).filter(Boolean)

  const headerIdx = lines.findIndex((l) => {
    if (!/^\s*\|/.test(l)) return false
    const cols = cellsOf(l)
    return cols.some((c) => /^agent$/i.test(c)) && cols.some((c) => /^(model|role|notes)$/i.test(c))
  })
  if (headerIdx === -1) fail(`no agent roster table found in ${rel(mdPath)}`)

  const header = cellsOf(lines[headerIdx])
  const agentIdx = header.findIndex((c) => /^agent$/i.test(c))
  const idIdx = header.findIndex((c) => /^id$/i.test(c))

  const slug = (raw) => raw.trim().toLowerCase().replace(/\s+/g, '-')
  const ids = new Set()
  let rows = 0
  // +2 skips the header and the |---|---| separator beneath it.
  for (let i = headerIdx + 2; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line.startsWith('|')) break
    const cols = cellsOf(line)
    if (cols.length < header.length) continue
    rows++
    if (idIdx >= 0 && cols[idIdx]) ids.add(slug(cols[idIdx]))
    if (agentIdx >= 0 && cols[agentIdx]) ids.add(slug(cols[agentIdx]))
  }

  if (ids.size < 2) {
    fail(
      `parsed only ${ids.size} agent id(s) from the roster table in ${rel(mdPath)}. ` +
      `Refusing to run: an almost-empty roster would make every agent id look invented.`
    )
  }
  return { ids, path: mdPath, rows }
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

/** Keywords after which a `/` begins a regex literal, never a division. */
const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'do', 'else', 'case', 'yield', 'await',
])

/**
 * Does a `/` at `idx` start a regex literal, or is it a division / JSX slash?
 *
 * The standard lexical heuristic: look at the last significant character. After
 * a value — identifier, number, `)`, `]`, `}`, a closing quote — a slash is
 * division. Everywhere else it opens a regex. Two amendments this codebase
 * actually needs:
 *
 *   - `=> /re/.test(x)` is common, and `>` would otherwise read as a value.
 *   - `</div>` is EVERYWHERE in .tsx. Its `/` follows `<`, which is not a value
 *     character, so the plain heuristic would open a regex on every closing JSX
 *     tag. `<` is treated as a non-regex context for that reason.
 */
function startsRegexLiteral(chars, idx) {
  let j = idx - 1
  while (j >= 0 && /\s/.test(chars[j])) j--
  if (j < 0) return true
  const c = chars[j]
  if (c === '>' && j > 0 && chars[j - 1] === '=') return true // arrow function body
  if (c === '<') return false                                 // JSX closing tag
  if (/[A-Za-z0-9_$]/.test(c)) {
    let k = j
    while (k >= 0 && /[A-Za-z0-9_$]/.test(chars[k])) k--
    return REGEX_PRECEDING_KEYWORDS.has(chars.slice(k + 1, j + 1).join(''))
  }
  return !/[)\]}'"`]/.test(c)
}

/**
 * Replace comment bodies with spaces, preserving line/column offsets so reported
 * line numbers stay true. Tracks quote, template AND regex state so a `//`
 * inside a string is not mistaken for a comment.
 *
 * one-scope-answer: regex literals used to be unmodelled, and the header used to
 * shrug that "a project name inside a regex literal may or may not be seen".
 * That understated it. components/tabs/ChatTab.tsx:121 contains
 * `.replace(/[*#>`...]/…)` — a regex whose CHARACTER CLASS contains a backtick.
 * Unmodelled, that backtick opened template-literal state, and the stripper
 * stayed in it for the next sixty lines: every `//` in that range was invisible,
 * so a plain line comment at :373 mentioning `@infra-sme` was scanned as live
 * code and reported as a violation. One stray character in one regex silently
 * turned the comment stripper off for a whole region of the file.
 *
 * A guard that reports a comment as a defect is the specific failure this repo
 * has already lost a round to twice (see the tombstone note in the header), so
 * it is modelled now rather than disclaimed.
 */
function stripComments(src) {
  const out = src.split('')
  let i = 0
  let state = 'code' // code | sq | dq | tpl | line | block | regex
  let inCharClass = false // inside a regex `[...]`, where `/` is literal
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (state === 'code') {
      if (c === '/' && n === '/') { state = 'line'; out[i] = ' '; out[i + 1] = ' '; i += 2; continue }
      if (c === '/' && n === '*') { state = 'block'; out[i] = ' '; out[i + 1] = ' '; i += 2; continue }
      if (c === '/' && startsRegexLiteral(out, i)) { state = 'regex'; inCharClass = false }
      else if (c === "'") state = 'sq'
      else if (c === '"') state = 'dq'
      else if (c === '`') state = 'tpl'
    } else if (state === 'sq' || state === 'dq' || state === 'tpl') {
      if (c === '\\') { i += 2; continue }
      if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) state = 'code'
    } else if (state === 'regex') {
      // A regex is left as-is (it is code, not a comment) — the point of the
      // state is only to stop its contents from being read as quotes.
      if (c === '\\') { i += 2; continue }
      if (c === '\n') { state = 'code'; inCharClass = false } // unterminated: resync at the line end
      else if (c === '[') inCharClass = true
      else if (c === ']') inCharClass = false
      else if (c === '/' && !inCharClass) state = 'code'
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

const ROSTER = readDeclaredAgentIds()
const DECLARED_AGENTS = ROSTER.ids

const isCanonicalProject = (name) => CANON_SET.has(name.trim())
/** `infra` matches `Infrastructure`; `kemuni` matches nothing. */
const isProjectSlugPrefix = (slug) => CANON_LOWER.some((p) => p.startsWith(slug.toLowerCase()))
/** The only question check 1 asks now. */
const isDeclaredAgent = (id) => DECLARED_AGENTS.has(id.toLowerCase())

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
    const id = m[0]
    if (isDeclaredAgent(id)) continue
    // Both are violations. The message separates the two fabrications so the
    // reader is not sent to fix the wrong one: `kemuni-sme` names a project
    // that does not exist, while `todero-sme` names a project that does and an
    // agent that does not. The second class is what this check used to miss.
    const why = isProjectSlugPrefix(m[1])
      ? `"${id}" is not a declared agent — no row in the roster table in ${rel(ROSTER.path)}. ` +
        `(Its "${m[1]}" DOES name a real project, which is why the old project-prefix ` +
        `check passed it. A real project does not make an agent real.)`
      : `"${id}" is not a declared agent, and no project matches "${m[1]}" either — ` +
        `the id invents both. See the roster table in ${rel(ROSTER.path)}.`
    record(file, src, m.index, id, why)
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
console.log(
  `no-invented-projects: declared agents = ${ROSTER.rows} roster row(s) -> ${DECLARED_AGENTS.size} accepted id(s) ` +
  `(each row contributes its Id column and its slugified Agent name) from ${rel(ROSTER.path)}`
)
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

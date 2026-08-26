#!/usr/bin/env node
/**
 * no-cloud-provider.mjs — fail the build when live code names an LLM provider
 * the owner has ruled out.
 *
 * WHY THIS EXISTS
 * ---------------
 * The channel goal is "the provider is a base URL, not a code branch". The
 * removal work itself is already done: measured 2026-08-26, the four live-code
 * roots below contain zero references to the ruled-out provider, and
 * `POST /api/chat` sends to `${LLM_BASE_URL}/chat/completions` with no vendor
 * branch anywhere in the path. What did not exist was anything that FAILS when
 * the name comes back. This repo has twice reinvented a fabrication it had
 * already deleted (see the tombstone note in scripts/no-invented-projects.mjs),
 * so the deletion is now enforced by a run rather than by a memory.
 *
 * There is a second, subtler reason this script exists rather than a plain
 * grep. The existing acceptance check for this provider (`no-<provider>` in
 * scripts/acceptance/checks.mjs, via `countMatches`) greps RAW TEXT across the
 * same roots. Raw text cannot tell a live `fetch()` from a tombstone comment
 * recording that the `fetch()` was deleted and why — so the only way to satisfy
 * a raw-text grep is to erase the record of the deletion, which is precisely how
 * the thing gets reinvented. This guard strips comments first, so a tombstone
 * can stay.
 *
 * WHERE "RULED OUT" COMES FROM
 * ----------------------------
 * From ONE existing declaration that was not written for this script: the
 * `- **Never <Provider>.**` bullets under the heading
 *
 *     ## Owner decisions already made — do not re-litigate
 *
 * in docs/rebuild/HANDOFF.md. This script carries NO list of provider names of
 * its own — replacing one hardcoded list with another would just move the
 * defect, and a guard that is the last remaining place a banned name is spelled
 * out is its own small failure. Override the file with HANDOFF_MD_PATH (used by
 * the acceptance item that proves this script refuses to run without it).
 *
 * If the heading is missing, the file is unreadable, or the section yields ZERO
 * names, this script EXITS 2 with an error. It never degrades to "found
 * nothing, all clear": an empty banned set would make every check trivially
 * pass, which is the failure mode that makes a green run meaningless. The
 * consequence to know about: deleting the `**Never …**` bullet does not silence
 * this guard, it breaks it — deliberately, so that reversing an owner decision
 * is a visible act.
 *
 * WHAT IT CHECKS
 * --------------
 * Every occurrence of a ruled-out provider's name, case-insensitively, as a
 * substring of any identifier, string literal, URL or property in LIVE code
 * under app/, lib/, components/, hooks/. Substring on purpose: the name shows up
 * as a hostname label, as a `<NAME>_API_KEY` env var and as a `<name>/model-id`
 * prefix, and all three are the same defect. Each hit is reported as
 * `file:line` with the offending token.
 *
 * WHAT IT DOES *NOT* COVER — read this before trusting a green run
 * ----------------------------------------------------------------
 *   - COMMENTS ARE STRIPPED BEFORE SCANNING, DELIBERATELY. That is the whole
 *     point (see above): tombstones must survive. The trade is real and is
 *     stated here rather than disclaimed — a live reference smuggled inside a
 *     comment is invisible to this script. Nothing executes a comment, so the
 *     exposure is that a comment could stop being a tombstone and become
 *     instructions for a future reader; that is a review problem, not one a
 *     lexer can catch.
 *   - DIRECTORIES IT NEVER OPENS: __tests__/ (a fixture may legitimately name a
 *     removed provider in order to prove it stays removed), scripts/ (the
 *     acceptance graders necessarily CONTAIN the pattern they hunt for — a
 *     grader that grades itself is a Wave 4 mistake this repo has already paid
 *     for), node_modules, .next-anything, exports/, config/, data/, docs/,
 *     migrations/, supabase/, public/, design/, and any dotfile directory.
 *   - MIGRATIONS. `migrations/045_connections_table.sql` and
 *     `migrations/sqlite/000_baseline.sql` each carry a `CHECK (type IN (…))`
 *     on the connections table that still ADMITS a row of the ruled-out
 *     provider's type. That is a real, open defect; a green run here does not
 *     clear it. It is not fixed here because migrations/** is owned by another
 *     builder this session — the exact lines are named in
 *     docs/rebuild/pieces/pieces6/provider-is-a-base-url.md.
 *   - OPERATOR DOCUMENTATION. .env.local.template, README.md and
 *     scripts/setup.mjs name the provider as one EXAMPLE of an
 *     OpenAI-compatible endpoint. That is prose about a request shape, not a
 *     route. Whether it should still be named there is an owner call, not
 *     something this guard should assert.
 *   - THE ENVIRONMENT. This reads source, never `.env.local`. A ruled-out
 *     endpoint configured in LLM_BASE_URL at runtime would not be seen here.
 *     That is the correct division — the seam's whole design is that the
 *     provider is configuration — but it means this guard proves the CODE has
 *     no branch, not that the HOST is pointed somewhere the owner approved.
 *   - PROVIDERS NOBODY RULED OUT. Only names carried by a `**Never …**` bullet
 *     are banned. This is not a general cloud-vendor detector.
 *   - ITS OWN SOURCE OF TRUTH. Editing the owner-decisions section of
 *     HANDOFF.md changes what this script bans. That is unavoidable in any
 *     derive-from-a-declaration design, and is the point: un-banning a provider
 *     should require editing the document that records the decision. Review any
 *     diff that touches that section.
 *
 * USAGE
 *   node scripts/no-cloud-provider.mjs             # scan the default roots
 *   node scripts/no-cloud-provider.mjs lib app     # scan only these paths
 * Exit 0 = clean. Exit 1 = violations (listed). Exit 2 = the guard itself could
 * not run (HANDOFF.md unreadable, section missing, or no names parsed).
 *
 * NOT WIRED INTO ANY OTHER SCRIPT ON PURPOSE. scripts/smoke-test-layout.sh and
 * scripts/acceptance/* are owned by other agents this session; wiring is the
 * orchestrator's call.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')

const DEFAULT_ROOTS = ['app', 'lib', 'components', 'hooks']
const SKIP_DIRS = new Set([
  '__tests__', 'node_modules', 'exports', 'config', 'data', 'docs',
  'migrations', 'supabase', 'scripts', 'public', 'design',
])
const SCAN_EXT = /\.(ts|tsx|mjs|cjs|js|jsx)$/

const rel = (p) => relative(REPO_ROOT, p).split(sep).join('/')

function fail(msg) {
  console.error(`\n  no-cloud-provider: GUARD COULD NOT RUN — ${msg}\n`)
  process.exit(2)
}

// ── 1. Derive the ruled-out set from the owner-decisions section ─────────────

function handoffPath() {
  const override = process.env.HANDOFF_MD_PATH?.trim()
  if (override) return override
  return join(REPO_ROOT, 'docs', 'rebuild', 'HANDOFF.md')
}

/** The heading whose bullets are the owner's standing decisions. */
const DECISIONS_HEADING = /^##\s+Owner decisions already made\b.*$/m

/**
 * A decision bullet that rules a thing out. The document's own form is
 *
 *     - **Never <Provider>.** <one sentence of reasoning>
 *
 * so the name is whatever sits between the word "Never" and the end of the
 * bold run. Trailing punctuation is trimmed; nothing else about the sentence
 * is interpreted.
 */
const NEVER_BULLET = /^\s*[-*]\s*\*\*\s*Never\s+([^*]+?)\s*\*\*/gim

/**
 * Reduce a display name to the token that actually appears in code.
 * "Foo Bar" and "FooBar" both reduce to "foobar". Spaces, punctuation and case
 * are all things source can drop or change, so none of them may be
 * load-bearing. (No real banned name is spelled out anywhere in this file, on
 * purpose: a guard that is the last place a deleted name still lives is its own
 * small reintroduction, and this file would otherwise fail itself if it were
 * ever moved under a scanned root.)
 */
const codeToken = (name) => name.toLowerCase().replace(/[^a-z0-9]+/g, '')

function readRuledOutProviders() {
  const path = handoffPath()
  let src
  try {
    src = readFileSync(path, 'utf8')
  } catch (e) {
    fail(`cannot read ${path}: ${e.message}`)
  }
  const heading = DECISIONS_HEADING.exec(src)
  if (!heading) {
    fail(
      `could not find the "## Owner decisions already made" heading in ${path}. ` +
      `This guard derives what is banned from that section and has no list of its own.`
    )
  }
  // The section runs to the next `## ` heading, or to the end of the file.
  const start = heading.index + heading[0].length
  const nextHeading = /^##\s/m.exec(src.slice(start))
  const section = nextHeading ? src.slice(start, start + nextHeading.index) : src.slice(start)

  const names = []
  NEVER_BULLET.lastIndex = 0
  let m
  while ((m = NEVER_BULLET.exec(section))) {
    const display = m[1].replace(/[.,;:!]+$/, '').trim()
    const token = codeToken(display)
    // A one- or two-character token would match half the tree. Refuse it
    // rather than emit a guard that flags `if` statements.
    if (token.length < 3) continue
    names.push({ display, token })
  }
  if (names.length === 0) {
    fail(
      `parsed 0 "**Never <Provider>.**" bullet(s) from the owner-decisions section of ${path}. ` +
      `Refusing to run: an empty banned set would make every check trivially pass.`
    )
  }
  return { path, names }
}

// ── 2. Source utilities ─────────────────────────────────────────────────────
//
// The comment stripper below is the same state machine as
// scripts/no-invented-projects.mjs. It is duplicated rather than imported
// because that file exports nothing and belongs to another agent this session;
// the duplication is deliberate and the two should be kept in step. Its regex
// modelling is not decoration: an unmodelled backtick inside a regex character
// class in ChatTab.tsx once desynchronised the sibling guard for sixty lines and
// made it report a plain comment as a defect.

/** Keywords after which a `/` begins a regex literal, never a division. */
const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'do', 'else', 'case', 'yield', 'await',
])

/**
 * Does a `/` at `idx` start a regex literal, or is it a division / JSX slash?
 * Standard lexical heuristic plus the two amendments this codebase needs:
 * `=> /re/.test(x)` (arrow body) and `</div>` (JSX closing tag, everywhere).
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
 * Replace comment bodies with spaces, preserving line/column offsets so
 * reported line numbers stay true. Tracks quote, template AND regex state so a
 * `//` inside a string is not mistaken for a comment.
 */
function stripComments(src) {
  const out = src.split('')
  let i = 0
  let state = 'code' // code | sq | dq | tpl | line | block | regex
  let inCharClass = false
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
      if (c === '\\') { i += 2; continue }
      if (c === '\n') { state = 'code'; inCharClass = false } // unterminated: resync at line end
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

/** 1-based line number of a character offset. */
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length

/**
 * The surrounding token, so the report says WHAT was found rather than only
 * where. Widened across the identifier/URL characters either side of the hit.
 */
function tokenAround(src, idx, len) {
  const isTok = (ch) => ch !== undefined && /[A-Za-z0-9_$./:-]/.test(ch)
  let a = idx
  while (a > 0 && isTok(src[a - 1])) a--
  let b = idx + len
  while (b < src.length && isTok(src[b])) b++
  return src.slice(a, b).trim().slice(0, 120)
}

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

// ── 3. The check ────────────────────────────────────────────────────────────

const { path: HANDOFF, names: RULED_OUT } = readRuledOutProviders()
const violations = []

function checkFile(file) {
  let raw
  try { raw = readFileSync(file, 'utf8') } catch { return }
  const src = stripComments(raw)
  for (const { display, token } of RULED_OUT) {
    const re = new RegExp(token, 'gi')
    let m
    while ((m = re.exec(src))) {
      violations.push({
        file: rel(file),
        line: lineOf(src, m.index),
        token: tokenAround(src, m.index, m[0].length),
        why: `names "${display}", which docs/rebuild/HANDOFF.md rules out ("Never ${display}")`,
      })
    }
  }
}

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

console.log(
  `no-cloud-provider: ruled out = [${RULED_OUT.map(n => n.display).join(', ')}] ` +
  `(from the "**Never …**" bullets in ${rel(HANDOFF)})`
)
console.log(`no-cloud-provider: scanned ${files.length} files under ${roots.map(rel).join(', ')}`)

if (violations.length) {
  console.error(`\n  ${violations.length} ruled-out provider reference(s) in live code:\n`)
  for (const v of violations) {
    console.error(`    ${v.file}:${v.line}  ${v.token}`)
    console.error(`        ${v.why}`)
  }
  console.error(
    `\n  These are LIVE code, not comments — comments were stripped before scanning,\n` +
    `  so a tombstone recording a past deletion is never reported here.\n` +
    `  The provider is meant to be a base URL (LLM_BASE_URL), not a branch.\n` +
    `  See docs/rebuild/pieces/pieces6/provider-is-a-base-url.md\n`
  )
  process.exit(1)
}

console.log('no-cloud-provider: OK — no ruled-out provider named in live code.')

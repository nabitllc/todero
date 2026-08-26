#!/usr/bin/env node
/**
 * no-phantom-columns.mjs — fail the build when live code reads or writes a
 * column the database does not have.
 *
 * WHY THIS EXISTS
 * ---------------
 * `test_status` survived FOUR sweeps. It was declared on the issue type in
 * lib/issues.ts, rendered by components/tabs/BoardTab.tsx, written by three
 * sites in the API, and gated on by a validator — and it is not a column on
 * `issues`. The cost was not cosmetic: every `PATCH /api/issues` into or out of
 * `code_review` answered HTTP 500 `no such column: test_status`, so the review
 * lifecycle could not complete in either direction, and a unit test asserting
 * the phantom write kept the suite green throughout.
 *
 * The reason it survived is that each sweep asked "what breaks if this goes?"
 * and the answer looked like "nothing" — a `?:` field on a TypeScript interface
 * type-checks whether or not the column exists, and a `{t.test_status && …}`
 * render just never renders. Nothing in the toolchain compares a column NAME
 * against a schema. That comparison is this script.
 *
 * It is not a one-column defect either. The audit that produced this script
 * found FOUR more phantoms on the same table — `environment`,
 * `steps_to_reproduce`, `expected_behavior`, `actual_behavior` — one of which
 * (`environment`) was named by a LIVE validator on the seeded bug
 * defined -> open transition and deadlocked it in both directions, exactly as
 * `test_status` deadlocked code_review. Measured against the running API
 * before migration 066:
 *   PATCH without environment -> 400 "missing required fields: environment"
 *   PATCH with    environment -> 500 "no such column: environment"
 * Migration 066 added those four (they are source data, not derivable). This
 * script is what makes the next one of them fail a check instead of a sprint.
 *
 * HONEST NOTE ON WHAT THIS SCRIPT WOULD HAVE CAUGHT, HAD IT EXISTED
 * ----------------------------------------------------------------
 * Not all five, unaided. Measured: with the `@db-table` annotation removed from
 * lib/issues.ts, re-adding `test_status?: string` to that interface produces a
 * CLEAN run (exit 0); with the annotation present it is reported (exit 1). The
 * annotation is load-bearing, and it did not exist before this script did.
 * Checks 1 and 2 would have caught the API's `.update()` writes and any query
 * string, which is where the HTTP 500s came from — but the BoardTab render and
 * the interface declaration, the two places the phantom lived longest and most
 * quietly, are only visible through check 3. So: annotate the row shape of
 * every table this app writes. An unannotated interface is a blind spot, and
 * saying otherwise here is how a green run gets over-trusted.
 *
 * WHERE "REAL" COMES FROM
 * -----------------------
 * Two sources, in this order, and the script always PRINTS which one it used:
 *
 *   1. THE LIVE DATABASE — `db.sqlite`, read with PRAGMA table_info. This is
 *      the schema the running app actually answers from, which is what the
 *      question is about.
 *   2. `migrations/sqlite/*.sql`, parsed in filename order (CREATE TABLE,
 *      ALTER TABLE ADD/DROP COLUMN, DROP TABLE), when no db.sqlite exists —
 *      a fresh clone or CI. This keeps the guard runnable before anyone has
 *      run `npm run db:migrate`.
 *
 * When BOTH exist, the parsed migrations are used as a STALENESS check, not as
 * a second opinion: if the migrations declare a column that the live database
 * lacks, on a table this scan actually touches, the script EXITS 2 and tells
 * you to run `npm run db:migrate`. A verdict rendered against a database that
 * is behind the repo would flag correct code, and a guard that flags correct
 * code is a guard someone deletes. The reverse direction — a column live but
 * not parsed — is NOT an error, because a parse gap in this file is this
 * file's problem and must never become a false positive.
 *
 * If the chosen source yields fewer than 5 tables, or the `issues` table fewer
 * than 20 columns, the script EXITS 2 rather than reporting a clean run. A
 * guard that passes because it could not read its own input is worse than no
 * guard: an almost-empty schema would make every check trivially fail, and an
 * empty one would make every check trivially pass.
 *
 * WHAT IT CHECKS  (each reported with file:line, the column, and the table)
 * ------------------------------------------------------------------------
 *   1. SEAM CHAINS. Every `.from('<table>')` in scanned code starts a method
 *      chain, and the chain is walked token by token (not regex-guessed):
 *        - filters — .eq .neq .gt .gte .lt .lte .like .ilike .is .in .not
 *          .contains .containedBy .overlaps .match .order — first string
 *          argument is a column.
 *        - .select('a,b,c') — every entry is a column. `*`, `count`, embedded
 *          resources (`x(y)`) and the alias half of `alias:col` are handled.
 *        - .insert({…}) .update({…}) .upsert({…}) — every literal key of the
 *          object is a column. `...spread` and `[computed]` keys are skipped.
 *      A `.from(someVariable)` cannot be resolved statically; those are
 *      COUNTED and printed in the summary rather than silently dropped, so a
 *      green run says how much it could not see.
 *
 *   2. BROWSER QUERY STRINGS. `dbUrl('<table>?…')` and `issuesUrl('…', scope)`
 *      (which is always the `issues` table). The PostgREST-shaped grammar is
 *      parsed: `select=` lists, `col=op.value` filters, `order=col.dir`, and
 *      the `col.op.value` terms inside `or=(…)` / `and=(…)`. `select`, `order`,
 *      `limit`, `offset`, `or`, `and` and `not` are grammar, not columns.
 *
 *   3. ANNOTATED ROW SHAPES. A TypeScript `interface` or `type` preceded by a
 *      `// @db-table <name>` comment declares itself to be the row shape of
 *      that table, and EVERY field it declares must be a column. This is the
 *      check that would have caught `test_status` first and earliest — it lived
 *      on `lib/issues.ts:Task` for far longer than it lived anywhere else, and
 *      that declaration is what made every downstream `t.test_status` compile.
 *      The annotation is read from the RAW source (comments are stripped before
 *      the other checks; see below), and it is a deliberate act by the author:
 *      this script does not guess which interface maps to which table.
 *
 * WHAT IT DOES *NOT* COVER — read this before trusting a green run
 * ----------------------------------------------------------------
 *   - COMMENTS ARE STRIPPED BEFORE SCANNING, DELIBERATELY, for checks 1 and 2.
 *     Tombstone comments — the ones recording what was deleted and why — must
 *     survive, and this repo has twice graded its own explanatory comment as a
 *     defect and lost a round to it. The `@db-table` annotation of check 3 is
 *     therefore read from the raw text, before stripping. The trade: a column
 *     reference hidden in a comment is invisible here, which is intended.
 *   - PLAIN MEMBER ACCESS. `issue.test_status` in a file with no `@db-table`
 *     interface is NOT flagged. Resolving what `issue` is needs a type checker,
 *     and a guard that guesses produces false positives on every local variable
 *     named `row`. Annotate the row shape instead — that is what check 3 is for.
 *     TODAY lib/issues.ts:Task is the ONLY annotated shape in this repo, so
 *     every other row interface is currently a blind spot. That is a backlog
 *     item, not a property of the design: each annotation added narrows it.
 *   - RAW SQL. Hand-written SQL strings are not parsed. The seam in lib/db.ts
 *     exists so that application code does not contain any; if that changes,
 *     this boundary needs revisiting.
 *   - DYNAMIC NAMES. `.eq(fieldName, v)` and `.from(table)` cannot be resolved.
 *     Both are counted and reported, never assumed clean.
 *   - COMPUTED / JOINED KEYS ON WRITES. An `.update({ ...fields })` spread is
 *     invisible: `fields` is a runtime object. This is exactly the hole the
 *     `test_status` write went through in app/api/issues/route.ts, and it is
 *     why that route now REJECTS the field by name in the body rather than
 *     relying on this script to have seen it.
 *   - TABLES THE SCHEMA SOURCE DOES NOT HAVE. A `.from('typo_table')` is
 *     reported as an unknown TABLE, which is a real finding, but the columns
 *     under it cannot then be checked.
 *   - DIRECTORIES IT NEVER OPENS: __tests__, node_modules, .next-anything,
 *     exports, config, data, docs, migrations, supabase, scripts, public,
 *     design, and any dotfile directory. `__tests__` in particular may
 *     legitimately name a removed column to prove it stays removed — that is
 *     what __tests__/utils/issue-routing.test.ts does for `test_status`.
 *   - ITS OWN SOURCE OF TRUTH. Adding `test_status` back in a migration would
 *     make it real and silence every check about it. That is unavoidable in
 *     any derive-from-the-schema design, and is precisely why migration 066
 *     carries a written explanation of why that column is NOT being added.
 *     The guard stops the accidental reintroduction; the tombstones stop the
 *     deliberate one. Review any diff that adds a column to `issues`.
 *
 * USAGE
 *   node scripts/no-phantom-columns.mjs             # scan the default roots
 *   node scripts/no-phantom-columns.mjs lib app     # scan only these paths
 * Exit 0 = clean. Exit 1 = phantom references (listed). Exit 2 = the guard
 * itself could not run (no readable schema, or a stale db.sqlite).
 *
 * NOT WIRED INTO ANY OTHER SCRIPT ON PURPOSE — scripts/smoke-test-layout.sh and
 * the npm scripts are owned by other agents this session; wiring is the
 * orchestrator's call, exactly as it was for scripts/no-invented-projects.mjs.
 */

import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

const REPO_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const SQLITE_DB = join(REPO_ROOT, 'db.sqlite')
const SQLITE_MIGRATIONS = join(REPO_ROOT, 'migrations', 'sqlite')

const DEFAULT_ROOTS = ['app', 'lib', 'components', 'hooks']
const SKIP_DIRS = new Set([
  '__tests__', 'node_modules', 'exports', 'config', 'data', 'docs',
  'migrations', 'supabase', 'scripts', 'public', 'design',
])
const SCAN_EXT = /\.(ts|tsx|mjs|cjs|js|jsx)$/

const rel = (p) => relative(REPO_ROOT, p).split(sep).join('/')

function fail(msg) {
  console.error(`\n  no-phantom-columns: GUARD COULD NOT RUN — ${msg}\n`)
  process.exit(2)
}

// ── 1. The schema ───────────────────────────────────────────────────────────

/** Read the live SQLite database. Returns Map<table, Set<column>> or null. */
function readLiveSchema() {
  if (!existsSync(SQLITE_DB)) return null
  let Database
  try {
    Database = require('better-sqlite3')
  } catch {
    return null // driver not installed — fall back to the migrations
  }
  let db
  try {
    db = new Database(SQLITE_DB, { readonly: true, fileMustExist: true })
  } catch (e) {
    fail(`db.sqlite exists but could not be opened: ${e.message}`)
  }
  const out = new Map()
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
  for (const { name } of tables) {
    out.set(name, new Set(db.prepare(`PRAGMA table_info("${name}")`).all().map((c) => c.name)))
  }
  db.close()
  return out
}

/** Split an SQL column list on top-level commas (parens are nested in CHECKs). */
function splitTopLevel(body) {
  const out = []
  let depth = 0
  let cur = ''
  for (const ch of body) {
    if (ch === '(') depth++
    else if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; continue }
    cur += ch
  }
  if (cur.trim()) out.push(cur)
  return out
}

/**
 * A table-level constraint, not a column definition. Matched on the leading
 * words rather than the first word alone: `key TEXT NOT NULL` is a real column
 * named `key` (hub_settings has one) and must not be eaten by a `KEY` keyword.
 */
const TABLE_CONSTRAINT =
  /^\s*(?:PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE\s*\(|CHECK\s*\(|CONSTRAINT\b|EXCLUDE\b)/i

/** Parse migrations/sqlite/*.sql in filename order. Map<table, Set<column>>. */
function readMigrationSchema() {
  let files
  try {
    files = readdirSync(SQLITE_MIGRATIONS).filter((f) => f.endsWith('.sql')).sort()
  } catch (e) {
    return null
  }
  if (files.length === 0) return null

  const schema = new Map()
  for (const f of files) {
    const sql = readFileSync(join(SQLITE_MIGRATIONS, f), 'utf8').replace(/--[^\n]*/g, '')
    let m

    const dropTable = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?["`]?(\w+)["`]?/gi
    while ((m = dropTable.exec(sql))) schema.delete(m[1])

    const createTable = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?\s*\(/gi
    while ((m = createTable.exec(sql))) {
      const table = m[1]
      let i = m.index + m[0].length - 1
      let depth = 0
      const start = i
      for (; i < sql.length; i++) {
        if (sql[i] === '(') depth++
        else if (sql[i] === ')') { depth--; if (depth === 0) break }
      }
      const cols = schema.get(table) ?? new Set()
      schema.set(table, cols)
      for (const part of splitTopLevel(sql.slice(start + 1, i))) {
        if (TABLE_CONSTRAINT.test(part)) continue
        const name = part.trim().split(/\s+/)[0]?.replace(/["`]/g, '')
        if (name) cols.add(name)
      }
    }

    const addCol = /ALTER\s+TABLE\s+["`]?(\w+)["`]?\s+ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?["`]?(\w+)["`]?/gi
    while ((m = addCol.exec(sql))) {
      const cols = schema.get(m[1]) ?? new Set()
      schema.set(m[1], cols)
      cols.add(m[2])
    }

    const dropCol = /ALTER\s+TABLE\s+["`]?(\w+)["`]?\s+DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?["`]?(\w+)["`]?/gi
    while ((m = dropCol.exec(sql))) schema.get(m[1])?.delete(m[2])
  }
  return schema
}

const liveSchema = readLiveSchema()
const migrationSchema = readMigrationSchema()

const SCHEMA = liveSchema ?? migrationSchema
const SCHEMA_SOURCE = liveSchema ? 'db.sqlite (live, PRAGMA table_info)' : 'migrations/sqlite/*.sql (parsed)'

if (!SCHEMA) {
  fail(
    'no schema could be read — db.sqlite is absent (or better-sqlite3 is not installed) ' +
    'and migrations/sqlite/*.sql could not be parsed. Run `npm run db:migrate`.'
  )
}
if (SCHEMA.size < 5) {
  fail(
    `read only ${SCHEMA.size} table(s) from ${SCHEMA_SOURCE}. Refusing to run: an ` +
    `almost-empty schema would make every check meaningless.`
  )
}
const ISSUES_COLS = SCHEMA.get('issues')
if (!ISSUES_COLS || ISSUES_COLS.size < 20) {
  fail(
    `the \`issues\` table came back with ${ISSUES_COLS?.size ?? 0} column(s) from ${SCHEMA_SOURCE}. ` +
    `Refusing to run: that is not a schema this repo could ever have worked against.`
  )
}

const hasTable = (t) => SCHEMA.has(t)
const hasColumn = (t, c) => SCHEMA.get(t)?.has(c) ?? false

// ── 2. Source utilities (comment stripping is shared with the sibling guard) ─

const REGEX_PRECEDING_KEYWORDS = new Set([
  'return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void',
  'do', 'else', 'case', 'yield', 'await',
])

/**
 * Does a `/` at `idx` open a regex literal, or is it division / a JSX slash?
 * Same lexical heuristic scripts/no-invented-projects.mjs uses, including the
 * two amendments this codebase needs: `=> /re/` and `</div>`.
 */
function startsRegexLiteral(chars, idx) {
  let j = idx - 1
  while (j >= 0 && /\s/.test(chars[j])) j--
  if (j < 0) return true
  const c = chars[j]
  if (c === '>' && j > 0 && chars[j - 1] === '=') return true
  if (c === '<') return false
  if (/[A-Za-z0-9_$]/.test(c)) {
    let k = j
    while (k >= 0 && /[A-Za-z0-9_$]/.test(chars[k])) k--
    return REGEX_PRECEDING_KEYWORDS.has(chars.slice(k + 1, j + 1).join(''))
  }
  return !/[)\]}'"`]/.test(c)
}

/**
 * Replace comment bodies with spaces, preserving offsets so reported line
 * numbers stay true. Tracks quote, template AND regex state, so a `//` inside a
 * string is not mistaken for a comment and a backtick inside a regex character
 * class does not desynchronise the rest of the file.
 */
function stripComments(src) {
  const out = src.split('')
  let i = 0
  let state = 'code'
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
      if (c === '\n') { state = 'code'; inCharClass = false }
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

/** Index of the `)` matching the `(` at `open`, string-aware. -1 if unbalanced. */
function matchParen(src, open) {
  let depth = 0
  let state = 'code'
  for (let i = open; i < src.length; i++) {
    const c = src[i]
    if (state === 'code') {
      if (c === "'") state = 'sq'
      else if (c === '"') state = 'dq'
      else if (c === '`') state = 'tpl'
      else if (c === '(') depth++
      else if (c === ')') { depth--; if (depth === 0) return i }
    } else {
      if (c === '\\') { i++; continue }
      if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) state = 'code'
    }
  }
  return -1
}

/** The literal string value of `text` if it is one whole quoted literal. */
function asStringLiteral(text) {
  const t = text.trim()
  const q = t[0]
  if (q !== "'" && q !== '"' && q !== '`') return null
  if (t[t.length - 1] !== q || t.length < 2) return null
  const inner = t.slice(1, -1)
  // A template with interpolation is not a static literal. Callers that only
  // need the part BEFORE the first `${` handle that themselves.
  if (q === '`' && inner.includes('${')) return null
  if (q !== '`' && (inner.includes(q))) return null
  return inner
}

/** Split an argument list on top-level commas, string- and bracket-aware. */
function splitArgs(text) {
  const out = []
  let depth = 0
  let state = 'code'
  let cur = ''
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (state === 'code') {
      if (c === "'") state = 'sq'
      else if (c === '"') state = 'dq'
      else if (c === '`') state = 'tpl'
      else if (c === '(' || c === '[' || c === '{') depth++
      else if (c === ')' || c === ']' || c === '}') depth--
      else if (c === ',' && depth === 0) { out.push(cur); cur = ''; continue }
    } else {
      if (c === '\\') { cur += c + (text[i + 1] ?? ''); i++; continue }
      if ((state === 'sq' && c === "'") || (state === 'dq' && c === '"') || (state === 'tpl' && c === '`')) state = 'code'
    }
    cur += c
  }
  if (cur.trim()) out.push(cur)
  return out
}

/** Top-level literal keys of an object literal `{ … }`. Spreads are skipped. */
function objectLiteralKeys(text) {
  const t = text.trim()
  if (t[0] !== '{') return null
  const inner = t.slice(1, t.lastIndexOf('}'))
  const keys = []
  for (const part of splitArgs(inner)) {
    const p = part.trim()
    if (!p || p.startsWith('...')) continue          // spread — runtime value
    if (p.startsWith('[')) continue                  // computed key
    const m = /^(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*(?::|,|$)/.exec(p)
    const key = m?.[1] ?? m?.[2] ?? m?.[3]
    if (key) keys.push(key)
  }
  return keys
}

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

const violations = []
const touchedTables = new Set()
const unresolved = { tables: 0, columns: 0 }

function record(file, src, idx, table, column, why) {
  violations.push({ file: rel(file), line: lineOf(src, idx), table, column, why })
}

function checkColumn(file, src, idx, table, column, where) {
  touchedTables.add(table)
  if (!hasTable(table)) return   // reported once per site by the caller
  if (hasColumn(table, column)) return
  record(file, src, idx, table, column, `\`${table}\` has no column \`${column}\` (${where})`)
}

const FILTER_METHODS = new Set([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'is', 'in', 'not',
  'contains', 'containedBy', 'overlaps', 'match', 'order',
])
const WRITE_METHODS = new Set(['insert', 'update', 'upsert'])

/** Every entry of a PostgREST `select=` list that names a column of `table`. */
function selectColumns(list) {
  const out = []
  for (const rawPart of list.split(',')) {
    const part = rawPart.trim()
    if (!part || part === '*' || part.includes('(')) continue  // `*`, embedded resource
    if (/^count$/i.test(part)) continue
    const name = part.includes(':') ? part.slice(part.indexOf(':') + 1).trim() : part
    if (!/^[A-Za-z_][\w]*$/.test(name)) continue
    out.push(name)
  }
  return out
}

/** CHECK 1 — walk `.from('t')` method chains. */
function checkSeamChains(file, src) {
  const FROM = /\.\s*from\s*\(/g
  let m
  while ((m = FROM.exec(src))) {
    const open = m.index + m[0].length - 1
    const close = matchParen(src, open)
    if (close === -1) continue
    const table = asStringLiteral(src.slice(open + 1, close))
    if (!table) { unresolved.tables++; continue }
    touchedTables.add(table)
    if (!hasTable(table)) {
      record(file, src, m.index, table, '(table)', `no table named \`${table}\` in the schema`)
      continue
    }

    // Walk forward over `.method( … )` links for as long as the chain runs.
    let cursor = close + 1
    for (;;) {
      const rest = src.slice(cursor)
      const link = /^\s*\.\s*([A-Za-z_$][\w$]*)\s*\(/.exec(rest)
      if (!link) break
      const argOpen = cursor + link[0].length - 1
      const argClose = matchParen(src, argOpen)
      if (argClose === -1) break
      const method = link[1]
      const args = splitArgs(src.slice(argOpen + 1, argClose))
      const at = cursor + link.index

      if (FILTER_METHODS.has(method) && args.length > 0) {
        const col = asStringLiteral(args[0])
        if (col === null) unresolved.columns++
        else if (method === 'order') checkColumn(file, src, at, table, col.split('.')[0], `.order()`)
        else checkColumn(file, src, at, table, col, `.${method}()`)
      } else if (method === 'select' && args.length > 0) {
        const list = asStringLiteral(args[0])
        if (list === null) unresolved.columns++
        else for (const c of selectColumns(list)) checkColumn(file, src, at, table, c, `.select()`)
      } else if (WRITE_METHODS.has(method) && args.length > 0) {
        const keys = objectLiteralKeys(args[0])
        if (keys === null) unresolved.columns++
        else for (const k of keys) checkColumn(file, src, at, table, k, `.${method}()`)
      }
      cursor = argClose + 1
    }
  }
}

/** Grammar keys in a PostgREST query string — not columns. */
const QUERY_GRAMMAR = new Set(['select', 'order', 'limit', 'offset', 'or', 'and', 'not'])

/** Parse `table?a=eq.1&select=x,y` and check every column it names. */
function checkQueryString(file, src, at, table, query) {
  touchedTables.add(table)
  if (!hasTable(table)) {
    record(file, src, at, table, '(table)', `no table named \`${table}\` in the schema`)
    return
  }
  for (const clause of query.split('&')) {
    const eq = clause.indexOf('=')
    if (eq === -1) continue
    const key = clause.slice(0, eq).trim()
    const value = clause.slice(eq + 1)
    if (key.includes('$') || key.includes('{') || !/^[A-Za-z_][\w]*$/.test(key)) continue
    if (key === 'select') {
      for (const c of selectColumns(value)) checkColumn(file, src, at, table, c, `dbUrl select=`)
    } else if (key === 'order') {
      for (const term of value.split(',')) {
        const col = term.split('.')[0].trim()
        if (/^[A-Za-z_][\w]*$/.test(col)) checkColumn(file, src, at, table, col, `dbUrl order=`)
      }
    } else if (key === 'or' || key === 'and') {
      // `or=(blocked_by.not.is.null,is_blocked.eq.true)` — leading term of each
      // comma-separated clause is a column.
      for (const term of value.replace(/^\(|\)$/g, '').split(',')) {
        const col = term.trim().split('.')[0]
        if (/^[A-Za-z_][\w]*$/.test(col)) checkColumn(file, src, at, table, col, `dbUrl ${key}=`)
      }
    } else if (!QUERY_GRAMMAR.has(key)) {
      checkColumn(file, src, at, table, key, `dbUrl filter`)
    }
  }
}

/**
 * The static prefix of a template literal — everything before the first `${`.
 * `agent_runs?agent_id=eq.${id}&order=…` still names two real columns, and
 * throwing the whole string away because of one interpolation would blind the
 * check to most of this repo's query strings.
 */
function staticPrefix(text) {
  const t = text.trim()
  const q = t[0]
  if (q !== '`') return null
  const inner = t.slice(1, t.lastIndexOf('`'))
  const cut = inner.indexOf('${')
  if (cut === -1) return inner
  // Keep only whole clauses: drop the partial one the interpolation sits in.
  const head = inner.slice(0, cut)
  const lastAmp = head.lastIndexOf('&')
  return lastAmp === -1 ? '' : head.slice(0, lastAmp)
}

/** CHECK 2 — `dbUrl('table?…')` and `issuesUrl('…', scope)`. */
function checkQueryBuilders(file, src) {
  const CALL = /\b(dbUrl|issuesUrl)\s*\(/g
  let m
  while ((m = CALL.exec(src))) {
    const open = m.index + m[0].length - 1
    const close = matchParen(src, open)
    if (close === -1) continue
    const first = splitArgs(src.slice(open + 1, close))[0]
    if (first === undefined) continue
    const literal = asStringLiteral(first) ?? staticPrefix(first)
    if (literal === null) { unresolved.columns++; continue }

    if (m[1] === 'issuesUrl') {
      checkQueryString(file, src, m.index, 'issues', literal)
    } else {
      const q = literal.indexOf('?')
      if (q === -1) continue
      const table = literal.slice(0, q).replace(/^\/+/, '')
      if (!/^[A-Za-z_][\w]*$/.test(table)) { unresolved.tables++; continue }
      checkQueryString(file, src, m.index, table, literal.slice(q + 1))
    }
  }
}

/**
 * CHECK 3 — `// @db-table <name>` annotated interfaces and type aliases.
 * Read from RAW source: the annotation is a comment, and comments are stripped
 * for the other two checks.
 */
function checkAnnotatedShapes(file, raw) {
  const ANN = /@db-table\s+([A-Za-z_][\w]*)/g
  let m
  while ((m = ANN.exec(raw))) {
    const table = m[1]
    // Find the first interface/type declaration after the annotation.
    const after = raw.slice(m.index)
    const decl = /\b(?:export\s+)?(?:interface\s+[A-Za-z_$][\w$]*|type\s+[A-Za-z_$][\w$]*\s*=)\s*\{/.exec(after)
    if (!decl) {
      record(file, raw, m.index, table, '(annotation)',
        `\`@db-table ${table}\` is not followed by an interface or type literal — nothing is being checked`)
      continue
    }
    const bodyOpen = m.index + decl.index + decl[0].length - 1
    // Brace-match over the raw text; a `{` inside a comment between the
    // annotation and the declaration cannot occur because decl[0] ends AT the
    // opening brace of the declaration itself.
    let depth = 0
    let end = -1
    for (let i = bodyOpen; i < raw.length; i++) {
      if (raw[i] === '{') depth++
      else if (raw[i] === '}') { depth--; if (depth === 0) { end = i; break } }
    }
    if (end === -1) continue
    touchedTables.add(table)
    if (!hasTable(table)) {
      record(file, raw, m.index, table, '(table)', `no table named \`${table}\` in the schema`)
      continue
    }
    // Strip comments from the BODY only, so a tombstone naming a removed column
    // is not read as a field.
    const body = stripComments(raw.slice(bodyOpen, end + 1))
    const FIELD = /(?:^|[\n;,{])\s*(?:readonly\s+)?(?:'([^']+)'|"([^"]+)"|([A-Za-z_$][\w$]*))\s*\??\s*:/g
    let f
    while ((f = FIELD.exec(body))) {
      const name = f[1] ?? f[2] ?? f[3]
      if (!name) continue
      if (!hasColumn(table, name)) {
        record(file, raw, bodyOpen + f.index, table, name,
          `\`${table}\` has no column \`${name}\` (declared on a @db-table row shape)`)
      }
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

for (const file of files) {
  const raw = readFileSync(file, 'utf8')
  const src = stripComments(raw)
  checkSeamChains(file, src)
  checkQueryBuilders(file, src)
  checkAnnotatedShapes(file, raw)
}

// Staleness: only meaningful when both sources exist, and only for the tables
// this scan actually touched. See the header for why the reverse direction is
// deliberately not an error.
if (liveSchema && migrationSchema) {
  const behind = []
  for (const table of touchedTables) {
    const declared = migrationSchema.get(table)
    const live = liveSchema.get(table)
    if (!declared || !live) continue
    for (const col of declared) if (!live.has(col)) behind.push(`${table}.${col}`)
  }
  if (behind.length) {
    fail(
      `db.sqlite is BEHIND migrations/sqlite — declared but missing live: ${behind.join(', ')}. ` +
      `Run \`npm run db:migrate\`. Refusing to render a verdict against a stale schema.`
    )
  }
}

console.log(`no-phantom-columns: schema source = ${SCHEMA_SOURCE}`)
console.log(
  `no-phantom-columns: ${SCHEMA.size} table(s); \`issues\` has ${ISSUES_COLS.size} column(s)` +
  (liveSchema && migrationSchema ? ' (live schema checked against migrations/sqlite — not stale)' : '')
)
console.log(`no-phantom-columns: scanned ${files.length} files under ${roots.map(rel).join(', ')}`)
console.log(
  `no-phantom-columns: ${touchedTables.size} table(s) referenced; ` +
  `${unresolved.tables} dynamic table name(s) and ${unresolved.columns} dynamic column expression(s) ` +
  `could not be resolved statically and were NOT checked`
)

if (violations.length) {
  console.error(`\n  ${violations.length} phantom column reference(s) in live code:\n`)
  for (const v of violations) {
    console.error(`    ${v.file}:${v.line}  ${v.table}.${v.column}`)
    console.error(`        ${v.why}`)
  }
  console.error(
    `\n  These are LIVE code, not comments — comments were stripped before scanning,\n` +
    `  so a tombstone recording a removed column is never reported here.\n` +
    `  A column named here does not exist: the read returns undefined forever and\n` +
    `  the write answers HTTP 500. Either add the column in a migration (and say in\n` +
    `  its comment why the value cannot be derived) or remove the reference and\n` +
    `  leave a tombstone. See docs/rebuild/pieces/pieces6/phantom-column.md\n`
  )
  process.exit(1)
}

console.log('no-phantom-columns: OK — every column named in live code exists.')

#!/usr/bin/env node
// ─── scripts/no-unscoped-issues.mjs — scope-is-a-boundary guard ──────────────
//
// WHY THIS EXISTS
// ----------------
// "Scope is a label, not a query boundary. Todero's scope is an optional
// React prop passed to ten of roughly twenty-three read paths, ignored by two
// of those ten, absent from eleven raw-proxy queries. Everything currently
// LOOKS correct only because migration 057 archived the other projects out of
// /api/issues. Un-archive one issue and the landing page fills with the mess
// again." — the critic quote this piece exists to answer.
//
// `dbUrl('issues?...')` (lib/db/browser.ts) is a same-origin proxy straight
// onto the `issues` table (app/api/db/[...path]/route.ts) with NO built-in
// filtering of its own — unlike /api/issues, which always applies the
// archived-rows filter server-side regardless of what the caller asks for.
// Every clause a `dbUrl('issues?...')` call site needs, it has to write out
// itself. A filter spread across N call sites is a filter the (N+1)th call
// site forgets, and the failure is silent: the row just shows up on a board
// it does not belong on.
//
// `lib/db/browser.ts` now exports `issuesUrl(query, scope)` — the one seam
// that injects `project=eq.<x>` and `archived_at=is.null` ONCE, with `scope`
// a required argument with no default (a call site that forgets it does not
// compile). This guard is the backstop for every call site `issuesUrl()`
// itself cannot reach: a comment saying "always scope your issues queries"
// is not a guard — this is. It fails the build on any `dbUrl('issues?...')`
// LITERAL under app/ or components/ that is missing either clause, i.e. that
// bypassed `issuesUrl()` and rebuilt the same mistake by hand.
//
// SCOPE OF THIS GUARD (read before extending it)
// ------------------------------------------------
// This guard checks ONE code path: `dbUrl(<literal starting with "issues">)`.
// It deliberately does NOT check `fetch('/api/issues?...')` call sites for a
// missing `project=` param — that route already applies the archived-rows
// filter unconditionally server-side (app/api/issues/route.ts), so an
// unscoped call there shows "every non-archived project's issues", not "the
// history migration 057 archived away". That is a real, related, and NOT
// fully fixed problem (components/tabs/EpicMapTab.tsx and
// components/tabs/ProjectsTab.tsx both call `/api/issues?limit=0` with no
// project filter today — ProjectsTab is intentional, EpicMapTab is not) —
// see the builder report for the full list. It is out of this guard's
// declared scope because catching it precisely (distinguishing "should be
// scoped" from "genuinely cross-project by design", like Projects and
// task_key search) needs per-call-site judgement a regex cannot make
// honestly. Extending this guard to cover it is real, valuable follow-up
// work — but that is a different, larger check than "these two literal
// clauses must both be present", and claiming it here would be exactly the
// kind of guard-that-doesn't-guard this file exists to avoid.
//
// PRE-EXISTING DEBT, NOT AN ALLOWLIST
// -------------------------------------
// no-silent-empty.mjs's ALLOWLIST names files that are CORRECT to contain its
// pattern (the two sanctioned modules that are allowed to touch a raw
// Response body). PRE_EXISTING_DEBT below is different in kind: every file in
// it IS a real violation of this rule, today, in the repo this guard ships
// in. They are exempted from failing the build not because they are right,
// but because fixing them requires editing components/tabs/** and
// components/ActiveAgentsCard.tsx / components/SearchOverlay.tsx — files
// this piece's concurrent-edit boundary explicitly forbids touching while
// another agent is mid-edit on the same repo (see the piece's DO NOT TOUCH
// list; ActiveAgentsCard's only caller is inside components/tabs/OverviewTab.tsx,
// so scoping it needs a prop threaded through a file this piece cannot edit
// either). This list must only ever shrink. A NEW file, or a NEW occurrence
// added to a file already on this list, is not covered by this exemption and
// WILL fail the build — the exemption is "don't retroactively fail on debt
// this piece structurally cannot pay down", not "this file gets a pass on
// backsliding further".
//
// Usage: node scripts/no-unscoped-issues.mjs   (exit 0 = clean, 1 = violations)

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Same reach as no-silent-empty.mjs: only these two roots carry UI code. */
const SCAN_DIRS = ['app', 'components']

const SCAN_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

// Matches the START of a `dbUrl(...)` call whose first argument is a string
// literal (backtick, single- or double-quoted, optionally leading with a
// slash) beginning with the table name `issues`. Deliberately does not try
// to match the whole call across multiple lines — every existing call site,
// scoped or not, fits on one line (same simplifying assumption
// no-silent-empty.mjs makes for its own single-line pattern).
const DBURL_ISSUES_CALL = /dbUrl\(\s*[`'"]\/?issues\b/

/**
 * This guard's own file: it necessarily contains the string `dbUrl('issues`
 * (in this very comment, and in the pattern source below) — a checker that
 * greps for a bad pattern contains that pattern and would report itself as a
 * defect. Skip it explicitly rather than relying on scan-dir scoping alone
 * (scripts/ is outside SCAN_DIRS today, but this file has moved roots before
 * in other guards' histories and should not silently start failing itself).
 */
const SELF_PATH = 'scripts/no-unscoped-issues.mjs'

/**
 * Real, current violations of this rule that this piece cannot fix without
 * editing files outside its ownership boundary (see PRE-EXISTING DEBT above).
 * Keep this list exact — a whole-directory exemption (e.g. "components/tabs")
 * would silently swallow a brand-new violation in a brand-new tab file too.
 */
// Each entry pins the EXACT number of violations that existed when the debt was
// recorded. This is deliberately a count and not a bare filename: a set of file
// names exempts a file, so a file on the list could grow from one violation to
// twenty and the guard would still pass — which is what the previous version of
// this comment promised it would not do, while the code did exactly that. A
// guard whose comment describes enforcement it does not perform is the same
// defect this whole wave has been removing, so the number is the enforcement.
//
// The list may only ever shrink, in both dimensions: fewer files, or a smaller
// count for a file. Both directions are checked below.
const PRE_EXISTING_DEBT = new Map([
  ['components/ActiveAgentsCard.tsx', 1],
  ['components/SearchOverlay.tsx', 1],
  ['components/tabs/ActivityTab.tsx', 2],
  ['components/tabs/OverviewTab.tsx', 11],
  ['components/tabs/PipelineTab.tsx', 3],
])

function scanFiles() {
  const out = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '--', ...SCAN_DIRS],
    { cwd: REPO_ROOT, encoding: 'utf8' }
  )
  return [...new Set(out.split('\n').map((l) => l.trim()).filter(Boolean))]
    .filter((f) => SCAN_EXTENSIONS.some((ext) => f.endsWith(ext)))
    .filter((f) => f !== SELF_PATH)
    .sort()
}

const hits = []
const debtCounts = new Map()

for (const file of scanFiles()) {
  const abs = join(REPO_ROOT, file)
  if (!existsSync(abs)) continue // listed by --cached but deleted in the worktree
  const lines = readFileSync(abs, 'utf8').split('\n')
  lines.forEach((line, i) => {
    if (!DBURL_ISSUES_CALL.test(line)) return
    const hasProjectClause = line.includes('project=')
    const hasArchivedClause = line.includes('archived_at=')
    if (hasProjectClause && hasArchivedClause) return // scoped correctly, inline
    const hit = { file, lineNo: i + 1, text: line.trim() }
    if (PRE_EXISTING_DEBT.has(file)) {
      debtCounts.set(file, (debtCounts.get(file) ?? 0) + 1)
    } else {
      hits.push(hit)
    }
  })
}

if (hits.length > 0) {
  console.error('FAIL: unscoped issues query — dbUrl(\'issues?...\') missing project= and/or archived_at= in the same literal.')
  console.error('')
  for (const h of hits) console.error(`${h.file}:${h.lineNo}:${h.text}`)
  console.error('')
  console.error("Fix: build the URL with issuesUrl(query, { project }) from '@/lib/db/browser' instead of dbUrl() —")
  console.error('     it injects both clauses once, and scope is a required argument with no default.')
  process.exit(1)
}

// Debt may shrink, never grow. Three ways this fails, all of them the same
// principle — the exemption covers what was already there, and nothing more:
//   grew   — a new unscoped query added to a file that already had some
//   stale  — the file is clean now, so the entry would silently exempt a
//            brand-new violation introduced later
//   shrank — genuinely fixed, but the pinned number is now a lie; lower it
const debtProblems = []
for (const [file, allowed] of PRE_EXISTING_DEBT) {
  const found = debtCounts.get(file) ?? 0
  if (found > allowed) {
    debtProblems.push(`  ${file}: ${found} violations, but only ${allowed} exempted — the new one(s) must be scoped`)
  } else if (found === 0) {
    debtProblems.push(`  ${file}: no violations left — remove it from PRE_EXISTING_DEBT`)
  } else if (found < allowed) {
    debtProblems.push(`  ${file}: down to ${found} from ${allowed} — lower the pinned count to ${found}`)
  }
}
if (debtProblems.length > 0) {
  console.error('FAIL: PRE_EXISTING_DEBT is out of date. It may only ever shrink.')
  console.error('')
  for (const line of debtProblems) console.error(line)
  console.error('')
  process.exit(1)
}

console.log('PASS: no unscoped dbUrl(\'issues?...\') literal outside PRE_EXISTING_DEBT under app/ or components/')
if (debtCounts.size > 0) {
  console.log(`  (${debtCounts.size} pre-existing debt file(s) still exempted — see PRE_EXISTING_DEBT in this script)`)
}
process.exit(0)

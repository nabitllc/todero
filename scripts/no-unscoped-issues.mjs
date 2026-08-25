#!/usr/bin/env node
// ─── scripts/no-unscoped-issues.mjs — scope-is-a-boundary guard ──────────────
//
// ORIGIN
// ------
// "Scope is a label, not a query boundary. Todero's scope is an optional
// React prop passed to ten of roughly twenty-three read paths, ignored by two
// of those ten, absent from eleven raw-proxy queries. Everything currently
// LOOKS correct only because migration 057 archived the other projects out of
// /api/issues. Un-archive one issue and the landing page fills with the mess
// again." — the critic quote the scope-is-a-boundary piece existed to answer.
// A later critic went further: "Scope stops at the React tree; it never
// reaches the server. [...] an /api/db/issues proxy and an /api/issues route
// [...] will hand any caller any project's rows." That is the defect
// scope-reaches-the-server (this file's current owner) fixed.
//
// WHAT THIS GUARD USED TO DO, AND WHY THAT STOPPED BEING RIGHT
// ---------------------------------------------------------------
// The original version of this file grepped every `dbUrl('issues?...')`
// LITERAL under app/ and components/ for the substrings `project=` and
// `archived_at=`, on the theory that `issuesUrl()` was the one seam that
// injected both clauses and any call site that bypassed it had to be caught
// by pattern. That was a text check standing in front of a leak that lived in
// TEXT — the query string a component happened to write. It had at least six
// known holes (a trailing comment satisfying the substring test, a variable
// holding the table name, a literal split across two lines, `fetch()` used
// directly instead of `dbUrl()`, `fetch('/api/issues?limit=0')` being out of
// its declared scope entirely, and a per-file pinned COUNT that let a file
// trade one fixed violation for a brand-new one, net zero, still green) —
// and patching those six holes was explicitly rejected as the wrong response
// ("close the hole they patrol").
//
// The hole is closed now, structurally, not textually: `app/api/db/[...path]
// /route.ts` (`scopedParams`) injects `project=eq.<scope>` and
// `archived_at=is.null` into every ISSUES-table READ it proxies, server-side,
// UNCONDITIONALLY, regardless of what the caller's own query string says —
// fed by `middleware.ts`, which resolves the caller's scope from its own path
// or its Referer and stamps it on a header no client request can forge (see
// that file's block comment). `GET /api/issues` does the equivalent for its
// own query builder. A `dbUrl('issues?...')` literal missing `project=` or
// `archived_at=` is no longer a leak — it is dead text the server overrides
// either way. Continuing to fail the build on it would be exactly the
// defect this wave has spent all day removing: a guard whose comment
// describes enforcement it does not perform (or, in this case, enforcement
// that doesn't matter any more).
//
// PRE_EXISTING_DEBT — the five-file exemption list that used to live here —
// is gone for the same reason: it tracked files this guard could not fail
// honestly on because fixing the literal required editing components/**,
// outside this piece's ownership. There is nothing left to exempt when the
// thing being checked is no longer a per-file property.
//
// WHAT THIS GUARD DOES NOW
// ---------------------------
// It asserts the enforcement described above is still IN THE CODE — not by
// executing the routes (scripts/acceptance/run.mjs already does that against
// the live server, end to end), but by checking that each file in the chain
// still contains the specific identifiers its own enforcement is built from.
// A comment can say anything; `params.set('archived_at', 'is.null')`
// appearing verbatim in app/api/db/[...path]/route.ts cannot be satisfied by
// prose. This is a smaller, structural claim than the old file made, and it
// is one this file can actually keep true.
//
// Usage: node scripts/no-unscoped-issues.mjs   (exit 0 = seam intact, 1 = one
// of the three files in the chain no longer contains its enforcement)

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const MIDDLEWARE = join(REPO_ROOT, 'middleware.ts')
const PROXY_ROUTE = join(REPO_ROOT, 'app', 'api', 'db', '[...path]', 'route.ts')
const ISSUES_ROUTE = join(REPO_ROOT, 'app', 'api', 'issues', 'route.ts')

/**
 * Each check names a file, a human description of what it proves, and the
 * exact substrings that must ALL still be present for the claim to be true.
 * These are the real identifiers the enforcement is built from (not English
 * words describing it), so satisfying all of them by accident — or by leaving
 * a comment behind after deleting the code — is not realistic.
 */
const SEAM_CHECKS = [
  {
    file: MIDDLEWARE,
    desc: 'middleware.ts resolves a project scope (own path, else Referer) and stamps it on a header, never trusting a client-supplied value for that header',
    mustContain: ['SCOPE_HEADER', 'function resolveProjectScope', 'headers.delete(SCOPE_HEADER)'],
  },
  {
    file: PROXY_ROUTE,
    desc: 'the db proxy injects project=eq.<scope> and archived_at=is.null into every issues-table READ, unconditionally, when a scope is resolvable',
    mustContain: [
      "table !== 'issues' || isWrite",
      "params.set('project', `eq.${scope}`)",
      "params.set('archived_at', 'is.null')",
    ],
  },
  {
    file: ISSUES_ROUTE,
    desc: 'GET /api/issues applies the server-resolved scope automatically, not only an explicit ?project=',
    mustContain: ["req.headers.get('x-mc-project')", 'effectiveProject'],
  },
]

const failures = []
for (const check of SEAM_CHECKS) {
  let text
  try {
    text = readFileSync(check.file, 'utf8')
  } catch {
    failures.push(`${check.file}: file not found — ${check.desc}`)
    continue
  }
  const missing = check.mustContain.filter((needle) => !text.includes(needle))
  if (missing.length > 0) {
    failures.push(`${check.file}: ${check.desc}\n    missing: ${missing.join(', ')}`)
  }
}

if (failures.length > 0) {
  console.error('FAIL: scope-reaches-the-server enforcement is missing or was edited away.')
  console.error('')
  for (const f of failures) console.error(`  ${f}`)
  console.error('')
  console.error("This guard no longer scans component call sites for a literal 'project='/'archived_at='")
  console.error('substring (see this file\'s header for why) — the seam enforces scope regardless of')
  console.error("what a caller's query string says. It fails only when the SEAM ITSELF stops enforcing it.")
  process.exit(1)
}

console.log('PASS: scope enforcement is in place at the seam (middleware.ts -> db proxy -> /api/issues).')
process.exit(0)

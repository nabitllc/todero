#!/usr/bin/env node
// ─── npm run doctor ──────────────────────────────────────────────────────────
//
// One command that answers "will Todero actually work on THIS machine, and if
// not, which line is the problem?" — without reading a single source file.
//
// It reports what the app itself resolves, not a second copy of that logic:
// the paths come from `lib/paths.ts`, the runtime list and every binary lookup
// come from `lib/runtimes/`, the database verdict comes from `lib/db.ts`, and
// the model roster is a live call through `lib/llm-provider.ts`. If the app
// would fail, doctor fails the same way and says so; if doctor is green, the
// same modules the server uses are the ones that said yes.
//
// Exit code: 0 when this host can run Todero, 1 when a required variable is
// missing or no agent runtime is available — so it is usable as a CI gate,
// not just as something to read.
//
// Usage:  npm run doctor

import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'

import { REPO_ROOT, importTs } from './lib/ts-import.mjs'
import { loadEnvFiles } from './lib/env-file.mjs'
import {
  llmStatus,
  requiredEnvReport,
  recommendedGaps,
  dropPlaceholderEnv,
} from './lib/env-report.mjs'

// The app resolves TODERO_DIR from the working directory; run from anywhere.
process.chdir(REPO_ROOT)

const heading = (text) => console.log(`\n${text}\n${'─'.repeat(text.length)}`)
const row = (label, value) => console.log(`  ${String(label).padEnd(16)}${value}`)
const note = (text) => console.log(`  ${' '.repeat(16)}${text}`)

const problems = []

// ── Host ─────────────────────────────────────────────────────────────────────

function reportHost(envFiles) {
  heading('Host')
  row('platform', `${process.platform} ${process.arch} (${os.release()})`)
  row('node', process.version)
  // `npm` is a .cmd shim on Windows, which Node refuses to spawn without a
  // shell — spawning it bare is the "not found" that has no business being
  // reported by a doctor. The command is a fixed literal, never interpolated.
  const npmVersion =
    process.platform === 'win32'
      ? spawnSync('npm --version', { encoding: 'utf8', windowsHide: true, shell: true })
      : spawnSync('npm', ['--version'], { encoding: 'utf8', windowsHide: true })
  row('npm', (npmVersion.stdout ?? '').trim() || 'not found')
  row('repo', REPO_ROOT)
  row('env files', envFiles.length > 0 ? envFiles.join(', ') : 'none — run `npm run setup`')
  if (envFiles.length === 0) problems.push('no .env.local — run `npm run setup`')
}

// ── Resolved paths ───────────────────────────────────────────────────────────

async function reportPaths() {
  heading('Resolved paths (lib/paths.ts)')
  const mod = await importTs('lib/paths.ts')
  if (!mod.ok) {
    row('unavailable', mod.reason)
    problems.push(`could not load lib/paths.ts — ${mod.reason}`)
    return null
  }
  const p = mod.module
  for (const name of ['TODERO_DIR', 'WORKSPACE_DIR', 'CONFIG_DIR', 'LOG_DIR', 'WORKTREE_ROOT']) {
    const value = p[name]
    row(name, `${value}${existsSync(value) ? '' : '   (does not exist yet)'}`)
  }

  const agentsMd = p.resolveAgentsMdPath()
  row('AGENTS.md', agentsMd ?? 'not found')
  if (!agentsMd) {
    note('looked in:')
    for (const candidate of p.agentsMdCandidates()) note(`  ${candidate}`)
    problems.push('no AGENTS.md found — the agent roster will be empty')
  }
  return p
}

// ── CLI binaries + runtimes ──────────────────────────────────────────────────

async function reportRuntimes(paths, llm) {
  heading('CLI binaries')
  if (paths) {
    for (const name of ['git', 'node', 'npm']) {
      const resolved = paths.resolveBinary(name)
      row(name, resolved ?? 'not on PATH')
      if (name === 'git' && !resolved) {
        problems.push('git is not on PATH — worktree isolation for code agents will fail')
      }
    }
  }

  heading('Agent runtimes (lib/runtimes)')
  const mod = await importTs('lib/runtimes/index.ts')
  if (!mod.ok) {
    row('unavailable', mod.reason)
    problems.push(`could not load the runtime registry — ${mod.reason}`)
    return 0
  }

  const runtimes = await mod.module.listRuntimes()
  let availableCount = 0
  for (const runtime of runtimes) {
    const inspection = await mod.module.inspectRuntime(runtime.name)
    if (runtime.available) availableCount++
    const where = inspection.binResolved ?? `${inspection.bin} not on PATH`
    row(runtime.name, `${runtime.available ? 'available  ' : 'unavailable'}  ${where}`)

    // `openai-api` reports availability from configuration alone — it has no
    // binary to look for, so a configured-but-dead endpoint still says
    // "available" and every dispatch through it fails at spawn time. Doctor
    // exists to catch exactly that kind of green, so say it out loud.
    if (runtime.name === 'openai-api' && runtime.available && llm && !llm.ok) {
      note(`but ${llm.baseUrl} does not answer — dispatch through it will fail`)
      problems.push(
        `runtime openai-api reports available while ${llm.baseUrl} is unreachable`,
      )
    }
  }
  row('available', `${availableCount} of ${runtimes.length}`)
  if (availableCount === 0) {
    problems.push('no agent runtime is available — install a CLI or configure LLM_BASE_URL')
  }
  return availableCount
}

// ── LLM endpoint ─────────────────────────────────────────────────────────────

async function reportLlm() {
  heading('LLM endpoint')
  const status = await llmStatus()
  row('LLM_BASE_URL', status.baseUrl)

  if (!status.ok) {
    row('reachable', 'no')
    note(status.error)
    problems.push(`no LLM answered at ${status.baseUrl}`)
    return status
  }

  row('reachable', `yes — ${status.models.length} model${status.models.length === 1 ? '' : 's'}`)
  for (const id of status.models) row('', `- ${id}`)

  const wanted = process.env.LLM_MODEL?.trim()
  if (wanted) {
    const known = status.models.includes(wanted)
    row('LLM_MODEL', `${wanted}${known ? '' : '   NOT served by this endpoint'}`)
    if (!known) problems.push(`LLM_MODEL=${wanted} is not served by ${status.baseUrl}`)
  } else {
    row('LLM_MODEL', `unset — first model reported (${status.models[0]}) will be used`)
  }
  return status
}

// ── Environment ──────────────────────────────────────────────────────────────

async function reportEnv(placeholders) {
  heading('Environment')
  const report = await requiredEnvReport()
  row('db provider', report.provider)
  if (report.dbError) note(report.dbError)

  console.log(`  missing required env vars: ${report.missing.length}`)
  for (const name of report.missing) note(`- ${name}`)
  if (report.missing.length > 0) {
    problems.push(`missing required env vars: ${report.missing.join(', ')}`)
  }

  const gaps = recommendedGaps()
  console.log(`  unset recommended env vars: ${gaps.length}`)
  for (const gap of gaps) note(`- ${gap.name}  (${gap.why})`)

  if (placeholders.length > 0) {
    console.log(`  still on template placeholders: ${placeholders.length}`)
    for (const name of placeholders) note(`- ${name}`)
  }
  return report
}

// ── main ─────────────────────────────────────────────────────────────────────

console.log('Todero doctor')

const envFiles = loadEnvFiles(REPO_ROOT)
const placeholders = dropPlaceholderEnv()

reportHost(envFiles)
const paths = await reportPaths()
const llm = await reportLlm()
const availableRuntimes = await reportRuntimes(paths, llm)
const env = await reportEnv(placeholders)

heading('Summary')
if (problems.length === 0) {
  console.log('  OK — this host can run Todero.')
} else {
  for (const problem of problems) console.log(`  - ${problem}`)
  console.log('')
  console.log('  Fix the lines above, then re-run `npm run doctor`.')
}
console.log('')

// A missing required variable or a total absence of runtimes means Todero
// cannot do its job here. Everything else is reported but does not fail the
// command — a missing Discord token is news, not a broken install.
process.exitCode = env.missing.length > 0 || availableRuntimes === 0 ? 1 : 0

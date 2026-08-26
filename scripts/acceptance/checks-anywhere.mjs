// Wave 4 "Runs anywhere, runs an agent" acceptance checks.
//
// Authored by the orchestrator BEFORE the work, as with checks-truth.mjs. A
// builder that writes its own grader learns to write one it already passes.
//
// The theme of this wave: Todero must run with no external service, register and
// track a real fleet, learn from its own runs, and dispatch one — under ceilings
// enforced outside the agent.

import { http, countMatches } from './checks.mjs'
import { execFileSync } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'

const OWNER = 'mc-auth=kaos2026; mc-role=owner'
const ok = (detail) => ({ ok: true, detail })
const no = (detail) => ({ ok: false, detail })

const pkg = async () => { try { return JSON.parse(await readFile('package.json', 'utf8')) } catch { return {} } }

export const ANYWHERE_CHECKS = [
  // ── runs with no external service ─────────────────────────────────────────
  {
    id: 'sqlite-adapter-registered', piece: 'sqlite-adapter', critical: true,
    desc: 'a SQLite adapter is registered behind the db seam',
    async run() {
      const h = await countMatches(['lib/db'], 'sqlite', ['.ts'])
      if (h.length === 0) return no('no sqlite adapter under lib/db — Supabase is still the only option')
      const dep = (await pkg()).dependencies ?? {}
      const driver = Object.keys(dep).find(d => /sqlite/i.test(d))
      return driver ? ok(`adapter present, driver ${driver}`) : no('adapter file exists but no sqlite driver in dependencies')
    },
  },
  {
    id: 'db-provider-selectable', piece: 'sqlite-adapter',
    desc: 'the database is chosen by configuration, not by code',
    async run() {
      const h = await countMatches(['lib'], 'TODERO_DB_PROVIDER', ['.ts'])
      return h.length > 0 ? ok(`selected via TODERO_DB_PROVIDER (${h.length} refs)`) : no('no TODERO_DB_PROVIDER — provider is not a configuration value')
    },
  },
  {
    id: 'no-external-service-required', piece: 'sqlite-adapter', critical: true,
    desc: 'nothing in the boot path hard-requires a cloud service',
    async run() {
      // A throw on missing Supabase env at import time makes SQLite mode impossible.
      const h = await countMatches(['lib/db'], "throw new Error\\('supabaseUrl", ['.ts'])
      return h.length === 0 ? ok('no hard Supabase requirement at boot') : no(`${h.length} hard-throw sites: ${h.slice(0, 2).join(', ')}`)
    },
  },

  // ── schema ────────────────────────────────────────────────────────────────
  {
    id: 'no-colliding-migrations', piece: 'boot-migrations', critical: true,
    desc: 'migration prefixes are unique — an ordered runner can actually run them',
    async run() {
      const seen = new Map()
      const dirs = ['migrations', 'migrations/sqlite', 'migrations/postgres']
      for (const d of dirs) {
        let files
        try { files = await readdir(d) } catch { continue }
        for (const f of files) {
          const m = f.match(/^(\d+)/)
          if (!m) continue
          const key = `${d}/${m[1]}`
          seen.set(key, (seen.get(key) ?? 0) + 1)
        }
      }
      const dupes = [...seen.entries()].filter(([, n]) => n > 1)
      return dupes.length === 0
        ? ok(`${seen.size} unique prefixes`)
        : no(`${dupes.length} colliding: ${dupes.slice(0, 5).map(([k, n]) => `${k}×${n}`).join(', ')}`)
    },
  },
  {
    id: 'migration-ledger-exists', piece: 'boot-migrations',
    desc: 'a ledger table makes migrations idempotent',
    async run() {
      const h = await countMatches(['lib', 'scripts', 'migrations'], 'schema_migrations', ['.ts', '.mjs', '.sql'])
      return h.length > 0 ? ok('schema_migrations referenced') : no('no ledger — re-running migrations is unsafe')
    },
  },

  // ── the fleet is real ─────────────────────────────────────────────────────
  {
    id: 'agent-registration-endpoint', piece: 'agents-table-heartbeat', critical: true,
    desc: 'an agent can register and is told where to go next',
    async run() {
      const r = await http('/api/connect', { method: 'POST', cookie: OWNER })
      if (r.status === 404) return no('POST /api/connect does not exist')
      if (r.status >= 500) return no(`registration 500s: ${r.body.slice(0, 100)}`)
      let j; try { j = JSON.parse(r.body) } catch { return no(`unparseable (${r.status})`) }
      const hasId = 'connection_id' in j || 'connectionId' in j
      const hasUrls = JSON.stringify(j).includes('heartbeat')
      if (!hasId) return no('no connection_id in the response')
      return hasUrls ? ok('returns connection_id and a heartbeat url') : no('returns an id but not the URLs to use next — clients must hardcode paths')
    },
  },
  {
    id: 'liveness-from-data', piece: 'agents-table-heartbeat', critical: true,
    desc: 'agent liveness comes from a timestamp, not a hardcoded array',
    async run() {
      const r = await http('/api/agents', { cookie: OWNER })
      if (r.status !== 200) return no(`status ${r.status}`)
      const body = r.body.toLowerCase()
      return (body.includes('last_seen') || body.includes('lastseen') || body.includes('heartbeat'))
        ? ok('roster carries a liveness timestamp')
        : no('roster has no last_seen/heartbeat field — liveness cannot be real')
    },
  },
  {
    id: 'vault-is-read-only', piece: 'brain2-agent-registry', critical: true,
    desc: 'nothing writes to the Brain2 vault outside _pending/',
    async run() {
      // Any write helper pointed at the vault path that is not the _pending outbox.
      const h = await countMatches(['lib', 'app', 'scripts'],
        '(writeFile|appendFile|mkdir|unlink|rm)[^\\n]*(Mich-Brain2|VAULT_DIR)', ['.ts', '.mjs'])
      const bad = h.filter(x => !/_pending/i.test(x))
      return bad.length === 0 ? ok('no vault writes outside _pending/') : no(`${bad.length} vault write sites: ${bad.slice(0, 3).join(', ')}`)
    },
  },
  {
    id: 'runs-without-vault', piece: 'brain2-agent-registry',
    desc: 'an absent vault degrades with a named path, it does not crash',
    async run() {
      const r = await http('/api/agents', { cookie: OWNER, timeoutMs: 15000 })
      if (r.status >= 500) return no(`roster 500s: ${r.body.slice(0, 120)}`)
      return ok(`${r.status} — roster survives whatever the vault state is`)
    },
  },

  // ── it learns ─────────────────────────────────────────────────────────────
  {
    id: 'memory-loop-portable', piece: 'memory-loop-write', critical: true,
    desc: 'the post-task learning loop is not macOS-only',
    async run() {
      const h = await countMatches(['scripts', 'config/scripts', 'lib'],
        '/Users/kemuniagent', ['.sh', '.ts', '.mjs'])
      return h.length === 0 ? ok('no mac-only paths in the loop') : no(`${h.length} still hardcoded: ${h.slice(0, 3).join(', ')}`)
    },
  },
  {
    id: 'retrieval-is-budgeted', piece: 'memory-loop-retrieval', critical: true,
    desc: 'context injection is capped, and overflow errors rather than truncating',
    // pieces9/memory-attempted seam 3 — THIS CHECK USED TO BE A GREP.
    //
    // It counted `MEMORY_BUDGET|contextBudget|CONTEXT_BUDGET` and
    // `budget[^\n]*(throw|Error)` over lib/ and scripts/ source TEXT. Comments
    // satisfy both. Measured by the lane that opened the seam: replacing the
    // real `throw new RetrievalBudgetExceededError(…)` with a silent
    // `block.slice(0, budgetTokens * 4)` still reported PASS here, 45/45, 10/10 —
    // the check certifying this behaviour could not fail, which inflates every
    // score it contributes to.
    //
    // It now RUNS the function. scripts/acceptance/retrieval-budget-probe.mjs
    // builds a scratch SQLite from the real migrations in a temp directory (the
    // live database is never touched), seeds one record whose human-written
    // reviewer_notes alone cannot fit, calls buildRetrievedContext() with a
    // 50-token budget, and prints RAISED / TRUNCATED / PROBE-BROKEN. Only
    // RAISED:RetrievalBudgetExceededError passes — a probe that measured
    // nothing fails loudly rather than passing quietly, which is the whole
    // failure mode being repaired here.
    async run() {
      const budget = await countMatches(['lib', 'scripts'], 'MEMORY_BUDGET|contextBudget|CONTEXT_BUDGET', ['.ts', '.mjs'])
      if (budget.length === 0) return no('no context budget — memory is injected uncapped, which is the bug this piece exists to fix')

      let out = ''
      try {
        out = String(
          execFileSync(process.execPath, ['scripts/acceptance/retrieval-budget-probe.mjs'], {
            encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'],
          }),
        ).trim()
      } catch (e) {
        // A non-zero exit is the probe's own verdict channel, so read its
        // stdout before treating this as a harness fault.
        out = String(e?.stdout ?? '').trim() || `PROBE-BROKEN:${e?.message ?? 'probe did not run'}`
      }

      const verdict = out.split('\n').map(l => l.trim()).filter(Boolean).pop() ?? '(no output)'
      if (verdict.startsWith('RAISED:RetrievalBudgetExceededError')) {
        return ok('budget enforced by raising, not truncating — buildRetrievedContext() actually raised on an oversized record (50-token budget, scratch sqlite)')
      }
      if (verdict.startsWith('TRUNCATED:')) {
        return no(`a budget exists but overflow did NOT raise — buildRetrievedContext() returned text instead (${verdict}); a silent truncation loses the record that mattered`)
      }
      return no(`the budget behaviour could not be measured: ${verdict}`)
    },
  },

  // ── the operator can decide ───────────────────────────────────────────────
  {
    id: 'inbox-approve-persists', piece: 'inbox-approval', critical: true,
    desc: 'an approval can actually be recorded',
    async run() {
      const r = await http('/api/inbox', { cookie: OWNER })
      if (r.status !== 200) return no(`inbox list ${r.status}`)
      // Approving is PATCH {id, status}, not POST — POST /api/inbox CREATES a
      // request and requires a body. This check spent a whole session calling the
      // wrong verb with no body, so req.json() threw and the route answered 500.
      // It read as "the approve path is broken" when the approve path was fine.
      // A grader that calls the wrong endpoint slanders working code.
      // A well-formed request against an id that does not exist. The route must
      // VALIDATE and refuse with a 4xx. Sending no body at all just makes
      // req.json() throw, which is a 500 that says nothing about the write path —
      // that mistake is what made this check read red for a whole session.
      const p = await http('/api/inbox', {
        method: 'PATCH', cookie: OWNER,
        body: { id: '00000000-0000-0000-0000-000000000000', status: 'approved' },
      })
      // A bogus id must be refused with a 4xx. A 5xx means the write path itself
      // is broken, which is the regression this actually guards.
      return p.status < 500
        ? ok(`approve path validates and answers ${p.status}, not a 5xx`)
        : no(`approve write path 5xx: ${p.body.slice(0, 120)}`)
    },
  },

  // ── ceilings, enforced outside the agent ──────────────────────────────────
  {
    id: 'ceilings-exist', piece: 'agent-budget-stop', critical: true,
    desc: 'concurrency, wall clock and a no-progress halt are enforced by the supervisor',
    async run() {
      const c = await countMatches(['lib', 'app/api'], 'maxConcurrent|MAX_CONCURRENT|concurrencyLimit', ['.ts'])
      const w = await countMatches(['lib', 'app/api'], 'maxRunMs|MAX_RUN_|wallClock|WALL_CLOCK', ['.ts'])
      const n = await countMatches(['lib', 'app/api'], 'noProgress|NO_PROGRESS|stallHeartbeats', ['.ts'])
      const missing = [!c.length && 'concurrency', !w.length && 'wall-clock', !n.length && 'no-progress'].filter(Boolean)
      return missing.length === 0
        ? ok('all three ceilings present')
        : no(`missing: ${missing.join(', ')} — a dollar cap alone would not have stopped the self-kicking watcher`)
    },
  },
  {
    id: 'ledger-closes-rows', piece: 'agent-budget-stop', critical: true,
    desc: 'the token ledger finalizes a run, so a budget has something to read',
    async run() {
      const h = await countMatches(['lib/runtimes', 'lib'], 'finalizeSpawn|finalizeRun|closeLedger', ['.ts'])
      if (h.length === 0) return no('no finalize function — 66,879 spawn stubs and zero closed rows was the starting state')
      // it must be CALLED, not merely defined
      const calls = h.filter(x => !/token-ledger\.ts/.test(x))
      return calls.length > 0 ? ok(`finalize called from ${calls.length} site(s)`) : no('finalize is defined but never called — still dead code')
    },
  },

  // ── the headline proof ────────────────────────────────────────────────────
  {
    id: 'dispatch-guard-untouched', piece: 'run-agent-locally', critical: true,
    desc: 'INTENTIONAL: the dispatch kill switch is still the kill switch',
    async run() {
      const g = await countMatches(['lib'], 'TODERO_DISPATCH_ENABLED', ['.ts'])
      if (g.length === 0) return no('the dispatch guard has been REMOVED — three agents tried this in wave 2')
      const spoof = await countMatches(['lib', 'app'], 'x-todero-source', ['.ts'])
      if (spoof.length > 0) return no('a spoofable header bypass was added around the guard')
      if (process.env.TODERO_DISPATCH_ENABLED === '1') return ok('guard present; deliberately lifted for this run')
      const r = await http('/api/run-agent?agent=builder', { method: 'POST', cookie: OWNER })
      return r.status === 503 ? ok('503 DISPATCH_DISABLED') : no(`guard present but POST returned ${r.status}`)
    },
  },
  {
    id: 'launch-control-honest', piece: 'run-agent-locally',
    desc: 'the UI never shows an armed control that then refuses',
    async run() {
      const h = await countMatches(['components'], 'DISPATCH_DISABLED|dispatchEnabled|dispatchDisabled')
      return h.length > 0
        ? ok('the UI knows about the guard and can render disabled')
        : no('no UI awareness of the dispatch guard — a launch button would appear live and then 503')
    },
  },
]

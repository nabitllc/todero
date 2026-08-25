// Machine-readable acceptance checks for the Todero reconstruction.
//
// Why this file exists: every acceptance criterion used to live as prose inside a
// per-piece brief, so each critic re-derived it from scratch at frontier cost, once
// per round. That is the expensive way to answer "does curl return 200".
// These run in seconds, so they run after EVERY piece — which is what catches a
// regression in the round it happens instead of an hour later by hand.
//
// A model critic should judge only what a script cannot score: honesty, design
// quality, and comparison against the benchmark.

import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'

export const BASE = process.env.TODERO_URL ?? 'http://localhost:3000'
const OWNER = 'mc-auth=kaos2026; mc-role=owner'

/** GET/POST helper that never throws — a network failure is a result, not a crash. */
export async function http(path, { method = 'GET', cookie = null, timeoutMs = 20000, body = null } = {}) {
  try {
    const res = await fetch(BASE + path, {
      method,
      headers: {
        ...(cookie ? { cookie } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(timeoutMs),
      redirect: 'manual',
    })
    return { status: res.status, body: await res.text() }
  } catch (err) {
    return { status: 0, body: `NETWORK: ${err.message}` }
  }
}

/** Count regex matches across a directory tree, skipping build and vendor output. */
export async function countMatches(dirs, pattern, exts = ['.ts', '.tsx']) {
  const re = new RegExp(pattern)
  const hits = []
  async function walk(dir) {
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name.startsWith('.next')) continue
      const p = join(dir, e.name)
      // The graders must never grade themselves: a check that greps for a bad
      // pattern necessarily CONTAINS that pattern, and would report its own
      // source as a defect. Two Wave 4 checks did exactly that on first run.
      if (p.split('\\').join('/').includes('scripts/acceptance')) continue
      if (e.isDirectory()) { await walk(p); continue }
      if (exts.length && !exts.some(x => e.name.endsWith(x))) continue
      let txt
      try { txt = await readFile(p, 'utf8') } catch { continue }
      txt.split('\n').forEach((line, i) => { if (re.test(line)) hits.push(`${p}:${i + 1}`) })
    }
  }
  for (const d of dirs) await walk(d)
  return hits
}

const ok = (detail) => ({ ok: true, detail })
const no = (detail) => ({ ok: false, detail })

// ── the checks ───────────────────────────────────────────────────────────────
// `critical: true` means a failure here invalidates downstream judgement.

export const CHECKS = [
  // ── authorization ──────────────────────────────────────────────────────────
  {
    id: 'rbac-owner-reads', piece: 'rbac-permission-gate', critical: true,
    desc: 'owner can read the MC API',
    async run() {
      const r = await http('/api/issues?all_projects=1', { cookie: OWNER })
      return r.status === 200 ? ok('200') : no(`expected 200, got ${r.status}: ${r.body.slice(0, 120)}`)
    },
  },
  {
    id: 'rbac-anon-denied-read', piece: 'rbac-permission-gate', critical: true,
    desc: 'anonymous CANNOT read the MC API',
    async run() {
      const r = await http('/api/issues?all_projects=1')
      return [401, 403].includes(r.status) ? ok(String(r.status)) : no(`expected 401/403, got ${r.status}`)
    },
  },
  {
    id: 'rbac-anon-denied-write', piece: 'rbac-permission-gate', critical: true,
    desc: 'anonymous CANNOT delete through the MC API',
    async run() {
      const r = await http('/api/issues?id=00000000-0000-0000-0000-000000000000', { method: 'DELETE' })
      return [401, 403].includes(r.status) ? ok(String(r.status)) : no(`expected 401/403, got ${r.status}`)
    },
  },
  {
    id: 'rbac-owner-memory', piece: 'rbac-permission-gate',
    desc: 'owner is not denied its own declared permissions',
    async run() {
      const r = await http('/api/memory', { cookie: OWNER })
      return r.status !== 403 ? ok(String(r.status)) : no('403 PERMISSION_DENIED for owner')
    },
  },
  {
    id: 'rbac-role-not-self-asserted', piece: 'auth-session',
    desc: 'role cannot be self-asserted by an unsigned cookie',
    async run() {
      const r = await http('/api/issues?all_projects=1', { cookie: 'mc-role=owner' })
      return [401, 403].includes(r.status)
        ? ok(`forged role rejected (${r.status})`)
        : no(`a forged mc-role=owner cookie alone returned ${r.status} — role is self-asserted`)
    },
  },

  // ── credential hygiene ─────────────────────────────────────────────────────
  {
    id: 'no-jwt-in-source', piece: 'client-service-role-key-leak', critical: true,
    desc: 'no Supabase JWT literal anywhere in source',
    async run() {
      const h = await countMatches(['app', 'lib', 'components', 'hooks'], 'eyJhbGciOi')
      return h.length === 0 ? ok('0 occurrences') : no(`${h.length} found: ${h.slice(0, 4).join(', ')}`)
    },
  },
  {
    id: 'no-project-ref-in-source', piece: 'supabase-config-portability',
    desc: "the author's Supabase project ref is not a compile-time constant",
    async run() {
      const h = await countMatches(
        ['app', 'lib', 'components', 'hooks', 'config'],
        // Split so this harness is not itself a hit for the grep it runs.
        'twthga' + 'piouiqhavrcnry',
        ['.ts', '.tsx', '.js', '.mjs', '.sh', '.json'],
      )
      return h.length === 0 ? ok('0 occurrences') : no(`${h.length} found: ${h.slice(0, 4).join(', ')}`)
    },
  },

  // ── portability ────────────────────────────────────────────────────────────
  {
    id: 'no-mac-paths', piece: 'cross-platform-paths',
    desc: 'no hardcoded macOS paths in app/ or lib/',
    async run() {
      const h = await countMatches(['app', 'lib'], '/Users/kemuniagent|/opt/homebrew|/bin/bash')
      return h.length === 0 ? ok('0 occurrences') : no(`${h.length} found: ${h.slice(0, 5).join(', ')}`)
    },
  },
  {
    id: 'no-openrouter', piece: 'chat-route-local-model',
    desc: 'OpenRouter is not referenced anywhere (owner directive: local only)',
    async run() {
      const h = await countMatches(['app', 'lib', 'components', 'hooks'], 'openrouter|OPENROUTER')
      return h.length === 0 ? ok('0 occurrences') : no(`${h.length} found: ${h.slice(0, 4).join(', ')}`)
    },
  },
  {
    id: 'agents-route-ok', piece: 'agents-api',
    desc: 'GET /api/agents returns 200 in under 1s',
    async run() {
      const t0 = Date.now()
      const r = await http('/api/agents', { cookie: OWNER })
      const ms = Date.now() - t0
      if (r.status !== 200) return no(`status ${r.status}: ${r.body.slice(0, 120)}`)
      return ms < 1000 ? ok(`200 in ${ms}ms`) : no(`200 but slow: ${ms}ms`)
    },
  },
  {
    id: 'core-routes-no-500', piece: 'cross-platform-paths', critical: true,
    desc: 'core routes do not 500 on this (non-Mac) host',
    async run() {
      // /api/health is excluded deliberately: it is SUPPOSED to answer 503 when the
      // schema is incomplete. That is the honest signal, not a fault.
      const routes = ['/api/status', '/api/files', '/api/automations', '/api/projects']
      const bad = []
      for (const p of routes) {
        const r = await http(p, { cookie: OWNER })
        if (r.status >= 500 || r.status === 0) bad.push(`${p}=${r.status}`)
      }
      return bad.length === 0 ? ok(`${routes.length} routes clean`) : no(bad.join(', '))
    },
  },

  // ── local LLM ──────────────────────────────────────────────────────────────
  {
    id: 'ollama-reachable', piece: 'llm-provider-base-url', critical: true,
    desc: 'the local LLM endpoint answers',
    async run() {
      try {
        const res = await fetch('http://localhost:11434/v1/models', { signal: AbortSignal.timeout(5000) })
        const j = await res.json()
        const n = (j.data ?? []).length
        return n > 0 ? ok(`${n} models`) : no('reachable but reports no models')
      } catch (e) { return no(`unreachable: ${e.message}`) }
    },
  },
  {
    id: 'runtime-reports-local', piece: 'llm-provider-base-url',
    desc: 'Todero reports a usable runtime on this machine',
    async run() {
      const r = await http('/api/run-agent/runtimes', { cookie: OWNER })
      if (r.status !== 200) return no(`status ${r.status}`)
      let j
      try { j = JSON.parse(r.body) } catch { return no('unparseable response') }
      const avail = (j.runtimes ?? []).filter(x => x.available)
      return avail.length > 0
        ? ok(`${avail.length} available: ${avail.map(x => x.name).join(',')}`)
        : no('availableCount 0 — no runtime usable here')
    },
  },
  {
    id: 'no-bash-spawn', piece: 'agent-spawn-execution',
    desc: 'runtimes do not shell out to /bin/bash',
    async run() {
      const h = await countMatches(['lib/runtimes'], '/bin/bash')
      return h.length === 0 ? ok('0 occurrences') : no(`${h.length} found: ${h.join(', ')}`)
    },
  },

  // ── intentional constraints — NOT defects. Critics must honor these. ───────
  {
    id: 'dispatch-guard-armed', piece: 'INTENTIONAL', critical: true,
    desc: 'INTENTIONAL: Todero cannot autonomously dispatch agents',
    async run() {
      if (process.env.TODERO_DISPATCH_ENABLED === '1') return ok('guard deliberately lifted for this run')
      const r = await http('/api/run-agent?agent=builder', { method: 'POST', cookie: OWNER })
      if (r.status === 503 && r.body.includes('DISPATCH_DISABLED')) return ok('503 DISPATCH_DISABLED')
      return no(`guard NOT armed — POST returned ${r.status}. Todero could spawn agents.`)
    },
  },
]

export async function runAll({ only = null } = {}) {
  const picked = only ? CHECKS.filter(c => c.piece === only || c.id === only) : CHECKS
  const results = []
  for (const c of picked) {
    let r
    try { r = await c.run() } catch (e) { r = no(`check threw: ${e.message}`) }
    results.push({ ...c, ...r })
  }
  return results
}

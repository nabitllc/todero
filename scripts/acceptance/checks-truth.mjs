// Wave 3 "Truth" acceptance checks.
//
// These are authored BEFORE the work, by the orchestrator, not by the builders
// who will be graded against them. Loop_Engineering: "Keep the evaluator outside
// the loop that changes the work" — a builder who writes its own check learns to
// write a check it already passes.
//
// The theme of this wave: the product must never assert something untrue. A
// green light that is green because 'ok' is a string literal is worse than no
// light at all, because it costs the operator their trust in every other light.

import { http, countMatches } from './checks.mjs'

const OWNER = 'mc-auth=kaos2026; mc-role=owner'
const ok = (detail) => ({ ok: true, detail })
const no = (detail) => ({ ok: false, detail })

export const TRUTH_CHECKS = [
  // ── fabricated automations ────────────────────────────────────────────────
  {
    id: 'no-fabricated-cron-list', piece: 'kill-fake-automations', critical: true,
    desc: 'the automations surface does not read from a hardcoded job array',
    async run() {
      const h = await countMatches(['lib', 'components'], 'ALWAYS_RUNNING|ALWAYS RUNNING')
      return h.length === 0 ? ok('no hardcoded job list') : no(`${h.length} found: ${h.slice(0, 3).join(', ')}`)
    },
  },
  {
    id: 'automations-honest-when-empty', piece: 'kill-fake-automations',
    desc: 'automations reports what it actually knows, with a source',
    async run() {
      const r = await http('/api/automations', { cookie: OWNER })
      if (r.status !== 200) return no(`status ${r.status}`)
      let j; try { j = JSON.parse(r.body) } catch { return no('unparseable') }
      // Must be explicit about provenance rather than returning a bare array of fiction.
      const hasProvenance = j && typeof j === 'object' && ('source' in j || 'scheduler' in j)
      return hasProvenance ? ok('response declares its source') : no('no source/scheduler field — cannot tell real jobs from invented ones')
    },
  },

  // ── fabricated infrastructure status ──────────────────────────────────────
  {
    id: 'no-hardcoded-ok-status', piece: 'kill-fake-infra-greens', critical: true,
    desc: 'service indicators are not green because a literal says so',
    async run() {
      const h = await countMatches(['app/api/status', 'components/tabs'], "status: *'ok'|status: *\"ok\"|'Tunnel active'")
      return h.length === 0 ? ok('no literal ok statuses') : no(`${h.length} hardcoded: ${h.slice(0, 4).join(', ')}`)
    },
  },
  {
    id: 'status-reports-unknown', piece: 'kill-fake-infra-greens',
    desc: 'status distinguishes checked from unchecked',
    async run() {
      const r = await http('/api/status', { cookie: OWNER })
      if (r.status !== 200) return no(`status ${r.status}`)
      const body = r.body.toLowerCase()
      return (body.includes('unknown') || body.includes('unchecked') || body.includes('checkedat') || body.includes('checked_at'))
        ? ok('reports unknown/checked-at')
        : no('every indicator claims a state with no evidence it was measured')
    },
  },

  // ── fabricated office activity ────────────────────────────────────────────
  {
    id: 'no-invented-meetings', piece: 'kill-office-fiction', critical: true,
    desc: 'the office does not fabricate meetings or minutes',
    async run() {
      const h = await countMatches(['components'], 'MEETING_SUMMARIES|meetingSummar|inferMeeting')
      return h.length === 0 ? ok('no fabricated meetings') : no(`${h.length} found: ${h.slice(0, 3).join(', ')}`)
    },
  },

  // ── fabricated agent roster ───────────────────────────────────────────────
  {
    id: 'no-invented-agent-fallback', piece: 'agent-roster-truth', critical: true,
    desc: 'a failed roster fetch does not fall back to invented agents',
    async run() {
      const h = await countMatches(['app', 'components'], 'ALL_AGENTS')
      return h.length === 0 ? ok('no hardcoded roster fallback') : no(`${h.length} found: ${h.slice(0, 3).join(', ')}`)
    },
  },

  // ── truthful counts ───────────────────────────────────────────────────────
  {
    id: 'issues-paginated', piece: 'issues-pagination', critical: true,
    desc: 'the issue list reports a true total, not a silent 1000-row truncation',
    async run() {
      // This check used to assert `total > 1000`. That was a PROXY, and it only
      // held because the database happened to carry 3,071 issues: the moment
      // history was archived and the board scoped to one empty project, the
      // proxy reported a product regression where there was none.
      //
      // The property actually worth guarding is not "the number is big" but
      // "the number is TRUE" — the reported total equals the rows the API will
      // actually hand over. That is testable at any dataset size, and it still
      // catches a silent 1000-row cap on a large one, which is the bug this
      // check was written for.
      const head = await http('/api/issues?limit=1&include_archived=1&all_projects=1', { cookie: OWNER })
      if (head.status !== 200) return no(`status ${head.status}`)
      let j; try { j = JSON.parse(head.body) } catch { return no('unparseable') }
      const total = j?.total ?? j?.meta?.total
      if (typeof total !== 'number') return no('no numeric total field — every count built on this is unverifiable')

      const all = await http('/api/issues?limit=0&include_archived=1&all_projects=1', { cookie: OWNER })
      if (all.status !== 200) return no(`full-list status ${all.status}`)
      let rows; try { const a = JSON.parse(all.body); rows = a?.data ?? a } catch { return no('unparseable full list') }
      if (!Array.isArray(rows)) return no('full list is not an array')

      if (rows.length !== total) {
        return no(`reported total=${total} but the API returned ${rows.length} rows — the count and the data disagree`)
      }
      if (rows.length === 1000) {
        return no('exactly 1000 rows returned — indistinguishable from the old silent cap')
      }
      return ok(`total=${total} matches ${rows.length} rows actually returned`)
    },
  },
  {
    id: 'issues-no-silent-truncation', piece: 'issues-pagination',
    desc: 'a truncated page says so',
    async run() {
      const r = await http('/api/issues?limit=10&all_projects=1', { cookie: OWNER })
      if (r.status !== 200) return no(`status ${r.status}`)
      let j; try { j = JSON.parse(r.body) } catch { return no('unparseable') }
      const hasMore = j?.has_more ?? j?.hasMore ?? j?.meta?.has_more
      return typeof hasMore === 'boolean' ? ok(`has_more=${hasMore}`) : no('no has_more flag — a partial page is indistinguishable from a complete one')
    },
  },

  // ── schema honesty ────────────────────────────────────────────────────────
  {
    id: 'health-reports-missing-tables', piece: 'schema-migrations', critical: true,
    desc: 'health fails loudly when the schema is incomplete',
    async run() {
      const r = await http('/api/health')
      if (r.status === 0) return no('unreachable')
      let j; try { j = JSON.parse(r.body) } catch { return no('unparseable') }
      const mentionsSchema = JSON.stringify(j).toLowerCase()
      const hasTableAwareness = mentionsSchema.includes('missing') || mentionsSchema.includes('tables') || mentionsSchema.includes('schema')
      return hasTableAwareness ? ok('health is schema-aware') : no('health returns green without ever checking the schema it depends on')
    },
  },
  {
    id: 'migration-runner-exists', piece: 'schema-migrations',
    desc: 'there is one command that turns migrations/ into a schema',
    async run() {
      const h = await countMatches(['.'], '"db:migrate"', ['package.json'])
      return h.length > 0 ? ok('npm run db:migrate defined') : no('no migration runner — a stranger cannot create the schema')
    },
  },
  {
    id: 'no-500-on-missing-table', piece: 'schema-migrations',
    desc: 'a missing table produces a named error, not a raw Postgres leak',
    async run() {
      const routes = ['/api/connections', '/api/deploy-history', '/api/roles']
      const bad = []
      for (const p of routes) {
        const r = await http(p, { cookie: OWNER })
        if (r.status >= 500) bad.push(`${p}=${r.status}`)
        else if (r.body.includes('schema cache')) bad.push(`${p} leaks a raw PostgREST error`)
      }
      return bad.length === 0 ? ok('3 routes degrade honestly') : no(bad.join('; '))
    },
  },

  // ── error surfacing ───────────────────────────────────────────────────────
  {
    id: 'shared-fetch-hook-exists', piece: 'ui-error-surfacing-complete',
    desc: 'tabs share one fetch path that cannot swallow an error',
    async run() {
      const h = await countMatches(['hooks', 'lib'], 'useApiData|useApiResource')
      return h.length > 0 ? ok('shared hook present') : no('no shared hook — every tab re-implements error handling and some will swallow it')
    },
  },
  {
    id: 'no-unchecked-json-parse', piece: 'ui-error-surfacing-complete', critical: true,
    desc: 'no tab parses a response body without checking res.ok first',
    async run() {
      // The exact anti-pattern that made five tabs render "0" over a 403.
      const h = await countMatches(['components'], '\\.then\\(r *=> *r\\.json\\(\\)\\)')
      return h.length === 0 ? ok('no unchecked .then(r => r.json())') : no(`${h.length} found: ${h.slice(0, 4).join(', ')}`)
    },
  },

  // ── chat on the local model ───────────────────────────────────────────────
  {
    id: 'chat-model-list-is-live', piece: 'finish-openrouter-removal',
    desc: 'the chat model list is not a hardcoded vendor menu',
    async run() {
      const h = await countMatches(['components/tabs'], "claude-sonnet|gpt-4o|anthropic/")
      return h.length === 0 ? ok('no hardcoded cloud models') : no(`${h.length} hardcoded: ${h.slice(0, 3).join(', ')}`)
    },
  },
]

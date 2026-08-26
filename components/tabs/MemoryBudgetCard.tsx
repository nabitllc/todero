'use client'
// ─── components/tabs/MemoryBudgetCard.tsx ────────────────────────────────────
//
// memory-cards piece (docs/rebuild/pieces/pieces6/memory-cards.md), build
// instruction 2 — the signature control of design/Memory.dc.html.
//
// The artboard draws ONE bar reading "1,180 / 1,300 tokens" over segments for
// agent body, skills, retrieved records and headroom. That single bar does not
// exist in this codebase and this card does not pretend it does: identity
// context and task retrieval have TWO separate budgets —
// `getContextBudgetTokens() * IDENTITY_CONTEXT_BUDGET_MULTIPLIER` (7,800) for
// the always-loaded half, and `getContextBudgetTokens()` (1,300) for the
// per-task retrieved half, which is not always in context at all. The bar is
// the first; the second is stated beside it as its own line.
//
// Every token figure here is measured from row content this app actually
// stores, by the same rule the server uses (lib/memory-budget.ts, mirrored and
// drift-tested). Nothing is estimated from a row count, and a table with no
// rows renders as a named empty state rather than an empty bar.

import React, { useMemo, useState } from 'react'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import Card from '@/components/nav/Card'
import { useApiData } from '@/hooks/useApiData'
import { dbUrl } from '@/lib/db/browser'
import {
  IDENTITY_CONTEXT_BUDGET_MULTIPLIER,
  RETRIEVAL_BUDGET_TOKENS_DEFAULT,
  composeIdentitySections,
  headroomTokens,
  identityBudgetTokens,
  selectWithinBudget,
  summarizeSelection,
  type ContextDoc,
  type ContextMemoryFile,
  type SectionKind,
} from '@/lib/memory-budget'

/** Row cap on both reads. `/api/db/<table>` has no count envelope, so a fetch
 *  that comes back at the cap is a BOUNDED scan and is labelled as one. */
const ROW_CAP = 200

const DOCS_QUERY = `agent_documents?select=agent_id,doc_type,slug,content&order=doc_type.asc,slug.asc&limit=${ROW_CAP}`
const DAILY_QUERY = `agent_memory_files?select=agent_id,memory_type,date_key,content&memory_type=eq.daily&order=date_key.desc&limit=${ROW_CAP}`

const SEGMENT_COLOR: Record<SectionKind, string> = {
  soul: '#3b82f6',
  'agent-soul': '#60a5fa',
  handbook: '#a78bfa',
  skill: '#c4b5fd',
  daily: '#f59e0b',
}

const dayKey = (offsetDays = 0) => new Date(Date.now() - offsetDays * 86400000).toISOString().slice(0, 10)

export default function MemoryBudgetCard({ agentIds }: { agentIds: string[] | null }) {
  const docs = useApiData<ContextDoc[]>(dbUrl(DOCS_QUERY))
  const daily = useApiData<ContextMemoryFile[]>(dbUrl(DAILY_QUERY))
  const [picked, setPicked] = useState<string | null>(null)

  const agent = picked ?? agentIds?.[0] ?? null
  const budget = identityBudgetTokens()

  const selection = useMemo(() => {
    if (!agent) return null
    const sections = composeIdentitySections(agent, docs.data ?? [], daily.data ?? [], dayKey(0), dayKey(1))
    return selectWithinBudget(sections, budget)
  }, [agent, docs.data, daily.data, budget])

  const segments = selection ? summarizeSelection(selection) : []
  const error = docs.error ?? daily.error
  const loading = docs.loading || daily.loading
  const bounded = (docs.data?.length ?? 0) >= ROW_CAP || (daily.data?.length ?? 0) >= ROW_CAP

  const source = (
    <>
      GET /api/db/{DOCS_QUERY}
      <br />
      GET /api/db/{DAILY_QUERY}
      <br />
      ceiling = lib/memory-budget.ts identityBudgetTokens() = {RETRIEVAL_BUDGET_TOKENS_DEFAULT} ×{' '}
      {IDENTITY_CONTEXT_BUDGET_MULTIPLIER} — the built-in default; TODERO_MEMORY_RETRIEVAL_BUDGET_TOKENS can
      override it server-side and no endpoint reports the effective value
      <br />
      the per-task retrieval budget is a SEPARATE {RETRIEVAL_BUDGET_TOKENS_DEFAULT.toLocaleString()} tokens
      (lib/memory-retrieval.ts) and is not part of this bar
      {bounded && <> · bounded scan: read the first {ROW_CAP} rows, the table may hold more</>}
    </>
  )

  // A metric may never render beside a failed request, and never while the
  // first response has not landed — an unmeasured 0 reads exactly like a
  // measured one.
  const metric = error || loading || !selection || selection.overflow
    ? undefined
    : { value: `${selection.usedTokens.toLocaleString()} / ${budget.toLocaleString()}`, label: 'tokens', tone: metricTone(selection.usedTokens, budget) }

  const nothingStored = !error && !loading && (docs.data?.length ?? 0) === 0 && (daily.data?.length ?? 0) === 0

  return (
    <Card
      id="memory-always-in-context"
      title="How much memory is always in context?"
      metric={metric}
      source={source}
      empty={{
        active: nothingStored,
        message:
          'No agent context is stored on this database: agent_documents and agent_memory_files both returned 0 rows, ' +
          'so no soul, handbook, skill doc or daily note is loaded into any agent\'s always-in-context window. ' +
          `The ceiling below is still ${budget.toLocaleString()} tokens — nothing has spent any of it yet.`,
      }}
    >
      {error ? (
        <ApiErrorBanner error={error} onRetry={docs.error ? docs.refetch : daily.refetch} />
      ) : loading ? (
        <p className="text-white/40 text-xs">Measuring stored context…</p>
      ) : !agent ? (
        <p className="text-white/45 text-xs">
          No agent roster reached this card, so there is no agent whose context could be measured. The budget is
          per-agent: GET /api/agents supplies the ids.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {agentIds && agentIds.length > 1 && (
            <label className="flex items-center gap-2 text-[11px] text-white/50">
              <span>Context for</span>
              <select
                value={agent}
                onChange={e => setPicked(e.target.value)}
                className="bg-[#111] border border-white/10 rounded-md px-2 py-1 text-white/80 text-[11px]"
              >
                {agentIds.map(id => <option key={id} value={id}>{id}</option>)}
              </select>
              <span className="text-white/30">— global rows load for every agent; per-agent rows only for this one</span>
            </label>
          )}

          {selection && !selection.overflow && selection.selected.length === 0 && (
            <p className="text-white/45 text-[11px] leading-relaxed">
              The tables hold rows, but none of them load for <span className="font-mono">{agent}</span>: no global soul or
              handbook, no soul or skill doc under this agent id, and no daily note from today or yesterday. Its
              always-in-context window is genuinely empty — that is a measurement, not a missing read.
            </p>
          )}

          {selection?.overflow ? (
            <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3">
              <p className="text-red-400 text-sm leading-5">
                RetrievalBudgetExceededError — the first section (<span className="font-mono">{selection.overflow.label}</span>)
                is ~{selection.overflow.tokens.toLocaleString()} tokens on its own, over the{' '}
                {budget.toLocaleString()}-token ceiling. A spawn for <span className="font-mono">{agent}</span> raises rather
                than loading a truncated identity, so there is no bar to draw.
              </p>
            </div>
          ) : (
            <>
              <div className="h-2 rounded-full bg-white/[0.08] overflow-hidden flex">
                {segments.map(s => (
                  <div key={s.kind} style={{ width: `${s.percentOfBudget}%`, background: SEGMENT_COLOR[s.kind] }} title={`${s.label}: ${s.tokens} tokens`} />
                ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {segments.map(s => (
                  <span key={s.kind} className="flex items-center gap-1.5">
                    <span className="w-2.5 h-1.5 rounded-sm" style={{ background: SEGMENT_COLOR[s.kind] }} />
                    <span className="font-mono text-[10.5px] text-white/55">
                      {s.label} · {s.tokens.toLocaleString()} ({s.sections} {s.sections === 1 ? 'section' : 'sections'})
                    </span>
                  </span>
                ))}
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-1.5 rounded-sm bg-white/15" />
                  <span className="font-mono text-[10.5px] text-white/55">
                    headroom · {selection ? headroomTokens(selection).toLocaleString() : '—'}
                  </span>
                </span>
              </div>
            </>
          )}

          {selection && selection.dropped.length > 0 && (
            <p className="font-mono text-[10px] leading-snug text-amber-400/80">
              dropped to fit, named not truncated:{' '}
              {selection.dropped.map(d => `${d.label} (~${d.tokens} tokens)`).join(', ')}
            </p>
          )}

          <p className="text-white/45 text-[11px] leading-relaxed">
            Overflow never truncates silently. A first section that does not fit raises{' '}
            <span className="font-mono text-white/65">RetrievalBudgetExceededError</span>; any later section that does not
            fit is dropped by name and reported, and selection continues past it to smaller sections behind.
          </p>
          <p className="text-white/45 text-[11px] leading-relaxed">
            Approaching the ceiling is the signal to consolidate, not to trim. Everything outside this budget still exists
            and is retrieved by search when a task looks similar — nothing is lost, only unloaded.
          </p>
          <p className="font-mono text-[10px] leading-snug text-white/35">
            separately: the per-task retrieval budget is {RETRIEVAL_BUDGET_TOKENS_DEFAULT.toLocaleString()} tokens
            (lib/memory-retrieval.ts). Retrieved records are ranked against one task at spawn time and are NOT
            always-in-context, so they are not part of the bar above.
          </p>
        </div>
      )}
    </Card>
  )
}

function metricTone(used: number, budget: number): 'default' | 'amber' | 'red' {
  const pct = budget > 0 ? used / budget : 0
  if (pct >= 1) return 'red'
  if (pct >= 0.9) return 'amber'
  return 'default'
}

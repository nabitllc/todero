'use client'
// components/tabs/RunTraceCard.tsx — runs-traces piece (Run Safety & Enforcement)
//
// design/Run.dc.html's trace, drawn from real rows. Three panels:
//   1. Trace          — run_steps, ordered by step_no (migration 060)
//   2. Cost by step   — run_steps.tokens grouped by run_steps.tool
//   3. Ceilings       — GET /api/agents/<id>/budget, i.e. lib/agent-budget.ts's
//                       own numbers, plus agent_runs.stopped_reason
//
// Not drawn: the mockup's "What it learned" panel. `agent_run_records` holds
// rejection_reason / reviewer_notes per RUN, and the "2 of 3 to skill"
// promotion counter is a threshold inside a script, not a queryable per-run
// column. There is no column that answers "how far along the promotion path is
// THIS run's lesson", so the panel is named as absent at the foot of this card
// rather than approximated. Same stance components/nav/RunsView.tsx has held
// since it shipped.
//
// Every number on screen is produced by lib/run-trace.ts from a column. There
// is no literal step, cost or ceiling in this file.

import React from 'react'
import { useApiData } from '@/hooks/useApiData'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import {
  NO_STEPS_MESSAGE,
  ceilingRows,
  ceilingSourceNote,
  costByStep,
  formatMs,
  formatStepNo,
  formatTokens,
  formatUsd,
  runTouchedPaidProvider,
  traceTotals,
  type CeilingTone,
  type RunBudget,
  type RunStepRow,
} from '@/lib/run-trace'

interface StepsResponse {
  run_id: string
  steps: RunStepRow[]
}

interface BudgetResponse {
  agentId: string
  budget: RunBudget
}

export interface RunTraceCardProps {
  /** `agent_runs.id`. */
  runId: string
  /** `agent_runs.agent_id` — the ceilings panel reads this agent's budget. */
  agentId: string
  startedAt: string
  completedAt: string | null
  /** `agent_runs.stopped_reason` — the ONLY source of a "triggered" ceiling. */
  stoppedReason: string | null
}

const TOOL_TONE = 'text-blue-300'
const FAIL_TONE = 'text-red-400'
const OK_TONE = 'text-emerald-400'

const CEILING_TONE: Record<CeilingTone, string> = {
  ok: 'text-emerald-400',
  warn: 'text-amber-400',
  fail: 'text-red-400',
  dormant: 'text-white/50',
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-white/10 bg-[#0f0f0f] overflow-hidden">
      <div className="px-4 py-2.5 border-b border-white/[0.08]">
        <h3 className="text-white text-[13px] font-semibold">{title}</h3>
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  )
}

export default function RunTraceCard({ runId, agentId, startedAt, completedAt, stoppedReason }: RunTraceCardProps) {
  const steps = useApiData<StepsResponse>(`/api/run-steps?run_id=${encodeURIComponent(runId)}`)
  const budget = useApiData<BudgetResponse>(`/api/agents/${encodeURIComponent(agentId)}/budget`)

  // Error REPLACES the body. Neither the "no steps were recorded" line nor an
  // empty trace may ever render over a request that failed — that is the
  // TOD-654 defect (an empty state drawn on top of a 403) one surface over.
  if (steps.error) {
    return (
      <div className="space-y-3 pt-3" data-testid="run-trace-error">
        <ApiErrorBanner error={steps.error} onRetry={steps.refetch} />
        <p className="font-mono text-[10px] text-white/35">
          GET /api/run-steps?run_id={runId} — the trace is unavailable, which is not the same as the run having no steps.
        </p>
      </div>
    )
  }

  if (steps.loading || steps.data === null) {
    return <p className="text-white/60 text-xs py-4">Loading trace for run {runId}…</p>
  }

  const rows = steps.data.steps
  const totals = traceTotals(rows)
  const paid = runTouchedPaidProvider(rows)
  const breakdown = costByStep(rows)

  return (
    <div className="space-y-3 pt-3">
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-3 items-start">

        {/* ── TRACE ─────────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-white/10 bg-[#0f0f0f] overflow-hidden">
          <div className="px-4 py-2.5 border-b border-white/[0.08] flex items-center gap-2.5 flex-wrap">
            <h3 className="text-white text-[13px] font-semibold">Trace</h3>
            <span className="font-mono text-[11px] text-white/50">
              {totals.steps} step{totals.steps === 1 ? '' : 's'}
              {totals.failedSteps > 0 && ` · ${totals.failedSteps} failed`}
            </span>
            <div className="flex-1" />
            <span className="font-mono text-[10px] text-white/35">
              run_steps where run_id = {runId}
            </span>
          </div>

          {rows.length === 0 ? (
            <div className="px-4 py-4" data-testid="run-trace-no-steps">
              <p className="text-white/70 text-xs leading-relaxed">{NO_STEPS_MESSAGE}</p>
              <p className="font-mono text-[10px] text-white/35 mt-2">
                A recorder appends steps with POST /api/run-steps.
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto">
                <div className="min-w-[520px]">
                  {rows.map(step => (
                    <div
                      key={step.id || `${step.run_id}-${step.step_no}`}
                      className="px-4 py-2.5 border-b border-white/5 last:border-b-0 flex gap-3 items-start"
                    >
                      <span className="font-mono text-[11px] text-white/40 min-w-[22px] pt-0.5">
                        {formatStepNo(step.step_no)}
                      </span>
                      <span
                        aria-hidden="true"
                        className={`w-[3px] rounded self-stretch min-h-[26px] ${step.ok ? 'bg-blue-400/70' : 'bg-red-400'}`}
                      />
                      <div className="flex-1 min-w-0 flex flex-col gap-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`font-mono text-[11.5px] ${step.ok ? TOOL_TONE : FAIL_TONE}`}>{step.tool}</span>
                          <span className="text-[12.5px] text-white/[0.78]">{step.what}</span>
                          {!step.ok && (
                            <span className="font-mono text-[10px] text-red-400 border border-red-500/25 bg-red-500/10 rounded px-1.5 py-px">
                              failed
                            </span>
                          )}
                        </div>
                        {/* Rendered ONLY when the column is non-null — never an empty detail line. */}
                        {step.detail && (
                          <div className="font-mono text-[10.5px] text-white/[0.48] leading-relaxed break-words">
                            {step.detail}
                          </div>
                        )}
                      </div>
                      <div className="flex gap-3 items-center shrink-0">
                        <span className="font-mono text-[10.5px] text-white/45 min-w-[52px] text-right">
                          {formatTokens(step.tokens)}
                        </span>
                        <span className="font-mono text-[10.5px] text-white/45 min-w-[52px] text-right">
                          {formatMs(step.duration_ms)}
                        </span>
                        {/* design/Run.dc.html: the dollar column appears only
                            when a run touches a paid provider. The condition is
                            lib/run-trace.ts's runTouchedPaidProvider — i.e. a
                            non-null run_steps.cost_usd — so a local run renders
                            no column at all rather than a row of $0.00. */}
                        {paid && (
                          <span className="font-mono text-[10.5px] text-white/45 min-w-[62px] text-right">
                            {formatUsd(step.cost_usd)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="px-4 py-2.5 bg-white/[0.03] border-t border-white/[0.08] flex gap-3 flex-wrap items-baseline">
                <span className="font-mono text-[10.5px] text-white/50">totals from the rows above:</span>
                <span className="font-mono text-[11px] text-white/75">{formatTokens(totals.tokens)} tokens</span>
                <span className="font-mono text-[11px] text-white/75">{formatMs(totals.durationMs)}</span>
                {paid && <span className={`font-mono text-[11px] ${OK_TONE}`}>{formatUsd(totals.costUsd)}</span>}
              </div>
            </>
          )}
        </section>

        {/* ── SIDE ──────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3">

          <Panel title="Cost by step">
            {breakdown.groups.length === 0 ? (
              <p className="text-white/60 text-xs leading-relaxed">
                {rows.length === 0
                  ? 'nothing to break down — no steps were recorded for this run.'
                  : `no step in this run recorded a token count (run_steps.tokens is null for all ${rows.length} step${rows.length === 1 ? '' : 's'}), so there is no breakdown to draw.`}
              </p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {breakdown.groups.map(group => (
                  <div key={group.tool} className="flex flex-col gap-1.5">
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-[11px] text-white/[0.62] flex-1 truncate">{group.tool}</span>
                      <span className="font-mono text-[11px] text-white/75">{formatTokens(group.tokens)}</span>
                      <span className="font-mono text-[11px] text-white/45 min-w-[34px] text-right">{group.pct}%</span>
                      {paid && (
                        <span className="font-mono text-[11px] text-white/45 min-w-[62px] text-right">
                          {formatUsd(group.costUsd)}
                        </span>
                      )}
                    </div>
                    <div className="h-1 rounded bg-white/[0.08]">
                      <div className="h-1 rounded bg-blue-400/80" style={{ width: `${group.pct}%` }} />
                    </div>
                  </div>
                ))}
                {breakdown.stepsWithoutTokens > 0 && (
                  <p className="font-mono text-[10px] text-white/35 leading-relaxed">
                    {breakdown.stepsWithoutTokens} step{breakdown.stepsWithoutTokens === 1 ? '' : 's'} recorded no token
                    count and {breakdown.stepsWithoutTokens === 1 ? 'is' : 'are'} excluded from the {formatTokens(breakdown.totalTokens)} total —
                    not counted as zero.
                  </p>
                )}
              </div>
            )}

            <p className="font-mono text-[10px] text-white/35 leading-relaxed mt-3">
              {paid
                ? `dollar figures are summed run_steps.cost_usd — ${formatUsd(breakdown.totalCostUsd)} across ${rows.length} step${rows.length === 1 ? '' : 's'}.`
                : 'no step recorded a dollar cost (run_steps.cost_usd is null for every step), so no dollar column is shown. The dollar column appears only when a run touches a paid provider.'}
            </p>
          </Panel>

          <Panel title="Ceilings on this run">
            {budget.error ? (
              <ApiErrorBanner error={budget.error} onRetry={budget.refetch} />
            ) : budget.loading || budget.data === null ? (
              <p className="text-white/60 text-xs">Loading ceilings for {agentId}…</p>
            ) : (
              <div className="flex flex-col gap-2">
                {ceilingRows({
                  startedAt,
                  completedAt,
                  stoppedReason,
                  budget: budget.data.budget,
                }).map(row => (
                  <div key={row.key} className="flex flex-col gap-0.5">
                    <div className="flex items-baseline gap-2">
                      <span className="text-[11.5px] text-white/[0.62] flex-1">{row.key}</span>
                      <span className={`font-mono text-[11px] ${CEILING_TONE[row.tone]}`}>{row.value}</span>
                    </div>
                    {row.note && <span className="font-mono text-[10px] text-white/30 leading-snug">{row.note}</span>}
                  </div>
                ))}
                <p className="font-mono text-[10px] text-white/35 leading-relaxed mt-1.5">
                  {ceilingSourceNote(budget.data.budget.source)} · GET /api/agents/{agentId}/budget
                </p>
              </div>
            )}
          </Panel>

          <p className="font-mono text-[10px] text-white/30 leading-relaxed px-1">
            design/Run.dc.html also shows a “What it learned” panel. No column records a per-run
            lesson or its promotion progress, so it is not drawn here rather than approximated.
          </p>
        </div>
      </div>
    </div>
  )
}

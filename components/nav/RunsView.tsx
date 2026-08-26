'use client'
// components/nav/RunsView.tsx — TOD-2381 (nav-six-destinations), extended by
// the runs-traces piece (Run Safety & Enforcement).
//
// "Runs does not exist yet. It is the one genuinely new destination. If the
// data behind it is not there, render an honest empty state that says what
// will appear and why it is empty — never a placeholder that implies data."
//
// This reads real rows straight from agent_runs (via the same same-origin db
// proxy app/page.tsx already uses for agent runs / issue counts).
//
// WHAT CHANGED, AND WHAT DID NOT
// ------------------------------
// This file used to say, correctly, that it does NOT render a per-step trace
// or a cost breakdown because "agent_runs has only tokens_used/cost_usd at the
// RUN level, not per step". That refusal was right, and it was NOT fixed by
// making the empty look nicer: migrations/060_run_steps.sql adds the missing
// table, POST /api/run-steps validates writes into it, and
// components/tabs/RunTraceCard.tsx draws the trace from those rows. A run with
// no run_steps rows still says so in words — see lib/run-trace.ts's
// NO_STEPS_MESSAGE — because an empty trace would imply the run did nothing.
//
// Still NOT rendered, for the original reason: design/Run.dc.html's "What it
// learned" panel and its "2 of 3 to skill" counter. No column records a
// per-run lesson or its promotion progress; the promotion threshold lives in a
// script. RunTraceCard names that absence on screen instead of approximating it.
//
// RUNS-NEED-URLS (Navigation & Deep Linking, 7/8)
// ----------------------------------------------
// An open run used to live in `useState`, and nowhere else. Measured
// 2026-08-26 before this piece: `GET /api/agent-runs/<uuid>` answered 405 with
// an empty body — a run had no address at all, while an issue has had one
// since the issue-permalink piece (`/p/<slug>/i/<key>`). You could not send
// anyone a run, and a reload lost whichever one you had open.
//
// The URL is now the ONLY source of truth for which run is open. There is no
// `openRunId` state left to disagree with the address bar: `runSegment` is
// read from `location.pathname` on mount and on every popstate (real or the
// synthetic one lib/run-permalink.ts dispatches), so clicking a row, using the
// back button, and pasting a link all go through the same one path.
//
// Two consequences worth stating because they are the point:
//   * every run row is a real `<a href>`, so middle-click, cmd-click and
//     "copy link address" work — the LangSmith/Linear property this channel
//     is measured against;
//   * a run OUTSIDE this list's `limit=100` window is still reachable, because
//     an open run that is not among the loaded rows is fetched by id from
//     GET /api/agent-runs/<id> and rendered above the table. Before, a
//     permalink to the 101st run would have rendered as "not found" with
//     nothing to distinguish it from a deleted one.
//
// INCOMPLETE UNTIL THE SEAM DIFF LANDS. app/page.tsx's mount-time
// `replaceState` canonicalises the URL to `buildPath(...)`, which for
// `/p/limiglow/runs/r/<id>` is `/p/limiglow/runs` — it erases the run id from
// the address bar milliseconds after load. This file cannot fix that;
// app/page.tsx is orchestrator-owned. The exact two-line diff is in
// docs/rebuild/pieces/pieces8/runs-need-urls.md §5. Until it is applied,
// clicking a run works and the back button works, but a full RELOAD of a run
// permalink does not survive. `grep -c 'run-permalink' app/page.tsx` -> 0,
// measured 2026-08-26; __tests__/nav/runs-permalink-seam.test.ts is RED for
// exactly as long as that stays 0.
//
// AND THIS FILE CANNOT WORK AROUND IT — checked 2026-08-26, not assumed. The
// tempting workaround is for this component to read the run segment on mount
// BEFORE the parent erases it, relying on child effects running before parent
// effects. That cannot happen here: app/page.tsx:921 gates every destination
// behind `!selectedProject`, so RunsView is not even mounted until
// /api/businesses and /api/projects have resolved — strictly after the
// mount-time replaceState at app/page.tsx:452 has already run. There is no
// effect ordering, no module-load capture and no re-assertion of the address
// bar from here that is not a race with a parent effect this file cannot see
// fire. The seam is the fix. Nothing else is.

import React, { useCallback, useEffect, useState } from 'react'
import { dbUrl, dbRestHeaders } from '@/lib/db/browser'
import { formatElapsedBetween } from '@/lib/time'
import { fetchJson } from '@/hooks/useApiData'
import { useProjectScope } from './ProjectScope'
import RunTraceCard from '@/components/tabs/RunTraceCard'
import {
  closeRunPermalink,
  navigateToRunPermalink,
  normalizeRunId,
  parseRunIdFromPath,
  rawRunSegment,
  runBackdropPath,
  runPermalinkPath,
} from '@/lib/run-permalink'

interface AgentRunRow {
  id: string
  agent_id: string
  task_id: string | null
  task_title: string | null
  status: string
  started_at: string
  completed_at: string | null
  tokens_used: number | null
  cost_usd: number | null
  /** Written only by lib/agent-budget.ts's stopRun — the one source of "a ceiling fired". */
  stopped_reason: string | null
  error: string | null
}

/**
 * one-clock (pieces6): the duration and the word that says which duration it
 * is.
 *
 * This column used to render a bare number from a local formatter, and the
 * SAME run could read "30s" here (started -> completed) and "14h 37m" on the
 * Fleet Office canvas (started -> now) with nothing on either screen saying
 * which measurement it was. Both numbers were correct; the reader could not
 * tell them apart. So the word ships with the number:
 *
 *   ran 30s        — the run finished, and this is how long it took
 *   running 14h 37m — the run has not finished, and this is how long so far
 *   —              — agent_runs.started_at is null, so nothing was measured
 *
 * The arithmetic is lib/time.ts's and nothing here duplicates it.
 */
function runDuration(startedAt: string, completedAt: string | null): { text: string; title: string } {
  const value = formatElapsedBetween(startedAt, completedAt)
  if (value === null) {
    return { text: '—', title: 'agent_runs.started_at is null — this run’s duration was never recorded' }
  }
  return completedAt
    ? { text: `ran ${value}`, title: 'agent_runs.started_at → completed_at' }
    : { text: `running ${value}`, title: 'agent_runs.started_at → now — this run has not completed' }
}

const STATUS_TONE: Record<string, string> = {
  running: 'text-blue-400 bg-blue-500/10 border-blue-500/25',
  completed: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
  done: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/25',
  error: 'text-red-400 bg-red-500/10 border-red-500/25',
  failed: 'text-red-400 bg-red-500/10 border-red-500/25',
  stopped: 'text-amber-400 bg-amber-500/10 border-amber-500/25',
}

/** What GET /api/agent-runs/<id> answers with. */
interface RunDetailResponse {
  run: AgentRunRow
  /** The run's own project, resolved through task_id -> issues.project. Null = no task. */
  project: string | null
  scope: string | null
  crossProject: boolean
}

export default function RunsView() {
  // scope-is-a-boundary: read from the one Context Provider instead of a
  // same-named prop — see components/nav/ProjectScope.tsx. Runs is
  // deliberately agent-wide (see file header), so the scope is used only for
  // the copy below, never as a query filter.
  const { project: projectName } = useProjectScope()
  const [rows, setRows] = useState<AgentRunRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // ── which run is open ──────────────────────────────────────────────────────
  // The URL, and only the URL. `runSegment` is the RAW segment after
  // `runs/r/`, not a parsed id, for the same reason lib/issue-permalink.ts
  // keeps `rawIssueSegment` (TOD-2467): a truncated or mistyped link has to
  // stay visibly a RUN REQUEST, or it renders as an ordinary list load and the
  // operator never learns their link was wrong.
  //
  // `null` on the very first render is deliberate and not a bug: this is a
  // 'use client' component inside an app that renders on the server first, so
  // reading `location` during render would be a hydration mismatch. The effect
  // below fills it in on mount, before paint.
  const [runSegment, setRunSegment] = useState<string | null>(null)
  const [detail, setDetail] = useState<RunDetailResponse | null>(null)
  const [detailError, setDetailError] = useState<string | null>(null)

  useEffect(() => {
    const read = () => setRunSegment(rawRunSegment(window.location.pathname))
    read()
    // Covers the browser's own back/forward AND the synthetic popstate
    // lib/run-permalink.ts dispatches — the same event app/page.tsx's router
    // already listens for, so this is not a second routing mechanism.
    window.addEventListener('popstate', read)
    return () => window.removeEventListener('popstate', read)
  }, [])

  const openRunId = runSegment === null ? null : normalizeRunId(runSegment)
  const rowForOpenRun = openRunId === null ? null : (rows ?? []).find(r => r.id === openRunId) ?? null

  /**
   * Toggle: open a run at its own URL, or go back to the list's URL.
   *
   * The comparison goes through `parseRunIdFromPath` — the NORMALISED id —
   * and not through `rawRunSegment`. That was a real defect, found by reading
   * rather than by running (this repo cannot render a component; see the file
   * header): with an upper-cased id in the address bar, `openRunId` normalises
   * and the row therefore renders OPEN with its link reading "Close this run",
   * while a raw comparison against the lower-cased `agent_runs.id` said "not
   * open" — so the first click re-pushed the permalink instead of closing it,
   * and the control did the opposite of what it said. What is open is decided
   * by exactly one rule, in one place, and this is that rule.
   */
  const toggleRun = useCallback((id: string) => {
    if (parseRunIdFromPath(window.location.pathname) === id) closeRunPermalink()
    else navigateToRunPermalink(id)
  }, [])

  /**
   * The href a row carries. An OPEN row links to the list (closing it is a
   * navigation too, so it gets a real URL as well); a closed row links to the
   * run's permalink. `runSegment` is in the dependency list because the
   * address bar is what these hrefs are derived from — when it changes, every
   * href on screen has to be recomputed, or an open row keeps advertising the
   * link that opened it.
   */
  const hrefFor = useCallback((id: string, isOpen: boolean) => {
    // Client-only in practice: `rows` is null until a browser fetch resolves,
    // so the table this feeds never renders on the server. The guard is here
    // so that stops being a thing anyone has to remember.
    const here = typeof window === 'undefined' ? '/' : window.location.pathname
    return isOpen ? runBackdropPath(here) : runPermalinkPath(here, id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runSegment])

  // A run that is open but NOT among the loaded rows — outside this list's
  // limit=100 window, or from another project — is fetched by id. Without
  // this, a permalink to the 101st run is indistinguishable from a deleted
  // one. The failure is kept and rendered, never coerced into an empty state
  // (scripts/no-silent-empty.mjs).
  useEffect(() => {
    if (openRunId === null || rows === null || rowForOpenRun !== null) {
      setDetail(null)
      setDetailError(null)
      return
    }
    let cancelled = false
    setDetail(null)
    setDetailError(null)
    fetchJson<RunDetailResponse>(`/api/agent-runs/${encodeURIComponent(openRunId)}`).then(r => {
      if (cancelled) return
      if (!r.ok) { setDetailError(`${r.error.status}: ${r.error.message}`); return }
      setDetail(r.data)
    })
    return () => { cancelled = true }
  }, [openRunId, rows, rowForOpenRun])

  useEffect(() => {
    let cancelled = false
    const url = dbUrl('agent_runs?select=id,agent_id,task_id,task_title,status,started_at,completed_at,tokens_used,cost_usd,stopped_reason,error&order=started_at.desc&limit=100')
    fetchJson<AgentRunRow[]>(url, { headers: dbRestHeaders() }).then(r => {
      if (cancelled) return
      if (!r.ok) { setError(`${r.error.status}: ${r.error.message}`); setRows(null); return }
      setError(null)
      setRows(Array.isArray(r.data) ? r.data : [])
    })
    return () => { cancelled = true }
  }, [])

  // ── the addressed run ──────────────────────────────────────────────────────
  // Rendered ABOVE the list branches below, deliberately: a permalink must
  // still say something when the list is empty, still loading, or failed. If
  // it were folded into the table it would disappear behind the empty state,
  // which is exactly the "looks like an ordinary page load" failure this piece
  // exists to remove.
  let addressed: React.ReactNode = null
  if (runSegment !== null && openRunId === null) {
    addressed = (
      <div className="border border-amber-500/25 bg-amber-500/[0.06] rounded-lg px-4 py-3 text-sm text-amber-200 space-y-1">
        <p className="font-medium">
          <code className="font-mono">{runSegment}</code> is not a run id.
        </p>
        <p className="text-amber-200/80 text-xs">
          A run permalink is <code className="font-mono">…/runs/r/&lt;agent_runs.id&gt;</code>. This link was
          truncated or mistyped — the run it names may still exist. The list below is unfiltered.
        </p>
      </div>
    )
  } else if (openRunId !== null && rows !== null && rowForOpenRun === null) {
    // `rows !== null` matters: while the list is still loading, EVERY run is
    // "not in the rows", and claiming so would be a sentence that is true for
    // a tenth of a second and wrong about why.
    addressed = (
      <div className="border border-white/10 rounded-lg px-4 py-3 space-y-2">
        <p className="text-white/75 text-xs font-mono">
          run {openRunId} · not among the {rows.length} most recent runs below, fetched by id
        </p>
        {detailError ? (
          <p className="text-red-300 text-sm">run unavailable — {detailError}</p>
        ) : detail === null ? (
          <p className="text-white/60 text-sm">Loading run…</p>
        ) : (
          <>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              <span className="text-white font-medium">{detail.run.agent_id}</span>
              <span className="text-white/70">{detail.run.task_title || '—'}</span>
              <span className={`text-xs font-mono border rounded px-1.5 py-0.5 ${STATUS_TONE[detail.run.status] ?? 'text-white/70 bg-white/5 border-white/10'}`}>
                {detail.run.status}
              </span>
              <span
                className="text-white/70 font-mono text-xs"
                title={runDuration(detail.run.started_at, detail.run.completed_at).title}
              >
                {runDuration(detail.run.started_at, detail.run.completed_at).text}
              </span>
              <span className="text-white/70 font-mono text-xs">{detail.run.tokens_used ?? '—'} tokens</span>
              <span className="text-white/70 font-mono text-xs">
                {detail.run.cost_usd != null ? `$${detail.run.cost_usd.toFixed(2)}` : '—'}
              </span>
              {/* The run's OWN project, resolved server-side through
                  task_id -> issues.project. Never the screen's scope, and
                  never rendered when the run has no task — see the route. */}
              <span className="text-white/60 font-mono text-xs" title="agent_runs.task_id → issues.project">
                {detail.project ?? 'no task — belongs to no project'}
              </span>
            </div>
            <RunTraceCard
              runId={detail.run.id}
              agentId={detail.run.agent_id}
              startedAt={detail.run.started_at}
              completedAt={detail.run.completed_at}
              stoppedReason={detail.run.stopped_reason}
            />
          </>
        )}
        <a
          href={runBackdropPath(typeof window === 'undefined' ? '/' : window.location.pathname)}
          onClick={e => { e.preventDefault(); closeRunPermalink() }}
          className="inline-block text-white/60 hover:text-white text-xs underline"
        >
          Close — back to the run list
        </a>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
        {addressed}
        <div className="border border-red-500/25 bg-red-500/[0.06] rounded-lg px-4 py-3 text-sm text-red-300">
          agent_runs unavailable — {error}
        </div>
      </div>
    )
  }

  if (rows === null) {
    return (
      <div className="space-y-4">
        {addressed}
        <div className="text-white/60 text-sm py-8 text-center">Loading runs…</div>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="space-y-4">
        {addressed}
        <div className="border border-dashed border-white/15 rounded-xl px-5 py-8 text-center space-y-2">
          <p className="text-white/70 text-sm font-medium">
            No runs recorded yet{projectName ? ` — ${projectName} has not had an agent dispatched to it` : ''}.
          </p>
          <p className="text-white/75 text-xs max-w-md mx-auto leading-relaxed">
            This will fill in the moment an agent is dispatched — every row comes straight from the
            <code className="mx-1 text-white/70 font-mono">agent_runs</code>
            table (agent, task, status, started/completed, tokens, cost), and opening a row shows its
            per-step trace from
            <code className="mx-1 text-white/70 font-mono">run_steps</code>.
            Nothing here is estimated.
            {projectName && ' Runs are agent-wide, not filtered by project — an agent works across every project it is assigned to.'}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {addressed}
      <p className="text-white/75 text-xs font-mono">
        {rows.length} run{rows.length === 1 ? '' : 's'} · every number below is recorded, never estimated · open a run for its per-step trace from run_steps
        {projectName && ' · shown across every project, not filtered to ' + projectName}
      </p>
      <div className="border border-white/10 rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 bg-white/[0.04] text-left text-white/75 text-xs">
              <th className="px-3 py-2 font-medium">Agent</th>
              <th className="px-3 py-2 font-medium">Task</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Duration</th>
              <th className="px-3 py-2 font-medium text-right">Tokens</th>
              <th className="px-3 py-2 font-medium text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const open = openRunId === r.id
              return (
                <React.Fragment key={r.id}>
                  {/* The whole row stays clickable, but a click that started
                      inside the anchor below is left to the anchor — otherwise
                      both fire and the run toggles twice, netting out as "the
                      click did nothing". */}
                  <tr
                    className={`border-b border-white/5 hover:bg-white/[0.03] cursor-pointer ${open ? 'bg-white/[0.04]' : ''}`}
                    onClick={e => {
                      if ((e.target as HTMLElement).closest('a')) return
                      toggleRun(r.id)
                    }}
                    aria-expanded={open}
                    aria-controls={`run-trace-${r.id}`}
                  >
                    <td className="px-3 py-2.5 text-white font-medium">
                      <span className="text-white/40 font-mono text-xs mr-1.5">{open ? '▾' : '▸'}</span>
                      {/* A REAL href, not a click handler wearing a link's
                          clothes: middle-click, cmd-click and "copy link
                          address" all have to work, which is the whole point
                          of this piece. It is also the row's keyboard
                          control — the <tr> no longer carries role="button"
                          and tabIndex, because two focusable things for one
                          action is worse than one. */}
                      <a
                        href={hrefFor(r.id, open)}
                        onClick={e => { e.preventDefault(); toggleRun(r.id) }}
                        className="hover:underline"
                        title={open ? 'Close this run' : 'Open this run — this link is its permalink'}
                      >
                        {r.agent_id}
                      </a>
                    </td>
                    <td className="px-3 py-2.5 text-white/70 max-w-[320px] truncate" title={r.error ?? undefined}>
                      {r.task_title || '—'}
                      {r.error && <span className="ml-2 text-red-400 text-xs">· {r.error.slice(0, 60)}</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-xs font-mono border rounded px-1.5 py-0.5 ${STATUS_TONE[r.status] ?? 'text-white/70 bg-white/5 border-white/10'}`}>
                        {r.status}
                      </span>
                      {r.stopped_reason && (
                        <span className="ml-1.5 text-[10px] font-mono text-amber-400" title="agent_runs.stopped_reason">
                          {r.stopped_reason}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-white/70 font-mono text-xs" title={runDuration(r.started_at, r.completed_at).title}>
                      {runDuration(r.started_at, r.completed_at).text}
                    </td>
                    <td className="px-3 py-2.5 text-right text-white/70 font-mono text-xs">{r.tokens_used ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right text-white/70 font-mono text-xs">{r.cost_usd != null ? `$${r.cost_usd.toFixed(2)}` : '—'}</td>
                  </tr>
                  {open && (
                    <tr className="border-b border-white/5 bg-black/20">
                      <td colSpan={6} className="px-3 pb-4" id={`run-trace-${r.id}`}>
                        <RunTraceCard
                          runId={r.id}
                          agentId={r.agent_id}
                          startedAt={r.started_at}
                          completedAt={r.completed_at}
                          stoppedReason={r.stopped_reason}
                        />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

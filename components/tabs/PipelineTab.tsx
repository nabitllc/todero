'use client'
// components/tabs/PipelineTab.tsx — pipeline-fidelity piece
//
// ─── what changed and why ────────────────────────────────────────────────────
//
// This board used to show SEVEN invented display stages — Backlog, Definition,
// Building, Testing, UX Review, PR Queue, Merged — none of which is a status.
// A card's column was decided by a 40-line `if`-chain in `lib/pipeline.ts` plus
// further conditions inside this render, so a card's position was a GUESS ABOUT
// its status rather than its status. Three consequences, all measured 2026-08-26:
//
//  * `UX Review` was unreachable. The only path into it was
//    `issue.test_status === "passed"`, and `test_status` is not a column on the
//    `issues` table (it has `tester_status`, `designer_status`,
//    `deployer_status`, `test_tier` — no `test_status`). `undefined === "passed"`
//    is false on every row that has ever existed.
//  * Six of the sixteen real statuses in `VALID_STATUSES` — `defined`,
//    `refined`, `underway`, `feature_review`, `draft`, `active` — fell through
//    the whole chain into the catch-all `return "Definition"`, landing beside
//    genuinely undefined work.
//  * Nothing could test any of it. Column membership was not a value.
//
// Columns now come from `lib/pipeline-stages.ts`, where the mapping is DATA:
// eight columns, each an explicitly named group of real statuses, covering all
// sixteen of `VALID_STATUSES` exactly once. `lib/__tests__/pipeline-stages.test.ts`
// enumerates that list and fails by name on any status no column claims, and on
// any status a column claims that the lifecycle does not define.
//
// ─── the second thing that changed: scope ────────────────────────────────────
//
// The old loader called `dbUrl('issues?status=…&select=*&limit=100')` — no
// `project=`, no `archived_at=`. Verified against the running server: that URL
// returns 200 with the CURRENT project's rows only because
// `app/api/db/[...path]/route.ts` injects the clauses from the referer, and
// returns 400 `unscoped_issues_read` when there is no referer at all. Borrowing
// scope from a seam is not the same as writing a scoped query, which is exactly
// why `lib/db/browser.ts` exports `issuesUrl(query, scope)` and why
// `scripts/no-unscoped-issues.mjs` exists. Every read here now goes through
// `issuesUrl`.

import React, { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import {
  PIPELINE_COLUMNS,
  PIPELINE_MODEL_DEFECTS,
  columnForStatus,
  type PipelineColumn,
} from '@/lib/pipeline-stages'
import {
  moveVerdict,
  moveBody,
  unmetFields,
  humaniseMoveFailure,
  humaniseLoadFailure,
  safeApiError,
  type MoveField,
  type MoveVerdict,
} from '@/lib/issue-moves'
import { sessionOperator } from '@/lib/operator-identity'
import { isBlocked, nextPRWindow } from '@/lib/pipeline'
import { Button } from '@/components/ui'
import { issuesUrl } from '@/lib/db/browser'
import { fetchJson, type ApiError } from '@/hooks/useApiData'
import RawApiErrorBanner from '@/components/ApiErrorBanner'
import { useAgentRoster, rosterEmptyReason, type RosterAgent } from '@/hooks/useAgentRoster'
import { issuePermalinkPath, navigateToIssuePermalink } from '@/lib/issue-permalink'

/**
 * A REAL anchor to an issue's permalink — issue-permalink piece, 2026-08-26.
 * This board had NO detail view at all before this (no `onClick` anywhere
 * near a `task_key`, confirmed: `grep -n "detailTask\|setDetail" PipelineTab
 * .tsx` returned nothing), so this is net-new reachability, not a
 * replacement of an existing handler. Same idiom as
 * `components/tabs/BoardTab.tsx`'s own `IssueKeyLink` and
 * `components/SearchOverlay.tsx`'s `openIssue`: a genuine `href` (native
 * Cmd-click/middle-click/"Copy Link Address"), and a plain left click
 * pushes the SPA route via `lib/issue-permalink.ts`'s
 * `navigateToIssuePermalink` instead of a full page load.
 */
function IssueKeyLink({ taskKey, className, style }: { taskKey: string; className?: string; style?: React.CSSProperties }) {
  const currentPath = typeof window !== 'undefined' ? window.location.pathname : ''
  return (
    <a
      href={issuePermalinkPath(currentPath, taskKey)}
      onClick={e => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
        e.preventDefault()
        e.stopPropagation()
        navigateToIssuePermalink(taskKey)
      }}
      className={className}
      style={style}
    >
      {taskKey}
    </a>
  )
}

/* ── the banner half of "no raw database text, ever" ─────────────────────────
 *
 * `safeApiError` used to be defined right here, and that was the defect. It is
 * a pure function, so the only test that could reach it inside a `.tsx` module
 * was one that greps this source for the identifier names reaching
 * `<ApiErrorBanner>`. On 2026-08-26 that guard was proven blind: gutting the
 * function to `return error` as its first statement left the suite at
 * 84 passed / 84 total while every banner below went back to rendering driver
 * text. It moved to `lib/issue-moves.ts`, where a test calls it directly.
 *
 * That fixed the FUNCTION and not its USE, and a fresh critic proved it the
 * same day with two one-line mutations that left this lane's suites at
 * 198 passed / 198 total:
 *
 *   `const human = humaniseMoveFailure(r.error.message, status, r.error.status)`
 *      → `const human = r.error.message`   — move sheet renders the raw CHECK
 *   `const safe  = safeApiError(r.error)`  → `const safe = r.error`
 *      → the Pipeline-health banner renders driver text
 *
 * Both survived because the guard was `expect(src).toMatch(/setErr\(safe\)/)`
 * — a whitelist of SOURCE SPELLINGS. Rebinding the variable satisfies the
 * spelling and reverses the behaviour, which is the same defect as a denylist
 * of message shapes, one file over.
 *
 * ── what replaced it, and why it cannot be satisfied by a rename ─────────────
 *
 * There is now no site in this file where a raw message can reach a screen,
 * because no site in this file HOLDS a humanised message. Both surfaces take
 * the RAW error and humanise inside a small exported component:
 *
 *   `ApiErrorBanner`      — a wrapper that SHADOWS the imported banner, so the
 *                           raw one (`RawApiErrorBanner`) is referenced exactly
 *                           once in the file and never by a call site
 *   `MoveFailureNotice`   — the only thing in this file that calls
 *                           `humaniseMoveFailure`; the move sheet's red bar
 *
 * `lib/__tests__/issue-moves.test.ts` RENDERS both of them with
 * `renderToStaticMarkup` — `react-dom/server` runs perfectly well under
 * `testEnvironment: "node"`, which is the thing the note here used to say was
 * impossible — feeds them a verbatim CHECK-constraint string, and asserts the
 * markup contains no driver text. That assertion reads the OUTPUT. Renaming a
 * variable does not move it; deleting the humaniser call inside either
 * component fails it immediately.
 *
 * The two source-shape guards that remain in that file are the closed kind, not
 * the whitelist kind: "`RawApiErrorBanner` appears exactly twice — the import
 * and the one use inside the wrapper" and "`humaniseMoveFailure(` appears
 * exactly once", so a NEW raw use is caught without anyone having to have
 * predicted its spelling.
 */

/** A refused move, exactly as the server described it. Raw on purpose. */
export type MoveFailure = {
  /** The server's own message. NEVER rendered — `MoveFailureNotice` humanises it. */
  readonly message: string
  /** The destination that was refused; disambiguates the anonymous sprint CHECKs. */
  readonly toStatus: string
  /** HTTP status, used only when the server said nothing at all. */
  readonly status?: number
}

/**
 * The move sheet's red bar. Takes the RAW failure and humanises it here.
 *
 * Exported for `lib/__tests__/issue-moves.test.ts`, which renders it. That is
 * the whole point: the caller cannot hand this component a pre-humanised string
 * because it does not accept one, so there is no call site left to mutate.
 */
export function MoveFailureNotice({ failure }: { failure: MoveFailure | null }) {
  if (!failure) return null
  return (
    <div role="alert" data-testid="move-failure" className="mx-3 mt-3 rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-[11px] text-red-300">
      {humaniseMoveFailure(failure.message, failure.toStatus, failure.status)}
    </div>
  )
}

/**
 * Every banner on this tab. Takes an `ApiError` and humanises it HERE, at the
 * render, whatever the caller already did to it.
 *
 * The NAME is the mechanism. `components/ApiErrorBanner.tsx` is imported as
 * `RawApiErrorBanner` and referenced exactly once — inside this function — so
 * within this module the identifier `ApiErrorBanner` no longer resolves to a
 * component that prints what it is handed. Every `<ApiErrorBanner …>` in this
 * file humanises, including one somebody adds next year without reading any of
 * this. A raw banner is not something a call site can reach by accident; it
 * takes deliberately spelling `RawApiErrorBanner`, which
 * `lib/__tests__/issue-moves.test.ts` permits exactly once, inside here.
 *
 * `safeApiError` keeps the status, the endpoint and the code — the half the
 * banner is right about — and replaces only the message. It is idempotent
 * (`isOwnSentence` in `lib/issue-moves.ts`), which is what lets the call sites
 * go on humanising too: belt AND braces, and neither can be removed without the
 * other still standing between the driver and the screen.
 */
export function ApiErrorBanner({ error, onRetry, className }: {
  error: ApiError
  onRetry?: () => void
  className?: string
}) {
  return <RawApiErrorBanner error={safeApiError(error)} onRetry={onRetry} className={className} />
}

/** Row caps, named once so the header can print the same numbers it enforces. */
const IN_FLIGHT_LIMIT = 400
const CLOSED_LIMIT = 100
/** How far back the Closed column reaches. Printed on that column's header. */
const CLOSED_WINDOW_HOURS = 24

const PRIORITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }

const TYPE_COLORS: Record<string, string> = {
  feature: '#3b82f6', bug: '#ef4444', task: '#71717a', ops: '#f59e0b', epic: '#a855f7', research: '#14b8a6',
}

type FilterMode = 'both' | 'features' | 'issues'

/** together = one board. agent = one lane per agent from GET /api/agents. */
type Lane = 'together' | 'agent'
const LANE_KEY = 'pipeline-swimlane'

/**
 * The holding column for a row whose status no column claims — a legacy row
 * carrying one of `RETIRED_STATUSES` ('in_review', 'done', 'blocked'), or a
 * status added to the database without being added to the model. It renders
 * ONLY when at least one such row exists, so it can never be an empty column
 * pretending to be a phase, and every card in it prints its raw status.
 *
 * Dropping those rows instead would be the worst failure this board can have:
 * a card that is nowhere, on the screen whose job is answering "where is it?".
 */
const UNRECOGNISED_ID = '__unrecognised__'

type Issue = Record<string, any>

export default function PipelineTab({ projectFilter }: { projectFilter?: string | null }) {
  const roster = useAgentRoster()

  // null means "not loaded / load failed" — never coerced to [] on a failure,
  // so neither the board nor any count can paint a confident zero over a 403.
  const [issues, setIssues] = useState<Issue[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)

  /** Exact project total from GET /api/issues (`total`), never a page length. */
  const [projectTotal, setProjectTotal] = useState<number | null>(null)
  const [capped, setCapped] = useState(false)

  const [filter, setFilter] = useState<FilterMode>('both')
  const [lane, setLane] = useState<Lane>('together')
  const [restored, setRestored] = useState(false)
  const [showIdle, setShowIdle] = useState(false)
  const [countdown, setCountdown] = useState('')

  const [actionSheetIssue, setActionSheetIssue] = useState<Issue | null>(null)
  const [moveError, setMoveError] = useState<MoveFailure | null>(null)
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Lane choice survives a reload, the same way BoardTab's swimlane does.
  //
  // `restored` is load-bearing, not defensive noise, and it is STATE rather
  // than a ref on purpose. Without it the save effect fires on mount holding
  // the DEFAULT value and overwrites the stored choice before the restore
  // effect's state update has re-rendered. Measured on the running app: the
  // lane read back as 'together' one reload after picking 'By agent'. A ref
  // does not fix it — the save effect would still run in that same commit.
  // Making it state puts the save effect behind a second render, so the first
  // thing ever written is the restored value, never the default.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(LANE_KEY)
      if (saved === 'agent' || saved === 'together') setLane(saved)
    } catch { /* private mode — the default is fine */ }
    setRestored(true)
  }, [])
  useEffect(() => {
    if (!restored) return
    try { localStorage.setItem(LANE_KEY, lane) } catch { /* ignore */ }
  }, [lane, restored])

  const handleLongPressStart = useCallback((issue: Issue) => {
    longPressTimer.current = setTimeout(() => {
      setMoveError(null)
      setActionSheetIssue(issue)
      if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(50)
    }, 500)
  }, [])

  // The move sheet used to be reachable ONLY by a 500ms touch long-press, so on
  // a desktop — the machine an operator actually watches this board from — a
  // card could not be moved at all. Long-press stays for phones; this is the
  // pointer/keyboard route to the same sheet.
  const openMove = useCallback((issue: Issue) => {
    setMoveError(null)
    setActionSheetIssue(issue)
  }, [])

  const handleLongPressEnd = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }, [])

  // ── the two queries, printed on screen exactly as they are sent ────────────
  const since = useMemo(
    () => new Date(Date.now() - CLOSED_WINDOW_HOURS * 60 * 60 * 1000).toISOString(),
    // Recomputed only when the loader re-runs; a per-render value would make
    // the URL — and therefore the printed query — change on every keystroke.
    [projectFilter], // eslint-disable-line react-hooks/exhaustive-deps
  )
  const inFlightQuery = `status=not.in.(closed)&select=*&limit=${IN_FLIGHT_LIMIT}`
  const closedQuery = `status=eq.closed&updated_at=gte.${since}&select=*&limit=${CLOSED_LIMIT}`
  const totalEndpoint = projectFilter
    ? `/api/issues?project=${encodeURIComponent(projectFilter)}&limit=1`
    : null

  const fetchIssues = useCallback(async () => {
    // issuesUrl() THROWS on an empty scope by design, so a component with no
    // project must not call it. There is no unscoped fallback: an unscoped
    // read is the defect, not a degraded mode.
    if (!projectFilter) { setIssues(null); setLoading(false); return }
    setLoading(true)
    const scope = { project: projectFilter }
    const [inFlight, closed, totalRes] = await Promise.all([
      fetchJson<Issue[]>(issuesUrl(inFlightQuery, scope)),
      fetchJson<Issue[]>(issuesUrl(closedQuery, scope)),
      // ?limit=1 and read `total` — ?limit=0 means EVERY ROW on this API, so
      // asking it for a count would fetch the whole table to render one number.
      fetchJson<{ total?: number }>(totalEndpoint!),
    ])
    // Never `Array.isArray(x) ? x : []` on a failed leg. A non-ok response
    // leaves `issues` null so the board cannot render an empty state over a
    // permission error or a 500.
    if (!inFlight.ok) { setError(inFlight.error); setIssues(null); setLoading(false); return }
    if (!closed.ok) { setError(closed.error); setIssues(null); setLoading(false); return }

    const a = Array.isArray(inFlight.data) ? inFlight.data : []
    const b = Array.isArray(closed.data) ? closed.data : []
    setCapped(a.length >= IN_FLIGHT_LIMIT || b.length >= CLOSED_LIMIT)
    setIssues([...a, ...b])
    // The total is a separate claim with a separate failure: losing it must not
    // blank the board, so it degrades to "unknown" rather than to a number.
    setProjectTotal(totalRes.ok && typeof totalRes.data?.total === 'number' ? totalRes.data.total : null)
    setError(null)
    setLoading(false)
  }, [projectFilter, inFlightQuery, closedQuery, totalEndpoint])

  useEffect(() => { fetchIssues() }, [fetchIssues])

  useEffect(() => {
    function tick() {
      const next = nextPRWindow()
      const diff = next.getTime() - Date.now()
      const h = Math.floor(diff / (1000 * 60 * 60))
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
      setCountdown(`${h}h ${m}m`)
    }
    tick()
    const iv = setInterval(tick, 60000)
    return () => clearInterval(iv)
  }, [])

  /**
   * A scoped query cannot return a foreign row. If one ever appears, SAY SO —
   * silently filtering it out would hide a live scope leak behind a board that
   * still looks correct, which is the failure mode `scripts/no-unscoped-issues.mjs`
   * was rewritten twice to catch.
   */
  const foreignRows = useMemo(
    () => (issues ?? []).filter(i => projectFilter && i.project && i.project !== projectFilter),
    [issues, projectFilter],
  )

  const childrenMap = useMemo(() => {
    const map: Record<string, Issue[]> = {}
    for (const issue of issues ?? []) {
      if (issue.parent_id) (map[issue.parent_id] ??= []).push(issue)
    }
    return map
  }, [issues])

  const visible = useMemo(() => {
    const rows = issues ?? []
    if (filter === 'features') return rows.filter(i => i.type === 'feature')
    if (filter === 'issues') return rows.filter(i => i.type !== 'feature')
    return rows
  }, [issues, filter])

  /** Every column that will be drawn: the eight real ones, plus the holding
   *  column only when a row actually needs it. */
  const columns = useMemo<PipelineColumn[]>(() => {
    const hasUnrecognised = visible.some(i => columnForStatus(i.status) === null)
    if (!hasUnrecognised) return [...PIPELINE_COLUMNS]
    return [
      ...PIPELINE_COLUMNS,
      {
        id: UNRECOGNISED_ID,
        label: 'Unrecognised status',
        meaning:
          'These rows carry a status no column claims — a retired status, or one added to the ' +
          'database but not to lib/pipeline-stages.ts. Shown here rather than dropped.',
        statuses: [],
        category: 'Planned',
        hex: '#ef4444',
      } as PipelineColumn,
    ]
  }, [visible])

  const sortByPriority = (a: Issue, b: Issue) =>
    (PRIORITY_ORDER[a.priority] ?? 3) - (PRIORITY_ORDER[b.priority] ?? 3)

  /** Bucket a set of rows by column id. Pure; used by the board and by each lane. */
  const bucket = useCallback((rows: Issue[]) => {
    const out: Record<string, Issue[]> = {}
    for (const col of PIPELINE_COLUMNS) out[col.id] = []
    out[UNRECOGNISED_ID] = []
    for (const row of rows) {
      const col = columnForStatus(row.status)
      out[col ? col.id : UNRECOGNISED_ID].push(row)
    }
    for (const key of Object.keys(out)) out[key].sort(sortByPriority)
    return out
  }, [])

  const boardBuckets = useMemo(() => bucket(visible), [bucket, visible])

  const wip = boardBuckets.in_progress?.length ?? 0

  // ── agent lanes ───────────────────────────────────────────────────────────
  //
  // The roster comes from GET /api/agents via useAgentRoster(). No agent id is
  // written in this file: the four-entry array that used to live here is the
  // exact fabrication class this rebuild has removed elsewhere.
  //
  // An agent with no work in flight must stay distinguishable from an agent
  // that does not exist, so EVERY rostered agent gets a lane even at zero rows
  // — idle ones collapse to a single line that names them. An assignee that is
  // NOT on the roster also gets a lane, badged, because work assigned to an
  // agent the host does not declare is something an operator needs to see.
  const lanes = useMemo(() => {
    type LaneRow = {
      key: string
      label: string
      sub: string
      emoji: string
      rows: Issue[]
      kind: 'agent' | 'unassigned' | 'off-roster'
    }
    const byAssignee = new Map<string, Issue[]>()
    const unassigned: Issue[] = []
    for (const row of visible) {
      const a = typeof row.assignee === 'string' ? row.assignee.trim() : ''
      if (!a) { unassigned.push(row); continue }
      const list = byAssignee.get(a)
      if (list) list.push(row)
      else byAssignee.set(a, [row])
    }

    const rostered: LaneRow[] = roster.agents.map((agent: RosterAgent) => ({
      key: `agent:${agent.id}`,
      label: agent.name || agent.id,
      sub: agent.id,
      emoji: agent.emoji || '•',
      rows: byAssignee.get(agent.id) ?? [],
      kind: 'agent' as const,
    }))
    const rosterIds = new Set(roster.agents.map(a => a.id))
    const offRoster: LaneRow[] = [...byAssignee.entries()]
      .filter(([id]) => !rosterIds.has(id))
      .map(([id, rows]) => ({
        key: `off:${id}`,
        label: id,
        sub: 'not on the roster',
        emoji: '❓',
        rows,
        kind: 'off-roster' as const,
      }))
    const unassignedLane: LaneRow[] = unassigned.length
      ? [{ key: 'unassigned', label: 'Unassigned', sub: 'no assignee set', emoji: '—', rows: unassigned, kind: 'unassigned' as const }]
      : []

    const all = [...offRoster, ...rostered, ...unassignedLane]
    const active = all.filter(l => l.rows.length > 0).sort((x, y) => y.rows.length - x.rows.length || x.label.localeCompare(y.label))
    const idle = all.filter(l => l.rows.length === 0).sort((x, y) => x.label.localeCompare(y.label))
    return { active, idle, total: all.length }
  }, [visible, roster.agents])

  // Both banners get the humanised copy HERE as well as inside
  // `ApiErrorBanner`. The duplication is deliberate and is why `safeApiError`
  // is idempotent: a mutation reverting either half leaves the other standing,
  // so the screen stays honest while the test that names the reverted half goes
  // red. The original goes to the console once, from an effect, so nothing is
  // lost and nothing is logged during render.
  const shownError = useMemo(() => (error ? safeApiError(error) : null), [error])
  const shownRosterError = useMemo(() => (roster.error ? safeApiError(roster.error) : null), [roster.error])
  useEffect(() => {
    for (const e of [error, roster.error]) {
      if (e && humaniseLoadFailure(e.message) !== e.message) {
        console.warn('[pipeline] load failed, raw server message:', e.message)
      }
    }
  }, [error, roster.error])

  const modelBroken = PIPELINE_MODEL_DEFECTS.length > 0

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="flex items-center gap-2 text-white/40 text-sm">
          <span className="animate-spin h-4 w-4 border-2 border-white/20 border-t-white/60 rounded-full" />
          Loading pipeline…
        </div>
      </div>
    )
  }

  if (!projectFilter) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#080808] px-4 py-6 text-sm text-white/50">
        No project is scoped, so the pipeline has nothing to ask for. Issues are never read
        without a project — pick one in the left rail.
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* The model itself is broken → say so INSTEAD of drawing a board. A board
          that is silently dropping cards is worse than no board. */}
      {modelBroken && (
        <div role="alert" className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <p className="font-semibold mb-1">The pipeline column model is incomplete — the board is not drawn.</p>
          <ul className="list-disc pl-5 space-y-0.5 text-[12px]">
            {PIPELINE_MODEL_DEFECTS.map(d => <li key={d}>{d}</li>)}
          </ul>
        </div>
      )}

      {/* A failed request REPLACES the body. No empty state over an error. */}
      {shownError && <ApiErrorBanner error={shownError} onRetry={fetchIssues} />}

      {!modelBroken && !error && issues !== null && (
        <>
          {/* ── header: the counts, and where each one comes from ── */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-baseline gap-3 min-w-0">
              <span className="text-lg font-semibold text-white">Pipeline</span>
              <span className="text-white/40 text-xs truncate">
                {visible.length} card{visible.length === 1 ? '' : 's'} on the board
                {projectTotal !== null
                  ? ` · ${projectFilter} has ${projectTotal} issue${projectTotal === 1 ? '' : 's'}`
                  : ` · ${projectFilter} total unavailable`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1 rounded-lg border border-white/10 p-0.5 bg-[#0f0f0f]">
                {(['together', 'agent'] as Lane[]).map(mode => (
                  <Button
                    key={mode}
                    variant={lane === mode ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setLane(mode)}
                    className="text-[10px]"
                    title="Swimlane: how the pipeline groups rows"
                  >
                    {mode === 'together' ? 'Together' : 'By agent'}
                  </Button>
                ))}
              </div>
              <div className="flex items-center gap-1 rounded-lg border border-white/10 p-0.5 bg-[#0f0f0f]">
                {(['both', 'features', 'issues'] as FilterMode[]).map(mode => (
                  <Button
                    key={mode}
                    variant={filter === mode ? 'secondary' : 'ghost'}
                    size="sm"
                    onClick={() => setFilter(mode)}
                    className="text-[10px] capitalize"
                  >
                    {mode === 'both' ? 'Both' : mode === 'features' ? 'Features' : 'Issues'}
                  </Button>
                ))}
              </div>
            </div>
          </div>

          {/* Every number above traces to one of these. Printed verbatim so an
              operator can re-run them and get the same answer. */}
          <details className="rounded-xl border border-white/10 bg-[#080808] px-3 py-2">
            <summary className="cursor-pointer text-[10px] uppercase tracking-wide text-white/40">
              Where these numbers come from
            </summary>
            <ul className="mt-2 space-y-1 text-[11px] text-white/40 font-mono break-all">
              <li>GET {issuesUrl(inFlightQuery, { project: projectFilter })}</li>
              <li>GET {issuesUrl(closedQuery, { project: projectFilter })}</li>
              <li>GET {totalEndpoint} → <span className="text-white/60">total</span></li>
            </ul>
            <p className="mt-2 text-[11px] text-white/30">
              Columns 1–7 hold every live row in {projectFilter} that is not closed. The Closed
              column reaches back {CLOSED_WINDOW_HOURS}h only. Caps: {IN_FLIGHT_LIMIT} in flight,{' '}
              {CLOSED_LIMIT} closed.{capped && ' A page came back full — there may be more.'}
            </p>
          </details>

          {foreignRows.length > 0 && (
            <div role="alert" className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-[12px] text-amber-300">
              Scope leak: {foreignRows.length} row(s) came back for a project other than {projectFilter} —{' '}
              {[...new Set(foreignRows.map(r => String(r.project)))].join(', ')}. They are shown, not hidden.
            </div>
          )}

          <PipelineMetrics />

          {lane === 'together' ? (
            <Board
              columns={columns}
              buckets={boardBuckets}
              allIssues={issues}
              childrenMap={childrenMap}
              wip={wip}
              countdown={countdown}
              filter={filter}
              onLongPressStart={handleLongPressStart}
              onLongPressEnd={handleLongPressEnd}
              onOpenMove={openMove}
              emptyLine={`${projectFilter} has no issues in this stage yet — that is correct, not broken.`}
            />
          ) : shownRosterError ? (
            // The roster failed → the lane region is REPLACED by the reason.
            // Falling back to "no agents" would invent an empty fleet.
            <ApiErrorBanner error={shownRosterError} onRetry={roster.refetch} />
          ) : roster.agents.length === 0 ? (
            <div className="rounded-xl border border-white/10 bg-[#080808] px-4 py-6 text-sm text-white/50">
              {rosterEmptyReason(roster)}
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-[11px] text-white/35">
                {lanes.total} lane{lanes.total === 1 ? '' : 's'} — {roster.agents.length} from{' '}
                <span className="font-mono">GET /api/agents</span>
                {lanes.active.length > 0 && `, ${lanes.active.length} with work in flight`}.
              </p>

              {lanes.active.length === 0 && (
                <div className="rounded-xl border border-white/10 bg-[#080808] px-4 py-6 text-sm text-white/50">
                  No agent in {projectFilter} has work in flight. All {roster.agents.length} rostered
                  agents are listed below — an idle agent and a non-existent one are not the same thing.
                </div>
              )}

              {lanes.active.map(l => {
                const laneBuckets = bucket(l.rows)
                return (
                <div key={l.key} className="rounded-xl border border-white/10 bg-[#050505]">
                  <div className="flex items-center gap-2 px-3 py-2 border-b border-white/5">
                    <span className="text-sm">{l.emoji}</span>
                    <span className="text-xs font-semibold text-white">{l.label}</span>
                    <span className={`text-[9px] px-1.5 py-0.5 rounded ${
                      l.kind === 'off-roster' ? 'bg-red-500/20 text-red-300' : 'bg-white/5 text-white/35'
                    }`}>{l.sub}</span>
                    <span className="ml-auto text-[10px] text-white/40">{l.rows.length} in flight</span>
                  </div>
                  <div className="p-2">
                    <Board
                      columns={columns}
                      buckets={laneBuckets}
                      allIssues={issues}
                      childrenMap={childrenMap}
                      wip={laneBuckets.in_progress.length}
                      countdown={countdown}
                      filter={filter}
                      compact
                      onLongPressStart={handleLongPressStart}
                      onLongPressEnd={handleLongPressEnd}
                      onOpenMove={openMove}
                      emptyLine="—"
                    />
                  </div>
                </div>
                )
              })}

              {lanes.idle.length > 0 && (
                <details
                  open={showIdle}
                  onToggle={e => setShowIdle((e.currentTarget as HTMLDetailsElement).open)}
                  className="rounded-xl border border-white/10 bg-[#080808] px-3 py-2"
                >
                  <summary className="cursor-pointer text-[11px] text-white/40">
                    {lanes.idle.length} agent{lanes.idle.length === 1 ? '' : 's'} on the roster with no
                    work in flight — each still has a lane
                  </summary>
                  <ul className="mt-2 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1">
                    {lanes.idle.map(l => (
                      <li
                        key={l.key}
                        data-agent-lane={l.sub}
                        className="flex items-center gap-2 rounded-lg border border-white/5 px-2 py-1.5 text-[11px] text-white/45"
                      >
                        <span className="text-sm">{l.emoji}</span>
                        <span className="text-white/70">{l.label}</span>
                        <span className="ml-auto text-white/25">no work in flight</span>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
        </>
      )}

      {actionSheetIssue && (
        <MoveSheet
          issue={actionSheetIssue}
          error={moveError}
          onClose={() => { setActionSheetIssue(null); setMoveError(null) }}
          onMove={async (status, values) => {
            const target = actionSheetIssue
            setMoveError(null)
            // Optimistic, but never left standing over a refusal: the MC API
            // enforces the lifecycle gates, and a rejected move rolls back and
            // shows a sentence a person wrote.
            const before = target.status
            setIssues(prev => prev ? prev.map(i => i.id === target.id ? { ...i, status } : i) : prev)
            // The MC API — the route that validates against VALID_STATUSES and
            // runs the transition rules. The old code PATCHed the db proxy
            // directly, bypassing all of it.
            //
            // The body now carries whatever this particular move requires, built
            // by `moveBody()` from the same predicate that decided to offer the
            // move at all. It is still the SERVER that enforces every one of
            // those requirements: a PATCH sent past this component is refused by
            // exactly the same rules, which is why the failure branch below is
            // not dead code and must never be removed.
            const r = await fetchJson<Issue>('/api/issues', {
              method: 'PATCH',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(moveBody(target, status, values)),
            })
            if (!r.ok) {
              setIssues(prev => prev ? prev.map(i => i.id === target.id ? { ...i, status: before } : i) : prev)
              // The RAW failure goes into state and `MoveFailureNotice` does the
              // humanising at render. This branch deliberately holds no
              // humanised string: there is nothing here to rebind to
              // `r.error.message`, which is the one-line mutation that used to
              // put a raw CHECK constraint back on this sheet with every test
              // still green.
              //
              // The raw message is logged unconditionally rather than only when
              // it was replaced. The old comparison needed a second call to the
              // humaniser just to decide whether to log, and one extra line in
              // the console on a refused move costs nothing next to a branch
              // that can be flipped.
              console.warn('[pipeline] move refused, raw server message:', r.error.message)
              setMoveError({ message: r.error.message, toStatus: status, status: r.error.status })
              return
            }
            setActionSheetIssue(null)
            fetchIssues()
          }}
        />
      )}
    </div>
  )
}

/* ── The board: N columns, one bucket each ── */
function Board({
  columns, buckets, allIssues, childrenMap, wip, countdown, filter, compact, emptyLine,
  onLongPressStart, onLongPressEnd, onOpenMove,
}: {
  columns: PipelineColumn[]
  buckets: Record<string, Issue[]>
  allIssues: Issue[]
  childrenMap: Record<string, Issue[]>
  wip: number
  countdown: string
  filter: FilterMode
  compact?: boolean
  emptyLine: string
  onLongPressStart: (i: Issue) => void
  onLongPressEnd: () => void
  onOpenMove: (i: Issue) => void
}) {
  const width = compact ? 200 : 240
  return (
    <div className="overflow-x-auto pb-2 -mx-1">
      <div className="flex gap-3 px-1" style={{ minWidth: columns.length * (width + 16) }}>
        {columns.map(col => {
          const rows = buckets[col.id] ?? []
          return (
            <div
              key={col.id}
              data-column={col.id}
              className="flex-shrink-0 rounded-xl border border-white/10 flex flex-col"
              style={{ width, background: '#080808', borderTop: `2px solid ${col.hex}` }}
            >
              <div className="px-3 py-2 border-b border-white/5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-semibold text-white truncate" title={col.meaning}>{col.label}</span>
                    <span
                      data-column-count={col.id}
                      className="text-[10px] px-1.5 py-0.5 rounded-full font-medium"
                      style={{ background: `${col.hex}20`, color: col.hex }}
                    >
                      {rows.length}
                    </span>
                  </div>
                  {col.id === 'in_progress' && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      wip >= 3 ? 'bg-red-500/20 text-red-400' : 'bg-white/5 text-white/40'
                    }`}>{wip}/3 WIP</span>
                  )}
                  {col.id === 'approved' && (
                    <span className="text-[10px] text-white/40" title="Next PR window">{countdown}</span>
                  )}
                </div>
                {/* The column says which statuses it holds, so its name can
                    never quietly drift from what is in it. */}
                <div className="mt-1 text-[9px] text-white/25 font-mono truncate" title={col.meaning}>
                  {col.id === UNRECOGNISED_ID
                    ? 'no column claims these'
                    : col.statuses.join(' · ')}
                  {col.id === 'closed' && ` · last ${CLOSED_WINDOW_HOURS}h`}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1.5" style={{ maxHeight: compact ? 300 : 520 }}>
                {rows
                  .filter(r => filter === 'both' || (filter === 'features' ? r.type === 'feature' : r.type !== 'feature'))
                  .map(row =>
                    row.type === 'feature' ? (
                      <FeatureCard
                        key={row.id}
                        feature={row}
                        childRows={childrenMap[row.id] ?? []}
                        onLongPressStart={() => onLongPressStart(row)}
                        onLongPressEnd={onLongPressEnd}
                        onOpenMove={() => onOpenMove(row)}
                      />
                    ) : (
                      <IssueCard
                        key={row.id}
                        issue={row}
                        parent={row.parent_id ? allIssues.find(x => x.id === row.parent_id) ?? null : null}
                        onLongPressStart={() => onLongPressStart(row)}
                        onLongPressEnd={onLongPressEnd}
                        onOpenMove={() => onOpenMove(row)}
                      />
                    ),
                  )}
                {rows.length === 0 && (
                  <p className="py-4 text-center text-[11px] text-white/25">{emptyLine}</p>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/* ── Aggregate pipeline health strip (TOD-2299) ── */
type Metrics = {
  window: '7d' | '30d'
  prs_merged: number
  merge_conflicts: number
  build_failures: number
  review_rejections: number
  avg_cycle_time_hours: number | null
  cycle_sample_size: number
  generated_at: string
}
function PipelineMetrics() {
  const [win, setWin] = useState<'7d' | '30d'>('7d')
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [err, setErr] = useState<ApiError | null>(null)
  const [busy, setBusy] = useState(true)
  const endpoint = `/api/pipeline-metrics?window=${win}`
  const load = useCallback(() => {
    let cancelled = false
    setBusy(true)
    fetchJson<Metrics>(endpoint).then(r => {
      if (cancelled) return
      // A failed load must not leave the strip on "loading…" forever — that
      // reads as a live metric that is merely slow, not a refused request.
      if (r.ok) {
        setMetrics(r.data); setErr(null)
      } else {
        setMetrics(null)
        // Same rule as the board's own banner: the status and the endpoint stay,
        // driver text does not. Logged here rather than in render because this
        // is already the imperative path.
        const safe = safeApiError(r.error)
        if (safe.message !== r.error.message) {
          console.warn('[pipeline-metrics] load failed, raw server message:', r.error.message)
        }
        setErr(safe)
      }
      setBusy(false)
    })
    return () => { cancelled = true }
  }, [endpoint])
  useEffect(() => load(), [load])

  return (
    <div className="rounded-xl border border-white/10 bg-[#080808] px-3 py-2">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] uppercase tracking-wide text-white/40">Pipeline health · last {win}</span>
        <div className="flex items-center gap-1 rounded-md border border-white/10 p-0.5 bg-[#0f0f0f]">
          {(['7d', '30d'] as const).map(w => (
            <button
              key={w}
              onClick={() => setWin(w)}
              className={`px-1.5 py-0.5 text-[10px] rounded ${win === w ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'}`}
            >{w}</button>
          ))}
        </div>
      </div>
      {err ? (
        <ApiErrorBanner error={err} onRetry={load} className="text-[11px]" />
      ) : metrics ? (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-[11px]">
          {[
            { label: 'PRs merged', value: metrics.prs_merged, color: '#10b981' },
            { label: 'Conflicts', value: metrics.merge_conflicts, color: metrics.merge_conflicts > 0 ? '#f59e0b' : '#52525b' },
            { label: 'Build fails', value: metrics.build_failures, color: metrics.build_failures > 0 ? '#ef4444' : '#52525b' },
            { label: 'Rejections', value: metrics.review_rejections, color: metrics.review_rejections > 0 ? '#a855f7' : '#52525b' },
            { label: 'Avg cycle', value: metrics.avg_cycle_time_hours != null ? `${metrics.avg_cycle_time_hours}h` : '—', color: '#3b82f6' },
            { label: 'Sample', value: metrics.cycle_sample_size, color: '#71717a' },
          ].map(m => (
            <div key={m.label} className="flex flex-col">
              <span className="text-white/40 text-[10px]">{m.label}</span>
              <span className="font-semibold" style={{ color: m.color }}>{m.value}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-white/30 text-[11px]">{busy ? 'loading…' : 'no data'}</div>
      )}
    </div>
  )
}

/** The status, spelled out, on every card. Column position and status can then
 *  never silently disagree — you can read both at once. */
function StatusText({ status }: { status: unknown }) {
  const s = typeof status === 'string' && status ? status : '(no status)'
  const known = columnForStatus(s) !== null
  return (
    <span
      data-status={s}
      className={`text-[8px] px-1 py-0.5 rounded font-mono ${
        known ? 'bg-white/5 text-white/45' : 'bg-red-500/20 text-red-300'
      }`}
      title={known ? `status = ${s}` : `status "${s}" is claimed by no column`}
    >
      {s}
    </span>
  )
}

/** Opens the move sheet with a pointer or the keyboard. */
function MoveButton({ taskKey, onOpenMove }: { taskKey: string; onOpenMove: () => void }) {
  return (
    <button
      type="button"
      data-move-button={taskKey}
      aria-label={`Move ${taskKey} to another status`}
      title={`Move ${taskKey} to another status`}
      onClick={e => { e.stopPropagation(); onOpenMove() }}
      className="ml-auto shrink-0 px-1 rounded text-[11px] leading-none text-white/25 hover:text-white/70 hover:bg-white/10"
    >
      ⋯
    </button>
  )
}

/* ── Feature Card ── */
function FeatureCard({ feature, childRows, onLongPressStart, onLongPressEnd, onOpenMove }: {
  feature: Issue; childRows: Issue[]; onLongPressStart: () => void; onLongPressEnd: () => void; onOpenMove: () => void
}) {
  // "Done" is derived from the column model, not from a second hardcoded list
  // of statuses that can drift away from it.
  const doneCount = childRows.filter(c => {
    const id = columnForStatus(c.status)?.id
    return id === 'signed_off' || id === 'closed'
  }).length
  const total = childRows.length
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0
  const blocked = isBlocked(feature)

  return (
    <div
      className={`rounded-lg border p-2 transition-all hover:border-white/20 select-none ${
        blocked ? 'border-red-500/60 ring-1 ring-red-500/30' : 'border-white/10'
      }`}
      style={{ background: '#0f0f0f' }}
      onTouchStart={onLongPressStart}
      onTouchEnd={onLongPressEnd}
      onTouchCancel={onLongPressEnd}
      onContextMenu={e => e.preventDefault()}
    >
      <div className="flex items-center gap-1.5 mb-1 flex-wrap">
        <IssueKeyLink taskKey={feature.task_key} className="text-[9px] px-1.5 py-0.5 rounded font-medium bg-blue-500/20 text-blue-400 hover:bg-blue-500/30" />
        <StatusText status={feature.status} />
        <MoveButton taskKey={feature.task_key} onOpenMove={onOpenMove} />
      </div>
      <div className="text-[11px] text-white/60 leading-tight mb-2 line-clamp-2">{feature.title}</div>
      {total > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1 rounded-full bg-white/5 overflow-hidden">
            <div className={`h-full rounded-full ${pct === 100 ? 'bg-green-400' : 'bg-blue-400'}`} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[9px] text-white/40">{doneCount}/{total}</span>
        </div>
      )}
    </div>
  )
}

/* ── Issue Card ── */
const REVIEW_CLASSES: Record<string, string> = {
  passed: 'bg-green-500/20 text-green-400',
  failed: 'bg-red-500/20 text-red-400',
  pending: 'bg-white/5 text-white/40',
}
function IssueCard({ issue, parent, onLongPressStart, onLongPressEnd, onOpenMove }: {
  issue: Issue; parent: Issue | null; onLongPressStart: () => void; onLongPressEnd: () => void; onOpenMove: () => void
}) {
  const blocked = isBlocked(issue)
  const typeColor = TYPE_COLORS[issue.type] || '#71717a'
  // Real columns only. The old card read `issue.test_status`, which is not a
  // column on the issues table, so its Passed/Failed badge never rendered once.
  const inReview = columnForStatus(issue.status)?.id === 'in_review'

  return (
    <div
      className={`rounded-lg border p-2 transition-all hover:border-white/20 select-none ${
        blocked ? 'border-red-500/60 ring-1 ring-red-500/30' : 'border-white/10'
      }`}
      style={{ background: '#0f0f0f' }}
      onTouchStart={onLongPressStart}
      onTouchEnd={onLongPressEnd}
      onTouchCancel={onLongPressEnd}
      onContextMenu={e => e.preventDefault()}
    >
      <div className="flex items-center justify-between gap-1 mb-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <IssueKeyLink
            taskKey={issue.task_key}
            className="text-[9px] px-1.5 py-0.5 rounded font-medium shrink-0"
            style={{ background: `${typeColor}20`, color: typeColor }}
          />
          <span className="text-[11px] text-white/60 truncate">{issue.title}</span>
        </div>
        {issue.assignee ? (
          <span
            className="w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold text-white shrink-0"
            style={{ background: '#1a1a1a' }}
            title={`assignee: ${issue.assignee}`}
          >{String(issue.assignee).charAt(0).toUpperCase()}</span>
        ) : (
          <span className="text-[8px] text-white/25 shrink-0" title="no assignee">unassigned</span>
        )}
        <MoveButton taskKey={issue.task_key} onOpenMove={onOpenMove} />
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <StatusText status={issue.status} />
        {issue.test_tier && (
          <span className="text-[8px] px-1 py-0.5 rounded font-semibold bg-white/5 text-white/40">{issue.test_tier}</span>
        )}
        {inReview && issue.tester_status && (
          <span className={`text-[8px] px-1 py-0.5 rounded font-semibold ${REVIEW_CLASSES[issue.tester_status] ?? 'bg-white/5 text-white/40'}`}>
            🧪 {issue.tester_status}
          </span>
        )}
        {inReview && issue.designer_status && (
          <span className={`text-[8px] px-1 py-0.5 rounded font-semibold ${REVIEW_CLASSES[issue.designer_status] ?? 'bg-white/5 text-white/40'}`}>
            🎨 {issue.designer_status}
          </span>
        )}
        {issue.blocked_by && (
          <span className="text-[8px] px-1 py-0.5 rounded font-semibold bg-red-500/20 text-red-400" title={`Blocked by ${issue.blocked_by}`}>
            🔒 {issue.blocked_by}
          </span>
        )}
      </div>
      {parent && <div className="text-[9px] text-white/25 truncate mt-1">{parent.title}</div>}
    </div>
  )
}

/* ── Move sheet — statuses, grouped by the column that displays them ──
   Offering a COLUMN would be ambiguous: six of the eight hold more than one
   status, so "move to In review" cannot say which of code_review /
   product_review / feature_review it means.

   Every row is now labelled with what that move needs, decided by
   `moveVerdict()` in `lib/issue-moves.ts`. Measured against the running API on
   2026-08-26: of the sixteen destinations this sheet offered unconditionally,
   ELEVEN completed on a bare `{id, status}` and FIVE were refused — two of them
   with a raw `CHECK constraint failed: …` string put straight on the operator's
   screen. Two further refusals (`backlog` from anywhere else, anything from a
   closed card) depend on the row rather than the destination.

   The sheet no longer sends a move it has been told will fail. It either
   collects what the move needs first, or shows the destination disabled with
   the reason. It never HIDES one: an operator who cannot see `code_review`
   learns nothing; an operator told what `code_review` needs learns everything.

   The server is still the authority. Nothing here is enforcement — the MC API
   re-checks every one of these rules and refuses a PATCH that skips this
   component entirely. */
function MoveSheet({ issue, error, onClose, onMove }: {
  issue: Issue
  // The RAW failure, not a sentence. See `MoveFailureNotice`.
  error: MoveFailure | null
  onClose: () => void
  // Genuinely async in PipelineTab — it PATCHes the MC API and awaits the
  // result before deciding whether to close the sheet or show `error`. Typed
  // `=> void` before, which is what let `MoveFieldForm` fire it without
  // awaiting; see the comment on `onSubmit` there for the failure this caused.
  onMove: (status: string, values: Record<string, string>) => Promise<void>
}) {
  // The workflow identity this PATCH will be attributed to — the same value the
  // server derives from the session cookie when the body omits one
  // (`lib/session-actor.ts:36`). Read here rather than passed down because this
  // sheet only ever renders from a click, long after hydration.
  const actor = sessionOperator()

  /** The destination whose fields are being collected, or null for the list. */
  const [collecting, setCollecting] = useState<{ status: string; fields: readonly MoveField[] } | null>(null)

  const verdicts = useMemo(() => {
    const m = new Map<string, MoveVerdict>()
    for (const col of PIPELINE_COLUMNS) {
      for (const s of col.statuses) m.set(s, moveVerdict(issue, s, actor))
    }
    return m
  }, [issue, actor])

  if (collecting) {
    return (
      <MoveSheetShell issue={issue} error={error} onClose={onClose}>
        <MoveFieldForm
          status={collecting.status}
          fields={collecting.fields}
          onBack={() => setCollecting(null)}
          onSubmit={values => onMove(collecting.status, values)}
        />
      </MoveSheetShell>
    )
  }

  return (
    <MoveSheetShell issue={issue} error={error} onClose={onClose}>
      <div className="py-1">
        {PIPELINE_COLUMNS.map(col => (
          <div key={col.id}>
            <div className="px-4 pt-3 pb-1 text-[9px] uppercase tracking-wider text-white/25">{col.label}</div>
            {col.statuses.map(status => (
              <MoveOption
                key={status}
                status={status}
                hex={col.hex}
                verdict={verdicts.get(status) ?? { kind: 'blocked', reason: 'This board has no verdict for that status.' }}
                onChoose={v => {
                  if (v.kind === 'ready') onMove(status, {})
                  else if (v.kind === 'needs') setCollecting({ status, fields: v.fields })
                }}
              />
            ))}
          </div>
        ))}
      </div>
      <div className="border-t border-white/5">
        <Button variant="ghost" size="md" onClick={onClose} className="w-full justify-center py-3">Cancel</Button>
      </div>
    </MoveSheetShell>
  )
}

/** The bottom-sheet chrome, shared by the list view and the field form. */
function MoveSheetShell({ issue, error, onClose, children }: {
  issue: Issue; error: MoveFailure | null; onClose: () => void; children: React.ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/90 backdrop-blur-sm" onClick={onClose}>
      <div
        className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-t-2xl border border-white/10 bg-[#0f0f0f] shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="px-4 py-3 border-b border-white/5 sticky top-0 bg-[#0f0f0f] z-10">
          <div className="w-10 h-1 rounded-full bg-white/10 mx-auto mb-2" />
          <div className="text-xs text-white/60 font-medium truncate">{issue.task_key} — {issue.title}</div>
          <div className="text-[10px] text-white/25 mt-0.5">
            Currently <span className="font-mono text-white/50">{String(issue.status)}</span> · move to another status
          </div>
        </div>
        <MoveFailureNotice failure={error} />
        {children}
      </div>
    </div>
  )
}

/**
 * One destination row.
 *
 * `blocked` renders as a disabled row that still shows the status and the
 * reason — deliberately not hidden, and deliberately not a tap that fails.
 * `needs` renders enabled with a summary of what it will ask for, so the
 * operator knows the cost before committing to the tap.
 */
function MoveOption({ status, hex, verdict, onChoose }: {
  status: string; hex: string; verdict: MoveVerdict; onChoose: (v: MoveVerdict) => void
}) {
  const disabled = verdict.kind === 'current' || verdict.kind === 'blocked'
  const note =
    verdict.kind === 'current' ? 'Current'
    : verdict.kind === 'needs' ? `Needs ${verdict.fields.map(f => f.label.toLowerCase()).join(', ')}`
    : null

  return (
    <div>
      <button
        onClick={() => !disabled && onChoose(verdict)}
        disabled={disabled}
        aria-describedby={verdict.kind === 'blocked' ? `move-blocked-${status}` : undefined}
        className={`w-full text-left px-4 py-2.5 text-sm flex items-center gap-3 ${
          disabled ? 'text-white/25 cursor-not-allowed' : 'text-white/60 hover:bg-white/5 active:bg-white/10'
        }`}
      >
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ background: hex, opacity: disabled ? 0.3 : 1 }}
        />
        <span className="font-mono text-[12px]">{status}</span>
        {note && (
          <span className={`text-[10px] ml-auto shrink-0 ${verdict.kind === 'needs' ? 'text-amber-300/70' : 'text-white/25'}`}>
            {note}
          </span>
        )}
      </button>
      {verdict.kind === 'blocked' && (
        <p id={`move-blocked-${status}`} className="px-4 pb-2 -mt-1 text-[10px] leading-snug text-white/30">
          {verdict.reason}
        </p>
      )}
    </div>
  )
}

/**
 * Collect what the destination needs, then send it in the same PATCH.
 *
 * All of a move's fields at once, not one per round trip: `code_review` on a
 * task needs four, and the API reports them one refusal at a time, so prompting
 * from the error message alone would make the operator submit four times.
 */
function MoveFieldForm({ status, fields, onBack, onSubmit }: {
  status: string
  fields: readonly MoveField[]
  onBack: () => void
  // `onSubmit` ultimately calls the async `onMove` in PipelineTab (a 409 lane
  // refusal, a network drop, a future thrown exception). It used to be typed
  // `=> void`, which let that promise go unawaited: `setSubmitting(true)` below
  // had no failure path that could ever clear it, so a refused move left the
  // button reading "Moving…" — disabled, with the error shown above it, and no
  // way to retry short of closing the sheet. Typing the return as a real
  // Promise is what makes the await below possible.
  onSubmit: (values: Record<string, string>) => Promise<void>
}) {
  const [values, setValues] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {}
    for (const f of fields) seed[f.field] = f.defaultValue ?? ''
    return seed
  })
  const [submitting, setSubmitting] = useState(false)
  // Whether this form is still on screen. The success path unmounts it
  // (PipelineTab closes the whole sheet on a 2xx), so the reset below must
  // never fire after that — not because it would error, but because a
  // post-unmount `setSubmitting(false)` would be a flicker of "Move to X"
  // reappearing for a frame before the sheet is gone. Only the failure paths
  // are supposed to reach it, and this ref is what keeps it that way without
  // hand-coding a success/failure branch (`onMove` never rejects on a
  // refusal — see the comment on it in PipelineTab — so branching on
  // resolved-vs-rejected would not by itself tell success from failure).
  const mountedRef = useRef(true)
  useEffect(() => () => { mountedRef.current = false }, [])
  const unmet = unmetFields(fields, values)
  const set = (field: string, v: string) => setValues(prev => ({ ...prev, [field]: v }))

  const submit = () => {
    if (unmet.length > 0 || submitting) return
    setSubmitting(true)
    Promise.resolve(onSubmit(values))
      .catch(() => { /* onMove reports failures via the error prop, not a rejection */ })
      .finally(() => { if (mountedRef.current) setSubmitting(false) })
  }

  return (
    <form
      className="px-4 py-3"
      onSubmit={e => { e.preventDefault(); submit() }}
    >
      <p className="text-[11px] text-white/50 mb-3">
        Moving to <span className="font-mono text-white/70">{status}</span> needs{' '}
        {fields.length === 1 ? 'one more thing' : `${fields.length} more things`}. The board asks for{' '}
        {fields.length === 1 ? 'it' : 'them'} here so the move goes through the first time.
      </p>

      {fields.map(f => (
        <div key={f.field} className="mb-3">
          <label htmlFor={`move-field-${f.field}`} className="block text-[11px] font-medium text-white/70">
            {f.label}
          </label>
          <p className="text-[10px] text-white/35 mb-1 leading-snug">{f.why}</p>
          {f.kind === 'select' ? (
            <select
              id={`move-field-${f.field}`}
              value={values[f.field] ?? ''}
              onChange={e => set(f.field, e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[12px] text-white/80"
            >
              <option value="">Choose one…</option>
              {(f.options ?? []).map(o => <option key={o} value={o}>{o}</option>)}
            </select>
          ) : f.kind === 'longtext' ? (
            <textarea
              id={`move-field-${f.field}`}
              rows={3}
              value={values[f.field] ?? ''}
              placeholder={f.placeholder}
              onChange={e => set(f.field, e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[12px] text-white/80 placeholder:text-white/20"
            />
          ) : (
            <input
              id={`move-field-${f.field}`}
              type={f.kind === 'date' ? 'date' : 'text'}
              value={values[f.field] ?? ''}
              placeholder={f.placeholder}
              onChange={e => set(f.field, e.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-[12px] text-white/80 placeholder:text-white/20"
            />
          )}
          {f.minLength && f.minLength > 1 && (
            <p className="text-[10px] text-white/25 mt-0.5">
              {(values[f.field] ?? '').trim().length}/{f.minLength} characters minimum
            </p>
          )}
        </div>
      ))}

      <div className="flex gap-2 pt-1 pb-2">
        <Button type="button" variant="ghost" size="md" onClick={onBack} className="flex-1 justify-center">Back</Button>
        <Button type="submit" variant="primary" size="md" disabled={unmet.length > 0 || submitting} className="flex-1 justify-center">
          {submitting ? 'Moving…' : `Move to ${status}`}
        </Button>
      </div>
      {unmet.length > 0 && (
        <p className="pb-3 text-[10px] text-white/30">
          Still needed: {fields.filter(f => unmet.includes(f.field)).map(f => f.label.toLowerCase()).join(', ')}.
        </p>
      )}
    </form>
  )
}

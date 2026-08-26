'use client'
import React, { useState, useMemo } from 'react'
import { Search, ChevronUp, ChevronDown } from 'lucide-react'
import { Button, Input, Select, EmptyState } from '@/components/ui'
import { TypeBadge, PriorityBadge, StatusBadge, Badge } from '@/components/ui'
import { List } from 'lucide-react'
import { useApiList, readApiError, type ApiError } from '@/hooks/useApiData'
import { useAgentRoster } from '@/hooks/useAgentRoster'
import { agentDisplay } from '@/lib/agents-config'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import { issuePermalinkPath, navigateToIssuePermalink } from '@/lib/issue-permalink'
import { countLabelFor, countVerbFor } from '@/components/tabs/WorkViewCard'

export interface Issue {
  id: string; title: string; description?: string; status: string;
  assignee?: string; project?: string; priority?: string; type?: string;
  parent_id?: string; task_key?: string; acceptance_criteria?: string;
  sprint?: string; due_date?: string; created_at?: string; updated_at?: string;
  resolution_type?: string;
}

// TOD-2463: Work -> List had ZERO anchors. A critic measured
// `document.querySelectorAll('a').length === 0` on this entire screen and named
// it the biggest gap in the permalink piece: on Linear every issue row is a real
// <a href>, which is why "no screen unreachable" is true there without anyone
// working at it — the URL falls out of the UI. Here the only two producers of a
// permalink were the command palette and a Copy button inside an overlay you
// could only reach through the palette.
//
// Copied verbatim from components/tabs/BoardTab.tsx, deliberately: the two
// boards should not drift into two idioms for the same gesture. A shared
// component is the right end state; it is not this piece's file to create.
//
// `href` is a real path, so middle-click, Cmd/Ctrl-click and right-click ->
// Copy Link Address are the browser's own handling and nothing here runs for
// them. The onClick returns WITHOUT preventDefault for any modified click,
// which is what leaves those to the browser. stopPropagation keeps the anchor
// from also firing the row's own expand handler.
function IssueKeyLink({ taskKey, className }: { taskKey: string; className?: string }) {
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
    >
      {taskKey}
    </a>
  )
}

const STATUS_OPTIONS = ['backlog','defined','open','in_progress','code_review','product_review','approved','completed','released','closed']
const PRIORITY_OPTIONS = ['critical','high','medium','low']
// Assignees come from the host's AGENTS.md via GET /api/agents. The literal
// seven-id ASSIGNEE_OPTIONS this replaces meant nine rostered agents —
// designer, ux, po, deployer, auditor, security, growth, content, community —
// could never be picked in the UI even though the API accepts them, and an
// issue already assigned to one rendered as a bare id with no name.

type SortKey = 'task_key'|'type'|'title'|'status'|'priority'|'assignee'|'sprint'
type SortDir = 'asc'|'desc'

// ─── the write paths, lifted out of the component ────────────────────────────
//
// ROUND 2 (2026-08-26). A fresh-context critic mutation-tested this lane and
// showed that this file's two headline behaviours could be REVERTED with every
// gate green: deleting `if (!res.ok) setWriteError(...)` and turning the bulk
// partial-failure check into `if (true)` both left 15/15 tests passing, tsc
// clean, no-silent-empty PASS and the smoke test at exit 0. Its diagnosis was
// exact — this file held 162 of the lane's 305 changed lines and had ZERO
// tests, because every interesting branch sat behind a click, and this repo's
// jest is `testEnvironment: "node"` with no jsdom.
//
// So the write paths are now two exported async functions whose entire contract
// is their RETURN VALUE. A mocked `global.fetch` drives them, and the branches
// the critic deleted are the branches under test.
//
// ROUND 3. The sentence that followed — "what a test still cannot do here is
// press the button" — was false, and round 2's five source guards were built on
// it. A second critic showed why that mattered: `{writeError && (` ->
// `{false && writeError && (`, `if (error) {` -> `if (false && error) {` and
// `const retryFailedWrite = () => { return` all survived the guards, because a
// guard greps for a string the mutation does not touch. The button IS pressed
// now — `__tests__/work-ui-wiring.test.tsx` mounts this component, loads it
// against a mocked fetch, clicks the row, the Save button, the select-all
// checkbox, Apply and Retry, and asserts on the rendered tree and the recorded
// PATCH bodies. The guards are deleted.

/** Outcome of one PATCH. Exactly one of `row`/`error` is non-null. */
export interface SaveOutcome {
  row: Issue | null
  error: ApiError | null
}

/**
 * PATCH one issue's edited fields.
 *
 * The behaviour under test: a REFUSED write returns an error and no row. The
 * commonest refusal is a move to a review status without `regression_test`,
 * which /api/issues rejects by design. Before round 1 this was
 * `if (res.ok) { ... }` with no else, inside `catch { /* ignore *\/ }` — the
 * editor stayed open, the row did not change, and nothing appeared on screen.
 */
export async function saveIssueFields(id: string, fields: Partial<Issue>): Promise<SaveOutcome> {
  try {
    const res = await fetch('/api/issues', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...fields }),
    })
    if (!res.ok) return { row: null, error: await readApiError(res, 'PATCH /api/issues') }
    return { row: (await res.json()) as Issue, error: null }
  } catch (e) {
    return {
      row: null,
      error: {
        status: 0,
        endpoint: 'PATCH /api/issues',
        message: e instanceof Error ? e.message : 'could not reach the server',
      },
    }
  }
}

/**
 * Outcome of a bulk status move.
 *
 * `nextSelection` and `nextBulkStatus` are the point of this shape. They are
 * the state the bulk bar must be left in, computed here rather than in a
 * component closure — which is what makes "Retry re-sends only the rows that
 * failed" a checkable claim: feed `nextSelection`/`nextBulkStatus` straight
 * back into this function and count the requests.
 */
export interface BulkMoveOutcome {
  /** Rows the server accepted, already updated. Apply these regardless of failures. */
  appliedRows: Issue[]
  /** Ids the server refused, in the order they were submitted. */
  failedIds: string[]
  /** The selection the bulk bar should show afterwards. */
  nextSelection: string[]
  /** The target status the bulk bar should still have chosen afterwards. */
  nextBulkStatus: string
  error: ApiError | null
}

/**
 * Move every id to `status`, reporting PARTIAL failure rather than hiding it.
 *
 * A bulk move is the operation most likely to be partially rejected — one
 * selected issue missing a field the target status requires fails while its
 * neighbours succeed. The pre-round-1 handler mapped a rejection to `null` and
 * dropped it, so nine of ten moving looked identical to ten of ten.
 *
 * `keyOf` turns an id into the operator-facing task key; an id alone is not
 * something anyone can act on.
 */
export async function bulkMoveStatus(
  ids: string[],
  status: string,
  keyOf: (id: string) => string,
): Promise<BulkMoveOutcome> {
  const results = await Promise.all(
    ids.map(async id => {
      const outcome = await saveIssueFields(id, { status })
      return { id, ...outcome }
    }),
  )

  const appliedRows = results.map(r => r.row).filter((r): r is Issue => r !== null)
  const failures = results.filter(r => r.error !== null)

  if (failures.length === 0) {
    // Everything landed: clear the bar so it does not sit there implying an
    // outstanding operation.
    return { appliedRows, failedIds: [], nextSelection: [], nextBulkStatus: '', error: null }
  }

  // Leave the failures selected and say which they were, by key where the key
  // is known. Keeping `status` chosen is what makes the retry the SAME intent
  // rather than a fresh, half-configured one.
  const failedIds = failures.map(f => f.id)
  const failedKeys = failedIds.map(keyOf).join(', ')
  const first = failures[0].error!
  return {
    appliedRows,
    failedIds,
    nextSelection: failedIds,
    nextBulkStatus: status,
    error: {
      status: first.status,
      endpoint: 'PATCH /api/issues',
      message:
        `${failures.length} of ${ids.length} could not move to "${status.replace(/_/g, ' ')}" ` +
        `(${failedKeys}) — ${first.message}. ` +
        // ROUND 3 defect, found by mounting the component and READING the
        // sentence this function produces (previously only its retry BEHAVIOUR
        // was asserted): `only those ${countVerbFor(n,'rows','row')}` renders
        // "only those row" at n = 1 — the demonstrative was left plural while
        // the noun was singularised. That is the same disagreement as
        // "1 issues" and "1 issue are loaded", written one line below the
        // helper that exists to prevent it. The whole phrase agrees now, and
        // the plural states the count instead of making the operator go back
        // and re-read it.
        `They are still selected, so Retry re-sends only ` +
        `${countVerbFor(failures.length, `those ${failures.length} rows`, 'that row')}.`,
    },
  }
}

export default function IssuesTab({ projectFilter }: { projectFilter?: string | null }) {
  const endpoint = useMemo(() => {
    const params = new URLSearchParams()
    if (projectFilter) params.set('project', projectFilter)
    params.set('limit', '0')
    return `/api/issues?${params.toString()}`
  }, [projectFilter])
  const { items, total, error: fetchError, loading, refetch, setItems } = useApiList<Issue>(endpoint)
  const { agents: rosterAgents, byId: rosterById } = useAgentRoster()
  const issues = items ?? []
  // Optimistic updates always run after a successful load, so treating a null
  // (never-loaded) list as empty here is safe and keeps call sites simple.
  const setIssues = (update: (prev: Issue[]) => Issue[]) => setItems(prev => update(prev ?? []))
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('task_key')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [expandedId, setExpandedId] = useState<string|null>(null)
  const [editFields, setEditFields] = useState<Partial<Issue>>({})
  const [saving, setSaving] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [bulkStatus, setBulkStatus] = useState('')
  const [bulkSaving, setBulkSaving] = useState(false)
  // A write that fails must say so. Before this, `if (res.ok)` had no else and
  // the surrounding try had `catch { /* ignore */ }`, so a PATCH the API
  // REJECTED — the commonest being a move to a review status without
  // `regression_test`, which /api/issues refuses by design — left the editor
  // open, the row unchanged, and nothing at all on screen. The operator's only
  // evidence that the save had not happened was noticing the row had not
  // moved. That is the same silent-emptiness family the honest-error guard
  // exists for, on the write path instead of the read path.
  const [writeError, setWriteError] = useState<ApiError | null>(null)
  // Retry has to re-run the operation that failed, not a generic reload, so the
  // banner's button has to know WHICH write failed.
  //
  // ROUND 2 — this was a `useRef` holding the handler itself, and the critic was
  // right that it was broken:
  //
  //     retryRef.current = handleBulkStatusChange   // inside the handler
  //
  // assigns the function object created by THAT render, pinning that render's
  // closure. The failure path then calls `setSelected(new Set(failedIds))`, and
  // the ref still holds the pre-failure closure whose `ids` is the ORIGINAL
  // selection. The bar rendered "1 selected" while Retry re-PATCHed all three.
  // Same defect on the save path: the pinned closure re-sent the stale
  // `editFields`, so an operator who read the error, corrected the Status
  // select and pressed Retry silently re-sent the old payload — while the
  // editor's own Save button, built in the current render, sent the new one.
  // Two buttons, one screen, one intent, two different requests.
  //
  // The ref is gone. `writeIntent` is plain state naming which write failed,
  // and the banner is handed a handler built in the CURRENT render, so it reads
  // whatever `selected` / `bulkStatus` / `editFields` are at the moment of the
  // click — which after a partial failure is exactly the failed rows and the
  // target status the outcome left behind.
  const [writeIntent, setWriteIntent] = useState<'save' | 'bulk' | null>(null)

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    let list = issues
    if (q) list = list.filter(i => i.title.toLowerCase().includes(q) || (i.task_key??'').toLowerCase().includes(q))
    list = [...list].sort((a,b) => {
      const av = (a[sortKey]??'') as string
      const bv = (b[sortKey]??'') as string
      if (sortKey === 'task_key') {
        const an = parseInt((av).replace(/\D/g,'')) || 0
        const bn = parseInt((bv).replace(/\D/g,'')) || 0
        return sortDir === 'asc' ? an - bn : bn - an
      }
      return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av)
    })
    return list
  }, [issues, search, sortKey, sortDir])

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const handleExpand = (id: string) => {
    if (expandedId === id) { setExpandedId(null); return }
    const issue = issues.find(i => i.id === id)
    if (issue) setEditFields({ status: issue.status, assignee: issue.assignee??'', sprint: issue.sprint??'', priority: issue.priority??'' })
    setExpandedId(id)
  }

  const handleSave = async () => {
    if (!expandedId) return
    setSaving(true)
    setWriteError(null)
    setWriteIntent('save')
    try {
      const { row, error } = await saveIssueFields(expandedId, editFields)
      if (error) {
        // Keep the editor OPEN on a rejection. Closing it would throw away the
        // operator's edits along with the explanation of why they did not take.
        setWriteError(error)
        return
      }
      setIssues(prev => prev.map(i => i.id === expandedId ? row! : i))
      setExpandedId(null)
      setWriteIntent(null)
    } finally { setSaving(false) }
  }

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const selectAll = () => {
    if (selected.size === filtered.length) setSelected(new Set())
    else setSelected(new Set(filtered.map(i => i.id)))
  }

  // The whole decision — which rows moved, which were refused, what the bar is
  // left showing, what the banner says — is `bulkMoveStatus` above, so that it
  // is reachable from a test. This handler is the wiring: it feeds the outcome
  // straight back into state, including `nextSelection`, which is what makes a
  // subsequent Retry re-send ONLY the rows that failed.
  const handleBulkStatusChange = async () => {
    if (!bulkStatus || selected.size === 0) return
    setBulkSaving(true)
    setWriteError(null)
    setWriteIntent('bulk')
    try {
      const outcome = await bulkMoveStatus(
        Array.from(selected),
        bulkStatus,
        id => issues.find(i => i.id === id)?.task_key ?? id,
      )
      setIssues(prev => prev.map(i => outcome.appliedRows.find(r => r.id === i.id) ?? i))
      setSelected(new Set(outcome.nextSelection))
      setBulkStatus(outcome.nextBulkStatus)
      setWriteError(outcome.error)
      if (!outcome.error) setWriteIntent(null)
    } finally { setBulkSaving(false) }
  }

  // Built in the CURRENT render on purpose — see the `writeIntent` comment
  // above. Whatever the operator has changed since the failure (a corrected
  // Status select, a narrowed selection) is what gets re-sent, and it is the
  // same request the on-screen Save / Apply button would send.
  const retryFailedWrite = () => {
    if (writeIntent === 'save') void handleSave()
    else if (writeIntent === 'bulk') void handleBulkStatusChange()
  }

  const sprints = useMemo(() => Array.from(new Set(issues.map(i=>i.sprint).filter(Boolean))).sort().reverse(), [issues])

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <span className="text-white/10 ml-0.5"><ChevronUp size={10} /></span>
    return sortDir === 'asc'
      ? <span className="text-white/40 ml-0.5"><ChevronUp size={10} /></span>
      : <span className="text-white/40 ml-0.5"><ChevronDown size={10} /></span>
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-medium text-white">Issues</h2>
            {projectFilter && (
              <Badge label={projectFilter} className="bg-blue-500/20 text-blue-400 border border-blue-500/30" />
            )}
          </div>
          <p className="text-xs text-white/40 mt-0.5">
            {fetchError
              ? 'data unavailable'
              // total comes from the server's {data,total,has_more} envelope — the
              // true row count, not issues.length (this endpoint is called with
              // limit=0, which batches through every matching row, but total is
              // still the authoritative source rather than re-deriving it).
              //
              // The noun goes through the same singularizeLabel the Work cards
              // use, so there is ONE pluralisation rule on this destination
              // instead of one per surface that happened to remember.
              : `${(() => {
                  const trueTotal = total ?? issues.length
                  const noun = countLabelFor(trueTotal, 'issues')
                  return search
                    ? `Showing ${filtered.length} of ${trueTotal} ${noun}`
                    : `${trueTotal} ${noun}`
                })()}${selected.size > 0 ? ` · ${selected.size} selected` : ''}`}
          </p>
          {/* Provenance, in Card's `.prov` idiom: the query that produced the
              number above and every row below, printed rather than implied.
              This surface renders INSIDE a WorkViewCard whose own metric counts
              a DIFFERENT query (`&status=backlog`), so two honest numbers sit
              on one screen. Printing both queries is what makes that legible
              instead of looking like one of them is wrong. */}
          <p className="font-mono text-[10px] leading-snug text-white/35 mt-1 break-all">{endpoint}</p>
        </div>
        <div className="relative max-w-xs flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/25 z-10" />
          <Input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by title or key..."
            className="pl-9 pr-3 rounded-xl text-xs"
          />
        </div>
      </div>

      {/* A rejected write, rendered where the operator is looking. It sits
          ABOVE the table rather than replacing it: the rows on screen are
          still true — it is the WRITE that did not happen, not the read. */}
      {writeError && (
        <ApiErrorBanner error={writeError} onRetry={retryFailedWrite} />
      )}

      {/* Bulk actions bar */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl border border-blue-500/20 bg-blue-500/5">
          <span className="text-xs text-blue-400 font-medium">{selected.size} selected</span>
          <Select value={bulkStatus} onChange={e => setBulkStatus(e.target.value)} className="text-xs rounded-lg px-2 py-1.5">
            <option value="">Change status to…</option>
            {STATUS_OPTIONS.map(s => <option key={s} value={s} className="bg-[#0f0f0f] text-white">{s.replace(/_/g,' ')}</option>)}
          </Select>
          <Button variant="primary" size="sm" onClick={handleBulkStatusChange} disabled={!bulkStatus || bulkSaving} loading={bulkSaving}>
            Apply
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setSelected(new Set())} className="ml-auto">
            Clear
          </Button>
        </div>
      )}

      <div className="rounded-xl border border-white/10 overflow-hidden bg-[#0f0f0f]">
        {loading && (
          <div className="flex items-center justify-center py-8 gap-2 text-white/40 text-xs">
            <span className="animate-spin h-4 w-4 border-2 border-white/20 border-t-white/60 rounded-full" />
            Loading issues...
          </div>
        )}
        {fetchError && (
          <div className="p-3">
            <ApiErrorBanner error={fetchError} onRetry={refetch} />
          </div>
        )}

        {!loading && !fetchError && (
          <div className="overflow-x-auto">
            {/* Header */}
            <div className="hidden md:grid md:grid-cols-[32px_80px_70px_1fr_100px_80px_90px_90px] gap-2 px-4 py-2.5 border-b border-white/10 bg-white/3">
              <button onClick={selectAll} className="flex items-center justify-center">
                <span className={`w-3.5 h-3.5 rounded border text-[8px] flex items-center justify-center ${selected.size === filtered.length && filtered.length > 0 ? 'bg-white text-black border-white' : 'border-white/10 text-transparent'}`}>
                  ✓
                </span>
              </button>
              {([['task_key','Key'],['type','Type'],['title','Title'],['status','Status'],['priority','Pri'],['assignee','Assignee'],['sprint','Sprint']] as [SortKey,string][]).map(([key,label]) => (
                <button key={key} onClick={() => handleSort(key)}
                  className="flex items-center text-[10px] font-semibold uppercase tracking-wider text-white/40 hover:text-white/60 transition-all text-left">
                  {label}<SortIcon col={key} />
                </button>
              ))}
            </div>

            {/* Mobile header */}
            <div className="md:hidden grid grid-cols-[70px_1fr_80px] gap-2 px-3 py-2 border-b border-white/10 bg-white/3">
              {([['task_key','Key'],['title','Title'],['status','Status']] as [SortKey,string][]).map(([key,label]) => (
                <button key={key} onClick={() => handleSort(key)}
                  className="flex items-center text-[10px] font-semibold uppercase tracking-wider text-white/40 hover:text-white/60 text-left">
                  {label}<SortIcon col={key} />
                </button>
              ))}
            </div>

            {/* Rows */}
            {filtered.map(issue => (
              <React.Fragment key={issue.id}>
                {/* Desktop row */}
                <div
                  onClick={() => handleExpand(issue.id)}
                  className={'hidden md:grid md:grid-cols-[32px_80px_70px_1fr_100px_80px_90px_90px] gap-2 px-4 py-2.5 cursor-pointer transition-all border-b border-white/10 ' +
                    (expandedId === issue.id ? 'bg-white/5' : selected.has(issue.id) ? 'bg-blue-500/5' : 'hover:bg-white/3')}
                >
                  <span className="flex items-center justify-center" onClick={e => toggleSelect(issue.id, e)}>
                    <span className={`w-3.5 h-3.5 rounded border text-[8px] flex items-center justify-center cursor-pointer ${selected.has(issue.id) ? 'bg-white text-black border-white' : 'border-white/10 text-transparent hover:border-white/30'}`}>
                      ✓
                    </span>
                  </span>
                  {issue.task_key
                    ? <IssueKeyLink taskKey={issue.task_key} className="text-[11px] font-mono px-1.5 py-0.5 rounded-lg bg-white/5 text-white/40 w-fit hover:text-white/70 hover:underline" />
                    : <span className="text-[11px] font-mono px-1.5 py-0.5 rounded-lg bg-white/5 text-white/40 w-fit">—</span>}
                  <TypeBadge value={issue.type ?? 'task'} />
                  <span className="text-xs text-white/60 truncate">{issue.title}</span>
                  <StatusBadge value={issue.status} />
                  <PriorityBadge value={issue.priority ?? ''} />
                  <span className="text-[10px] text-white/40">
                    {issue.assignee ? `${rosterById[issue.assignee]?.emoji ?? agentDisplay(issue.assignee).emoji} ${rosterById[issue.assignee]?.name ?? agentDisplay(issue.assignee).name}` : '—'}
                  </span>
                  <span className="text-[10px] text-white/40 font-mono">{issue.sprint??'—'}</span>
                </div>

                {/* Mobile row */}
                <div
                  onClick={() => handleExpand(issue.id)}
                  className={'md:hidden grid grid-cols-[70px_1fr_80px] gap-2 px-3 py-2.5 cursor-pointer transition-all border-b border-white/10 ' +
                    (expandedId === issue.id ? 'bg-white/5' : 'hover:bg-white/3')}
                >
                  {issue.task_key
                    ? <IssueKeyLink taskKey={issue.task_key} className="text-[10px] font-mono px-1 py-0.5 rounded-lg bg-white/5 text-white/40 w-fit hover:text-white/70 hover:underline" />
                    : <span className="text-[10px] font-mono px-1 py-0.5 rounded-lg bg-white/5 text-white/40 w-fit">—</span>}
                  <span className="text-[11px] text-white/60 truncate">{issue.title}</span>
                  <StatusBadge value={issue.status} />
                </div>

                {/* Inline edit row */}
                {expandedId === issue.id && (
                  <div className="px-4 py-3 border-b border-white/10 bg-white/3">
                    <div className="flex flex-wrap gap-3 items-end">
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold">Status</span>
                        <Select value={editFields.status??''} onChange={e => setEditFields(f=>({...f,status:e.target.value}))} className="text-xs rounded-lg px-2 py-1.5">
                          {STATUS_OPTIONS.map(s => <option key={s} value={s} className="bg-[#0f0f0f] text-white">{s.replace(/_/g,' ')}</option>)}
                        </Select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold">Assignee</span>
                        <Select value={editFields.assignee??''} onChange={e => setEditFields(f=>({...f,assignee:e.target.value}))} className="text-xs rounded-lg px-2 py-1.5">
                          <option value="" className="bg-[#0f0f0f] text-white">Unassigned</option>
                          {/* registry-reaches-dispatch piece: a.dispatchable
                              is computed server-side (app/api/agents/route.ts)
                              from the same getQueueConfig() POST
                              /api/run-agent itself calls, including a config
                              derived from a Brain2 vault manifest
                              (lib/agent-manifests.ts) — this file's own
                              client-bundle copy of getQueueConfig() cannot
                              see that. Assigning to a non-dispatchable agent
                              still works (assigning is not itself an error)
                              — the option just says so instead of implying a
                              queue lane that does not exist for this id. */}
                          {rosterAgents.map(a => (
                            <option key={a.id} value={a.id} className="bg-[#0f0f0f] text-white">
                              {a.name}{!a.dispatchable ? ' (not dispatchable)' : ''}
                            </option>
                          ))}
                          {/* An assignee already on the issue that this host's roster does not
                              declare stays selectable, so opening the editor cannot silently
                              reassign the issue to whoever happens to be first in the list. */}
                          {editFields.assignee && !rosterById[editFields.assignee] && (
                            <option value={editFields.assignee} className="bg-[#0f0f0f] text-white">{editFields.assignee} (not in roster)</option>
                          )}
                        </Select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold">Sprint</span>
                        <Select value={editFields.sprint??''} onChange={e => setEditFields(f=>({...f,sprint:e.target.value}))} className="text-xs rounded-lg px-2 py-1.5">
                          <option value="" className="bg-[#0f0f0f] text-white">None</option>
                          {sprints.map(s => <option key={s} value={s!} className="bg-[#0f0f0f] text-white">{s}</option>)}
                        </Select>
                      </label>
                      <label className="flex flex-col gap-1">
                        <span className="text-[10px] text-white/40 uppercase tracking-wider font-semibold">Priority</span>
                        <Select value={editFields.priority??''} onChange={e => setEditFields(f=>({...f,priority:e.target.value}))} className="text-xs rounded-lg px-2 py-1.5">
                          {PRIORITY_OPTIONS.map(p => <option key={p} value={p} className="bg-[#0f0f0f] text-white">{p}</option>)}
                        </Select>
                      </label>
                      <Button variant="primary" size="sm" onClick={handleSave} disabled={saving} loading={saving}>
                        {saving ? 'Saving...' : 'Save'}
                      </Button>
                    </div>
                  </div>
                )}
              </React.Fragment>
            ))}

            {/* An empty state has to NAME what it is empty about, and it has to
                distinguish the two reasons a table can be empty. "No issues
                found" said neither: it read identically whether the project
                genuinely holds nothing, whether the search matched nothing, and
                — before the `!fetchError` guard above — whether the request had
                failed. The failure case is now impossible to reach here (the
                banner replaces this branch), and the remaining two say which
                one they are and which project they are talking about. */}
            {!loading && !fetchError && filtered.length === 0 && (
              <EmptyState
                icon={List}
                title={
                  search
                    ? `Nothing in ${projectFilter ?? 'this project'} matches “${search}”`
                    : `${projectFilter ?? 'This project'} has no issues yet`
                }
                description={
                  search
                    // ROUND 2: this sentence singularised its NOUN and left
                    // its VERB plural — "1 issue are loaded". Limiglow held
                    // exactly 1 issue when this session began, so any
                    // non-matching search here reproduced it on real data at
                    // that moment. The verb goes through the same rule as the
                    // noun now.
                    ? (() => {
                        const loadedTotal = total ?? issues.length
                        return `${loadedTotal} ${countLabelFor(loadedTotal, 'issues')} ` +
                          `${countVerbFor(loadedTotal, 'are', 'is')} loaded — the search is what is hiding ` +
                          `${countVerbFor(loadedTotal, 'them', 'it')}, not the project.`
                      })()
                    : 'That is correct, not broken. Rows appear here as issues are created.'
                }
              />
            )}
          </div>
        )}
      </div>
    </div>
  )
}

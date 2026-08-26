'use client'

// TOD-2416 — the Work destination's card treatment.
//
// Work absorbed eight of the twenty old tabs and had no cards: four pills over
// raw legacy components. The owner's table (docs/rebuild/FEEDBACK.md item 4)
// names its four cards — Bolt board, Backlog, Epics, Due.
//
// This wraps the legacy tabs rather than rewriting them. What it ADDS is the
// contract they never had: one question, one number from a real query, the
// query printed, a collapse that persists, an empty state that names the
// project, and an error that is loud instead of a body silently blanking.
//
// The number is deliberately an EXACT count. design/Work.dc.html:
// "Counts come from a count:'exact' query, never from the length of a page."
// `/api/issues?project=<p>&limit=1` answers with the exact `{ total }` and a
// single row. Note `limit=0` on that route means "every matching row", not
// "count only" — it would fetch thousands of rows to render one number.
//
// ─── ROUND 2 (2026-08-26): why this file is now three exported pieces ────────
//
// A fresh-context critic mutation-tested this lane and found that the headline
// behaviours could be REVERTED with every gate green, because the tests only
// exercised the pure helpers below and never the component that consumes them.
// Two of its nine mutants landed here and both survived:
//
//   - drop `children` from the error branch — verbatim TOD-2444
//   - ignore `emptyStatePlacement` and blank the body again
//
// Both were invisible to a test because the state that reaches those branches
// only arrives from a `fetch` inside `useEffect`, and this repo's jest is
// `testEnvironment: "node"` with no jsdom — effects never run, so those
// branches were unreachable from a test at all.
//
// The fix is structural rather than a new dependency: the rendering is now a
// PURE, prop-driven component (`WorkViewCardView`) that `renderToStaticMarkup`
// can put into any state directly, and the request is a separate exported
// async function (`fetchCountTotal`) that a mocked `global.fetch` can drive.
// The default export is the thin wiring between the two. Both mutants now fail
// a test — see `__tests__/work-ui-cards-behaviour.test.tsx`.

import React, { useCallback, useEffect, useState } from 'react'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import { readApiError, type ApiError } from '@/hooks/useApiData'
import Card from '@/components/nav/Card'

// ─── the number and its noun must agree ──────────────────────────────────────
//
// MEASURED 2026-08-26, read-only against db.sqlite, by me, twice: at the start
// of this session the shared fixture project Limiglow held exactly 1 issue
// (TOD-298, type=epic), so `epics = 1`; by the end of the session another lane
// had removed its fixture and the count was 0. `app/page.tsx` mounts the Epics
// card with countLabel="epics" and Card renders a metric as `{value} {label}`,
// so at the first of those two readings the operator read "1 epics" off real
// data. The count is a moving fixture, not a fixed fact — what is fixed is
// that a count of 1 happens, and the rule below is what makes it read right
// when it does.
//
// The label is the CALLER's word, and app/page.tsx is not this lane's file, so
// the agreement has to be enforced here. Two ways in, in priority order:
//
//   1. `countLabelOne` — the caller states the singular outright. Always
//      correct, and the only option for a label English does not pluralise
//      with an "s".
//   2. the fallback below — strip ONE trailing "s" from the FINAL word, and
//      only when that word ends in a single "s".
//
// The fallback is deliberately timid rather than clever, because a wrong
// singular is worse than a missing one. Checked against all four labels
// app/page.tsx passes today:
//
//   "issues"           -> "issue"            (changed, correct)
//   "epics"            -> "epic"             (changed, correct)
//   "in backlog"       -> "in backlog"       (last word has no "s" — untouched)
//   "with a due date"  -> "with a due date"  (last word has no "s" — untouched)
//
// "ss" is excluded so a label like "in progress" cannot become "in progres".
// Anything irregular ("people", "sprints in flight") should use countLabelOne
// rather than hope; that is what the prop is for.
export function singularizeLabel(label: string): string {
  const words = label.split(' ')
  const last = words[words.length - 1]
  if (!/s$/.test(last) || /ss$/.test(last) || last.length < 2) return label
  words[words.length - 1] = last.slice(0, -1)
  return words.join(' ')
}

/** The noun to render beside `total`. Exported so it can be tested without a DOM. */
export function countLabelFor(total: number, label: string, one?: string): string {
  if (total !== 1) return label
  return one ?? singularizeLabel(label)
}

/**
 * Subject-verb agreement for a sentence built around a count.
 *
 * ROUND 2 defect, found by the critic INSIDE round 1's own fix: `IssuesTab`
 * rendered `${total} ${countLabelFor(total, 'issues')} are loaded`, which
 * singularises the noun and leaves the verb plural — "1 issue are loaded".
 * Limiglow held exactly 1 issue when this session began, so any non-matching
 * search on Work -> List reproduced it on real data at that moment.
 * Pluralising a noun without its verb is the same defect as not pluralising at
 * all, so the rule lives next to the noun rule instead of being remembered per
 * call site.
 */
export function countVerbFor(total: number, plural: string, singular: string): string {
  return total === 1 ? singular : plural
}

/** Where a count-driven empty sentence is allowed to go. */
export type EmptyPlacement = 'none' | 'replaces-body' | 'note-above-body'

// TOD-2444, generalised so the same bug cannot be reintroduced by a caller.
//
// The original defect: this card counts ONE query, but the body it wraps is its
// own surface with its own scope. When the count reached zero, Card rendered
// `empty.message` IN PLACE OF that body — so a sentence about the COUNT deleted
// content that was still there. Two callers were fixed one at a time by moving
// their routers out of `children`; `work/board` and `work/list` still pass
// children, and `work/list` is the dangerous shape: it counts `&status=backlog`
// while the IssuesTab underneath lists EVERY issue in the project. An empty
// backlog would have blanked a full table.
//
// The rule is structural now rather than a per-caller judgement: a count-driven
// empty state may only take over the body when there IS no body.
export function emptyStatePlacement(loaded: boolean, total: number | null, hasBody: boolean): EmptyPlacement {
  if (!loaded || total !== 0) return 'none'
  return hasBody ? 'note-above-body' : 'replaces-body'
}

// ─── the note that replaced a displayed lie ──────────────────────────────────
//
// ROUND 2 defect (the critic's second): round 1 stopped the count from DELETING
// the table, and then printed the caller's project-level sentence directly
// above the full table it had just saved. `app/page.tsx:992` mounts work/list
// with countFilter="&status=backlog" and an emptyMessage of the form
// "<project> has no issues yet". An empty backlog over a populated table
// therefore rendered "Limiglow has no issues yet" above a list of Limiglow's
// issues. Round 1 flagged this in its doc and shipped it unfixed.
//
// The seam diff that repairs the caller's wording is still requested in the
// piece doc and is still not this lane's to apply — but the card does not need
// it, because in the note-above-body case the card KNOWS the caller's sentence
// cannot be trusted: by construction the count is about one query and the body
// is about another. So it stops relaying that sentence there and states only
// what it can prove — its own count is zero, the query that produced it is
// printed one line up, and the body below answers a different question.
//
// The caller's `emptyMessage` is still used verbatim for `replaces-body`, where
// there is no second query and the sentence is the whole card.
export function emptyNoteAboveBody(project: string, countLabel: string): string {
  return (
    `No rows in ${project} match this card's count (${countLabel}) — the query is printed above. ` +
    `The view below runs its own query and still lists its own rows.`
  )
}

export interface WorkViewCardProps {
  /** Stable card id — the localStorage key for the collapsed state. */
  id: string
  /** The question this view answers, as the card title. */
  title: string
  /** Project scope. Null means the app has not resolved one yet. */
  projectFilter: string | null
  /**
   * Extra filters appended to the count query, e.g. `&type=epic`. The project
   * clause is added here and is not the caller's to omit — an unscoped count
   * on a scoped card is the cross-project leak this wave closed nine of.
   */
  countFilter?: string
  /** Unit for the number, e.g. "issues", "epics". Used when the count is not 1. */
  countLabel: string
  /**
   * The same unit in the singular, for a count of exactly 1. Optional: without
   * it `singularizeLabel` above makes a conservative guess. Pass it whenever
   * the plural is irregular or does not simply end in "s".
   */
  countLabelOne?: string
  /** Rendered when the count is 0 AND the card has no body. Must name the project. */
  emptyMessage: (project: string) => string
  /**
   * TOD-2444: OPTIONAL. Card renders empty.message IN PLACE OF children, so a
   * sub-view router passed as children disappears at exactly the count this
   * project sits at — zero. `emptyStatePlacement` above is what stops that now.
   */
  children?: React.ReactNode
}

/** The count query this card runs, or null when no project is resolved yet. */
export function countQueryFor(projectFilter: string | null, countFilter = ''): string | null {
  // `limit=1` returns the EXACT total with a single row. Two things this is
  // deliberately not: `rows.length` off a page — the defect still live on Now,
  // where a `limit: 5` query renders "5 events" however many exist — and
  // `limit=0`, which on this route means "every matching row" and would fetch
  // all 3,000+ issues to display one number.
  return projectFilter
    ? `/api/issues?project=${encodeURIComponent(projectFilter)}&limit=1${countFilter}`
    : null
}

export type CountResult =
  | { total: number | null; error: null }
  | { total: null; error: ApiError }

/**
 * The card's one request, lifted out of the component so it is reachable from a
 * test with a mocked `global.fetch`. A non-ok response becomes an ApiError and
 * NEVER a total — deleting that branch (the critic's surviving-mutant class)
 * now fails a test instead of passing silently.
 */
export async function fetchCountTotal(query: string): Promise<CountResult> {
  try {
    const res = await fetch(query)
    if (!res.ok) return { total: null, error: await readApiError(res, '/api/issues') }
    const body = await res.json()
    return { total: typeof body?.total === 'number' ? body.total : null, error: null }
  } catch (e) {
    return {
      total: null,
      error: {
        status: 0,
        endpoint: '/api/issues',
        message: e instanceof Error ? e.message : 'could not reach the server',
      },
    }
  }
}

export interface WorkViewCardViewProps extends WorkViewCardProps {
  /** The query string printed as provenance. */
  source: React.ReactNode
  total: number | null
  error: ApiError | null
  loaded: boolean
  onRetry: () => void
}

/**
 * Everything this card RENDERS, as a pure function of props.
 *
 * Split out for one reason: every branch below used to be reachable only after
 * a fetch resolved inside a useEffect, which under `testEnvironment: "node"`
 * never happens — so `renderToStaticMarkup` could only ever observe the
 * loading state and the interesting branches were untestable. As props, each
 * branch is one call.
 *
 * The invariant this file exists to hold: **`children` render in EVERY
 * branch.** A fact about THE COUNT may never delete a surface that owns a
 * different query — not when the count is zero, not when the count is refused,
 * not when no project is resolved yet. The child owns its own query and its own
 * ApiErrorBanner and reports on itself.
 */
export function WorkViewCardView({
  id,
  title,
  projectFilter,
  countLabel,
  countLabelOne,
  emptyMessage,
  source,
  total,
  error,
  loaded,
  onRetry,
  children,
}: WorkViewCardViewProps) {
  const hasBody = children !== undefined && children !== null && children !== false

  // The two early returns this replaces — one for "no project yet", one for a
  // failed count — each rendered a Card and DROPPED `children` on the floor.
  // That is the identical defect the placement rule exists to stop, reached
  // down two different paths. On `work/list` a refused COUNT query took the
  // whole issues table with it, and the table's own request had not even been
  // made yet, let alone failed.
  if (!projectFilter) {
    const message = 'No project selected yet, so there is nothing scoped to count.'
    return (
      <Card id={id} title={title} source={source} empty={hasBody ? undefined : { active: true, message }}>
        {hasBody && <p className="text-white/45 text-xs mb-3">{message}</p>}
        {children}
      </Card>
    )
  }

  if (error) {
    return (
      <Card id={id} title={title} source={source}>
        <ApiErrorBanner error={error} onRetry={onRetry} className={hasBody ? 'mb-3' : ''} />
        {children}
      </Card>
    )
  }

  const placement = emptyStatePlacement(loaded, total, hasBody)

  return (
    <Card
      id={id}
      title={title}
      source={source}
      // No fabricated 0 while the count is in flight: omit the metric entirely
      // until a real number arrives.
      metric={
        loaded && total !== null
          ? { value: total.toLocaleString('en-US'), label: countLabelFor(total, countLabel, countLabelOne) }
          : undefined
      }
      empty={placement === 'replaces-body' ? { active: true, message: emptyMessage(projectFilter) } : undefined}
    >
      {placement === 'note-above-body' && (
        <p className="text-white/45 text-xs mb-3">{emptyNoteAboveBody(projectFilter, countLabel)}</p>
      )}
      {children}
    </Card>
  )
}

export default function WorkViewCard(props: WorkViewCardProps) {
  const { projectFilter, countFilter = '' } = props
  const [total, setTotal] = useState<number | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loaded, setLoaded] = useState(false)

  const query = countQueryFor(projectFilter, countFilter)

  const load = useCallback(async () => {
    if (!query) return
    const result = await fetchCountTotal(query)
    setError(result.error)
    setTotal(result.total)
    setLoaded(true)
  }, [query])

  useEffect(() => { void load() }, [load])

  return (
    <WorkViewCardView
      {...props}
      source={query ?? '/api/issues — waiting for a project scope'}
      total={total}
      error={error}
      loaded={loaded}
      onRetry={() => { void load() }}
    />
  )
}

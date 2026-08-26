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
// project, and an error that replaces the body instead of an empty state
// appearing over a failure.
//
// The number is deliberately an EXACT count. design/Work.dc.html:
// "Counts come from a count:'exact' query, never from the length of a page."
// `/api/issues?project=<p>&limit=1` answers with the exact `{ total }` and a
// single row. Note `limit=0` on that route means "every matching row", not
// "count only" — it would fetch thousands of rows to render one number.

import React, { useCallback, useEffect, useState } from 'react'
import ApiErrorBanner from '@/components/ApiErrorBanner'
import { readApiError, type ApiError } from '@/hooks/useApiData'
import Card from '@/components/nav/Card'

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
  /** Unit for the number, e.g. "issues", "epics". */
  countLabel: string
  /** Rendered when the count is 0. Must name the project. */
  emptyMessage: (project: string) => string
  children: React.ReactNode
}

export default function WorkViewCard({
  id,
  title,
  projectFilter,
  countFilter = '',
  countLabel,
  emptyMessage,
  children,
}: WorkViewCardProps) {
  const [total, setTotal] = useState<number | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loaded, setLoaded] = useState(false)

  // `limit=1` returns the EXACT total with a single row. Two things this is
  // deliberately not: `rows.length` off a page — the defect still live on Now,
  // where a `limit: 5` query renders "5 events" however many exist — and
  // `limit=0`, which on this route means "every matching row" and would fetch
  // all 3,000+ issues to display one number.
  const query = projectFilter
    ? `/api/issues?project=${encodeURIComponent(projectFilter)}&limit=1${countFilter}`
    : null

  const load = useCallback(async () => {
    if (!query) return
    try {
      const res = await fetch(query)
      if (!res.ok) {
        setError(await readApiError(res, '/api/issues'))
        setTotal(null)
        setLoaded(true)
        return
      }
      const body = await res.json()
      setError(null)
      setTotal(typeof body?.total === 'number' ? body.total : null)
      setLoaded(true)
    } catch (e) {
      setError({
        status: 0,
        endpoint: '/api/issues',
        message: e instanceof Error ? e.message : 'could not reach the server',
      })
      setTotal(null)
      setLoaded(true)
    }
  }, [query])

  useEffect(() => { void load() }, [load])

  const source = query ?? '/api/issues — waiting for a project scope'

  if (!projectFilter) {
    return (
      <Card
        id={id}
        title={title}
        source={source}
        empty={{ active: true, message: 'No project selected yet, so there is nothing scoped to count.' }}
      />
    )
  }

  // An error REPLACES the body. It never renders alongside an empty state —
  // an empty state over a failed request tells the operator there is no work
  // when the truth is that nobody asked.
  if (error) {
    return (
      <Card id={id} title={title} source={source}>
        <ApiErrorBanner error={error} onRetry={load} />
      </Card>
    )
  }

  return (
    <Card
      id={id}
      title={title}
      source={source}
      // No fabricated 0 while the count is in flight: omit the metric entirely
      // until a real number arrives.
      metric={loaded && total !== null ? { value: total.toLocaleString('en-US'), label: countLabel } : undefined}
      empty={
        loaded && total === 0
          ? { active: true, message: emptyMessage(projectFilter) }
          : undefined
      }
    >
      {children}
    </Card>
  )
}

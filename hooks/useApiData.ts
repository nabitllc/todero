'use client'
// Shared fetch hook — TOD-654 follow-up.
//
// The repo-wide anti-pattern this replaces parsed every response body without
// checking `res.ok`, then coerced the result with `?? []`. A 403/500 body is an
// object, so the coercion silently produced an empty array and the tab rendered
// "No issues found" over a permission error. Every tab that loads data must be
// able to tell "nothing there" apart from "the server refused". This hook makes
// that distinction structural: on a non-ok response `data` stays null and
// `error` is populated.
//
// The error shape, wording and body-reading live in lib/fetch-json.ts so that
// imperative call sites and server routes share them; they are re-exported here
// because most consumers are React components that already import this module.

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchJson, type ApiError } from '@/lib/fetch-json'

export { fetchJson, fetchJsonOrNull, formatApiError, readApiError } from '@/lib/fetch-json'
export type { ApiError, JsonResult } from '@/lib/fetch-json'

export interface ApiDataState<T> {
  /** Parsed payload, or null while loading and whenever the load failed. */
  data: T | null
  error: ApiError | null
  /** Status of the last completed response (null before the first one). */
  status: number | null
  loading: boolean
  refetch: () => void
  /** Escape hatch for optimistic updates. */
  setData: React.Dispatch<React.SetStateAction<T | null>>
}

/**
 * Fetch JSON from a same-origin endpoint, surfacing failures instead of
 * swallowing them. Pass `null` as the endpoint to skip the request.
 */
export function useApiData<T>(endpoint: string | null, init?: RequestInit): ApiDataState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [status, setStatus] = useState<number | null>(null)
  const [loading, setLoading] = useState<boolean>(endpoint !== null)
  const [nonce, setNonce] = useState(0)
  // init is usually an object literal; freezing it in a ref keeps a new
  // identity on every render from re-triggering the effect.
  const initRef = useRef(init)
  initRef.current = init

  useEffect(() => {
    if (!endpoint) { setLoading(false); return }
    const ctrl = new AbortController()
    let cancelled = false
    setLoading(true)
    ;(async () => {
      const r = await fetchJson<T>(endpoint, { ...initRef.current, signal: ctrl.signal })
      if (cancelled || ctrl.signal.aborted) return
      setStatus(r.status === 0 ? 0 : r.status)
      if (r.ok) {
        setData(r.data)
        setError(null)
      } else {
        setData(null)
        setError(r.error)
      }
      setLoading(false)
    })()
    return () => { cancelled = true; ctrl.abort() }
  }, [endpoint, nonce])

  const refetch = useCallback(() => setNonce(n => n + 1), [])

  return { data, error, status, loading, refetch, setData }
}

export interface ApiListState<T> {
  /** null means "not loaded / failed" — never confuse it with an empty list. */
  items: T[] | null
  error: ApiError | null
  status: number | null
  loading: boolean
  refetch: () => void
  setItems: React.Dispatch<React.SetStateAction<T[] | null>>
}

/**
 * List flavour of {@link useApiData}. Unwraps both response shapes the MC API
 * uses (a bare array, or `{ data: [...] }`) but only ever on a 2xx — a failed
 * load leaves `items` null so callers cannot accidentally render an empty state.
 */
export function useApiList<T>(endpoint: string | null, init?: RequestInit): ApiListState<T> {
  // The payload shape is one of two known variants, hence the union rather than any.
  const { data, error, status, loading, refetch, setData } =
    useApiData<T[] | { data?: T[] }>(endpoint, init)

  const items: T[] | null =
    data === null ? null : Array.isArray(data) ? data : data?.data ?? []

  const setItems = useCallback<React.Dispatch<React.SetStateAction<T[] | null>>>(
    update => {
      setData(prev => {
        const current: T[] | null =
          prev === null ? null : Array.isArray(prev) ? prev : prev?.data ?? []
        return typeof update === 'function'
          ? (update as (p: T[] | null) => T[] | null)(current)
          : update
      })
    },
    [setData],
  )

  return { items, error, status, loading, refetch, setItems }
}

'use client'
// Shared fetch hook — TOD-654 follow-up.
//
// The repo-wide anti-pattern this replaces:
//   fetch(url).then(r => r.json()).then(d => setItems(Array.isArray(d) ? d : d?.data ?? []))
// A 403/500 body is an object, so `d?.data ?? []` silently produced an empty
// array and the tab rendered "No issues found" over a permission error. Every
// tab that loads data must be able to tell "nothing there" apart from
// "the server refused". This hook makes that distinction structural: on a
// non-ok response `data` stays null and `error` is populated.

import { useCallback, useEffect, useRef, useState } from 'react'

export interface ApiError {
  /** HTTP status, or 0 when the request never reached the server. */
  status: number
  /** The path that was requested, shown verbatim to the operator. */
  endpoint: string
  /** Server-supplied message (`error` / `message` field, else raw body text). */
  message: string
  /** Machine-readable code when the server sent one (e.g. PERMISSION_DENIED). */
  code?: string
}

/**
 * The one sentence every tab shows when a load fails. Kept in one place so the
 * wording — and therefore what an auditor can grep for — is identical
 * everywhere: `data unavailable — 403 from /api/issues: <server message>`.
 */
export function formatApiError(err: ApiError): string {
  const status = err.status > 0 ? String(err.status) : 'network error'
  return `data unavailable — ${status} from ${err.endpoint}: ${err.message}`
}

/** Pull the most useful message out of an error response body. */
export async function readApiError(res: Response, endpoint: string): Promise<ApiError> {
  let message = res.statusText || 'request failed'
  let code: string | undefined
  try {
    const text = await res.text()
    if (text) {
      try {
        const body = JSON.parse(text) as { error?: string; message?: string; code?: string }
        message = body?.error ?? body?.message ?? text.slice(0, 300)
        code = body?.code
      } catch {
        message = text.slice(0, 300)
      }
    }
  } catch {
    /* body already consumed or unreadable — keep the statusText */
  }
  return { status: res.status, endpoint, message, code }
}

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
      try {
        const res = await fetch(endpoint, { ...initRef.current, signal: ctrl.signal })
        if (cancelled) return
        setStatus(res.status)
        if (!res.ok) {
          setError(await readApiError(res, endpoint))
          setData(null)
          return
        }
        const parsed = (await res.json()) as T
        if (cancelled) return
        setData(parsed)
        setError(null)
      } catch (e) {
        if (cancelled || ctrl.signal.aborted) return
        setStatus(0)
        setData(null)
        setError({
          status: 0,
          endpoint,
          message: e instanceof Error ? e.message : 'could not reach the server',
        })
      } finally {
        if (!cancelled) setLoading(false)
      }
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

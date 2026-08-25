// Shared "never swallow a bad response" fetch primitives — TOD-654 follow-up.
//
// The repo-wide anti-pattern this replaces parsed every response body without
// looking at `res.ok`, then coerced it with `?? []`. A 403/500 body is an
// object, so the coercion silently produced an empty array and the tab rendered
// "No issues found" over a permission error. Every loader must be able to tell
// "nothing there" apart from "the server refused".
//
// This module has no React dependency on purpose: client hooks
// (hooks/useApiData.ts), client event handlers and server route handlers all
// share the same error shape and the same wording.

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
 * The one sentence every surface shows when a load fails. Kept in one place so
 * the wording — and therefore what an auditor can grep for — is identical
 * everywhere: `data unavailable — 403 from /api/issues: <server message>`.
 */
export function formatApiError(err: ApiError, label = 'data unavailable'): string {
  const status = err.status > 0 ? String(err.status) : 'network error'
  return `${label} — ${status} from ${err.endpoint}: ${err.message}`
}

/**
 * One readable line out of a non-JSON error body.
 *
 * A JSON endpoint answering with HTML means the request never reached a
 * handler — a dev-server error page, a proxy, a wrong path. Pasting the
 * document into a red bar ("data unavailable — 404 from /api/tasks:
 * <!DOCTYPE html><html lang=…") tells the operator nothing and pushes the
 * status code off screen, so say what actually happened instead.
 */
function readableBody(text: string, status: number): string {
  const trimmed = text.trim()
  if (!trimmed) return ''
  if (!/^<(!doctype|html|\?xml)/i.test(trimmed)) return trimmed.replace(/\s+/g, ' ').slice(0, 300)
  const title = /<title[^>]*>([^<]{1,120})<\/title>/i.exec(trimmed)?.[1]?.trim()
  const suffix = title ? ` — page title: ${title}` : ''
  return status === 404
    ? `no such endpoint; the server returned an HTML page${suffix}`
    : `the server returned an HTML error page instead of JSON${suffix}`
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
        message = body?.error ?? body?.message ?? readableBody(text, res.status)
        code = body?.code
      } catch {
        message = readableBody(text, res.status) || message
      }
    }
  } catch {
    /* body already consumed or unreadable — keep the statusText */
  }
  return { status: res.status, endpoint, message, code }
}

/** Discriminated result: exactly one of `data` / `error` is non-null. */
export type JsonResult<T> =
  | { ok: true; data: T; error: null; status: number }
  | { ok: false; data: null; error: ApiError; status: number }

/**
 * One-shot JSON fetch for imperative call sites (event handlers, polling
 * loops, server route fan-out) that cannot use the `useApiData` hook.
 * Never throws and never returns a parsed body for a non-ok response.
 */
export async function fetchJson<T>(endpoint: string, init?: RequestInit): Promise<JsonResult<T>> {
  let res: Response
  try {
    res = await fetch(endpoint, init)
  } catch (e) {
    return {
      ok: false,
      data: null,
      status: 0,
      error: {
        status: 0,
        endpoint,
        message: e instanceof Error ? e.message : 'could not reach the server',
      },
    }
  }
  if (!res.ok) {
    return { ok: false, data: null, status: res.status, error: await readApiError(res, endpoint) }
  }
  try {
    return { ok: true, data: (await res.json()) as T, error: null, status: res.status }
  } catch (e) {
    return {
      ok: false,
      data: null,
      status: res.status,
      error: {
        status: res.status,
        endpoint,
        message: e instanceof Error ? `invalid JSON in response: ${e.message}` : 'invalid JSON in response',
      },
    }
  }
}

/**
 * `fetchJson` for callers that only want the payload and are happy to treat a
 * failure as "nothing" — but explicitly, at the call site, instead of by
 * accident. Returns null (never an empty object) when the request failed.
 */
export async function fetchJsonOrNull<T>(endpoint: string, init?: RequestInit): Promise<T | null> {
  const r = await fetchJson<T>(endpoint, init)
  return r.ok ? r.data : null
}

/**
 * `fetchJson` for `Promise.allSettled` fan-out (server routes): a non-ok
 * response rejects, so the caller's existing `status === 'fulfilled'` check
 * keeps meaning "this upstream actually answered with data". Without this a
 * 401 body from an upstream API arrives as a fulfilled value and gets read as
 * though it were a real reading.
 */
export async function fetchJsonOrThrow<T>(endpoint: string, init?: RequestInit): Promise<T> {
  const r = await fetchJson<T>(endpoint, init)
  if (!r.ok) throw new Error(formatApiError(r.error, 'upstream unavailable'))
  return r.data
}

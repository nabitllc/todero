// Server-internal call authentication.
//
// Todero makes server-to-server calls to its own API (cron routes, watchdogs,
// agent callbacks). Those calls carry no browser session, and the previous
// middleware handled that by treating "no cookie" as "must be internal, let it
// through" — which meant any anonymous caller on the internet was treated as
// internal. That is how anonymous DELETE on /api/issues returned 200.
//
// The fix is to make internal calls prove it with a shared secret instead of
// being inferred from the absence of evidence.
//
// Edge-runtime safe: no node:crypto, no Buffer.

const HEADER = 'x-todero-internal'

/** Constant-time string compare — avoids leaking the secret through timing. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * True when the request carries a valid internal secret.
 * Returns false when no secret is configured — absence of configuration must
 * never grant access.
 */
export function isInternalCall(headers: { get(name: string): string | null }): boolean {
  const expected = process.env.TODERO_INTERNAL_SECRET
  if (!expected || expected.length < 16) return false
  const presented = headers.get(HEADER)
  if (!presented) return false
  return safeEqual(presented, expected)
}

/** Headers to attach when Todero calls its own API server-side. */
export function internalHeaders(): Record<string, string> {
  const secret = process.env.TODERO_INTERNAL_SECRET
  return secret ? { [HEADER]: secret } : {}
}

export const INTERNAL_HEADER_NAME = HEADER

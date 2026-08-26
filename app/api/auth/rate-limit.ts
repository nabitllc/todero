// ─── Brute-force limiting for the login handshake ────────────────────────────
//
// Todero authenticates with SHARED PASSWORDS whose values double as the session
// cookie (see ./route.ts). There are three of them, they are short, and until
// this file existed an attacker could try them without limit: measured on
// 2026-08-26, twelve consecutive wrong passwords against POST /api/auth all
// answered 401 in sequence with no throttle, and a thirteenth request carrying
// the real password answered 200.
//
// ─── ROUND 2, 2026-08-26: A CORRECTION AND THREE FIXES ──────────────────────
//
// CORRECTION. This header used to say "This module is the only thing standing
// between that and an online guessing attack that runs as fast as the network
// allows." THAT WAS FALSE, and it was false in a way the author had the facts
// for: because the `mc-auth` cookie IS the password, `middleware.ts`'s
// `hasValidSession()` compares a guess against all three passwords on EVERY
// `/api/` request and answers 401 or 200 accordingly — an unthrottled password
// oracle that never touches this file. Measured against the running dev server:
//
//     30 requests, GET /api/projects, Cookie: mc-auth=guess-N
//       -> 401 x30, no throttling of any kind
//     the same request with the real value
//       -> 200
//     GET /settings leaks it too: 307 when wrong, 200 when right
//
// So an attacker never has to visit the login endpoint at all, and this file
// limits only the door they have no reason to use. Closing the oracle requires
// `mc-auth` to stop being the password — that is Shape A in the piece doc, it
// needs an edit to `middleware.ts`, and `middleware.ts` is not in this lane's
// ownership. It is filed as a seam request with an exact diff in
// docs/rebuild/pieces/pieces8/identity-sessions.md §10. UNTIL THAT LANDS, THIS
// LIMITER IS A SPEED BUMP ON ONE OF TWO DOORS. It is not the last line of
// defence and this comment will not claim it is.
//
// FIX 1 — environment values may only ever TIGHTEN. The previous version
// clamped `MC_AUTH_WINDOW_MS` to a MINIMUM of 1000ms and accepted it. Proven
// with the real class under an injected clock: with `MC_AUTH_WINDOW_MS=1000`,
// one address was allowed 600 guesses per 60 simulated seconds — 864,000 a day,
// a 900x weakening — while the doc claimed "there is no environment value that
// disables it ... clamped to sane ranges". The old env test only ever varied
// `MC_AUTH_MAX_FAILURES`, never the window, so nothing caught it. Each variable
// is now bounded on the side that makes the limiter STRICTER, so no setting of
// any of them can enlarge the guessing budget. See `tighteningIntFromEnv`.
//
// FIX 2 — a success no longer buys unlimited forgiveness. `recordSuccess`
// deleted the client's whole failure history, so anyone holding ANY ONE of the
// three passwords — the read-only viewer password, say — could interleave one
// correct login every ten guesses and grind on the other two forever, bounded
// only by the global counter. Forgiveness is now once per window per key: the
// operator who mistypes twice and then gets it right is unaffected, and the
// grinder's budget is bounded at 2x maxFailures per window instead of infinite.
//
// FIX 3 — the global backstop is no longer a workspace-wide denial-of-service.
// It was one: measured with the real class over ten full windows, an attacker
// re-topping the global counter whenever a slot freed (about one request per
// second) refused the honest operator's CORRECT password on 5,994 of 6,000
// attempts — 99.9% — indefinitely, unauthenticated, with no allowlist and no
// off switch. A client that has itself authenticated successfully inside
// `trustWindowMs` is now exempt from the GLOBAL counter (never from its own
// per-client counter). See `check` for why that exemption is not a hole.
//
// ─── The two counters ───────────────────────────────────────────────────────
//
//   1. PER CLIENT — keyed on the best client address the request carries.
//      Cheap, precise, and the one that actually stops a single attacker.
//   2. GLOBAL — one unkeyed counter across the whole endpoint. The per-client
//      key is derived from proxy headers, and proxy headers are attacker
//      supplied: an attacker who rotates `X-Forwarded-For` gets a fresh
//      per-client bucket on every request. The global counter is the backstop
//      that header rotation cannot move.
//
// SUCCESSFUL logins are not counted. Only failures are. An operator who types
// the right password all day is never throttled by this file.
//
// SCOPE — what this does NOT do, so nobody mistakes it for more:
//   * It does not close the cookie oracle above. That is the bigger door.
//   * State is per process and in memory. Restarting the server clears it, and
//     two server processes do not share a budget. There is no store the login
//     route can reach that would fix that without a schema change; a durable
//     counter belongs to the real-sessions plan, not to this file.
//   * It does not make the passwords stronger, give anyone an identity, or
//     make an already-stolen cookie stop working.

/** Why a request was refused. `ok` means it was not. */
export type RateLimitReason = 'ok' | 'per-client' | 'global'

export interface RateLimitDecision {
  allowed: boolean
  reason: RateLimitReason
  /** Seconds until the caller may reasonably try again. `0` when allowed. */
  retryAfterSeconds: number
}

export interface AuthRateLimiterOptions {
  /** Failures from one client, inside one window, before that client is refused. */
  maxFailures?: number
  /** Sliding window length in milliseconds. */
  windowMs?: number
  /** Failures from EVERYONE, inside one window, before all logins are refused. */
  globalMaxFailures?: number
  /** Injectable clock. Tests use it to prove the window actually drains. */
  now?: () => number
  /** Ceiling on tracked client keys, so spoofed addresses cannot exhaust memory. */
  maxTrackedKeys?: number
  /** How long a successful login exempts that client from the GLOBAL counter. */
  trustWindowMs?: number
}

const DEFAULT_MAX_FAILURES = 10
const DEFAULT_WINDOW_MS = 15 * 60 * 1000
const DEFAULT_GLOBAL_MAX_FAILURES = 100
const DEFAULT_MAX_TRACKED_KEYS = 10_000
const DEFAULT_TRUST_WINDOW_MS = 12 * 60 * 60 * 1000

/**
 * Read a positive integer out of the environment that may only make the
 * limiter STRICTER, FAILING CLOSED.
 *
 * `direction` says which way is stricter for this variable:
 *   'lower'  — fewer failures allowed is stricter, so the default is the MAX.
 *   'higher' — a longer window is stricter (the same failure budget is spread
 *              over more time), so the default is the MIN.
 *
 * Anything that is not an integer on the strict side of the default — empty,
 * `0`, `-1`, `"unlimited"`, `NaN`, a float, or a value that would LOOSEN the
 * limiter — is ignored and the default is used.
 *
 * THIS IS THE PROPERTY THE PREVIOUS VERSION CLAIMED AND DID NOT HAVE. It let
 * `MC_AUTH_WINDOW_MS=1000` through, which multiplied the guessing budget by 900
 * (measured: 864,000 guesses/day for one address). "There is deliberately no
 * value that turns this limiter off" is only worth saying if there is also no
 * value that guts it, and now there is not: every accepted value refuses at
 * least as much as the default does.
 */
function tighteningIntFromEnv(
  name: string,
  fallback: number,
  direction: 'lower' | 'higher',
  hardBound: number,
): number {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return fallback
  const n = Number(raw)
  if (!Number.isInteger(n)) return fallback
  if (direction === 'lower') {
    // Stricter means smaller. Accept [1, fallback].
    return n >= 1 && n <= fallback ? n : fallback
  }
  // Stricter means larger. Accept [fallback, hardBound].
  return n >= fallback && n <= hardBound ? n : fallback
}

export class AuthRateLimiter {
  private readonly maxFailures: number
  private readonly windowMs: number
  private readonly globalMaxFailures: number
  private readonly maxTrackedKeys: number
  private readonly trustWindowMs: number
  private readonly now: () => number

  /** key -> ascending failure timestamps inside the window */
  private readonly perClient = new Map<string, number[]>()
  /** key -> when this key last had its history forgiven by a success */
  private readonly forgiven = new Map<string, number>()
  /** key -> when this key last presented a CORRECT password */
  private readonly trusted = new Map<string, number>()
  /** ascending failure timestamps across every key */
  private global: number[] = []

  constructor(options: AuthRateLimiterOptions = {}) {
    this.maxFailures =
      options.maxFailures ??
      tighteningIntFromEnv('MC_AUTH_MAX_FAILURES', DEFAULT_MAX_FAILURES, 'lower', DEFAULT_MAX_FAILURES)
    this.windowMs =
      options.windowMs ??
      tighteningIntFromEnv('MC_AUTH_WINDOW_MS', DEFAULT_WINDOW_MS, 'higher', 24 * 60 * 60 * 1000)
    this.globalMaxFailures =
      options.globalMaxFailures ??
      tighteningIntFromEnv(
        'MC_AUTH_GLOBAL_MAX_FAILURES',
        DEFAULT_GLOBAL_MAX_FAILURES,
        'lower',
        DEFAULT_GLOBAL_MAX_FAILURES,
      )
    this.maxTrackedKeys = options.maxTrackedKeys ?? DEFAULT_MAX_TRACKED_KEYS
    this.trustWindowMs = options.trustWindowMs ?? DEFAULT_TRUST_WINDOW_MS
    this.now = options.now ?? (() => Date.now())
  }

  /** Drop every timestamp at or before `cutoff`. Appends are in clock order,
   *  so the survivors are always a suffix. */
  private prune(stamps: number[], cutoff: number): number[] {
    let i = 0
    while (i < stamps.length && stamps[i] <= cutoff) i++
    return i === 0 ? stamps : stamps.slice(i)
  }

  /** When the block lifts: the moment enough of the oldest failures age out
   *  that the count falls back below `limit`. */
  private retryAfter(stamps: number[], limit: number, at: number): number {
    const oldestThatMustExpire = stamps[stamps.length - limit]
    if (oldestThatMustExpire === undefined) return Math.ceil(this.windowMs / 1000)
    return Math.max(1, Math.ceil((oldestThatMustExpire + this.windowMs - at) / 1000))
  }

  /**
   * True when this client presented a CORRECT password recently enough to be
   * treated as a known operator rather than an anonymous stranger.
   */
  private isTrusted(key: string, at: number): boolean {
    const last = this.trusted.get(key)
    if (last === undefined) return false
    if (last <= at - this.trustWindowMs) {
      this.trusted.delete(key)
      return false
    }
    return true
  }

  /**
   * Ask whether this client may make an attempt right now.
   *
   * Callers must run this BEFORE comparing the password, on purpose. A limiter
   * that runs after verification lets the correct guess through on the attempt
   * that finds it, which is the only attempt an attacker cares about. The
   * consequence is deliberate and is the load-bearing property: a blocked
   * client is refused EVEN WITH THE RIGHT PASSWORD.
   *
   * WHY THE TRUSTED EXEMPTION IS NOT A HOLE. The global counter is a lockout,
   * and a lockout an unauthenticated stranger can trigger is a
   * denial-of-service against the whole workspace — measured at 99.9% refusal
   * of the honest operator's correct password, sustained indefinitely for about
   * one request a second. Exempting a client that has ITSELF authenticated
   * successfully inside `trustWindowMs` fixes that, and it cannot be turned
   * into a guessing budget:
   *   * The exemption skips ONLY the global counter. The per-client counter
   *     still applies in full, so a trusted client gets no more attempts per
   *     window than an untrusted one.
   *   * Becoming trusted requires already knowing a password, so it grants an
   *     attacker nothing they did not already have — and rotating
   *     `X-Forwarded-For`, the move the global counter exists to catch, lands
   *     on a fresh untrusted key every time.
   *   * With FIX 2 above, holding one password no longer buys unlimited
   *     per-client forgiveness either, so the bound is real rather than
   *     nominal.
   */
  check(key: string): RateLimitDecision {
    const at = this.now()
    const cutoff = at - this.windowMs

    this.global = this.prune(this.global, cutoff)
    if (this.global.length >= this.globalMaxFailures && !this.isTrusted(key, at)) {
      return {
        allowed: false,
        reason: 'global',
        retryAfterSeconds: this.retryAfter(this.global, this.globalMaxFailures, at),
      }
    }

    const mine = this.prune(this.perClient.get(key) ?? [], cutoff)
    if (mine.length === 0) this.perClient.delete(key)
    else this.perClient.set(key, mine)

    if (mine.length >= this.maxFailures) {
      return {
        allowed: false,
        reason: 'per-client',
        retryAfterSeconds: this.retryAfter(mine, this.maxFailures, at),
      }
    }

    return { allowed: true, reason: 'ok', retryAfterSeconds: 0 }
  }

  /** Record one failed attempt. Only failures are counted. */
  recordFailure(key: string): void {
    const at = this.now()
    const cutoff = at - this.windowMs

    this.global = this.prune(this.global, cutoff)
    this.global.push(at)

    const mine = this.prune(this.perClient.get(key) ?? [], cutoff)
    mine.push(at)
    this.perClient.set(key, mine)

    this.evictIfOverCapacity(cutoff)
  }

  /**
   * Record one successful login.
   *
   * Two effects, and the difference between them matters:
   *
   *  1. The key becomes TRUSTED for `trustWindowMs`, which exempts it from the
   *     GLOBAL lockout (never from its own counter). This is what stops a
   *     stranger from locking the workspace out of its own login.
   *
   *  2. That client's failure history is cleared — but AT MOST ONCE PER
   *     WINDOW. Unconditional clearing was a hole: anyone holding any one of
   *     the three passwords could interleave a correct login every ten guesses
   *     and grind the other two forever. The operator who fat-fingers the
   *     password twice and then gets it right still gets a clean slate; the
   *     grinder is bounded at 2x `maxFailures` per window per key.
   *
   * The GLOBAL counter is deliberately never cleared. If it were, an attacker
   * holding the read-only viewer password could reset the backstop at will.
   */
  recordSuccess(key: string): void {
    const at = this.now()
    this.trusted.set(key, at)

    const lastForgiven = this.forgiven.get(key)
    if (lastForgiven === undefined || lastForgiven <= at - this.windowMs) {
      this.perClient.delete(key)
      this.forgiven.set(key, at)
    }

    this.evictIfOverCapacity(at - this.windowMs)
  }

  /**
   * Keep the key maps bounded. First drop keys holding nothing but expired
   * failures; if still over the ceiling, drop the least-recently-failing keys.
   *
   * Eviction hands an attacker a fresh per-client bucket. That is precisely
   * what the global counter — which is never evicted — exists to catch.
   *
   * `forgiven` and `trusted` are bounded the same way and against the same
   * ceiling, so a flood of spoofed addresses cannot grow them without limit
   * either. Evicting a `trusted` entry only ever costs its owner the global
   * exemption, which fails CLOSED (they are treated as a stranger again).
   */
  private evictIfOverCapacity(cutoff: number): void {
    // The three maps are bounded INDEPENDENTLY, on purpose. An earlier draft
    // trimmed `trusted` and `forgiven` only when `perClient` was over capacity
    // — and `recordSuccess` removes the key from `perClient`, so a caller who
    // holds any one password could rotate `X-Forwarded-For` and log in
    // repeatedly, adding a trust entry per request while `perClient` stayed
    // empty and the trim never ran. Successes are deliberately not rate
    // limited, so that loop had no brake on it at all.
    this.expireTrust()
    this.trimMap(this.forgiven)
    this.trimMap(this.trusted)

    if (this.perClient.size <= this.maxTrackedKeys) return
    for (const [k, stamps] of this.perClient) {
      if (stamps[stamps.length - 1] <= cutoff) this.perClient.delete(k)
    }
    if (this.perClient.size <= this.maxTrackedKeys) return
    const byRecency = [...this.perClient.entries()].sort(
      (a, b) => a[1][a[1].length - 1] - b[1][b[1].length - 1]
    )
    const excess = this.perClient.size - this.maxTrackedKeys
    for (let i = 0; i < excess; i++) this.perClient.delete(byRecency[i][0])
  }

  /** Drop trust entries that have aged out, so the map does not accumulate. */
  private expireTrust(): void {
    const cutoff = this.now() - this.trustWindowMs
    for (const [k, at] of this.trusted) if (at <= cutoff) this.trusted.delete(k)
  }

  /** Drop the oldest entries of a key->timestamp map down to the ceiling. */
  private trimMap(map: Map<string, number>): void {
    if (map.size <= this.maxTrackedKeys) return
    const byAge = [...map.entries()].sort((a, b) => a[1] - b[1])
    const excess = map.size - this.maxTrackedKeys
    for (let i = 0; i < excess; i++) map.delete(byAge[i][0])
  }

  /** Test and diagnostic helper. The routes do not use it. */
  snapshot(): { keys: number; globalFailures: number; trusted: number } {
    return {
      keys: this.perClient.size,
      globalFailures: this.global.length,
      trusted: this.trusted.size,
    }
  }
}

/**
 * The address this request appears to come from.
 *
 * Every source below is a header the client can set, so this value is a HINT,
 * not an identity. It is good enough to separate honest operators from each
 * other and to cost a naive attacker something. The attacker who lies about it
 * is the global counter's problem, not this function's.
 */
export function clientKey(headers: Headers, fallback?: string | null): string {
  const candidates = [
    headers.get('cf-connecting-ip'),
    headers.get('x-real-ip'),
    headers.get('x-forwarded-for')?.split(',')[0],
    fallback,
  ]
  for (const candidate of candidates) {
    const value = candidate?.trim()
    if (value) return value.slice(0, 128)
  }
  return 'unknown'
}

/**
 * Process-wide limiter shared by /api/auth and /api/auth-form.
 *
 * PINNED TO `globalThis` ON PURPOSE, and this is load-bearing rather than
 * stylistic. A plain module-level `new AuthRateLimiter()` does not survive:
 * measured on 2026-08-26 against the running dev server, twelve consecutive
 * wrong passwords from one address all answered 401 with the limiter already
 * deployed and running, because Next's dev compiler re-evaluates the route
 * module and every counter went back to zero between requests. The module
 * registry is not a reliable home for state that must outlive one request; the
 * global object is. (Same reason the Prisma-client-singleton pattern exists.)
 *
 * This still buys exactly ONE process. Separate workers do not share a budget,
 * and a restart clears it — see this file's header.
 */
const GLOBAL_KEY = Symbol.for('todero.auth.rateLimiter')
type LimiterHost = typeof globalThis & { [GLOBAL_KEY]?: AuthRateLimiter }

export const authRateLimiter: AuthRateLimiter =
  ((globalThis as LimiterHost)[GLOBAL_KEY] ??= new AuthRateLimiter())

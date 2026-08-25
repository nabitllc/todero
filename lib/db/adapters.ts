// ─── Adapter registry ────────────────────────────────────────────────────────
//
// The one place that names concrete vendors. `lib/db.ts` picks from this map by
// `TODERO_DB_PROVIDER` and never learns what is behind the key.
//
//   sqlite   — one file under the checkout, through Node's own `node:sqlite`.
//              Needs nothing: no server, no account, no connection string.
//              This is what a fresh clone gets, and what makes
//              `npm run setup && npm run dev` end at a working board.
//   supabase — hosted Postgres behind an HTTP query layer. Needs
//              NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
//   postgres — any Postgres reachable by connection string, over the plain
//              node-postgres driver. Needs DATABASE_URL. This is the adapter a
//              Neon / Vercel-Postgres / RDS / self-hosted move uses unchanged.
//
// Adding a fourth takes one file plus one line here — see the contract at the
// top of `lib/db.ts`, and `pg-adapter.ts` for a worked example that compiles
// the whole seam to SQL.

import type { DbAdapterFactory } from '../db'
import { pgAdapterFactory } from './pg-adapter'
import { sqliteAdapterFactory } from './sqlite-adapter'
import { supabaseAdapterFactory } from './supabase-adapter'

export const DB_ADAPTERS: Record<string, DbAdapterFactory> = {
  [supabaseAdapterFactory.provider]: supabaseAdapterFactory,
  [pgAdapterFactory.provider]: pgAdapterFactory,
  [sqliteAdapterFactory.provider]: sqliteAdapterFactory,
}

/**
 * Provider used when `TODERO_DB_PROVIDER` is unset.
 *
 * The rule is "keep what this install already has, and give a bare clone
 * something that works":
 *
 *   - credentials for the hosted database present  -> `supabase`, unchanged.
 *     Every existing install falls here, so nothing about a configured host
 *     changes by this file existing.
 *   - a DATABASE_URL and nothing else              -> `postgres`.
 *   - neither                                      -> `sqlite`.
 *
 * That last line is the whole point: without it a fresh clone resolves to a
 * provider whose credentials nobody has, and every data route answers 503
 * naming two variables the operator has to go and create an account to get.
 * With it, `npm run setup` finishes its own job. Setting TODERO_DB_PROVIDER
 * explicitly always wins over all of this.
 */
function detectProvider(): string {
  // A value copied straight out of .env.local.template is not a value. Without
  // this, uncommenting `NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT…` and
  // leaving it would pick a provider whose credentials do not exist — the
  // 503-on-a-fresh-clone this function exists to prevent.
  const set = (name: string) => {
    const value = (process.env[name] ?? '').trim()
    return value.length > 0 && !/YOUR_[A-Z0-9_]/.test(value)
  }
  if (set('SUPABASE_SERVICE_ROLE_KEY') || set('NEXT_PUBLIC_SUPABASE_URL')) {
    return supabaseAdapterFactory.provider
  }
  if (set('DATABASE_URL')) return pgAdapterFactory.provider
  return sqliteAdapterFactory.provider
}

export const DEFAULT_DB_PROVIDER: string = detectProvider()

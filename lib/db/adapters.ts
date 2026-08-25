// ─── Adapter registry ────────────────────────────────────────────────────────
//
// The one place that names concrete vendors. `lib/db.ts` picks from this map by
// `TODERO_DB_PROVIDER` and never learns what is behind the key.
//
//   supabase — hosted Postgres behind an HTTP query layer (the default today).
//              Needs NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY.
//   postgres — any Postgres reachable by connection string, over the plain
//              node-postgres driver. Needs DATABASE_URL. This is the adapter a
//              Neon / Vercel-Postgres / RDS / self-hosted move uses unchanged.
//
// Adding a third takes one file plus one line here — see the contract at the
// top of `lib/db.ts`, and `pg-adapter.ts` for a worked example that compiles
// the whole seam to SQL.

import type { DbAdapterFactory } from '../db'
import { pgAdapterFactory } from './pg-adapter'
import { supabaseAdapterFactory } from './supabase-adapter'

/** Provider used when `TODERO_DB_PROVIDER` is unset. */
export const DEFAULT_DB_PROVIDER = supabaseAdapterFactory.provider

export const DB_ADAPTERS: Record<string, DbAdapterFactory> = {
  [supabaseAdapterFactory.provider]: supabaseAdapterFactory,
  [pgAdapterFactory.provider]: pgAdapterFactory,
}

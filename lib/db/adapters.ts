// ─── Adapter registry ────────────────────────────────────────────────────────
//
// The one place that names concrete vendors. `lib/db.ts` picks from this map by
// `TODERO_DB_PROVIDER` and never learns what is behind the key.
//
// To add Postgres-on-Vercel (Neon):
//   1. write `lib/db/neon-adapter.ts` satisfying the `DbAdapter` contract in
//      `lib/db.ts` (see the extension-point note in supabase-adapter.ts),
//   2. import it here and add `[neonAdapterFactory.provider]: neonAdapterFactory`,
//   3. set `TODERO_DB_PROVIDER=neon`.
// Nothing else in the app changes.

import type { DbAdapterFactory } from '../db'
import { supabaseAdapterFactory } from './supabase-adapter'

/** Provider used when `TODERO_DB_PROVIDER` is unset. */
export const DEFAULT_DB_PROVIDER = supabaseAdapterFactory.provider

export const DB_ADAPTERS: Record<string, DbAdapterFactory> = {
  [supabaseAdapterFactory.provider]: supabaseAdapterFactory,
  // [neonAdapterFactory.provider]: neonAdapterFactory,  // ← next adapter goes here
}

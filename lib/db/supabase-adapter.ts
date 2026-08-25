// ─── Supabase adapter ────────────────────────────────────────────────────────
//
// Together with `supabase-env.ts`, the ONLY place in the app that imports the
// Supabase SDK or knows the names of the Supabase environment variables.
// Everything else goes through `lib/db.ts`.
//
// Supabase is used here as plain hosted Postgres + PostgREST: no Storage, no
// Realtime, no channels, no auth-as-a-service. That is what makes the seam in
// lib/db.ts cheap, and what makes a future `lib/db/neon-adapter.ts` a drop-in.
//
// ── EXTENSION POINT ─────────────────────────────────────────────────────────
// To add Postgres-on-Vercel (Neon), create `lib/db/neon-adapter.ts` exporting a
// `DbAdapterFactory` shaped exactly like `supabaseAdapterFactory` below, and
// register it in `lib/db/adapters.ts` under the key `'neon'`. The contract it
// must satisfy is the `DbAdapter` / `DbQueryBuilder` / `DbResult` triple
// documented in `lib/db.ts`. Do not add a second code path anywhere else.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { DbAdapter, DbAdapterFactory, DbQueryBuilder, DbResult, DbRow } from '../db'
import { assertSupabaseConfigured, readSupabaseEnv, supabaseMissingEnv } from './supabase-env'

let client: SupabaseClient | null = null

function getClient(): SupabaseClient {
  assertSupabaseConfigured()
  if (!client) {
    client = createClient(
      readSupabaseEnv('NEXT_PUBLIC_SUPABASE_URL'),
      readSupabaseEnv('SUPABASE_SERVICE_ROLE_KEY'),
      { auth: { persistSession: false, autoRefreshToken: false } },
    )
  }
  return client
}

export const supabaseAdapterFactory: DbAdapterFactory = {
  provider: 'supabase',
  create(): DbAdapter {
    return {
      provider: 'supabase',
      missingEnv: supabaseMissingEnv,
      // The SDK's builder already implements the fluent surface `DbQueryBuilder`
      // describes; the cast is the single, deliberate boundary between the
      // vendor's generic types and the app's vendor-neutral contract. Keeping it
      // here means no call site above the seam ever sees a vendor type.
      from: (table: string) => getClient().from(table) as unknown as DbQueryBuilder,
      rpc: (fn: string, params?: DbRow) =>
        getClient().rpc(fn, params) as unknown as PromiseLike<DbResult>,
    }
  },
}

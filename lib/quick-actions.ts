// INF-206: Quick-action floating button — schema, types, and data layer
import { db, type DbAdapter, type DbError } from '@/lib/db'

// TOD: kill-fake-infra-greens — client-safe types/defaults moved to
// lib/quick-actions-constants.ts (see that file for why); re-exported here so
// existing server-side callers see no change. New client code should import
// lib/quick-actions-constants directly rather than through this file.
export type { QuickActionType, QuickAction } from '@/lib/quick-actions-constants'
export { DEFAULT_QUICK_ACTIONS } from '@/lib/quick-actions-constants'
import { DEFAULT_QUICK_ACTIONS, type QuickAction } from '@/lib/quick-actions-constants'

// Lazy-init: avoids crashing at build time when the database credentials aren't
// set (CI). First call throws if still missing. (TOD-2296)
let _supabase: DbAdapter | null = null
function getSupabase(): DbAdapter {
  if (!_supabase) {
    _supabase = db()
  }
  return _supabase
}

// ── Data layer (persisted actions — optional, falls back to defaults) ──────

/**
 * Falls back to DEFAULT_QUICK_ACTIONS only when the query genuinely found no
 * rows (a fresh workspace that never customized its actions) — never when the
 * query itself failed. It used to fabricate the same four default rows with
 * a fresh `created_at` on ANY error, including a missing `quick_actions`
 * table, which made `/api/quick-actions` return 200 with invented data on
 * exactly the failure `/api/health` now reports as a 503. A missing table is
 * now returned as an error, exactly like every other query in this codebase,
 * so the route can answer with the same honest 424 as the rest of the API
 * (see app/api/quick-actions/route.ts).
 */
export async function listQuickActions(): Promise<{ data: QuickAction[]; error: DbError | null }> {
  const { data, error } = await getSupabase()
    .from('quick_actions')
    .select('*')
    .eq('enabled', true)
    .order('sort_order', { ascending: true })
  if (error) return { data: [], error }
  if (!data?.length) {
    // Return defaults as QuickAction shape
    return {
      data: DEFAULT_QUICK_ACTIONS.map((a, i) => ({
        ...a,
        id: `default-${i}`,
        created_at: new Date().toISOString(),
      })),
      error: null,
    }
  }
  return { data: data as QuickAction[], error: null }
}

export async function upsertQuickAction(action: Partial<QuickAction> & { label: string }) {
  const { data, error } = await getSupabase()
    .from('quick_actions')
    .upsert(action, { onConflict: 'id' })
    .select()
    .single()
  return { data: data as QuickAction | null, error }
}

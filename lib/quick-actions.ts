// INF-206: Quick-action floating button — schema, types, and data layer
import { db, type DbAdapter } from '@/lib/db'

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

export async function listQuickActions(): Promise<QuickAction[]> {
  const { data, error } = await getSupabase()
    .from('quick_actions')
    .select('*')
    .eq('enabled', true)
    .order('sort_order', { ascending: true })
  if (error || !data?.length) {
    // Return defaults as QuickAction shape
    return DEFAULT_QUICK_ACTIONS.map((a, i) => ({
      ...a,
      id: `default-${i}`,
      created_at: new Date().toISOString(),
    }))
  }
  return data as QuickAction[]
}

export async function upsertQuickAction(action: Partial<QuickAction> & { label: string }) {
  const { data, error } = await getSupabase()
    .from('quick_actions')
    .upsert(action, { onConflict: 'id' })
    .select()
    .single()
  return { data: data as QuickAction | null, error }
}

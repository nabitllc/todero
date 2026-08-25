// INF-221: Theme selector — schema, types, and data layer
import { db, type DbAdapter } from '@/lib/db'

// TOD: kill-fake-infra-greens — the client-safe types/data used to live here,
// which meant any client component reaching for THEMES pulled in lib/db.ts
// (and, transitively, the `pg` package's Node-only `fs` dependency) into the
// browser bundle and broke every route on this host. They now live in
// lib/theme-constants.ts; re-exported here so existing server-side callers
// (app/api/theme/route.ts) see no change. New client code should import
// lib/theme-constants directly rather than through this file.
export type { ThemeId, ThemeConfig } from '@/lib/theme-constants'
export { THEMES, THEME_IDS } from '@/lib/theme-constants'
import { THEMES, type ThemeId } from '@/lib/theme-constants'

// Lazy-init: avoids crashing at build time when the database credentials aren't
// set (CI). First call throws if still missing. (TOD-2296)
let _supabase: DbAdapter | null = null
function getSupabase(): DbAdapter {
  if (!_supabase) {
    _supabase = db()
  }
  return _supabase
}

// ── User preference (key-value in agent_memory table) ──────────────────────

const THEME_KEY = 'mc_theme'

export async function getThemePreference(): Promise<ThemeId> {
  const { data } = await getSupabase()
    .from('agent_memory')
    .select('value')
    .eq('agent_id', 'system')
    .eq('key', THEME_KEY)
    .maybeSingle()
  const val = data?.value
  if (typeof val === 'string' && val in THEMES) return val as ThemeId
  return 'dark'
}

export async function setThemePreference(themeId: ThemeId) {
  const { error } = await getSupabase()
    .from('agent_memory')
    .upsert(
      { agent_id: 'system', key: THEME_KEY, value: themeId, updated_at: new Date().toISOString() },
      { onConflict: 'agent_id,key' }
    )
  return { error }
}

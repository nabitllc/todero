// INF-206: Quick-action floating button — schema, types, and data layer
import { createClient, SupabaseClient } from '@supabase/supabase-js'

const SUPA_URL = 'https://twthgapiouiqhavrcnry.supabase.co'

// Lazy-init: avoids crashing at build time when SUPABASE_SERVICE_ROLE_KEY isn't
// set (CI). First call throws if still missing. (TOD-2296)
let _supabase: SupabaseClient | null = null
function getSupabase(): SupabaseClient {
  if (!_supabase) {
    _supabase = createClient(SUPA_URL, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  }
  return _supabase
}

// ── Types ──────────────────────────────────────────────────────────────────

export type QuickActionType = 'create_issue' | 'start_chat' | 'run_agent' | 'navigate' | 'custom'

export interface QuickAction {
  id: string
  label: string
  icon: string
  action_type: QuickActionType
  payload: Record<string, unknown>
  sort_order: number
  enabled: boolean
  created_at: string
}

// ── Default quick actions (no DB needed for v1) ────────────────────────────

export const DEFAULT_QUICK_ACTIONS: Omit<QuickAction, 'id' | 'created_at'>[] = [
  { label: 'New Issue',     icon: '📝', action_type: 'create_issue', payload: {},                       sort_order: 0, enabled: true },
  { label: 'New Chat',      icon: '💬', action_type: 'start_chat',   payload: {},                       sort_order: 1, enabled: true },
  { label: 'Run Builder',   icon: '🔨', action_type: 'run_agent',    payload: { agent: 'builder' },     sort_order: 2, enabled: true },
  { label: 'Go to Board',   icon: '📋', action_type: 'navigate',     payload: { tab: 'board' },         sort_order: 3, enabled: true },
  { label: 'Go to Infra',   icon: '⚙️', action_type: 'navigate',     payload: { tab: 'infra' },         sort_order: 4, enabled: true },
]

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

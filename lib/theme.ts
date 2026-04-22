// INF-221: Theme selector — schema, types, and data layer
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

export type ThemeId = 'dark' | 'midnight' | 'slate' | 'abyss'

export interface ThemeConfig {
  id: ThemeId
  label: string
  bg: string
  surface: string
  border: string
  textPrimary: string
  textSecondary: string
  accent: string
}

// ── Built-in themes ────────────────────────────────────────────────────────

export const THEMES: Record<ThemeId, ThemeConfig> = {
  dark: {
    id: 'dark',
    label: 'Dark (Default)',
    bg: '#080808',
    surface: '#0f0f0f',
    border: 'rgba(255,255,255,0.1)',
    textPrimary: '#ffffff',
    textSecondary: 'rgba(255,255,255,0.5)',
    accent: '#3b82f6',
  },
  midnight: {
    id: 'midnight',
    label: 'Midnight Blue',
    bg: '#0a0e1a',
    surface: '#111827',
    border: 'rgba(99,102,241,0.15)',
    textPrimary: '#e0e7ff',
    textSecondary: 'rgba(165,180,252,0.5)',
    accent: '#6366f1',
  },
  slate: {
    id: 'slate',
    label: 'Slate',
    bg: '#0f1419',
    surface: '#1a1f2e',
    border: 'rgba(148,163,184,0.12)',
    textPrimary: '#e2e8f0',
    textSecondary: 'rgba(148,163,184,0.5)',
    accent: '#38bdf8',
  },
  abyss: {
    id: 'abyss',
    label: 'Abyss',
    bg: '#050505',
    surface: '#0a0a0a',
    border: 'rgba(255,255,255,0.06)',
    textPrimary: '#d4d4d4',
    textSecondary: 'rgba(255,255,255,0.3)',
    accent: '#10b981',
  },
}

export const THEME_IDS = Object.keys(THEMES) as ThemeId[]

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

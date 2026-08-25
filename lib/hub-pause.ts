// TOD-632: Shared hub pause state reader
import { db, type DbAdapter } from '@/lib/db'


// Lazy-init: avoids crashing at build time when SUPABASE_SERVICE_ROLE_KEY isn't
// set (CI). First call throws if still missing. (TOD-2296)
let _supabase: DbAdapter | null = null
function getSupabase(): DbAdapter {
  if (!_supabase) {
    _supabase = db()
  }
  return _supabase
}

export async function isHubPaused(): Promise<boolean> {
  try {
    const { data, error } = await getSupabase()
      .from('agent_memory')
      .select('value')
      .eq('agent_id', 'system')
      .eq('key', 'hub_pause')
      .single()
    if (error || !data?.value) return false
    const val = typeof data.value === 'string' ? JSON.parse(data.value) : data.value
    return val?.paused === true
  } catch {
    return false
  }
}

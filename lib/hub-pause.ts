// TOD-632: Shared hub pause state reader
import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = 'https://twthgapiouiqhavrcnry.supabase.co'
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

export async function isHubPaused(): Promise<boolean> {
  try {
    const { data, error } = await supabase
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

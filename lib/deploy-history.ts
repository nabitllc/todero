// INF-209: Deploy history log — schema, types, and data layer
import { db, type DbAdapter } from '@/lib/db'


let _supabase: DbAdapter | null = null
function getSupabase(): DbAdapter {
  if (!_supabase) {
    _supabase = db()
  }
  return _supabase
}

// ── Types ──────────────────────────────────────────────────────────────────

export type DeployStatus = 'pending' | 'building' | 'ready' | 'error' | 'canceled'
export type DeploySource = 'vercel' | 'manual' | 'github_action'

export interface DeployRecord {
  id: string
  project: string
  branch: string
  commit_sha: string | null
  commit_message: string | null
  status: DeployStatus
  source: DeploySource
  url: string | null
  triggered_by: string | null
  duration_ms: number | null
  error_message: string | null
  created_at: string
  finished_at: string | null
}

// ── Data layer ─────────────────────────────────────────────────────────────

export async function listDeploys(opts?: { project?: string; limit?: number }) {
  let query = getSupabase()
    .from('deploy_history')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(opts?.limit ?? 50)

  if (opts?.project) query = query.eq('project', opts.project)
  const { data, error } = await query
  return { data: (data ?? []) as DeployRecord[], error }
}

export async function insertDeploy(record: Omit<DeployRecord, 'id' | 'created_at'>) {
  const { data, error } = await getSupabase()
    .from('deploy_history')
    .insert(record)
    .select()
    .single()
  return { data: data as DeployRecord | null, error }
}

export async function updateDeploy(id: string, fields: Partial<DeployRecord>) {
  const { data, error } = await getSupabase()
    .from('deploy_history')
    .update(fields)
    .eq('id', id)
    .select()
    .single()
  return { data: data as DeployRecord | null, error }
}

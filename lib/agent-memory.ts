// Shared agent memory — read/write structured knowledge across agents.
// All access goes through the database seam in `lib/db.ts`.
import { db } from '@/lib/db'

export async function rememberFact(agentId: string, key: string, value: unknown) {
  await db()
    .from('agent_memory')
    // No explicit conflict target: the seam falls back to the table's primary
    // key, which is what this call site has always relied on.
    .upsert({ agent_id: agentId, key, value, updated_at: new Date().toISOString() })
}

export async function recallFact(agentId: string, key: string): Promise<unknown | null> {
  const { data } = await db()
    .from('agent_memory')
    .select('value')
    .eq('agent_id', agentId)
    .eq('key', key)
    .limit(1)
  return data?.[0]?.value ?? null
}

export async function recallAll(agentId: string): Promise<Record<string, unknown>> {
  const { data } = await db()
    .from('agent_memory')
    .select('key,value')
    .eq('agent_id', agentId)
    .order('updated_at', { ascending: false })
  const rows = (data ?? []) as { key: string; value: unknown }[]
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
}

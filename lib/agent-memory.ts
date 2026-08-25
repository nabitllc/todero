// Shared agent memory — read/write structured knowledge across agents.
// All access goes through the database seam in `lib/db.ts`.
import { db } from '@/lib/db'

/**
 * Throws on a failed write rather than swallowing it — a caller storing a
 * fact has to know whether it actually landed.
 *
 * onConflict is load-bearing: agent_memory's real uniqueness is
 * UNIQUE(agent_id, key) (it predates the migrations directory — see
 * migrations/016_agent_documents.sql's note), not its `id` primary key. The
 * old "no explicit conflict target" comment here was wrong about what the
 * seam falls back to: the table's primary key, `id`, which this payload
 * never supplies — so every call INSERTed a fresh row instead of updating
 * the existing one, silently, with no error.
 */
export async function rememberFact(agentId: string, key: string, value: unknown): Promise<void> {
  const { error } = await db()
    .from('agent_memory')
    .upsert(
      { agent_id: agentId, key, value, updated_at: new Date().toISOString() },
      { onConflict: 'agent_id,key' },
    )
  if (error) {
    throw new Error(`[agent-memory] rememberFact(${agentId}, ${key}) failed: ${error.message}`)
  }
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

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

/**
 * Throws on a failed read, mirroring `rememberFact` — the same class of
 * defect the memory-retrieval-relevance piece's round-4 critic found in
 * `lib/memory-retrieval.ts`'s searchSqliteFts (a store failure other than
 * one literal string classified as "searched, nothing there"), present here
 * too: the old `const { data } = await db()...` discarded `error` entirely,
 * so a table that does not exist, a connection failure, or any other driver
 * error came back as `data === undefined` — indistinguishable from "the
 * table exists and this agent genuinely has no memory for that key" (which
 * is `data === []`/`null` with no error). A caller cannot tell "fact is
 * absent" from "the store could not be read" from a bare `null`, and would
 * silently proceed as if the fact were simply never remembered.
 */
export async function recallFact(agentId: string, key: string): Promise<unknown | null> {
  const { data, error } = await db()
    .from('agent_memory')
    .select('value')
    .eq('agent_id', agentId)
    .eq('key', key)
    .limit(1)
  if (error) {
    throw new Error(`[agent-memory] recallFact(${agentId}, ${key}) failed: ${error.message}`)
  }
  return data?.[0]?.value ?? null
}

/** Throws on a failed read — see `recallFact`. */
export async function recallAll(agentId: string): Promise<Record<string, unknown>> {
  const { data, error } = await db()
    .from('agent_memory')
    .select('key,value')
    .eq('agent_id', agentId)
    .order('updated_at', { ascending: false })
  if (error) {
    throw new Error(`[agent-memory] recallAll(${agentId}) failed: ${error.message}`)
  }
  const rows = (data ?? []) as { key: string; value: unknown }[]
  return Object.fromEntries(rows.map(r => [r.key, r.value]))
}

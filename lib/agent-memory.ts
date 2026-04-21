// Shared agent memory — read/write structured knowledge across agents
const SUPA_URL = 'https://twthgapiouiqhavrcnry.supabase.co'
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const HEADERS = {
  'apikey': SUPA_KEY,
  'Authorization': `Bearer ${SUPA_KEY}`,
  'Content-Type': 'application/json',
}

export async function rememberFact(agentId: string, key: string, value: unknown) {
  await fetch(`${SUPA_URL}/rest/v1/agent_memory`, {
    method: 'POST',
    headers: { ...HEADERS, 'Prefer': 'resolution=merge-duplicates' },
    body: JSON.stringify({ agent_id: agentId, key, value, updated_at: new Date().toISOString() }),
  })
}

export async function recallFact(agentId: string, key: string): Promise<unknown | null> {
  const res = await fetch(`${SUPA_URL}/rest/v1/agent_memory?agent_id=eq.${agentId}&key=eq.${encodeURIComponent(key)}&limit=1`, {
    headers: HEADERS,
  })
  const data = await res.json()
  return data[0]?.value ?? null
}

export async function recallAll(agentId: string): Promise<Record<string, unknown>> {
  const res = await fetch(`${SUPA_URL}/rest/v1/agent_memory?agent_id=eq.${agentId}&order=updated_at.desc`, {
    headers: HEADERS,
  })
  const data = await res.json()
  return Object.fromEntries((data as {key: string, value: unknown}[]).map(r => [r.key, r.value]))
}

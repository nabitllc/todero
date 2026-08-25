// Phase 2.3: Read agent docs from the agent_documents table instead of local files
// TOD-1514 — works on both local and remote access

import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/hub-client'

export async function GET(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const id = params.id
  if (!/^[a-z0-9-]+$/.test(id)) {
    return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  }

  try {
    const db = createAdminClient()
    const { data: docs, error } = await db
      .from('agent_documents')
      .select('doc_type, content')
      .or([
        { column: 'agent_id', op: 'eq', value: id },
        { column: 'agent_id', op: 'eq', value: 'global' },
      ])
      .in('doc_type', ['soul', 'heartbeat', 'agents'])

    if (error) {
      return NextResponse.json({ soul: '', heartbeat: '', agents: '' }, { status: 200 })
    }

    // Prefer agent-specific doc over global if both exist
    const pick = (docType: string) => {
      const agentDoc = docs?.find(d => d.doc_type === docType)
      return agentDoc?.content || ''
    }

    return NextResponse.json(
      { soul: pick('soul'), heartbeat: pick('heartbeat'), agents: pick('agents') },
      { headers: { 'Cache-Control': 'max-age=300, stale-while-revalidate=60' } }
    )
  } catch {
    return NextResponse.json({ soul: '', heartbeat: '', agents: '' }, { status: 200 })
  }
}

import { NextRequest, NextResponse } from 'next/server'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export async function POST(req: NextRequest) {
  try {
    const { agentId, enabled } = await req.json()
    if (!agentId) return NextResponse.json({ error: 'agentId required' }, { status: 400 })

    const action = enabled ? 'enable' : 'disable'
    const { stdout, stderr } = await execAsync(
      `/opt/homebrew/bin/openclaw heartbeat ${action} ${agentId}`,
      { timeout: 8000 }
    )

    return NextResponse.json({
      ok: true,
      agentId,
      enabled,
      output: stdout || stderr,
    })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

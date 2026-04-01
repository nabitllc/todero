import { execFile } from 'child_process'
import { promisify } from 'util'
import { NextRequest, NextResponse } from 'next/server'

const execFileAsync = promisify(execFile)

export const runtime = 'nodejs'

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const prompt = String(body?.prompt || '').trim()
    const agentId = String(body?.agentId || 'main').trim() || 'main'
    const timeoutSeconds = Number(body?.timeoutSeconds || 180)

    if (!prompt) {
      return NextResponse.json({ error: 'prompt required' }, { status: 400 })
    }

    const { stdout, stderr } = await execFileAsync(
      'openclaw',
      [
        'agent',
        '--agent', agentId,
        '--message', prompt,
        '--json',
        '--timeout', String(timeoutSeconds),
      ],
      {
        timeout: timeoutSeconds * 1000 + 10000,
        maxBuffer: 2 * 1024 * 1024,
        env: process.env,
      }
    )

    const parsed = JSON.parse(stdout)
    const text = parsed?.result?.payloads?.[0]?.text || ''
    const meta = parsed?.result?.meta?.agentMeta || {}

    return NextResponse.json({
      ok: true,
      text,
      model: [meta.provider, meta.model].filter(Boolean).join('/'),
      raw: parsed,
      stderr: stderr || '',
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || 'model canary execution failed' },
      { status: 500 }
    )
  }
}

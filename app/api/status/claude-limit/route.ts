import { NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

const STATE_FILE = path.join('/tmp', 'claude-limit-state.json')

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
  } catch {
    return { limited: false, since: null }
  }
}

export async function GET() {
  const state = readState()
  return NextResponse.json({ wasLimited: state.limited, since: state.since })
}

export async function POST(req: NextRequest) {
  const { limited } = await req.json()
  const state = {
    limited,
    since: limited ? new Date().toISOString() : null,
    clearedAt: !limited ? new Date().toISOString() : undefined,
  }
  fs.writeFileSync(STATE_FILE, JSON.stringify(state))
  return NextResponse.json({ ok: true, state })
}

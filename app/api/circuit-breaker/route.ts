// TOD-767: Circuit Breaker API
// GET  /api/circuit-breaker?provider=openrouter  — read state for one or all providers
// POST /api/circuit-breaker — record a provider response { provider, statusCode }

import { NextRequest, NextResponse } from 'next/server'
import {
  recordProviderResponse,
  getBreakerStatus,
  getAllBreakerStatuses,
} from '@/lib/circuit-breaker'

const KNOWN_PROVIDERS = ['openrouter', 'openai', 'ollama', 'anthropic']

export async function GET(req: NextRequest) {
  const provider = req.nextUrl.searchParams.get('provider')

  if (provider) {
    const status = await getBreakerStatus(provider)
    return NextResponse.json(status)
  }

  const statuses = await getAllBreakerStatuses(KNOWN_PROVIDERS)
  return NextResponse.json(statuses)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const { provider, statusCode } = body as { provider?: string; statusCode?: number }

    if (!provider || typeof provider !== 'string') {
      return NextResponse.json({ error: 'provider is required' }, { status: 400 })
    }
    if (typeof statusCode !== 'number') {
      return NextResponse.json({ error: 'statusCode (number) is required' }, { status: 400 })
    }

    const status = await recordProviderResponse(provider, statusCode)
    return NextResponse.json({ ok: true, status })
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

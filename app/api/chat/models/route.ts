// Live model roster for the Chat tab's model dropdown.
//
// Proxies a live GET to `${LLM_BASE_URL}/models` — never a hardcoded vendor
// list. Same-origin proxy so the client never needs to know the LLM host or
// carry its key, and so an unreachable/misconfigured endpoint comes back as
// a normal JSON error the shared fetch hook can render, naming the URL that
// failed.

import { NextResponse } from 'next/server'
import { LLM_BASE_URL, LLM_DEFAULT_MODEL, fetchLiveModels } from '@/lib/llm-provider'

export const runtime = 'nodejs'

export async function GET() {
  const live = await fetchLiveModels()
  if (!live.ok) {
    return NextResponse.json({ error: live.error, base_url: LLM_BASE_URL }, { status: 502 })
  }
  if (live.models.length === 0) {
    return NextResponse.json(
      { error: `${LLM_BASE_URL}/models returned no models — pull one first (e.g. \`ollama pull qwen2.5-coder:7b\`)`, base_url: LLM_BASE_URL },
      { status: 502 },
    )
  }
  return NextResponse.json({
    base_url: LLM_BASE_URL,
    default_model: LLM_DEFAULT_MODEL || live.models[0].id,
    models: live.models,
  })
}

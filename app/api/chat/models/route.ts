// Live model roster for the Chat tab's model dropdown.
//
// Proxies a live GET to `${LLM_BASE_URL}/models` — never a hardcoded vendor
// list. Same-origin proxy so the client never needs to know the LLM host or
// carry its key, and so an unreachable/misconfigured endpoint comes back as
// a normal JSON error the shared fetch hook can render, naming the URL that
// failed.

import { NextResponse } from 'next/server'
import { LLM_BASE_URL, LLM_DEFAULT_MODEL, fetchLiveModels, noModelsError } from '@/lib/llm-provider'

export const runtime = 'nodejs'
// TOD-2456: WITHOUT THIS, THE "LIVE" MODEL LIST IS NOT LIVE. Next 14 caches the
// fetch inside fetchLiveModels for the life of the process, so this route
// served whatever the endpoint said the FIRST time it was hit — forever.
//
// A critic measured it: it killed the endpoint and this route kept answering
// HTTP 200 with the old menu; it started a different endpoint serving one
// different model and this route still served the original two, across six
// calls and a cache-busting query string.
//
// That is the channel goal — "the model list is read live from that endpoint,
// never hardcoded" — failing in the exact way the acceptance list declares
// impossible, and it is WORSE than a hardcoded constant: a constant is
// greppable, this was invisible to every check in the repo including the
// 11-test file written to prevent it.
//
// Fourteen other routes under app/api already set this. The one whose entire
// purpose is liveness did not. POST /api/chat was exempt only because POST
// handlers are dynamic by default, which is why it correctly reported the
// endpoint unreachable in the same second this route was serving a menu.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET() {
  const live = await fetchLiveModels(5000, { includeContextLength: true })
  if (!live.ok) {
    // `kind` is in the body next to the prose so a client can tell an
    // endpoint that is DOWN from one that is the WRONG KIND OF SERVER without
    // parsing the sentence. Before the seam distinguished them, the second
    // case did not reach this branch at all — it arrived as a 200 with an
    // empty menu, identical to a healthy Ollama with nothing pulled.
    return NextResponse.json(
      { error: live.error, kind: live.kind, base_url: LLM_BASE_URL },
      { status: 502 },
    )
  }
  if (live.models.length === 0) {
    // Now reachable ONLY from a genuinely OpenAI-compatible endpoint with an
    // empty roster, so "pull one first" is real advice rather than a guess.
    return NextResponse.json(
      { error: noModelsError(), kind: 'empty-roster', base_url: LLM_BASE_URL },
      { status: 502 },
    )
  }
  return NextResponse.json({
    base_url: LLM_BASE_URL,
    default_model: LLM_DEFAULT_MODEL || live.models[0].id,
    // Two distinct windows, deliberately not collapsed into one number: the
    // client meters against `servedContextLength` (what the loaded slot will
    // actually accept) and may only mention `trainedContextLength` as
    // background. A model that is not loaded reports served as absent —
    // which the UI must render as unknown, never as the trained figure.
    models: live.models.map(m => ({
      id: m.id,
      servedContextLength: m.servedContextLength,
      trainedContextLength: m.trainedContextLength,
    })),
  })
}

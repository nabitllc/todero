/**
 * The failure KIND, tested by behaviour rather than by grep.
 *
 * WHY THIS FILE EXISTS (TOD-2483). `__tests__/api/llm-kind-seam-requests.test.ts`
 * carried this channel's guarantee, and a critic proved three of its four
 * assertions were decoration. It restored the defect completely — every failure
 * arm back to the word "unreachable" — and the suite reported 4 passed, 4 total.
 * It also dropped `kind` entirely from a route and got 4 passed, 4 total again.
 *
 * Both evade for the same reason: those assertions are `src.includes(<one exact
 * string>)`. A source grep goes green the moment the string appears anywhere in
 * the file, and it cannot notice the behaviour coming back. That suite was the
 * right mechanism for CARRYING a diff across an ownership boundary — which it
 * did — and the wrong mechanism for KEEPING it.
 *
 * These exercise `readModelsResponse`, which the module's own comment calls "the
 * one and only place in this repo that decides whether something answering at a
 * base URL is an OpenAI-compatible endpoint". Real Response objects, real
 * bodies, no mocking of the thing under test.
 *
 * The case that matters is a 200 carrying Ollama's NATIVE shape — what you get
 * when LLM_BASE_URL has lost its /v1 suffix. It ANSWERED. Calling that
 * "unreachable" sends an operator to restart a server that is already running,
 * which is the invented verdict this channel exists to delete.
 *
 * A NOTE ON THE FIRST DRAFT, because it is the same lesson one level down: it
 * called `fetchLiveModels(baseUrl)`, and that function's first parameter is
 * `timeoutMs`. The URL became NaN, every probe aborted instantly, and all three
 * cases reported `unreachable` — a test that would have "proved" the exact
 * defect it exists to prevent, because the harness was wrong rather than the
 * code. Measure the harness before trusting its number.
 */

import { readModelsResponse, unreachableModelsResult } from '@/lib/llm-provider'

const BASE = 'http://127.0.0.1:11434'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('LLM failure kind — behaviour, not source text', () => {
  it('a 200 carrying Ollama NATIVE shape is not-openai-compatible, never unreachable', async () => {
    const r = await readModelsResponse(BASE, json({ models: [{ name: 'qwen2.5-coder:7b' }] }))
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.kind).toBe('not-openai-compatible')
    // It answered. The verdict must not say otherwise.
    expect(r.error.toLowerCase()).not.toContain('unreachable')
    // And it must carry the DIAGNOSIS, not only the conclusion — a critic
    // measured a variant that deleted everything after the last em dash.
    expect(r.error).toMatch(/\/v1|shape|data|models/i)
  })

  it('a non-2xx is error-status, never unreachable', async () => {
    const r = await readModelsResponse(BASE, new Response('boom', { status: 500 }))
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.kind).toBe('error-status')
    expect(r.error.toLowerCase()).not.toContain('unreachable')
  })

  it('a 200 that is not JSON at all is still not a network failure', async () => {
    const r = await readModelsResponse(BASE, new Response('<html>login</html>', { status: 200 }))
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.kind).toBe('not-openai-compatible')
    expect(r.error.toLowerCase()).not.toContain('unreachable')
  })

  it('a real socket failure IS unreachable — the word is correct exactly once', () => {
    const r = unreachableModelsResult(BASE, new Error('connect ECONNREFUSED 127.0.0.1:11434'))
    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('unreachable')
    expect(r.kind).toBe('unreachable')
  })

  it('the kinds are distinguishable from one another — the whole point', async () => {
    const shape = await readModelsResponse(BASE, json({ models: [] }))
    const status = await readModelsResponse(BASE, new Response('nope', { status: 503 }))
    const dead = unreachableModelsResult(BASE, new Error('ECONNREFUSED'))
    const kinds = [shape, status, dead].map(r => (r.ok ? 'ok' : r.kind))
    // If a future change collapses them back into one verdict, this fails even
    // when every source string a grep looks for is still present.
    expect(new Set(kinds).size).toBe(3)
  })

  it('a genuine OpenAI shape still succeeds — the control against refusing everything', async () => {
    const r = await readModelsResponse(BASE, json({ data: [{ id: 'qwen2.5-coder:7b' }] }))
    expect(r.ok).toBe(true)
  })
})

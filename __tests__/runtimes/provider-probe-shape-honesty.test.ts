// Round-2 guard for pieces8/llm-provider-honesty — THE GAP THE CRITIC NAMED.
//
// The piece fixed `lib/llm-provider.ts`'s `fetchLiveModels()` so that a 200
// carrying an HTML page, a proxy login screen, or Ollama's native `/api/tags`
// shape stopped coming back as `{ ok: true, models: [] }` — the byte-identical
// answer a healthy endpoint with nothing pulled gives.
//
// It left the SAME defect standing one file over. `lib/runtimes/openai-api.ts`
// has a second `/models` reader, `fetchModelsFrom()`, used whenever
// `resolveProvider()`'s base URL differs from the module-level LLM_BASE_URL
// (i.e. OPENAI_BASE_URL is set, or the env changed after import). It ended:
//
//     const body = await res.json().catch(() => null)
//     return { ok: true, models: Array.isArray(body?.data) ? body.data : [] }
//
// That feeds `probeProvider()`, which feeds `openaiApiRuntime.isAvailable()`,
// `listRuntimes()` and `/api/health` — so the OBSERVABILITY surface went on
// reporting a plain HTML page as "answers but serves no models — pull one
// first". Same lie, louder speaker.
//
// The two readers are now one (`readModelsResponse()` in lib/llm-provider.ts).
// These tests hold the REGISTRY to the same standard the seam is held to, so
// the fix cannot be undone in only one of the two places again.

import { openaiApiRuntime, resetProviderProbeCache } from '@/lib/runtimes/openai-api'

const ORIGINAL_ENV = { ...process.env }
const ORIGINAL_FETCH = global.fetch

/** A REAL Response: the shape check reads headers and body off it. */
function realResponse(body: string, status: number, contentType: string): Response {
  return new Response(body, { status, headers: { 'Content-Type': contentType } })
}

const HTML_PAGE = '<!doctype html><html><body><h1>It works!</h1></body></html>'
const LOGIN_SCREEN = '<html><body><form>Sign in to continue</form></body></html>'
const OLLAMA_NATIVE = JSON.stringify({ models: [{ name: 'qwen2.5-coder:7b' }] })
const OPENAI_EMPTY = JSON.stringify({ object: 'list', data: [] })

/**
 * Deliberately NOT the module-level LLM_BASE_URL, so every case below takes
 * the branch that dials the resolved URL directly — the branch that carried
 * the hand-rolled parser. A `/v1` suffix, because that is the realistic
 * configuration; the no-suffix case gets its own URL in its own test.
 */
const DIVERGENT_URL = 'http://localhost:59997/v1'

let fetchMock: jest.Mock

beforeEach(() => {
  resetProviderProbeCache()
  fetchMock = jest.fn()
  global.fetch = fetchMock as unknown as typeof fetch
  process.env.LLM_BASE_URL = DIVERGENT_URL
  delete process.env.OPENAI_BASE_URL
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  global.fetch = ORIGINAL_FETCH
  resetProviderProbeCache()
})

async function reason(): Promise<string> {
  const available = await openaiApiRuntime.isAvailable()
  const why = await openaiApiRuntime.unavailableReason?.()
  return available ? `AVAILABLE (${why ?? 'no reason'})` : String(why)
}

describe('the provider probe no longer calls a non-OpenAI-compatible 200 a healthy provider', () => {
  it('a plain HTML page is unavailable for the RIGHT reason, not "serves no models"', async () => {
    fetchMock.mockResolvedValue(realResponse(HTML_PAGE, 200, 'text/html'))

    await expect(openaiApiRuntime.isAvailable()).resolves.toBe(false)
    const why = await reason()

    // Before the fix this read "…answers but serves no models — dispatch
    // through it will fail. Pull one first (e.g. `ollama pull …`)".
    expect(why).toContain('not an OpenAI-compatible endpoint')
    expect(why).toContain('It works!')
    expect(why).toContain(DIVERGENT_URL)
    expect(why).not.toContain('serves no models')
    expect(why).not.toContain('Pull one first')
  })

  it('a proxy login screen is the same named failure, never an empty roster', async () => {
    fetchMock.mockResolvedValue(realResponse(LOGIN_SCREEN, 200, 'text/html'))

    await expect(openaiApiRuntime.isAvailable()).resolves.toBe(false)
    const why = await reason()

    expect(why).toContain('Sign in to continue')
    expect(why).not.toContain('serves no models')
  })

  it('valid JSON in a different API shape names the shape', async () => {
    fetchMock.mockResolvedValue(realResponse(OLLAMA_NATIVE, 200, 'application/json'))

    await expect(openaiApiRuntime.isAvailable()).resolves.toBe(false)
    const why = await reason()

    expect(why).toContain('no top-level "data" array')
    expect(why).toContain('Top-level keys: models')
    expect(why).not.toContain('serves no models')
  })

  it('names the missing /v1 suffix when the configured base URL lacks one', async () => {
    // The dominant real cause of an Ollama-native body: LLM_BASE_URL pointing
    // at :11434 instead of :11434/v1.
    process.env.LLM_BASE_URL = 'http://localhost:59996'
    resetProviderProbeCache()
    fetchMock.mockResolvedValue(realResponse(OLLAMA_NATIVE, 200, 'application/json'))

    const why = await reason()

    expect(why).toContain('needs its /v1 suffix')
    expect(why).toContain('http://localhost:59996/v1')
  })

  it('a "data" array with no ids in it is not a roster either', async () => {
    fetchMock.mockResolvedValue(
      realResponse(JSON.stringify({ data: [{ name: 'a' }, { name: 'b' }] }), 200, 'application/json'),
    )

    await expect(openaiApiRuntime.isAvailable()).resolves.toBe(false)
    expect(await reason()).toContain('none carrying a string "id"')
  })

  it('a genuinely empty compatible roster is STILL the "serves no models" answer', async () => {
    fetchMock.mockResolvedValue(realResponse(OPENAI_EMPTY, 200, 'application/json'))

    await expect(openaiApiRuntime.isAvailable()).resolves.toBe(false)
    const why = await reason()

    // The one case where installing a model is the real fix — it must keep
    // saying so, or the fix has just moved the dishonesty in the other
    // direction.
    expect(why).toContain('serves no models')
    // ...but phrased for THIS endpoint. The base URL under test here is
    // localhost:59997, which is not Ollama, and this assertion used to demand
    // the literal Ollama command for it. "Runs against ANY OpenAI-compatible
    // LLM API" is the channel goal, and `ollama pull` is a confident wrong
    // answer at a vLLM/LM Studio/hosted endpoint — the same reasoning that
    // already made the /v1 suffix hint conditional. See pieces9/llm-provider-sweep.md.
    expect(why).toMatch(/load or enable at least one model/i)
    expect(why).not.toContain('ollama pull')
  })

  it('the empty-roster advice IS the Ollama command when the endpoint is Ollama', async () => {
    // The other half of the same rule: making the advice conditional must not
    // cost the accurate advice in the case it was written for.
    process.env.LLM_BASE_URL = 'http://localhost:11434/v1'
    jest.resetModules()
    const fresh = await import('@/lib/runtimes/openai-api')
    fresh.resetProviderProbeCache()
    fetchMock.mockResolvedValue(realResponse(OPENAI_EMPTY, 200, 'application/json'))

    const why = await fresh.openaiApiRuntime.unavailableReason?.()

    expect(why).toContain('serves no models')
    expect(why).toContain('ollama pull')
  })

  it('a real roster is still available', async () => {
    fetchMock.mockResolvedValue(
      realResponse(JSON.stringify({ data: [{ id: 'qwen2.5-coder:7b' }] }), 200, 'application/json'),
    )

    await expect(openaiApiRuntime.isAvailable()).resolves.toBe(true)
    await expect(openaiApiRuntime.unavailableReason?.()).resolves.toBeNull()
  })

  it('the four causes that used to be one answer are four different answers HERE too', async () => {
    // The piece's headline assertion, restated at the registry layer — the
    // surface /api/health publishes. Before the fix, all four of these
    // produced the same "answers but serves no models" sentence.
    const answers: string[] = []
    for (const [body, type] of [
      [HTML_PAGE, 'text/html'],
      [LOGIN_SCREEN, 'text/html'],
      [OLLAMA_NATIVE, 'application/json'],
      [OPENAI_EMPTY, 'application/json'],
    ] as Array<[string, string]>) {
      resetProviderProbeCache()
      fetchMock.mockResolvedValue(realResponse(body, 200, type))
      answers.push(await reason())
    }

    expect(new Set(answers).size).toBe(4)
    expect(answers.filter(a => a.includes('serves no models'))).toHaveLength(1)
  })

  it('an unreachable endpoint is still unreachable, not a shape complaint', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'))

    const why = await reason()

    expect(why).toContain('is unreachable — fetch failed')
    expect(why).not.toContain('OpenAI-compatible')
  })

  it('a non-2xx is still reported by status, not as a shape complaint', async () => {
    fetchMock.mockResolvedValue(realResponse('Internal Server Error', 500, 'text/plain'))

    const why = await reason()

    expect(why).toContain('responded 500')
    expect(why).not.toContain('not an OpenAI-compatible endpoint')
  })
})

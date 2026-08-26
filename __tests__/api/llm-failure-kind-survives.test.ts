// The honest verdict has to SURVIVE the trip to the operator.
//
// lib/llm-provider.ts produces a required, machine-readable `kind`
// ('unreachable' | 'error-status' | 'not-openai-compatible'). That was the
// hard part and it worked. But the consumers above it flattened it back out:
//
//   * ProviderProbe was { ok: false; reason: string } with no `kind` at all,
//     and probeProvider() prefixed EVERY failure with "<url> does not answer",
//     so /api/health emitted the self-contradictory
//     "<url> does not answer — ... answered 200 but the body is not JSON"
//     and called a live HTTP 401 unreachable. Measured 2026-08-26.
//   * scripts/lib/env-report.mjs's llmStatus() dropped `kind` on the floor.
//
// A verdict that is correct at the seam and wrong on every surface an operator
// reads is not an honest verdict; it is a well-tested internal value.
//
// These tests pin the SURFACES, not the parser. The parser is covered by
// __tests__/api/llm-endpoint-shape-honesty.test.ts.

import { readModelsResponse } from '@/lib/llm-provider'

const ORIGINAL_ENV = { ...process.env }
const ORIGINAL_FETCH = global.fetch

function realResponse(body: string, status: number, contentType: string): Response {
  return new Response(body, { status, headers: { 'Content-Type': contentType } })
}

let fetchMock: jest.Mock

beforeEach(() => {
  fetchMock = jest.fn()
  global.fetch = fetchMock as unknown as typeof fetch
  jest.resetModules()
  delete process.env.LLM_MODEL
  delete process.env.OPENAI_BASE_URL
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  global.fetch = ORIGINAL_FETCH
})

/** Fresh probe module bound to `base`, with its memo cleared. */
async function probeAgainst(base: string) {
  process.env.LLM_BASE_URL = base
  jest.resetModules()
  const mod = await import('@/lib/runtimes/openai-api')
  mod.resetProviderProbeCache()
  return mod.probeProvider()
}

describe('probeProvider carries the reason as a VALUE, not only as prose', () => {
  it('an HTTP 401 is error-status — and is NOT described as "does not answer"', async () => {
    fetchMock.mockResolvedValue(
      realResponse(JSON.stringify({ error: { message: 'invalid api key' } }), 401, 'application/json'),
    )

    const probe = await probeAgainst('http://127.0.0.1:19701/v1')

    expect(probe.ok).toBe(false)
    if (probe.ok) throw new Error('expected failure')
    expect(probe.kind).toBe('error-status')
    // The endpoint answered. Saying otherwise sends the operator to check the
    // wrong thing (is the server up?) instead of the right one (the key).
    expect(probe.reason).not.toContain('does not answer')
    expect(probe.reason).toContain('401')
  })

  it('a 200 serving HTML is not-openai-compatible, and the sentence is not self-contradictory', async () => {
    fetchMock.mockResolvedValue(realResponse('<html><body>It works!</body></html>', 200, 'text/html'))

    const probe = await probeAgainst('http://127.0.0.1:19702/v1')

    expect(probe.ok).toBe(false)
    if (probe.ok) throw new Error('expected failure')
    expect(probe.kind).toBe('not-openai-compatible')
    // The measured defect, verbatim: "does not answer — ... answered 200".
    expect(probe.reason).not.toContain('does not answer')
    expect(probe.reason).toContain('answered')
  })

  it('a genuinely dead socket IS "does not answer", and is kind unreachable', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'))

    const probe = await probeAgainst('http://127.0.0.1:19703/v1')

    expect(probe.ok).toBe(false)
    if (probe.ok) throw new Error('expected failure')
    expect(probe.kind).toBe('unreachable')
    expect(probe.reason).toContain('does not answer')
  })

  it('an OpenAI-shaped endpoint with an empty roster is empty-roster, distinct from all three', async () => {
    fetchMock.mockResolvedValue(realResponse(JSON.stringify({ object: 'list', data: [] }), 200, 'application/json'))

    const probe = await probeAgainst('http://127.0.0.1:19704/v1')

    expect(probe.ok).toBe(false)
    if (probe.ok) throw new Error('expected failure')
    expect(probe.kind).toBe('empty-roster')
    expect(probe.reason).toContain('serves no models')
  })
})

describe('a roster that is empty because the endpoint reported a FAULT', () => {
  it('a body carrying both an empty data array and an error field is a fault, not an empty list', async () => {
    // A shape hosted gateways really return for an expired key or an org
    // without access. Read literally it is "OpenAI-shaped, zero models" —
    // byte-identical to a healthy server with nothing loaded — and the advice
    // that followed was to install a model the operator cannot install.
    const verdict = await readModelsResponse(
      'http://127.0.0.1:19705/v1',
      realResponse(
        JSON.stringify({ data: [], error: { message: 'no permission for this org' } }),
        200,
        'application/json',
      ),
    )

    expect(verdict.ok).toBe(false)
    if (verdict.ok) throw new Error('expected failure')
    expect(verdict.error).toContain('no permission for this org')
    expect(verdict.error).not.toContain('pull')
  })

  it('a plain empty roster with no error field is still a legitimate empty roster', async () => {
    // The other half of the distinction: this one must NOT become a failure.
    const verdict = await readModelsResponse(
      'http://127.0.0.1:19706/v1',
      realResponse(JSON.stringify({ object: 'list', data: [] }), 200, 'application/json'),
    )

    expect(verdict.ok).toBe(true)
    if (!verdict.ok) throw new Error('expected success')
    expect(verdict.models).toEqual([])
  })
})

describe('advice is phrased for the endpoint actually configured', () => {
  it('does not tell a non-Ollama endpoint to run an ollama command', async () => {
    process.env.LLM_BASE_URL = 'http://127.0.0.1:19707/v1'
    jest.resetModules()
    const { noModelsError } = await import('@/lib/llm-provider')

    const msg = noModelsError()

    expect(msg).toContain('roster is empty')
    // "any OpenAI-compatible LLM API" is the channel goal. The ollama command
    // is right for exactly one server and a confident wrong answer everywhere
    // else — the same reasoning that made the /v1 suffix hint conditional.
    expect(msg).not.toContain('ollama pull')
  })

  it('still gives the Ollama command when the endpoint IS Ollama', async () => {
    process.env.LLM_BASE_URL = 'http://localhost:11434/v1'
    jest.resetModules()
    const { noModelsError } = await import('@/lib/llm-provider')

    expect(noModelsError()).toContain('ollama pull')
  })
})

describe('the Ollama-native context enrichment is gated on the endpoint being Ollama', () => {
  it('a non-Ollama endpoint gets ONE request, not one per model', async () => {
    // Measured before the gate: a single /api/chat/models load against a
    // 60-model gateway fired 62 authenticated requests — GET /v1/models,
    // GET /api/ps, and 60 POSTs to /api/show — every one of which 404s on a
    // server that does not speak Ollama's native API. ~300 on a large one.
    process.env.LLM_BASE_URL = 'http://127.0.0.1:19708/v1'
    jest.resetModules()
    const { fetchLiveModels } = await import('@/lib/llm-provider')
    const many = Array.from({ length: 60 }, (_, i) => ({ id: `model-${i}` }))
    fetchMock.mockResolvedValue(realResponse(JSON.stringify({ data: many }), 200, 'application/json'))

    const live = await fetchLiveModels(5000, { includeContextLength: true })

    expect(live.ok).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

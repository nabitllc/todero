// Regression guard for the sensorless-availability class of defect.
//
// `openaiApiRuntime.isAvailable()` used to be `isLocal || apiKey.length > 0`.
// Any localhost URL reported the runtime ready whether or not a server was
// listening, so /api/run-agent/runtimes returned available:true, the first-run
// wizard printed a green, and the dispatch then failed. scripts/doctor.mjs was
// the only surface that actually asked the endpoint.
//
// These tests hold the registry to the endpoint's answer: available means the
// endpoint responded AND named at least one model. Everything else is
// unavailable WITH a reason that names what failed.

import { openaiApiRuntime, resetProviderProbeCache } from '@/lib/runtimes/openai-api'

const ORIGINAL_ENV = { ...process.env }
const ORIGINAL_FETCH = global.fetch

/** Minimal Response stand-in — the probe only reads ok/status/json/text. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as unknown as Response
}

let fetchMock: jest.Mock

beforeEach(() => {
  resetProviderProbeCache()
  fetchMock = jest.fn()
  global.fetch = fetchMock as unknown as typeof fetch
  // A URL that differs from llm-provider's module-level constant, so the probe
  // exercises the branch that dials the RESOLVED endpoint rather than the one
  // baked in at import time.
  process.env.LLM_BASE_URL = 'http://localhost:59999/v1'
  delete process.env.OPENAI_BASE_URL
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  global.fetch = ORIGINAL_FETCH
  resetProviderProbeCache()
})

describe('openaiApiRuntime.isAvailable', () => {
  it('is false for a localhost endpoint with nothing listening — the exact regression', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'))

    await expect(openaiApiRuntime.isAvailable()).resolves.toBe(false)
    const reason = await openaiApiRuntime.unavailableReason?.()
    expect(reason).toContain('http://localhost:59999/v1 does not answer — dispatch through it will fail')
    expect(reason).toContain('fetch failed')
  })

  it('probes ${baseUrl}/models rather than trusting the configuration', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: 'qwen2.5-coder:7b' }] }))

    await expect(openaiApiRuntime.isAvailable()).resolves.toBe(true)
    await expect(openaiApiRuntime.unavailableReason?.()).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalled()
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://localhost:59999/v1/models')
  })

  it('is false when the endpoint answers non-2xx — a rejected credential is not availability', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'invalid api key' }, 401))
    process.env.LLM_API_KEY = 'wrong'

    await expect(openaiApiRuntime.isAvailable()).resolves.toBe(false)
    await expect(openaiApiRuntime.unavailableReason?.()).resolves.toContain('401')
  })

  it('is false when the endpoint answers but serves no models', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }))

    await expect(openaiApiRuntime.isAvailable()).resolves.toBe(false)
    await expect(openaiApiRuntime.unavailableReason?.()).resolves.toContain('serves no models')
  })

  it('is false with a reason naming the variable when no endpoint is configured', async () => {
    delete process.env.LLM_BASE_URL

    await expect(openaiApiRuntime.isAvailable()).resolves.toBe(false)
    await expect(openaiApiRuntime.unavailableReason?.()).resolves.toContain('LLM_BASE_URL is not set')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('memoizes the probe so listing the registry does not flood the endpoint', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: 'qwen2.5-coder:7b' }] }))

    await openaiApiRuntime.isAvailable()
    await openaiApiRuntime.isAvailable()
    await openaiApiRuntime.unavailableReason?.()

    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('re-probes when the configured endpoint changes', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: 'qwen2.5-coder:7b' }] }))
    await openaiApiRuntime.isAvailable()

    process.env.LLM_BASE_URL = 'http://localhost:58888/v1'
    fetchMock.mockRejectedValue(new Error('fetch failed'))

    await expect(openaiApiRuntime.isAvailable()).resolves.toBe(false)
    await expect(openaiApiRuntime.unavailableReason?.()).resolves.toContain('http://localhost:58888/v1')
  })
})

describe('listRuntimes', () => {
  it('carries an actionable unavailableReason for every unavailable runtime', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'))
    const { listRuntimes } = await import('@/lib/runtimes')
    const runtimes = await listRuntimes()

    expect(runtimes.length).toBeGreaterThan(0)
    for (const runtime of runtimes) {
      if (runtime.available) {
        expect(runtime.unavailableReason).toBeNull()
      } else {
        expect(typeof runtime.unavailableReason).toBe('string')
        expect(runtime.unavailableReason).not.toBe('')
      }
    }

    const openai = runtimes.find(r => r.name === 'openai-api')
    expect(openai?.available).toBe(false)
    expect(openai?.unavailableReason).toContain('does not answer — dispatch through it will fail')
  })
})

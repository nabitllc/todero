// Regression guard for the hardcoded-model-menu class of defect.
//
// The channel goal is "the model list is read live from that endpoint, never
// hardcoded". A hardcoded menu does not only look like a list of constants —
// its more dangerous form is a FALLBACK: an endpoint that will not answer, and
// a seam that quietly produces a vendor id anyway so the dropdown still has
// something in it. That is the same silent substitution the chat route was
// rebuilt to stop doing, and it is invisible to any grep, because the constant
// only appears on the unhappy path.
//
// These tests hold lib/llm-provider.ts to the endpoint's answer:
//   - unreachable  -> an error naming the URL, and NO model ids
//   - empty roster -> an error naming the URL, and NO model ids
//   - reachable    -> exactly the ids the endpoint reported, nothing added
//   - unknown id   -> reported by name, never resolved to a loaded model
//
// scripts/no-cloud-provider.mjs covers the other half (a ruled-out provider
// named in live code at all). See
// docs/rebuild/pieces/pieces6/provider-is-a-base-url.md.

import {
  LLM_BASE_URL,
  fetchLiveModels,
  resolveConfiguredModel,
  resolveModelId,
} from '@/lib/llm-provider'

const ORIGINAL_ENV = { ...process.env }
const ORIGINAL_FETCH = global.fetch

/** Minimal Response stand-in — the seam only reads ok/status/json/text. */
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
  fetchMock = jest.fn()
  global.fetch = fetchMock as unknown as typeof fetch
  delete process.env.LLM_MODEL
})

afterEach(() => {
  process.env = { ...ORIGINAL_ENV }
  global.fetch = ORIGINAL_FETCH
})

describe('fetchLiveModels', () => {
  it('reads the roster from ${LLM_BASE_URL}/models and returns exactly what it reported', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: 'qwen2.5-coder:7b' }, { id: 'qwen2.5-coder:14b' }] }))

    const live = await fetchLiveModels()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toBe(`${LLM_BASE_URL}/models`)
    // MUTATION-TESTING GAP (found 2026-08-26): deleting `cache: 'no-store'`
    // from that fetch left all seven seam suites green — 70/70 — even the one
    // named `chat-model-list-is-live`, because every assertion here looked at
    // calls[0][0] (WHERE we fetch) and none at calls[0][1] (the init). That
    // one line IS the liveness: TOD-2456 added it because Next's fetch cache
    // had made a "live" roster permanent. A frozen roster is a number on
    // screen that no longer traces to a live query.
    expect((fetchMock.mock.calls[0][1] as RequestInit).cache).toBe('no-store')
    expect(live.ok).toBe(true)
    if (!live.ok) throw new Error('unreachable')
    // Exactly the endpoint's two ids — nothing appended, nothing merged in.
    expect(live.models.map(m => m.id)).toEqual(['qwen2.5-coder:7b', 'qwen2.5-coder:14b'])
  })

  it('reports an unreachable endpoint by URL and produces NO model ids', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'))

    const live = await fetchLiveModels()

    expect(live.ok).toBe(false)
    if (live.ok) throw new Error('expected failure')
    expect(live.error).toContain(LLM_BASE_URL)
    expect(live.error).toContain('unreachable')
    // The whole point: there is no `models` to fall back into.
    expect((live as unknown as { models?: unknown }).models).toBeUndefined()
  })

  it('reports a non-2xx roster by status rather than substituting a list', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ error: 'no' }, 401))

    const live = await fetchLiveModels()

    expect(live.ok).toBe(false)
    if (live.ok) throw new Error('expected failure')
    expect(live.error).toContain(`${LLM_BASE_URL}/models`)
    expect(live.error).toContain('401')
  })

  it('an empty roster stays empty — it is not backfilled with a default id', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }))

    const live = await fetchLiveModels()

    expect(live.ok).toBe(true)
    if (!live.ok) throw new Error('unreachable')
    expect(live.models).toEqual([])
  })
})

describe('resolveModelId', () => {
  const served = ['qwen2.5-coder:7b']

  it('accepts a bare id the endpoint serves', () => {
    expect(resolveModelId('qwen2.5-coder:7b', served)).toBe('qwen2.5-coder:7b')
  })

  it('refuses an id prefixed with a provider that is not the configured one', () => {
    // The dangerous case: a cloud-qualified id must NOT be stripped down to
    // "whatever is running locally" and answered as if it were that model.
    expect(resolveModelId('some-other-vendor/qwen2.5-coder:7b', served)).toBeNull()
  })

  it('refuses an id the endpoint does not serve', () => {
    expect(resolveModelId('a-model-nobody-pulled', served)).toBeNull()
  })
})

describe('resolveConfiguredModel', () => {
  it('502s by URL when the endpoint will not answer — no model comes out', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'))

    const r = await resolveConfiguredModel('qwen2.5-coder:7b')

    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('expected failure')
    expect(r.status).toBe(502)
    expect(r.error).toContain(LLM_BASE_URL)
  })

  it('502s by URL when the roster is empty, naming how to fix it', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [] }))

    const r = await resolveConfiguredModel()

    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('expected failure')
    expect(r.status).toBe(502)
    expect(r.error).toContain(`${LLM_BASE_URL}/models`)
  })

  it('400s an unknown id BY NAME instead of answering with a loaded model', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: 'qwen2.5-coder:7b' }] }))

    const r = await resolveConfiguredModel('a-cloud-model-this-host-never-had')

    expect(r.ok).toBe(false)
    if (r.ok) throw new Error('expected failure')
    expect(r.status).toBe(400)
    expect(r.error).toContain('a-cloud-model-this-host-never-had')
    expect(r.id).toBe('a-cloud-model-this-host-never-had')
  })

  it('with no request and no LLM_MODEL, defaults to the FIRST id the endpoint reported', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ data: [{ id: 'qwen2.5-coder:7b' }, { id: 'qwen2.5-coder:14b' }] }))

    const r = await resolveConfiguredModel()

    expect(r).toEqual({ ok: true, model: 'qwen2.5-coder:7b' })
  })
})

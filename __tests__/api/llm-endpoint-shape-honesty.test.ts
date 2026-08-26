// Regression guard: a 200 is not evidence that the thing answering at
// LLM_BASE_URL speaks this API.
//
// THE DEFECT THESE TESTS PIN (measured 2026-08-26, before the fix, by pointing
// lib/llm-provider.ts at seven deliberately-wrong local servers — see
// docs/rebuild/pieces/pieces8/llm-provider-honesty.md for the raw output):
// `fetchLiveModels` parsed the body with `res.json().catch(() => null)` and
// then took `Array.isArray(body?.data) ? body.data : []`. So FOUR unrelated
// causes —
//
//     a plain HTML index page          (200 text/html)
//     a proxy login screen             (200 text/html)
//     Ollama's NATIVE shape, reached
//       when LLM_BASE_URL lost its /v1 (200 application/json, {"models":[…]})
//     a real OpenAI endpoint with
//       nothing pulled yet             (200 application/json, {"data":[]})
//
// — all produced the byte-identical answer `{ ok: true, models: [] }`, and
// every route above them printed the same "returned no models — pull one
// first". Three of those four are configuration faults where pulling a model
// fixes nothing, and they were the invisible ones.
//
// The channel goal is "runs against ANY OpenAI-compatible LLM API". A seam
// that cannot tell a compatible endpoint from an incompatible one has not met
// that goal; it has only stopped reporting when it isn't met.
//
// scripts/lib/env-report.mjs's probeOpenAiShape() already drew this
// distinction at DIAGNOSIS time (`npm run doctor`). These tests hold the
// PRODUCT path to it — the answer the user actually sees, at the moment it
// fails.

import {
  LLM_BASE_URL,
  fetchLiveModels,
  noModelsError,
  readModelsResponse,
  resolveConfiguredModel,
  unreachableModelsResult,
} from '@/lib/llm-provider'

const ORIGINAL_ENV = { ...process.env }
const ORIGINAL_FETCH = global.fetch

/**
 * A REAL Response, not a stand-in. The shape check reads headers and body, so
 * a hand-rolled object could pass a test the actual runtime object fails.
 */
function realResponse(body: string, status: number, contentType: string): Response {
  return new Response(body, { status, headers: { 'Content-Type': contentType } })
}

const HTML_PAGE = '<!doctype html><html><body><h1>It works!</h1></body></html>'
const LOGIN_SCREEN = '<html><body><form>Sign in to continue</form></body></html>'
const OLLAMA_NATIVE = JSON.stringify({ models: [{ name: 'qwen2.5-coder:7b' }] })
const OPENAI_EMPTY = JSON.stringify({ object: 'list', data: [] })
const OPENAI_ONE = JSON.stringify({ object: 'list', data: [{ id: 'qwen2.5-coder:7b' }] })

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

describe('fetchLiveModels tells a non-OpenAI-compatible 200 from an empty roster', () => {
  it('a plain HTML page is a NAMED failure, not an empty model list', async () => {
    fetchMock.mockResolvedValue(realResponse(HTML_PAGE, 200, 'text/html'))

    const live = await fetchLiveModels()

    expect(live.ok).toBe(false)
    if (live.ok) throw new Error('expected failure')
    expect(live.kind).toBe('not-openai-compatible')
    // The message has to be actionable on its own: which URL, what came back,
    // and what the endpoint was supposed to look like.
    expect(live.error).toContain(LLM_BASE_URL)
    expect(live.error).toContain('not JSON')
    expect(live.error).toContain('text/html')
    expect(live.error).toContain('It works!')
    // And crucially: no roster to mistake for a real answer.
    expect((live as unknown as { models?: unknown }).models).toBeUndefined()
  })

  it('a proxy login screen is the same NAMED failure — never "0 models"', async () => {
    fetchMock.mockResolvedValue(realResponse(LOGIN_SCREEN, 200, 'text/html'))

    const live = await fetchLiveModels()

    expect(live.ok).toBe(false)
    if (live.ok) throw new Error('expected failure')
    expect(live.kind).toBe('not-openai-compatible')
    expect(live.error).toContain('Sign in to continue')
    // The "pull a model" sentence must NOT be the answer to this problem.
    expect(live.error).not.toContain('pull')
  })

  it('valid JSON in a different API shape names the shape AND the likely cause', async () => {
    fetchMock.mockResolvedValue(realResponse(OLLAMA_NATIVE, 200, 'application/json'))

    const live = await fetchLiveModels()

    expect(live.ok).toBe(false)
    if (live.ok) throw new Error('expected failure')
    expect(live.kind).toBe('not-openai-compatible')
    expect(live.error).toContain('no top-level "data" array')
    expect(live.error).toContain('Top-level keys: models')
    // ROUND 2: this assertion USED to be `toContain('/v1')`, meant to pin the
    // "if this is Ollama, the base URL needs its /v1 suffix" hint. It could
    // not: the configured LLM_BASE_URL is literally `.../v1`, so deleting the
    // hint sentence outright still passed on the URL echoed at the front of
    // the message. Worse, the hint is now CONDITIONAL — it is suppressed when
    // the base URL already ends in /v1, because blaming a missing suffix on a
    // URL that has one is a confident wrong answer. So the hint is asserted
    // where it actually applies, further down, against a URL without one.
    expect(live.error).not.toContain('needs its /v1 suffix')
  })

  it('a "data" array whose entries carry no id is not a roster either', async () => {
    fetchMock.mockResolvedValue(
      realResponse(JSON.stringify({ data: [{ name: 'a' }, { name: 'b' }] }), 200, 'application/json'),
    )

    const live = await fetchLiveModels()

    expect(live.ok).toBe(false)
    if (live.ok) throw new Error('expected failure')
    expect(live.kind).toBe('not-openai-compatible')
    expect(live.error).toContain('2 entries')
  })

  it('a REAL OpenAI-compatible endpoint with nothing pulled is the ONLY empty list', async () => {
    fetchMock.mockResolvedValue(realResponse(OPENAI_EMPTY, 200, 'application/json'))

    const live = await fetchLiveModels()

    // This one stays ok:true with zero models — it is a working endpoint that
    // genuinely has no models, and "pull one" IS the fix.
    expect(live.ok).toBe(true)
    if (!live.ok) throw new Error('expected success')
    expect(live.models).toEqual([])
  })

  it('the four causes that used to be identical are now four different answers', async () => {
    // The whole point of the piece, asserted directly rather than implied by
    // the four tests above passing separately.
    const answers: string[] = []
    for (const [body, type] of [
      [HTML_PAGE, 'text/html'],
      [LOGIN_SCREEN, 'text/html'],
      [OLLAMA_NATIVE, 'application/json'],
      [OPENAI_EMPTY, 'application/json'],
    ] as Array<[string, string]>) {
      fetchMock.mockResolvedValue(realResponse(body, 200, type))
      answers.push(JSON.stringify(await fetchLiveModels()))
    }
    expect(new Set(answers).size).toBe(4)
    // Before the fix this assertion read `.size === 1`: all four were
    // {"ok":true,"models":[]}.
    expect(answers.filter(a => a === '{"ok":true,"models":[]}')).toHaveLength(1)
  })

  it('a real roster still comes back untouched, with no kind', async () => {
    fetchMock.mockResolvedValue(realResponse(OPENAI_ONE, 200, 'application/json'))

    const live = await fetchLiveModels()

    expect(live.ok).toBe(true)
    if (!live.ok) throw new Error('expected success')
    expect(live.models.map(m => m.id)).toEqual(['qwen2.5-coder:7b'])
  })
})

describe('the other failure modes stay distinct from each other', () => {
  it('an unreachable endpoint is kind "unreachable"', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'))

    const live = await fetchLiveModels()

    expect(live.ok).toBe(false)
    if (live.ok) throw new Error('expected failure')
    expect(live.kind).toBe('unreachable')
    expect(live.error).toContain(LLM_BASE_URL)
  })

  it('a timeout is also "unreachable", and says so', async () => {
    fetchMock.mockRejectedValue(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))

    const live = await fetchLiveModels()

    expect(live.ok).toBe(false)
    if (live.ok) throw new Error('expected failure')
    expect(live.kind).toBe('unreachable')
    expect(live.error).toContain('timeout')
  })

  it('a non-2xx is kind "error-status", NOT "not-openai-compatible"', async () => {
    fetchMock.mockResolvedValue(realResponse('Internal Server Error', 500, 'text/plain'))

    const live = await fetchLiveModels()

    expect(live.ok).toBe(false)
    if (live.ok) throw new Error('expected failure')
    // A 500 from a real Ollama is an outage, not a misconfiguration. Folding
    // it into the shape verdict would send the operator to edit .env.local
    // over a server that needs restarting.
    expect(live.kind).toBe('error-status')
    expect(live.error).toContain('500')
  })
})

describe('resolveConfiguredModel carries the reason through', () => {
  it('propagates kind for an incompatible endpoint instead of "pull one first"', async () => {
    fetchMock.mockResolvedValue(realResponse(HTML_PAGE, 200, 'text/html'))

    const resolved = await resolveConfiguredModel('qwen2.5-coder:7b')

    expect(resolved.ok).toBe(false)
    if (resolved.ok) throw new Error('expected failure')
    expect(resolved.status).toBe(502)
    expect(resolved.kind).toBe('not-openai-compatible')
    expect(resolved.error).not.toContain('pull one first')
  })

  it('still says "pull one first" for a genuinely empty compatible roster', async () => {
    fetchMock.mockResolvedValue(realResponse(OPENAI_EMPTY, 200, 'application/json'))

    const resolved = await resolveConfiguredModel(undefined)

    expect(resolved.ok).toBe(false)
    if (resolved.ok) throw new Error('expected failure')
    expect(resolved.status).toBe(502)
    expect(resolved.error).toBe(noModelsError())
    expect(resolved.error).toContain('pull one first')
    // Not a fetch failure — no kind. See the comment at that return.
    expect(resolved.kind).toBeUndefined()
  })
})

describe('GET /api/chat/models surfaces the distinction to the client', () => {
  // The route is the thing a browser actually reaches, so the guarantee is
  // asserted there and not only one layer down.
  async function callRoute() {
    const { GET } = await import('@/app/api/chat/models/route')
    const res = await GET()
    return { status: res.status, body: await res.json() }
  }

  it('answers 502 with kind "not-openai-compatible" for an HTML 200', async () => {
    fetchMock.mockResolvedValue(realResponse(HTML_PAGE, 200, 'text/html'))

    const { status, body } = await callRoute()

    // Before the fix this route answered HTTP 502 with "returned no models —
    // pull one first", identical to a healthy-but-empty Ollama.
    expect(status).toBe(502)
    expect(body.kind).toBe('not-openai-compatible')
    expect(body.base_url).toBe(LLM_BASE_URL)
    expect(body.error).toContain('not JSON')
    expect(body.error).not.toContain('pull one first')
  })

  it('answers 502 with kind "empty-roster" for a compatible endpoint with no models', async () => {
    fetchMock.mockResolvedValue(realResponse(OPENAI_EMPTY, 200, 'application/json'))

    const { status, body } = await callRoute()

    expect(status).toBe(502)
    expect(body.kind).toBe('empty-roster')
    expect(body.error).toContain('pull one first')
  })

  it('answers 502 with kind "unreachable" when nothing is listening', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'))

    const { status, body } = await callRoute()

    expect(status).toBe(502)
    expect(body.kind).toBe('unreachable')
  })

  it('still serves the live roster unchanged when the endpoint is real', async () => {
    // includeContextLength makes the route fire follow-up /api/ps and
    // /api/show calls; those are allowed to fail (unknown, never guessed) and
    // this mock lets them, which is itself the documented behaviour.
    fetchMock.mockImplementation((url: string) =>
      String(url).endsWith('/models')
        ? Promise.resolve(realResponse(OPENAI_ONE, 200, 'application/json'))
        : Promise.reject(new Error('not an Ollama-native endpoint')),
    )

    const { status, body } = await callRoute()

    expect(status).toBe(200)
    expect(body.models.map((m: { id: string }) => m.id)).toEqual(['qwen2.5-coder:7b'])
    expect(body.default_model).toBe('qwen2.5-coder:7b')
    // Unknown stays unknown.
    expect(body.models[0].servedContextLength).toBeUndefined()
    expect(body.models[0].trainedContextLength).toBeUndefined()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// ROUND 2. A fresh-context critic mutation-tested this file and found three
// mutants it could not see. Two of them are pinned below (the third, a
// wholesale revert of app/api/chat/autotitle/route.ts, is pinned in
// __tests__/api/chat-route-failure-kinds.test.ts).
// ─────────────────────────────────────────────────────────────────────────────

describe('noModelsError says what it claims to say (kills mutant M8)', () => {
  it('states that the endpoint IS OpenAI-compatible, which is the whole point', async () => {
    // §2.3 of the piece doc claims this sentence "now says the endpoint *is*
    // OpenAI-compatible, which it could not honestly say before". Deleting
    // that clause left the suite 16/16 green — the doc's claim was unguarded.
    // It is the clause that makes "pull one first" honest advice rather than a
    // guess, because it is only reachable once the shape check has passed.
    expect(noModelsError()).toContain('the endpoint is OpenAI-compatible')
    expect(noModelsError()).toContain('roster is empty')
    expect(noModelsError()).toContain('pull one first')
    expect(noModelsError()).toContain(LLM_BASE_URL)
  })
})

describe('the /v1 hint is asserted as a SENTENCE, not as a substring of the URL (kills mutant M1)', () => {
  // The old assertion was `expect(live.error).toContain('/v1')`, and the
  // configured LLM_BASE_URL is literally `http://localhost:11434/v1` — so
  // deleting the entire hint sentence still passed, satisfied by the URL
  // echoed at the front of the message. The doc calls that sentence "the
  // measured, dominant real cause"; an assertion that cannot see it removed
  // is not guarding it.
  //
  // `readModelsResponse` takes the base URL as an argument (it is shared with
  // lib/runtimes/openai-api.ts, which may dial a different one), so the hint
  // can be tested against a URL that genuinely lacks the suffix without
  // re-importing the module for its load-time constant.
  const NO_SUFFIX = 'http://127.0.0.1:59995'

  it('names the missing suffix, and the exact URL to set, when there is no /v1', async () => {
    const res = realResponse(OLLAMA_NATIVE, 200, 'application/json')

    const out = await readModelsResponse(NO_SUFFIX, res)

    expect(out.ok).toBe(false)
    if (out.ok) throw new Error('expected failure')
    expect(out.kind).toBe('not-openai-compatible')
    expect(out.error).toContain('needs its /v1 suffix')
    expect(out.error).toContain('http://127.0.0.1:59995/v1')
  })

  it('does NOT blame a missing /v1 on a URL that already has one', async () => {
    // A confident wrong answer is the failure mode this whole seam exists to
    // remove. If the suffix is present, the Ollama-native body has some other
    // cause and the message must not invent one.
    const out = await readModelsResponse(`${NO_SUFFIX}/v1`, realResponse(OLLAMA_NATIVE, 200, 'application/json'))

    expect(out.ok).toBe(false)
    if (out.ok) throw new Error('expected failure')
    expect(out.error).toContain('no top-level "data" array')
    expect(out.error).not.toContain('needs its /v1 suffix')
  })
})

describe('there is exactly ONE /models parser in this repo', () => {
  // lib/runtimes/openai-api.ts kept a hand-rolled second copy for a full
  // round, and that copy went on answering `{ ok: true, models: [] }` for an
  // HTML page while this file reported it honestly — so /api/health and the
  // runtimes registry published the defect the piece claimed to have killed.
  // The registry side is guarded in
  // __tests__/runtimes/provider-probe-shape-honesty.test.ts; this asserts the
  // property that makes a third copy hard to write.

  it('every failure carries a kind — the field is required, not optional', async () => {
    const cases: Array<() => void> = [
      () => fetchMock.mockResolvedValue(realResponse(HTML_PAGE, 200, 'text/html')),
      () => fetchMock.mockResolvedValue(realResponse(LOGIN_SCREEN, 200, 'text/html')),
      () => fetchMock.mockResolvedValue(realResponse(OLLAMA_NATIVE, 200, 'application/json')),
      () => fetchMock.mockResolvedValue(realResponse('Internal Server Error', 500, 'text/plain')),
      () => fetchMock.mockRejectedValue(new Error('fetch failed')),
    ]
    for (const setup of cases) {
      setup()
      const live = await fetchLiveModels()
      expect(live.ok).toBe(false)
      if (live.ok) throw new Error('expected failure')
      expect(['unreachable', 'error-status', 'not-openai-compatible']).toContain(live.kind)
    }
  })

  it('readModelsResponse is the shared entry point and reports the URL it was given', async () => {
    // Not LLM_BASE_URL: the URL the CALLER dialled. openai-api.ts's probe can
    // resolve a different one via OPENAI_BASE_URL, and reporting the module
    // constant for a URL that was never contacted is its own lie.
    const out = await readModelsResponse('http://127.0.0.1:59994/v1', realResponse(HTML_PAGE, 200, 'text/html'))

    expect(out.ok).toBe(false)
    if (out.ok) throw new Error('expected failure')
    expect(out.error).toContain('http://127.0.0.1:59994/v1/models')
    expect(out.error).not.toContain(LLM_BASE_URL)
  })

  it('unreachableModelsResult names the URL it was given, with kind "unreachable"', async () => {
    const out = unreachableModelsResult('http://127.0.0.1:59993/v1', new Error('connect ECONNREFUSED'))

    expect(out.ok).toBe(false)
    if (out.ok) throw new Error('expected failure')
    expect(out.kind).toBe('unreachable')
    expect(out.error).toBe('http://127.0.0.1:59993/v1 is unreachable — connect ECONNREFUSED')
  })
})

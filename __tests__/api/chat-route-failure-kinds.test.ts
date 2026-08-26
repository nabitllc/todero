// Round-2 guard for pieces8/llm-provider-honesty.
//
// WHY THIS FILE EXISTS: a fresh-context critic mutation-tested the piece and
// found that two of its four owned files had NO test coverage at all. Two
// mutants survived because of it, and both put the product back to its
// pre-fix behaviour with the suite still reporting 16/16 green:
//
//   M6  app/api/chat/route.ts — sseError() stops emitting `kind`, so the
//       streaming path loses the machine-readable reason entirely.
//   M7  app/api/chat/autotitle/route.ts — reverted WHOLESALE: `kind` dropped
//       from the 502 body and the old "returned no models — pull one first"
//       prose restored for an endpoint that is not OpenAI-compatible at all.
//
// A guard that cannot see a whole file being reverted is not a guard. These
// tests assert the two routes' failure answers directly: which kind, and — for
// the incompatible-endpoint case — that "pull one first" is NOT the advice.
//
// The seam itself (lib/llm-provider.ts) is covered by
// __tests__/api/llm-endpoint-shape-honesty.test.ts; this file is only about
// what the two ROUTES do with the seam's verdict.

import { NextRequest } from 'next/server'
import { LLM_BASE_URL, noModelsError } from '@/lib/llm-provider'

// The database is irrelevant to every path under test: both routes answer
// before any query. Neutralising the guard keeps the test about the LLM seam
// rather than about whichever DB provider the sandbox happens to have.
jest.mock('@/lib/db-http', () => ({
  ...jest.requireActual('@/lib/db-http'),
  dbUnavailableResponse: () => null,
}))
jest.mock('@/lib/hub-client', () => ({
  createAdminClient: () => {
    throw new Error('the database must not be touched on a failed-roster path')
  },
}))

const ORIGINAL_FETCH = global.fetch
const ORIGINAL_ENV = { ...process.env }

/** A REAL Response — the shape check reads headers and body off it. */
function realResponse(body: string, status: number, contentType: string): Response {
  return new Response(body, { status, headers: { 'Content-Type': contentType } })
}

const HTML_PAGE = '<!doctype html><html><body><h1>It works!</h1></body></html>'
const OLLAMA_NATIVE = JSON.stringify({ models: [{ name: 'qwen2.5-coder:7b' }] })
const OPENAI_EMPTY = JSON.stringify({ object: 'list', data: [] })

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

/** Drain the route's SSE body and return the first frame's JSON payload. */
async function firstSseFrame(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text()
  const line = text.split('\n').find(l => l.startsWith('data: '))
  if (!line) throw new Error(`no SSE data frame in: ${JSON.stringify(text)}`)
  return JSON.parse(line.slice(6))
}

async function postChat(body: unknown): Promise<Response> {
  const { POST } = await import('@/app/api/chat/route')
  return POST(
    new NextRequest('http://localhost:3000/api/chat', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  )
}

async function postAutotitle(): Promise<{ status: number; body: Record<string, unknown> }> {
  const { POST } = await import('@/app/api/chat/autotitle/route')
  const res = await POST(
    new NextRequest('http://localhost:3000/api/chat/autotitle', {
      method: 'POST',
      body: JSON.stringify({ conversationId: 'conv-test', firstUserMessage: 'hello there' }),
    }),
  )
  return { status: res.status, body: await res.json() }
}

const MESSAGES = { messages: [{ role: 'user', content: 'hi' }] }

describe('POST /api/chat carries the failure KIND in the SSE frame (kills mutant M6)', () => {
  it('an HTML 200 at LLM_BASE_URL streams kind "not-openai-compatible", not "pull one first"', async () => {
    fetchMock.mockResolvedValue(realResponse(HTML_PAGE, 200, 'text/html'))

    const frame = await firstSseFrame(await postChat(MESSAGES))

    // The field the piece added. Its absence is exactly mutant M6.
    expect(frame.kind).toBe('not-openai-compatible')
    expect(String(frame.error)).toContain('not JSON')
    expect(String(frame.error)).toContain(LLM_BASE_URL)
    // Pulling a model does not fix an HTML page. This sentence reaching the
    // user here was the original defect.
    expect(String(frame.error)).not.toContain('pull one first')
  })

  it('a compatible-but-empty roster streams kind "empty-roster" and DOES say pull one first', async () => {
    fetchMock.mockResolvedValue(realResponse(OPENAI_EMPTY, 200, 'application/json'))

    const frame = await firstSseFrame(await postChat(MESSAGES))

    expect(frame.kind).toBe('empty-roster')
    expect(frame.error).toBe(noModelsError())
    expect(String(frame.error)).toContain('pull one first')
  })

  it('an unreachable endpoint streams kind "unreachable"', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'))

    const frame = await firstSseFrame(await postChat(MESSAGES))

    expect(frame.kind).toBe('unreachable')
    expect(String(frame.error)).toContain('is unreachable')
  })

  it('the three roster failures are three DIFFERENT frames, not one', async () => {
    const frames: string[] = []
    fetchMock.mockResolvedValue(realResponse(HTML_PAGE, 200, 'text/html'))
    frames.push(JSON.stringify(await firstSseFrame(await postChat(MESSAGES))))
    fetchMock.mockResolvedValue(realResponse(OLLAMA_NATIVE, 200, 'application/json'))
    frames.push(JSON.stringify(await firstSseFrame(await postChat(MESSAGES))))
    fetchMock.mockResolvedValue(realResponse(OPENAI_EMPTY, 200, 'application/json'))
    frames.push(JSON.stringify(await firstSseFrame(await postChat(MESSAGES))))

    expect(new Set(frames).size).toBe(3)
  })

  it('a request with no messages still fails the way it always did', async () => {
    const frame = await firstSseFrame(await postChat({}))

    expect(frame.error).toBe('messages array is required')
    // Not a roster failure, so no kind — the field means "why the ROSTER read
    // failed", and attaching one here would be noise dressed as a diagnosis.
    expect(frame.kind).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('POST /api/chat/autotitle answers with the same kinds (kills mutant M7)', () => {
  it('an HTML 200 is a 502 with kind "not-openai-compatible" and no "pull one first"', async () => {
    fetchMock.mockResolvedValue(realResponse(HTML_PAGE, 200, 'text/html'))

    const { status, body } = await postAutotitle()

    expect(status).toBe(502)
    // Mutant M7 reverted this whole file and the suite stayed green.
    expect(body.kind).toBe('not-openai-compatible')
    expect(String(body.error)).toContain('not an OpenAI-compatible endpoint')
    expect(String(body.error)).not.toContain('pull one first')
  })

  it('Ollama’s native shape is named as a different API, not an empty roster', async () => {
    fetchMock.mockResolvedValue(realResponse(OLLAMA_NATIVE, 200, 'application/json'))

    const { status, body } = await postAutotitle()

    expect(status).toBe(502)
    expect(body.kind).toBe('not-openai-compatible')
    expect(String(body.error)).toContain('no top-level "data" array')
    expect(String(body.error)).not.toContain('pull one first')
  })

  it('a genuinely empty compatible roster is kind "empty-roster" with the shared sentence', async () => {
    fetchMock.mockResolvedValue(realResponse(OPENAI_EMPTY, 200, 'application/json'))

    const { status, body } = await postAutotitle()

    expect(status).toBe(502)
    expect(body.kind).toBe('empty-roster')
    // The SAME string the other two routes use. Three copies of this sentence
    // is how the wording drifts apart and one of them starts lying again.
    expect(body.error).toBe(noModelsError())
  })

  it('an unreachable endpoint is kind "unreachable"', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'))

    const { status, body } = await postAutotitle()

    expect(status).toBe(502)
    expect(body.kind).toBe('unreachable')
  })
})

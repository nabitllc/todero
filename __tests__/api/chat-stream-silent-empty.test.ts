// Live-socket guard: a stream that produced NOTHING must not look like a
// stream that produced an empty answer.
//
// THE DEFECT CLASS (the one this whole channel exists to remove): a parse
// failure, a non-2xx, a timeout or an unexpected shape collapsing into a value
// that is indistinguishable from a legitimate empty result.
//
// app/api/chat/route.ts had it on its LOUDEST surface. The SSE relay loop
// skipped any line it could not parse (`catch { /* skip malformed lines */ }`)
// and any line not starting with `data: `. So an upstream that answered 200
// with something that is not an OpenAI SSE stream — an HTML login page, or a
// NON-streaming JSON completion because the server ignored `stream: true` —
// produced zero delta frames and then the ordinary terminator:
//
//     data: {"done":true}
//
// byte-identical to a model that legitimately replied with an empty string.
// The user sees an empty assistant bubble and no error anywhere. Measured
// 2026-08-26 against real sockets (see pieces9/llm-provider-sweep.md).
//
// These tests use REAL HTTP servers rather than a fetch mock on purpose: the
// bug lives in how the response BODY streams, and a mock that resolves a
// string cannot exercise a reader loop.

import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

jest.mock('@/lib/db-http', () => ({
  ...jest.requireActual('@/lib/db-http'),
  dbUnavailableResponse: () => null,
}))

const ORIGINAL_ENV = { ...process.env }
const ROSTER = JSON.stringify({ object: 'list', data: [{ id: 'qwen2.5-coder:7b' }] })

/** An endpoint serving a real roster plus whatever `completions` writes. */
function startEndpoint(completions: (res: import('node:http').ServerResponse) => void): Promise<Server> {
  return new Promise(resolve => {
    const srv = createServer((req, res) => {
      if ((req.url ?? '').includes('/models')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(ROSTER)
        return
      }
      let body = ''
      req.on('data', c => { body += c })
      req.on('end', () => completions(res))
    })
    srv.listen(0, '127.0.0.1', () => resolve(srv))
  })
}

const close = (s: Server) => new Promise<void>(r => s.close(() => r()))

/** Drive the real route handler against a real socket. */
async function postChat(server: Server): Promise<string> {
  const port = (server.address() as AddressInfo).port
  process.env.LLM_BASE_URL = `http://127.0.0.1:${port}/v1`
  delete process.env.LLM_MODEL
  jest.resetModules()
  // Re-require so the route re-reads LLM_BASE_URL at module load.
  const route = require('@/app/api/chat/route')
  const req = new Request('http://localhost:3000/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // No conversationId: nothing is persisted, so no fixture rows are created.
    body: JSON.stringify({ messages: [{ role: 'user', content: 'say PONG' }] }),
  })
  const res = await route.POST(req as never)
  return await res.text()
}

afterEach(() => { process.env = { ...ORIGINAL_ENV } })

describe('the chat stream distinguishes "no answer" from "an empty answer"', () => {
  it('relays a real SSE completion as delta frames and a clean done', async () => {
    const srv = await startEndpoint(res => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: {"choices":[{"delta":{"content":"PONG"}}]}\n\n')
      res.write('data: [DONE]\n\n')
      res.end()
    })
    try {
      const body = await postChat(srv)
      expect(body).toContain('"delta":"PONG"')
      expect(body).toContain('"done":true')
      // A successful stream carries no complaint.
      expect(body).not.toContain('"error"')
    } finally { await close(srv) }
  })

  it('an upstream 200 that is NOT a stream is an ERROR, not an empty reply', async () => {
    // A proxy login page. Every line fails `startsWith('data: ')`, so the old
    // loop emitted zero deltas and then {"done":true}.
    const srv = await startEndpoint(res => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><body>Sign in to continue</body></html>')
    })
    try {
      const body = await postChat(srv)
      expect(body).toContain('"error"')
      // and it must say what actually happened, not "unreachable"
      expect(body).not.toContain('unreachable')
      expect(body).toMatch(/no content|not .*stream|0 |zero/i)
    } finally { await close(srv) }
  })

  it('an upstream that ignored stream:true is an ERROR, not an empty reply', async () => {
    // A real, correct, NON-streaming OpenAI completion. The content is right
    // there in the body — the relay just cannot see it — so silently showing
    // an empty bubble is the worst possible answer.
    const srv = await startEndpoint(res => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: 'PONG' } }] }))
    })
    try {
      const body = await postChat(srv)
      expect(body).toContain('"error"')
    } finally { await close(srv) }
  })

  it('a stream of ONLY malformed data: lines is an ERROR, not an empty reply', async () => {
    const srv = await startEndpoint(res => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: {not json at all\n\n')
      res.write('data: {"choices":[{"delta":{}}]\n\n')
      res.end()
    })
    try {
      const body = await postChat(srv)
      expect(body).toContain('"error"')
    } finally { await close(srv) }
  })
})

describe('autotitle names what actually arrived', () => {
  async function postTitle(server: Server): Promise<{ status: number; body: Record<string, unknown> }> {
    const port = (server.address() as AddressInfo).port
    process.env.LLM_BASE_URL = `http://127.0.0.1:${port}/v1`
    delete process.env.LLM_MODEL
    jest.resetModules()
    const route = require('@/app/api/chat/autotitle/route')
    const req = new Request('http://localhost:3000/api/chat/autotitle', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ conversationId: 'probe-not-in-db', firstUserMessage: 'hello there' }),
    })
    const res = await route.POST(req as never)
    return { status: res.status, body: await res.json() }
  }

  it('an HTML 200 is reported as incompatible, NOT as "unreachable"', async () => {
    // The old code did a bare `await res.json()`. An HTML page threw a
    // SyntaxError, fell into the catch, and was reported as
    // "<url> is unreachable" — about an endpoint that had just answered 200.
    const srv = await startEndpoint(res => {
      res.writeHead(200, { 'content-type': 'text/html' })
      res.end('<html><body>Sign in to continue</body></html>')
    })
    try {
      const { status, body } = await postTitle(srv)
      expect(status).toBe(502)
      expect(body.kind).toBe('not-openai-compatible')
      expect(String(body.error)).not.toContain('unreachable')
    } finally { await close(srv) }
  })

  it('valid JSON with no choices array is a different API, not an empty title', async () => {
    const srv = await startEndpoint(res => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ result: 'some other API' }))
    })
    try {
      const { status, body } = await postTitle(srv)
      expect(status).toBe(502)
      expect(body.kind).toBe('not-openai-compatible')
    } finally { await close(srv) }
  })

  it('a well-formed completion carrying an empty string is empty-completion', async () => {
    // The honest other half: the endpoint is fine and the MODEL produced
    // nothing. Different cause, different fix, so a different answer.
    const srv = await startEndpoint(res => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: '   ' } }] }))
    })
    try {
      const { status, body } = await postTitle(srv)
      expect(status).toBe(502)
      expect(body.kind).toBe('empty-completion')
    } finally { await close(srv) }
  })
})

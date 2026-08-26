// TOD-1045: OpenAI API runtime adapter — direct API + tool-use loop.
// TOD-2020: spawn() tool-use loop implemented.
//
// Unlike Codex CLI (which shells out to the `codex` binary), this adapter
// calls the OpenAI Chat Completions API directly with function-calling enabled.
// Useful when the Codex CLI isn't installed but OPENAI_API_KEY is available.
//
// Key properties:
// - No binary dependency — just the env var OPENAI_API_KEY
// - Single-shot (supportsSessions=false) — spawns a Node subprocess per task
// - Tool-use loop (supportsTools=true) — exposes read_file + run_bash tools
// - Model ids come from a live GET of ${LLM_BASE_URL}/models — there is no
//   vendor alias table, so an unresolvable tier is reported by name

import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AgentRuntime, AgentSpawnOptions, AgentSpawnResult } from './types'
import {
  LLM_BASE_URL,
  fetchLiveModels,
  readModelsResponse,
  resolveModelId,
  unreachableModelsResult,
} from '@/lib/llm-provider'
import type { LiveModelsResult } from '@/lib/llm-provider'
import { appendLog, spawnDetached, watchChildExit } from './detached-spawn'
import { summarizeExit } from './exit-evidence'
import { recordRunOnExit } from '../memory-loop'
import { finalizeRun } from './token-ledger'
import { estimateModelRateUsd } from '../model-rates'

// ---------------------------------------------------------------------------
// Provider resolution - OpenAI-compatible, not OpenAI-only
// ---------------------------------------------------------------------------
//
// The endpoint used to be the literal hostname `api.openai.com`, so pointing
// Todero at Ollama / LM Studio / a hosted gateway / Azure required editing this file.
// Any server speaking the OpenAI chat-completions shape now works by setting
// LLM_BASE_URL (e.g. http://localhost:11434/v1 for Ollama).

export interface ProviderConfig {
  /** Base URL including the version segment, e.g. http://localhost:11434/v1 */
  baseUrl: string
  /** Bearer token. Local servers ignore it, so it may be a placeholder. */
  apiKey: string
  /** True when the endpoint is on this machine and needs no credential. */
  isLocal: boolean
}

/** Thrown when no LLM endpoint is configured. Names the missing env var. */
export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProviderConfigError'
  }
}

/**
 * There is deliberately NO default base URL. It used to fall back to
 * `https://api.openai.com/v1`, so an operator who never configured anything
 * got a silent cloud endpoint (and an inscrutable 401) instead of being told
 * which variable they had not set. An unset LLM_BASE_URL is a configuration
 * error, by name.
 */
export function resolveProvider(): ProviderConfig {
  const configured = (process.env.LLM_BASE_URL ?? process.env.OPENAI_BASE_URL ?? '').trim()
  if (!configured) {
    throw new ProviderConfigError(
      'LLM_BASE_URL is not set — no LLM endpoint is configured. Set LLM_BASE_URL ' +
      '(e.g. http://localhost:11434/v1 for Ollama) in .env.local. There is no ' +
      'default: a missing value must not quietly become a cloud vendor.',
    )
  }
  const baseUrl = configured.replace(/[/]+$/, '')

  let isLocal = false
  try {
    const host = new URL(baseUrl).hostname
    isLocal = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0'
  } catch {
    isLocal = false
  }

  const apiKey = process.env.LLM_API_KEY ?? process.env.OPENAI_API_KEY ?? (isLocal ? 'local' : '')
  return { baseUrl, apiKey, isLocal }
}

// ---------------------------------------------------------------------------
// Availability — a probe, not a guess
// ---------------------------------------------------------------------------
//
// isAvailable() used to be `isLocal || apiKey.length > 0`: any URL whose host
// was localhost reported the runtime ready, whether or not anything was
// listening on it. That is a sensorless guard — /api/run-agent/runtimes went
// green, the first-run wizard printed "OpenAI API is available on this host",
// and every dispatch then failed at spawn time. scripts/doctor.mjs already did
// the real probe and printed the contradiction out loud; this makes the
// registry itself ask the same question.
//
// The question is answered by the endpoint: GET ${baseUrl}/models must succeed
// AND report at least one model id. A configured endpoint that will not answer,
// answers non-2xx (a bad or missing credential on a hosted gateway), or serves
// an empty roster is unavailable, by name.

/** Short on purpose — this runs inline in request handlers. */
const PROBE_TIMEOUT_MS = 1500
/** listRuntimes() is polled by the wizard and /api/health; don't re-probe per request. */
const PROBE_TTL_MS = 30_000

export type ProviderProbe = { ok: true } | { ok: false; reason: string }

let probeCache: { key: string; at: number; result: ProviderProbe } | null = null

/**
 * `fetchLiveModels()` reads its own module-level LLM_BASE_URL. That is the same
 * URL in every normal setup, but resolveProvider() also accepts OPENAI_BASE_URL,
 * so the two can diverge — and probing a URL the adapter would not dispatch to
 * is the exact class of lie this function exists to remove. Use the shared
 * helper when they agree, and probe the resolved URL directly when they do not.
 *
 * The "probe it directly" branch used to be a HAND-ROLLED SECOND PARSER, and
 * it ended with:
 *
 *     const body = await res.json().catch(() => null)
 *     return { ok: true, models: Array.isArray(body?.data) ? body.data : [] }
 *
 * so any HTTP 200 whatsoever — an HTML index page, a proxy login screen,
 * Ollama's native `/api/tags` shape when the base URL lost its `/v1` — came
 * back as `{ ok: true, models: [] }`, byte-identical to a healthy endpoint
 * with nothing pulled. `probeProvider()` then reported "answers but serves no
 * models — pull one first" for four unrelated causes, three of which pulling a
 * model does not fix, and `/api/health` and `listRuntimes()` published that.
 * lib/llm-provider.ts's `fetchLiveModels()` was fixed first and this copy was
 * left behind, which is the whole argument for there being one parser: the
 * body check and the unreachable case now come from `readModelsResponse()` /
 * `unreachableModelsResult()`, and `LiveModelsResult.kind` is required, so a
 * third hand-rolled copy will not type-check.
 */
async function fetchModelsFrom(provider: ProviderConfig): Promise<LiveModelsResult> {
  if (provider.baseUrl === LLM_BASE_URL) return fetchLiveModels(PROBE_TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(`${provider.baseUrl}/models`, {
      headers: { Authorization: `Bearer ${provider.apiKey}` },
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    })
  } catch (err) {
    return unreachableModelsResult(provider.baseUrl, err)
  }
  return readModelsResponse(provider.baseUrl, res)
}

/**
 * Ask the configured endpoint whether it is there. Memoized for PROBE_TTL_MS
 * per base URL so the registry can be listed on every request without turning
 * into a health-check flood.
 */
export async function probeProvider(): Promise<ProviderProbe> {
  let provider: ProviderConfig
  try {
    provider = resolveProvider()
  } catch (err) {
    // No endpoint configured at all. The message already names the variable.
    return { ok: false, reason: err instanceof Error ? err.message : String(err) }
  }

  const now = Date.now()
  if (probeCache && probeCache.key === provider.baseUrl && now - probeCache.at < PROBE_TTL_MS) {
    return probeCache.result
  }

  const live = await fetchModelsFrom(provider)
  let result: ProviderProbe
  if (!live.ok) {
    result = {
      ok: false,
      reason: `${provider.baseUrl} does not answer — dispatch through it will fail: ${live.error}`,
    }
  } else if (live.models.length === 0) {
    result = {
      ok: false,
      reason:
        `${provider.baseUrl} answers but serves no models — dispatch through it will fail. ` +
        'Pull one first (e.g. `ollama pull qwen2.5-coder:7b`).',
    }
  } else {
    result = { ok: true }
  }

  probeCache = { key: provider.baseUrl, at: now, result }
  return result
}

/** Test/CLI seam: drop the memo so the next probe hits the endpoint again. */
export function resetProviderProbeCache(): void {
  probeCache = null
}

// ---------------------------------------------------------------------------
// Model mapping
// ---------------------------------------------------------------------------

/**
 * Resolve an agent's model tier against the roster the configured endpoint
 * actually reports (`GET ${LLM_BASE_URL}/models`).
 *
 * This used to be a static map — `sonnet` became `gpt-4o` whether or not the
 * configured endpoint had ever heard of it, which is the same silent
 * substitution the chat route was fixed to stop doing. Now the only ids that
 * can come out of here are ids the live roster contains, in this order:
 *
 *   1. `LLM_MODEL_<TIER>` (e.g. LLM_MODEL_SONNET) — per-tier override
 *   2. `LLM_MODEL` — the single-model setup most local hosts use
 *   3. the tier name itself, if the endpoint happens to serve a model by that name
 *
 * Returns null when nothing matches — including when the endpoint is
 * unreachable — so the caller reports the tier by name instead of guessing.
 *
 * `overrideId` (run-agent-locally piece) takes precedence over every env-var
 * candidate when given — it is a concrete id the caller already resolved
 * (typically a vault agent's `fallback_local`, e.g. "qwen2.5-coder:14b") —
 * but it is still checked against the endpoint's live roster like every
 * other candidate: a stale manifest naming a model this Ollama has not
 * pulled is reported by name, never dispatched anyway.
 *
 * `liveModelsOverride` (agent-config-panel-truth piece, round 3): a
 * `fetchLiveModels()` result the caller already has. lib/resolve-
 * dispatch-model.ts's `resolveDispatchModel()` passes one shared result in
 * when resolving many agents in a single request (GET /api/agents can
 * resolve ~42 rows this way) so this function does not issue its own live
 * GET against the endpoint's `/models` once per row. Omitted = unchanged
 * behavior — this function fetches its own, exactly as it always has.
 */
export async function mapModel(
  alias: 'opus' | 'sonnet' | 'haiku' | undefined,
  overrideId?: string,
  liveModelsOverride?: LiveModelsResult,
): Promise<string | null> {
  const live = liveModelsOverride ?? await fetchLiveModels()
  if (!live.ok) return null
  const ids = live.models.map(m => m.id)
  const candidates = [
    overrideId,
    alias ? process.env[`LLM_MODEL_${alias.toUpperCase()}`] : undefined,
    process.env.LLM_MODEL,
    alias,
  ]
  for (const candidate of candidates) {
    if (!candidate) continue
    const hit = resolveModelId(candidate, ids)
    if (hit) return hit
  }
  return null
}

// ---------------------------------------------------------------------------
// Tool schemas — OpenAI function-calling format
// ---------------------------------------------------------------------------

export const OPENAI_TOOL_SCHEMAS = [
  {
    type: 'function' as const,
    function: {
      name: 'read_file',
      description: 'Read the contents of a file at the given path.',
      parameters: {
        type: 'object',
        properties: {
          path: {
            type: 'string',
            description: 'Absolute or relative path to the file to read.',
          },
        },
        required: ['path'],
        additionalProperties: false,
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'run_bash',
      description: 'Run a shell command and return its stdout/stderr.',
      parameters: {
        type: 'object',
        properties: {
          command: {
            type: 'string',
            description: 'The bash command to execute.',
          },
        },
        required: ['command'],
        additionalProperties: false,
      },
    },
  },
]

// ---------------------------------------------------------------------------
// Tool-use loop — exported for unit testing
// ---------------------------------------------------------------------------

export interface ToolUseLoopOpts {
  apiKey: string
  model: string
  prompt: string
  /** Dependency-injectable API caller; defaults to real HTTPS POST */
  callApi?: (body: object) => Promise<unknown>
  /** Dependency-injectable tool executor; defaults to real fs/exec */
  executeTool?: (name: string, args: Record<string, unknown>) => string
  maxIterations?: number
}

export interface ToolUseLoopResult {
  finalText: string
  iterations: number
}

type OAIMessage = {
  role: string
  content: string | null
  tool_calls?: Array<{
    id: string
    type: string
    function: { name: string; arguments: string }
  }>
  tool_call_id?: string
}

type OAIResponse = {
  error?: { message: string }
  choices: Array<{
    finish_reason: string
    message: OAIMessage
  }>
}

/**
 * runOpenAIToolUseLoop — core Chat Completions tool-use loop.
 *
 * Sends the prompt to the model, executes tool calls, feeds results back,
 * and repeats until the model returns a final text (finish_reason === 'stop'
 * or no tool_calls).
 *
 * Exported for unit testing via injected callApi / executeTool.
 */
export async function runOpenAIToolUseLoop(opts: ToolUseLoopOpts): Promise<ToolUseLoopResult> {
  const MAX_ITER = opts.maxIterations ?? 20
  const callApi = opts.callApi ?? ((body: object) => defaultCallApi(opts.apiKey, body))
  const executeTool = opts.executeTool ?? defaultExecuteTool

  const messages: OAIMessage[] = [{ role: 'user', content: opts.prompt }]

  for (let iter = 1; iter <= MAX_ITER; iter++) {
    const response = (await callApi({
      model: opts.model,
      messages,
      tools: OPENAI_TOOL_SCHEMAS,
      tool_choice: 'auto',
    })) as OAIResponse

    if (response.error) {
      throw new Error(`OpenAI API error: ${response.error.message}`)
    }

    const choice = response.choices[0]
    if (!choice) throw new Error('No choices in OpenAI response')

    const assistantMessage = choice.message
    messages.push(assistantMessage)

    if (
      choice.finish_reason === 'stop' ||
      !assistantMessage.tool_calls ||
      assistantMessage.tool_calls.length === 0
    ) {
      return { finalText: assistantMessage.content ?? '', iterations: iter }
    }

    for (const tc of assistantMessage.tool_calls) {
      let args: Record<string, unknown> = {}
      try {
        args = JSON.parse(tc.function.arguments) as Record<string, unknown>
      } catch {
        args = {}
      }
      const result = executeTool(tc.function.name, args)
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result })
    }
  }

  throw new Error(`openai-api: tool-use loop exceeded ${MAX_ITER} iterations`)
}

// ---------------------------------------------------------------------------
// Default implementations (real HTTPS + fs/exec)
// ---------------------------------------------------------------------------

function defaultCallApi(apiKey: string, body: object): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const { baseUrl } = resolveProvider()
    const url = new URL(`${baseUrl}/chat/completions`)
    const transport = url.protocol === 'http:'
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      ? (require('http') as typeof import('http'))
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      : (require('https') as typeof import('https'))
    const data = JSON.stringify(body)
    const req = transport.request(
      {
        hostname: url.hostname,
        port: url.port || undefined,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          'Content-Length': Buffer.byteLength(data),
        },
      },
      (res) => {
        let raw = ''
        res.on('data', (chunk) => { raw += chunk })
        res.on('end', () => {
          try { resolve(JSON.parse(raw)) }
          catch { reject(new Error(`Failed to parse response from ${baseUrl}: ${raw.slice(0, 200)}`)) }
        })
      }
    )
    req.on('error', reject)
    req.write(data)
    req.end()
  })
}

function defaultExecuteTool(name: string, args: Record<string, unknown>): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require('fs') as typeof import('fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const cp = require('child_process') as typeof import('child_process')

  if (name === 'read_file') {
    const path = String(args.path ?? '')
    try { return fs.readFileSync(path, 'utf8') }
    catch (e) { return `Error reading file: ${e instanceof Error ? e.message : String(e)}` }
  }

  if (name === 'run_bash') {
    const command = String(args.command ?? '')
    try { return cp.execSync(command, { encoding: 'utf8', timeout: 30_000 }) }
    catch (e) { return `Error running command: ${e instanceof Error ? e.message : String(e)}` }
  }

  return `Unknown tool: ${name}`
}

// ---------------------------------------------------------------------------
// Runner script — written to a temp file and executed in a detached subprocess
// ---------------------------------------------------------------------------

// Plain JS (no TypeScript) executed by node in the child process.
// Implements the same tool-use loop as runOpenAIToolUseLoop, reading config from env vars.
//
// EVERY `\n` INSIDE A STRING IN THESE LINES MUST BE WRITTEN `\\n`. These are
// TypeScript string literals whose contents become JavaScript SOURCE, so a
// single-backslash `\n` is a real newline character emitted into the middle of
// a JS string literal — an unterminated-string SyntaxError, and node refuses to
// parse the whole file.
//
// This is not hypothetical. Two of these lines (the `!BASE_URL` and `!MODEL`
// guards) shipped with a single backslash from the commit that introduced this
// runner, so EVERY openai-api dispatch since then spawned a runner that died
// instantly with `SyntaxError: Invalid or unexpected token`, wrote no `[trace]`
// line at all, and exited 1. Nothing caught it because nothing had ever run
// this adapter's spawn() end to end. Found and fixed in pieces8/memory-attempted
// round 2, by the first test that did — see
// __tests__/runtimes/adapter-exit-record.test.ts, whose 'a run that really
// completes' case fails with exit 1 if either backslash is dropped again.
const RUNNER_SCRIPT = [
  "'use strict'",
  'const http = require("http")',
  'const https = require("https")',
  'const fs = require("fs")',
  'const cp = require("child_process")',
  'const API_KEY = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || ""',
  'const BASE_URL = (process.env.LLM_BASE_URL || "").replace(/[/]+$/, "")',
  'const MODEL = process.env.OPENAI_MODEL || ""',
  // No cloud default for either. The parent already refused to spawn without
  // both, so reaching here unset means the env was tampered with in between —
  // say which one is missing rather than dialling api.openai.com with "gpt-4o".
  'if (!BASE_URL) { process.stderr.write("[openai-api] LLM_BASE_URL not set\\n"); process.exit(1) }',
  'if (!MODEL) { process.stderr.write("[openai-api] OPENAI_MODEL not set\\n"); process.exit(1) }',
  'const PROMPT_F = process.env.PROMPT_FILE',
  'const LOG_F = process.env.LOG_FILE',
  'const MAX_ITER = parseInt(process.env.MAX_ITER || "20", 10)',
  'const ENDPOINT = new URL(BASE_URL + "/chat/completions")',
  'const TRANSPORT = ENDPOINT.protocol === "http:" ? http : https',
  'if (!PROMPT_F) { process.stderr.write("[openai-api] PROMPT_FILE not set\\n"); process.exit(1) }',
  'if (!LOG_F) { process.stderr.write("[openai-api] LOG_FILE not set\\n"); process.exit(1) }',
  'const prompt = fs.readFileSync(PROMPT_F, "utf8")',
  'const TOOLS = [',
  '  { type: "function", function: { name: "read_file", description: "Read a file.",',
  '    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false } } },',
  '  { type: "function", function: { name: "run_bash", description: "Run a bash command.",',
  '    parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"], additionalProperties: false } } },',
  ']',
  'function callApi(body) {',
  '  return new Promise(function(resolve, reject) {',
  '    const data = JSON.stringify(body)',
  '    const req = TRANSPORT.request({ hostname: ENDPOINT.hostname, port: ENDPOINT.port || undefined, path: ENDPOINT.pathname, method: "POST",',
  '      headers: { "Content-Type": "application/json", "Authorization": "Bearer " + API_KEY, "Content-Length": Buffer.byteLength(data) }',
  '    }, function(res) {',
  '      let raw = ""',
  '      res.on("data", function(c) { raw += c })',
  '      res.on("end", function() { try { resolve(JSON.parse(raw)) } catch(e) { reject(new Error("Parse error: " + raw.slice(0,200))) } })',
  '    })',
  '    req.on("error", reject); req.write(data); req.end()',
  '  })',
  '}',
  'function executeTool(name, args) {',
  '  if (name === "read_file") { try { return fs.readFileSync(args.path, "utf8") } catch(e) { return "Error reading file: " + e.message } }',
  '  if (name === "run_bash") { try { return cp.execSync(args.command, { encoding: "utf8", timeout: 30000 }) } catch(e) { return "Error running command: " + e.message } }',
  '  return "Unknown tool: " + name',
  '}',
  // run-agent-locally piece: every step this loop takes — each model call,
  // each tool call, each token count the endpoint reports — is written as a
  // structured `[trace] {...}` JSON line, one per line, on top of the
  // existing human-readable `[openai-api] ...` lines. This is the whole of
  // the drillable trace: no separate DB write from the child process (it has
  // no import of the server\'s db seam and no session cookie to call an
  // authenticated API with), so the log file itself is the source of truth.
  // parseOpenAiTrace() (this same module, running server-side) reads these
  // lines back into a run -> steps -> tool-calls structure once the process
  // has exited.
  'function trace(obj) { fs.appendFileSync(LOG_F, "[trace] " + JSON.stringify(obj) + "\\n") }',
  'async function main() {',
  '  fs.appendFileSync(LOG_F, "[openai-api] provider=" + BASE_URL + " model=" + MODEL + " prompt_bytes=" + prompt.length + "\\n")',
  '  trace({ type: "run_start", model: MODEL, provider: BASE_URL, promptBytes: prompt.length, at: new Date().toISOString() })',
  '  const messages = [{ role: "user", content: prompt }]',
  '  let totalIn = 0, totalOut = 0',
  '  for (let iter = 1; iter <= MAX_ITER; iter++) {',
  '    const callStart = Date.now()',
  '    const resp = await callApi({ model: MODEL, messages: messages, tools: TOOLS, tool_choice: "auto" })',
  '    const callEnd = Date.now()',
  // upstream_started_at / upstream_finished_at bracket exactly the fetch to
  // `${BASE_URL}/chat/completions` this process just made — nothing before
  // callStart or after callEnd is included, so this window cannot be
  // stretched to cover a request some other run or process caused.
  '    const upstreamStartedAt = new Date(callStart).toISOString()',
  '    const upstreamFinishedAt = new Date(callEnd).toISOString()',
  '    const usage = resp && resp.usage ? resp.usage : {}',
  '    const tokensIn = usage.prompt_tokens || 0, tokensOut = usage.completion_tokens || 0',
  '    totalIn += tokensIn; totalOut += tokensOut',
  '    if (resp.error) {',
  '      trace({ type: "model_call", iter: iter, ok: false, error: String(resp.error.message || resp.error), ms: callEnd - callStart, upstream_started_at: upstreamStartedAt, upstream_finished_at: upstreamFinishedAt })',
  '      fs.appendFileSync(LOG_F, "[openai-api] API error: " + JSON.stringify(resp.error) + "\\n"); process.exit(1)',
  '    }',
  '    const choice = resp.choices && resp.choices[0]',
  '    if (!choice) { trace({ type: "model_call", iter: iter, ok: false, error: "no choices in response", upstream_started_at: upstreamStartedAt, upstream_finished_at: upstreamFinishedAt }); fs.appendFileSync(LOG_F, "[openai-api] No choices\\n"); process.exit(1) }',
  '    const msg = choice.message',
  '    messages.push(msg)',
  // response.id is the OpenAI-compatible completion id (Ollama echoes one
  // back too, e.g. "chatcmpl-..."). response.model is what the endpoint
  // itself reports it served, which is not always byte-identical to the
  // MODEL string this process requested (a server may report a resolved/
  // quantized tag). Both are written here, on the same trace line as the
  // window that bounds the fetch that produced them — this line, and no
  // other, is what verify.mjs treats as the run\'s upstream correlation
  // record. A dedicated "upstream_correlation" type keeps it from being
  // confused with the human-readable model_call bookkeeping line.
  '    const providerResponseId = (resp && resp.id) || null',
  '    const providerModel = (resp && resp.model) || MODEL',
  '    trace({ type: "model_call", iter: iter, ok: true, finishReason: choice.finish_reason, tokensIn: tokensIn, tokensOut: tokensOut, ms: callEnd - callStart, toolCalls: (msg.tool_calls || []).map(function(t) { return t.function.name }) })',
  '    trace({ type: "upstream_correlation", iter: iter, provider_response_id: providerResponseId, provider_model: providerModel, upstream_started_at: upstreamStartedAt, upstream_finished_at: upstreamFinishedAt })',
  '    if (choice.finish_reason === "stop" || !msg.tool_calls || msg.tool_calls.length === 0) {',
  '      fs.appendFileSync(LOG_F, "[openai-api] Final (iter=" + iter + "):\\n" + (msg.content || "") + "\\n")',
  '      trace({ type: "run_end", status: "completed", iterations: iter, tokensIn: totalIn, tokensOut: totalOut, at: new Date().toISOString() })',
  '      return',
  '    }',
  '    for (const tc of msg.tool_calls) {',
  '      let args = {}; try { args = JSON.parse(tc.function.arguments) } catch {}',
  '      const toolStart = Date.now()',
  '      const result = executeTool(tc.function.name, args)',
  '      fs.appendFileSync(LOG_F, "[openai-api] tool_call " + tc.function.name + "\\n")',
  '      trace({ type: "tool_call", iter: iter, tool: tc.function.name, args: JSON.stringify(args).slice(0, 500), result: String(result).slice(0, 500), ms: Date.now() - toolStart })',
  '      messages.push({ role: "tool", tool_call_id: tc.id, content: String(result) })',
  '    }',
  '  }',
  '  fs.appendFileSync(LOG_F, "[openai-api] Max iterations reached\\n")',
  '  trace({ type: "run_end", status: "max_iterations", iterations: MAX_ITER, tokensIn: totalIn, tokensOut: totalOut, at: new Date().toISOString() })',
  '}',
  'main().catch(function(e) { fs.appendFileSync(LOG_F, "[openai-api] Fatal: " + e.message + "\\n"); trace({ type: "run_end", status: "failed", error: e.message, at: new Date().toISOString() }); process.exit(1) })',
].join('\n')

// ---------------------------------------------------------------------------
// Trace parsing — the log file IS the trace store (see RUNNER_SCRIPT above).
// ---------------------------------------------------------------------------

export interface TraceStep {
  type: string
  [key: string]: unknown
}

export interface ParsedTrace {
  steps: TraceStep[]
  totals: { tokensIn: number; tokensOut: number; costUsd: number; toolCalls: number }
  status: 'completed' | 'failed' | 'max_iterations' | 'running' | 'unknown'
  /**
   * The upstream correlation record for THIS run — sourced from the last
   * `upstream_correlation` trace line the child process wrote (see
   * RUNNER_SCRIPT above), which brackets exactly one fetch this process made
   * to `${LLM_BASE_URL}/chat/completions`. null when the log has no such
   * line (a run that failed before any model call, or a log from before this
   * field existed) — the caller must not invent a window when none was
   * measured.
   */
  upstream: {
    providerResponseId: string | null
    providerModel: string | null
    upstreamStartedAt: string | null
    upstreamFinishedAt: string | null
  } | null
}

/**
 * Read a run's log file back into the trace structure the RUNNER_SCRIPT
 * wrote (`[trace] {...}` JSON lines). Best-effort: a log file that does not
 * exist, or one written by a runtime that never emitted `[trace]` lines
 * (claude-code, codex, cursor), returns an empty step list rather than
 * throwing — the caller reports "no structured trace for this run" instead
 * of a 500.
 */
export function parseOpenAiTrace(logFile: string, model: string): ParsedTrace {
  const steps: TraceStep[] = []
  let raw = ''
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    raw = (require('fs') as typeof import('fs')).readFileSync(logFile, 'utf8')
  } catch {
    return { steps, totals: { tokensIn: 0, tokensOut: 0, costUsd: 0, toolCalls: 0 }, status: 'unknown', upstream: null }
  }
  for (const line of raw.split('\n')) {
    const idx = line.indexOf('[trace] ')
    if (idx === -1) continue
    try {
      steps.push(JSON.parse(line.slice(idx + '[trace] '.length)) as TraceStep)
    } catch { /* one malformed line does not lose the rest of the trace */ }
  }
  const runEnd = [...steps].reverse().find(s => s.type === 'run_end')
  const tokensIn = Number(runEnd?.tokensIn ?? 0)
  const tokensOut = Number(runEnd?.tokensOut ?? 0)
  const rate = estimateModelRateUsd(model)
  const costUsd = ((tokensIn + tokensOut) / 1_000_000) * rate
  const toolCalls = steps.filter(s => s.type === 'tool_call').length
  const status = (runEnd?.status as ParsedTrace['status'] | undefined) ?? (steps.length > 0 ? 'running' : 'unknown')
  // The LAST upstream_correlation line is canonical: on a multi-iteration
  // tool-use run it is the call that actually produced the final answer, and
  // on the (typical) single-iteration run it is the only one there is.
  const lastCorrelation = [...steps].reverse().find(s => s.type === 'upstream_correlation')
  const upstream = lastCorrelation
    ? {
        providerResponseId: (lastCorrelation.provider_response_id as string | null | undefined) ?? null,
        providerModel: (lastCorrelation.provider_model as string | null | undefined) ?? null,
        upstreamStartedAt: (lastCorrelation.upstream_started_at as string | null | undefined) ?? null,
        upstreamFinishedAt: (lastCorrelation.upstream_finished_at as string | null | undefined) ?? null,
      }
    : null
  return { steps, totals: { tokensIn, tokensOut, costUsd, toolCalls }, status, upstream }
}

// ---------------------------------------------------------------------------
// Runtime adapter
// ---------------------------------------------------------------------------

export const openaiApiRuntime: AgentRuntime = {
  name: 'openai-api',
  displayName: 'OpenAI API',
  supportsSessions: false,
  supportsTools: true,

  async isAvailable(): Promise<boolean> {
    return (await probeProvider()).ok
  },

  async unavailableReason(): Promise<string | null> {
    const probe = await probeProvider()
    return probe.ok ? null : probe.reason
  },

  async spawn(opts: AgentSpawnOptions): Promise<AgentSpawnResult> {
    let provider: ProviderConfig
    try {
      provider = resolveProvider()
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        runtime: 'openai-api',
      }
    }
    if (!provider.apiKey && !provider.isLocal) {
      return {
        ok: false,
        error: `no API key for ${provider.baseUrl} - set LLM_API_KEY (or OPENAI_API_KEY), or point LLM_BASE_URL at a local server`,
        runtime: 'openai-api',
      }
    }

    // Resolved against the endpoint's own live roster. An id nothing on the
    // roster matches is reported by name here rather than swapped for a model
    // from a vendor the operator never configured.
    const tier = opts.model ?? 'default'
    const model = await mapModel(opts.model, opts.modelOverride)
    if (!model) {
      return {
        ok: false,
        error:
          `cannot resolve a model for tier "${tier}" against ${provider.baseUrl}/models — ` +
          `set LLM_MODEL${opts.model ? ` (or LLM_MODEL_${opts.model.toUpperCase()})` : ''} ` +
          `to an id that endpoint reports`,
        runtime: 'openai-api',
      }
    }

    let tmpDir: string
    try {
      tmpDir = mkdtempSync(join(tmpdir(), `todero-openai-${opts.agentId}-`))
    } catch (err) {
      return {
        ok: false,
        error: `failed to create temp dir: ${err instanceof Error ? err.message : String(err)}`,
        runtime: 'openai-api',
      }
    }

    const promptFile = join(tmpDir, 'prompt.txt')
    const runnerFile = join(tmpDir, 'runner.js')

    try {
      writeFileSync(promptFile, opts.prompt, { encoding: 'utf8' })
      writeFileSync(runnerFile, RUNNER_SCRIPT, { encoding: 'utf8' })
    } catch (err) {
      try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
      return {
        ok: false,
        error: `failed to write temp files: ${err instanceof Error ? err.message : String(err)}`,
        runtime: 'openai-api',
      }
    }

    // Write spawn header to log
    try {
      writeFileSync(
        opts.logFile,
        `[spawn-start] ${new Date().toISOString()} agentId=${opts.agentId} model=${model} provider=${provider.baseUrl}\n` +
        `[spawn-start] prompt bytes: ${opts.prompt.length}\n` +
        `[spawn-start] ---\n`
      )
    } catch (err) {
      console.warn(`[openai-api] failed to write spawn marker: ${err instanceof Error ? err.message : String(err)}`)
    }

    // No shell at all. `process.execPath` rather than the bare name 'node': the
    // Next.js server is itself a node process, so the binary is guaranteed to
    // exist and to be the version the runner was written against. A host with
    // no POSIX shell (every Windows box) is no longer a blocker.
    const result = await spawnDetached(process.execPath, [runnerFile], opts.logFile, {
      cwd: opts.workingDir,
      env: {
        ...process.env,
        LLM_BASE_URL: provider.baseUrl,
        LLM_API_KEY: provider.apiKey,
        OPENAI_API_KEY: provider.apiKey,
        OPENAI_MODEL: model,
        PROMPT_FILE: promptFile,
        LOG_FILE: opts.logFile,
      },
    })

    if (!result.ok) {
      try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
      return {
        ok: false,
        error: result.error ?? 'spawn failed',
        logFile: result.logFile,
        command: result.command,
        runtime: 'openai-api',
      }
    }

    appendLog(opts.logFile, `[spawn-ok] child_pid=${result.pid}`)
    const spawnStartedAt = Date.now()
    // pieces8/memory-attempted: the child's real exit code, captured by
    // spawnDetached's `'exit'` listener. Read below, after the poll fires.
    const childExit = result.exit
    watchChildExit(result.pid, opts.logFile, () => {
      // tmpDir holds the prompt + runner; only safe to drop once the child
      // that reads them is gone.
      try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
      // run-agent-locally piece: close the ledger row with REAL numbers —
      // before this, openai-api spawns were the one runtime whose token_ledger
      // row never closed with token counts/cost at all (only claude-code.ts
      // called finalizeRun). The trace lines RUNNER_SCRIPT wrote to this same
      // log file are the only record of what the endpoint actually reported;
      // parseOpenAiTrace() reads them back now that the process has exited.
      const parsed = parseOpenAiTrace(opts.logFile, model)
      finalizeRun({
        logFile: opts.logFile,
        // Record what the trace actually reported — 'max_iterations',
        // 'running' (process died without a run_end line) and 'unknown' (no
        // trace lines at all) are all real, distinct outcomes, not synonyms
        // for 'completed'. Collapsing them used to make every non-crashed
        // run read as a success even when the agent never finished the task.
        status: parsed.status,
        durationSec: Math.round((Date.now() - spawnStartedAt) / 1000),
        taskId: opts.taskId ?? null,
        inputTokens: parsed.totals.tokensIn || undefined,
        outputTokens: parsed.totals.tokensOut || undefined,
        costUsd: parsed.totals.costUsd || undefined,
        // evidence-based-verification (round 2): the correlation record —
        // written on this same ledger row, never inferred by a verifier from
        // co-occurrence. Absent (undefined) when the run never completed a
        // model call at all, e.g. it failed before the first fetch.
        providerResponseId: parsed.upstream?.providerResponseId ?? undefined,
        providerModel: parsed.upstream?.providerModel ?? undefined,
        upstreamStartedAt: parsed.upstream?.upstreamStartedAt ?? undefined,
        upstreamFinishedAt: parsed.upstream?.upstreamFinishedAt ?? undefined,
      })
      // memory-loop-write (round 2): one agent_run_records row per run.
      //
      // pieces8/memory-attempted: this runtime has the RICHEST observable
      // exit record in the codebase and none of it used to reach memory.
      // `parsed` above — the very same object the ledger call just used —
      // carries the run's own `run_end` status ('completed' / 'failed' /
      // 'max_iterations'), its iteration count, and every `tool_call` step
      // it actually made, because RUNNER_SCRIPT writes them as `[trace]`
      // lines. A list of the tools a run invoked IS "what it tried", as a
      // fact rather than an inference, so it is recorded. `run_end` also
      // makes the max_iterations case honest: that run exits 0 while plainly
      // not having finished, and summarizeExit() ranks the run's own status
      // above the exit code precisely so it is never filed as a success.
      const toolsUsed = parsed.steps
        .filter(step => step.type === 'tool_call' && typeof step.tool === 'string')
        .map(step => String(step.tool))
      const finalReportStep = [...parsed.steps].reverse().find(step => step.type === 'run_end')
      const evidence = summarizeExit({
        runtime: 'openai-api',
        exitCode: childExit?.observed ? childExit.code : null,
        signal: childExit?.observed ? childExit.signal : null,
        durationSec: Math.round((Date.now() - spawnStartedAt) / 1000),
        reportedStatus: parsed.status,
        turns: typeof finalReportStep?.iterations === 'number' ? finalReportStep.iterations : null,
        tokensIn: parsed.totals.tokensIn || null,
        tokensOut: parsed.totals.tokensOut || null,
        toolsUsed,
        // The runner's own fatal-error text, when it wrote one. Not a
        // summary of the run — the literal `error` field off the `run_end`
        // trace line, which only exists on the failure path.
        finalReport: typeof finalReportStep?.error === 'string' ? `run_end error: ${finalReportStep.error}` : null,
        logFile: opts.logFile,
      })
      void recordRunOnExit({
        agentId: opts.agentId,
        taskId: opts.taskId ?? null,
        attempted: evidence.attempted,
        succeeded: evidence.succeeded,
        failed: evidence.failed,
        exitStatus: evidence.exitStatus,
      })
    }, { maxMinutes: 90 })

    return {
      ok: true,
      pid: result.pid,
      logFile: result.logFile,
      command: `node ${runnerFile} [provider=${provider.baseUrl} model=${model}]`,
      runtime: 'openai-api',
    }
  },
}

export default openaiApiRuntime

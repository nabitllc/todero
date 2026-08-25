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
// - Model map: sonnet→gpt-4o, opus→o3, haiku→gpt-4o-mini

import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AgentRuntime, AgentSpawnOptions, AgentSpawnResult } from './types'
import { appendLog, spawnDetached, watchChildExit } from './detached-spawn'

// ---------------------------------------------------------------------------
// Provider resolution - OpenAI-compatible, not OpenAI-only
// ---------------------------------------------------------------------------
//
// The endpoint used to be the literal hostname `api.openai.com`, so pointing
// Todero at Ollama / LM Studio / OpenRouter / Azure required editing this file.
// Any server speaking the OpenAI chat-completions shape now works by setting
// LLM_BASE_URL (e.g. http://localhost:11434/v1 for Ollama).

export interface ProviderConfig {
  /** Base URL including the version segment, e.g. https://api.openai.com/v1 */
  baseUrl: string
  /** Bearer token. Local servers ignore it, so it may be a placeholder. */
  apiKey: string
  /** True when the endpoint is on this machine and needs no credential. */
  isLocal: boolean
}

export function resolveProvider(): ProviderConfig {
  const baseUrl = (
    process.env.LLM_BASE_URL ??
    process.env.OPENAI_BASE_URL ??
    'https://api.openai.com/v1'
  ).replace(/[/]+$/, '')

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
// Model mapping
// ---------------------------------------------------------------------------

function mapModel(alias: 'opus' | 'sonnet' | 'haiku' | undefined): string {
  switch (alias) {
    case 'opus':  return 'o3'
    case 'haiku': return 'gpt-4o-mini'
    case 'sonnet':
    default:      return 'gpt-4o'
  }
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
const RUNNER_SCRIPT = [
  "'use strict'",
  'const http = require("http")',
  'const https = require("https")',
  'const fs = require("fs")',
  'const cp = require("child_process")',
  'const API_KEY = process.env.LLM_API_KEY || process.env.OPENAI_API_KEY || ""',
  'const BASE_URL = (process.env.LLM_BASE_URL || "https://api.openai.com/v1").replace(/[/]+$/, "")',
  'const MODEL = process.env.OPENAI_MODEL || "gpt-4o"',
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
  'async function main() {',
  '  fs.appendFileSync(LOG_F, "[openai-api] provider=" + BASE_URL + " model=" + MODEL + " prompt_bytes=" + prompt.length + "\\n")',
  '  const messages = [{ role: "user", content: prompt }]',
  '  for (let iter = 1; iter <= MAX_ITER; iter++) {',
  '    const resp = await callApi({ model: MODEL, messages: messages, tools: TOOLS, tool_choice: "auto" })',
  '    if (resp.error) { fs.appendFileSync(LOG_F, "[openai-api] API error: " + JSON.stringify(resp.error) + "\\n"); process.exit(1) }',
  '    const choice = resp.choices && resp.choices[0]',
  '    if (!choice) { fs.appendFileSync(LOG_F, "[openai-api] No choices\\n"); process.exit(1) }',
  '    const msg = choice.message',
  '    messages.push(msg)',
  '    if (choice.finish_reason === "stop" || !msg.tool_calls || msg.tool_calls.length === 0) {',
  '      fs.appendFileSync(LOG_F, "[openai-api] Final (iter=" + iter + "):\\n" + (msg.content || "") + "\\n"); return',
  '    }',
  '    for (const tc of msg.tool_calls) {',
  '      let args = {}; try { args = JSON.parse(tc.function.arguments) } catch {}',
  '      const result = executeTool(tc.function.name, args)',
  '      fs.appendFileSync(LOG_F, "[openai-api] tool_call " + tc.function.name + "\\n")',
  '      messages.push({ role: "tool", tool_call_id: tc.id, content: String(result) })',
  '    }',
  '  }',
  '  fs.appendFileSync(LOG_F, "[openai-api] Max iterations reached\\n")',
  '}',
  'main().catch(function(e) { fs.appendFileSync(LOG_F, "[openai-api] Fatal: " + e.message + "\\n"); process.exit(1) })',
].join('\n')

// ---------------------------------------------------------------------------
// Runtime adapter
// ---------------------------------------------------------------------------

export const openaiApiRuntime: AgentRuntime = {
  name: 'openai-api',
  displayName: 'OpenAI API',
  supportsSessions: false,
  supportsTools: true,

  async isAvailable(): Promise<boolean> {
    // A local OpenAI-compatible server (Ollama, LM Studio) needs no credential;
    // a hosted one does. Either way this runtime has no binary dependency.
    const { apiKey, isLocal } = resolveProvider()
    return isLocal || apiKey.length > 0
  },

  async spawn(opts: AgentSpawnOptions): Promise<AgentSpawnResult> {
    const provider = resolveProvider()
    if (!provider.apiKey && !provider.isLocal) {
      return {
        ok: false,
        error: `no API key for ${provider.baseUrl} - set LLM_API_KEY (or OPENAI_API_KEY), or point LLM_BASE_URL at a local server`,
        runtime: 'openai-api',
      }
    }

    // LLM_MODEL wins when set: a local server has its own model names
    // (qwen2.5-coder:7b), which the opus/sonnet/haiku aliases cannot express.
    const model = process.env.LLM_MODEL ?? mapModel(opts.model)

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
    watchChildExit(result.pid, opts.logFile, () => {
      // tmpDir holds the prompt + runner; only safe to drop once the child
      // that reads them is gone.
      try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
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

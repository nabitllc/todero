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

import { spawn } from 'child_process'
import { writeFileSync, appendFileSync, mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AgentRuntime, AgentSpawnOptions, AgentSpawnResult } from './types'

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
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const https = require('https') as typeof import('https')
    const data = JSON.stringify(body)
    const req = https.request(
      {
        hostname: 'api.openai.com',
        path: '/v1/chat/completions',
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
          catch { reject(new Error(`Failed to parse OpenAI response: ${raw.slice(0, 200)}`)) }
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
  'const https = require("https")',
  'const fs = require("fs")',
  'const cp = require("child_process")',
  'const API_KEY = process.env.OPENAI_API_KEY',
  'const MODEL = process.env.OPENAI_MODEL || "gpt-4o"',
  'const PROMPT_F = process.env.PROMPT_FILE',
  'const LOG_F = process.env.LOG_FILE',
  'const MAX_ITER = parseInt(process.env.MAX_ITER || "20", 10)',
  'if (!API_KEY) { process.stderr.write("[openai-api] OPENAI_API_KEY not set\\n"); process.exit(1) }',
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
  '    const req = https.request({ hostname: "api.openai.com", path: "/v1/chat/completions", method: "POST",',
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
    const key = process.env.OPENAI_API_KEY
    return typeof key === 'string' && key.length > 0
  },

  async spawn(opts: AgentSpawnOptions): Promise<AgentSpawnResult> {
    const apiKey = process.env.OPENAI_API_KEY
    if (!apiKey) {
      return { ok: false, error: 'OPENAI_API_KEY not set', runtime: 'openai-api' }
    }

    const model = mapModel(opts.model)

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
        `[spawn-start] ${new Date().toISOString()} agentId=${opts.agentId} model=${model}\n` +
        `[spawn-start] prompt bytes: ${opts.prompt.length}\n` +
        `[spawn-start] ---\n`
      )
    } catch (err) {
      console.warn(`[openai-api] failed to write spawn marker: ${err instanceof Error ? err.message : String(err)}`)
    }

    const logFileEsc = JSON.stringify(opts.logFile)
    const runnerFileEsc = JSON.stringify(runnerFile)
    const workingDirEsc = JSON.stringify(opts.workingDir)
    const script =
      `set -e\ncd ${workingDirEsc}\n` +
      `nohup node ${runnerFileEsc} >> ${logFileEsc} 2>&1 </dev/null &\n` +
      `CHILD=$!\ndisown $CHILD || true\n` +
      `echo "[spawn-ok] child_pid=$CHILD" >> ${logFileEsc}\n`

    try {
      const child = spawn('/bin/bash', ['-c', script], {
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          OPENAI_API_KEY: apiKey,
          OPENAI_MODEL: model,
          PROMPT_FILE: promptFile,
          LOG_FILE: opts.logFile,
        },
      })
      child.unref()

      return {
        ok: true,
        command: `nohup node ${runnerFile} [model=${model}]`,
        runtime: 'openai-api',
      }
    } catch (err: unknown) {
      try {
        appendFileSync(
          opts.logFile,
          `\n[spawn-failure] ${new Date().toISOString()} ${err instanceof Error ? err.message : String(err)}\n`
        )
      } catch { /* ignore */ }
      try { rmSync(tmpDir, { recursive: true, force: true }) } catch { /* ignore */ }
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        runtime: 'openai-api',
      }
    }
  },
}

export default openaiApiRuntime

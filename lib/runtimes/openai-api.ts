// TOD-1045: OpenAI API runtime adapter — direct API + tool-use loop.
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
//
// spawn() is currently a stub (returns ok:false) — the actual tool-use loop
// will be implemented in a follow-on task.

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
    // TOD-1045: spawn() is a stub — the full tool-use loop is a follow-on task.
    // Returning ok:false causes the registry to fall back to the next runtime.
    void opts // suppress unused-variable warning
    return {
      ok: false,
      error: 'openai-api spawn() not yet implemented — follow-on task pending',
      runtime: 'openai-api',
    }
  },
}

export default openaiApiRuntime

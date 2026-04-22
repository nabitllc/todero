// TOD-793: Codex CLI adapter — OpenAI's terminal coding agent.
//
// Codex CLI is OpenAI's answer to Claude Code. It has a similar invocation
// surface (read a prompt, run tools, edit files) but different flags.
//
// Key differences from claude-code:
// - Binary name: `codex` (from the `@openai/codex` npm package or OpenAI installer)
// - Single-shot mode: `codex exec "<prompt>"` or `codex -q "<prompt>"` (quiet)
// - Permission mode: `--full-auto` (Codex's equivalent of bypassPermissions)
// - Model selection: `--model o4-mini` / `--model gpt-5` / etc.
//
// Todero prompts are runtime-neutral (SOUL/AGENTS/skills + task + gates), so
// this adapter just needs to shell out with the right flags. No prompt rewriting.

import { exec } from 'child_process'
import { existsSync } from 'fs'
import type { AgentRuntime, AgentSpawnOptions, AgentSpawnResult } from './types'
import { prepareWorktree, teardownWorktree } from './worktree'

// Codex's default install location via npm -g or the official installer
const CODEX_BIN = process.env.CODEX_BIN ?? '/opt/homebrew/bin/codex'

// Codex has no exact sonnet/opus/haiku alias. Map to OpenAI models:
// - sonnet → o4-mini (fast, balanced)
// - opus   → gpt-5 (max capability)
// - haiku  → gpt-5-nano (cheapest)
function mapModel(alias: 'opus' | 'sonnet' | 'haiku' | undefined): string {
  switch (alias) {
    case 'opus':  return 'gpt-5'
    case 'haiku': return 'gpt-5-nano'
    case 'sonnet':
    default:      return 'o4-mini'
  }
}

const WORKTREE_TEARDOWN_MINUTES = 60

export const codexRuntime: AgentRuntime = {
  name: 'codex',
  displayName: 'OpenAI Codex CLI',
  supportsSessions: false,  // codex exec is single-shot; a future persistent variant would use `codex` interactive
  supportsTools: true,      // Codex exposes file/shell tools in --full-auto mode

  async isAvailable() {
    try {
      return existsSync(CODEX_BIN)
    } catch {
      return false
    }
  },

  async spawn(opts: AgentSpawnOptions): Promise<AgentSpawnResult> {
    // Same worktree isolation story as claude-code — agents never touch the
    // shared ~/todero checkout's branch state.
    const wtResult = prepareWorktree({
      agentId: opts.agentId,
      taskKey: extractTaskKeyFromBranch(opts.branch),
      branch: opts.branch,
    })

    let effectiveWorkingDir = opts.workingDir
    let teardownPath: string | null = null
    if (wtResult.ok && wtResult.worktreePath) {
      effectiveWorkingDir = wtResult.worktreePath
      teardownPath = wtResult.worktreePath
    } else {
      console.warn(
        `[codex] worktree setup failed for ${opts.agentId} — falling back to shared dir. ${wtResult.error}`
      )
    }

    const escapedPrompt = opts.prompt.replace(/'/g, "'\\''")
    const model = mapModel(opts.model)
    const permissionFlag = opts.bypassPermissions !== false ? '--full-auto' : ''

    // codex exec: single-shot mode. Read/write tools available under --full-auto.
    // The prompt is passed as a positional argument.
    const cmd = `cd ${effectiveWorkingDir} && `
      + `nohup ${CODEX_BIN} exec ${permissionFlag} --model ${model} '${escapedPrompt}' `
      + `> ${opts.logFile} 2>&1 < /dev/null & disown`

    try {
      exec(cmd, { timeout: 5000 })

      if (teardownPath) {
        setTimeout(() => {
          const tr = teardownWorktree(teardownPath!)
          if (!tr.ok) console.warn(`[codex] worktree teardown failed: ${tr.error}`)
        }, WORKTREE_TEARDOWN_MINUTES * 60 * 1000).unref()
      }

      return {
        ok: true,
        command: cmd.slice(0, 200) + '…',
        runtime: 'codex',
      }
    } catch (err: unknown) {
      if (teardownPath) teardownWorktree(teardownPath)
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        runtime: 'codex',
      }
    }
  },
}

function extractTaskKeyFromBranch(branch: string | null | undefined): string | null {
  if (!branch) return null
  const match = branch.match(/(?:feat\/|infra\/)?(tod|mc|inf|ves|kem|task)-(\d+)/i)
  if (!match) return null
  return `${match[1].toUpperCase()}-${match[2]}`
}

export default codexRuntime

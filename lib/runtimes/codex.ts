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

import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AgentRuntime, AgentSpawnOptions, AgentSpawnResult } from './types'
import { prepareWorktree, teardownWorktree } from './worktree'
import { appendLog, spawnDetached, watchChildExit } from './detached-spawn'
import { resolveBinary } from '../paths'

// Bare name: resolved through PATH at spawn time, so an npm -g install, a
// Homebrew install and a Windows shim all work. CODEX_BIN overrides.
export const CODEX_BIN = process.env.CODEX_BIN ?? 'codex'

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
      return resolveBinary(CODEX_BIN) !== null
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

    const model = mapModel(opts.model)

    // The prompt goes to the child on stdin instead of being single-quote
    // escaped into a shell string. `codex exec` with no positional prompt reads
    // stdin, and Windows' ~32k command-line cap makes argv unusable for a
    // Todero-sized prompt anyway.
    let promptFile: string
    try {
      const tmp = mkdtempSync(join(tmpdir(), `todero-codex-${opts.agentId}-`))
      promptFile = join(tmp, 'prompt.txt')
      writeFileSync(promptFile, opts.prompt, { encoding: 'utf8' })
    } catch (err) {
      if (teardownPath) teardownWorktree(teardownPath)
      return {
        ok: false,
        error: `failed to write prompt file: ${err instanceof Error ? err.message : String(err)}`,
        runtime: 'codex',
      }
    }

    const argv = ['exec']
    if (opts.bypassPermissions !== false) argv.push('--full-auto')
    argv.push('--model', model)

    const result = await spawnDetached(CODEX_BIN, argv, opts.logFile, {
      cwd: effectiveWorkingDir,
      env: process.env,
      stdinFile: promptFile,
    })

    if (!result.ok) {
      if (teardownPath) teardownWorktree(teardownPath)
      return {
        ok: false,
        error: result.error ?? 'spawn failed',
        logFile: result.logFile,
        command: result.command,
        runtime: 'codex',
      }
    }

    appendLog(opts.logFile, `[spawn-ok] child_pid=${result.pid}`)
    watchChildExit(result.pid, opts.logFile, () => {
      appendLog(opts.logFile, `[spawn-exit] agent=${opts.agentId} task=${opts.taskId ?? 'none'}`)
    }, { maxMinutes: WORKTREE_TEARDOWN_MINUTES + 30 })

    if (teardownPath) {
      const captured = teardownPath
      setTimeout(() => {
        const tr = teardownWorktree(captured)
        if (!tr.ok) console.warn(`[codex] worktree teardown failed: ${tr.error}`)
      }, WORKTREE_TEARDOWN_MINUTES * 60 * 1000).unref()
    }

    return {
      ok: true,
      pid: result.pid,
      logFile: result.logFile,
      command: result.command,
      runtime: 'codex',
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

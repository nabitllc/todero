// TOD-793: Cursor CLI adapter.
//
// Cursor ships a command-line `cursor-agent` (formerly `cursor` CLI) that can
// run an AI agent in a terminal context. The invocation surface is similar to
// claude-code but with Cursor-specific flags.
//
// Key differences:
// - Binary: `cursor-agent` (installed via Cursor desktop app → Cursor → Install
//   cursor-agent command)
// - Headless mode: `cursor-agent --print "<prompt>"` (single-shot)
// - Permission mode: `--force` or `--yolo` depending on version
// - Model selection: `--model claude-3-5-sonnet` / `--model gpt-5` / etc.
//
// Cursor defers model choice to user configuration by default. We pass the
// alias through and let Cursor resolve it.

import { mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AgentRuntime, AgentSpawnOptions, AgentSpawnResult } from './types'
import { prepareWorktree, teardownWorktree } from './worktree'
import { appendLog, spawnDetached, watchChildExit } from './detached-spawn'
import { resolveBinary } from '../paths'

// Bare name: resolved through PATH at spawn time. CURSOR_BIN overrides with an
// explicit path (the Homebrew prefix it used to assume exists on one OS only).
const CURSOR_BIN = process.env.CURSOR_BIN ?? 'cursor-agent'

function mapModel(alias: 'opus' | 'sonnet' | 'haiku' | undefined): string {
  // Cursor accepts provider-qualified model strings. Map our aliases to the
  // Anthropic models Cursor knows about by default.
  switch (alias) {
    case 'opus':  return 'claude-opus-4-6'
    case 'haiku': return 'claude-haiku-4-5'
    case 'sonnet':
    default:      return 'claude-sonnet-4-6'
  }
}

const WORKTREE_TEARDOWN_MINUTES = 60

export const cursorRuntime: AgentRuntime = {
  name: 'cursor',
  displayName: 'Cursor CLI',
  supportsSessions: false,
  supportsTools: true,

  async isAvailable() {
    try {
      return resolveBinary(CURSOR_BIN) !== null
    } catch {
      return false
    }
  },

  async spawn(opts: AgentSpawnOptions): Promise<AgentSpawnResult> {
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
        `[cursor] worktree setup failed for ${opts.agentId} — falling back to shared dir. ${wtResult.error}`
      )
    }

    const model = mapModel(opts.model)

    // Prompt on stdin - `cursor-agent --print` reads it there when no positional
    // prompt is given. Removes the single-quote escaping that broke on any
    // prompt containing a quote, and the 32k argv cap on Windows.
    let promptFile: string
    try {
      const tmp = mkdtempSync(join(tmpdir(), `todero-cursor-${opts.agentId}-`))
      promptFile = join(tmp, 'prompt.txt')
      writeFileSync(promptFile, opts.prompt, { encoding: 'utf8' })
    } catch (err) {
      if (teardownPath) teardownWorktree(teardownPath)
      return {
        ok: false,
        error: `failed to write prompt file: ${err instanceof Error ? err.message : String(err)}`,
        runtime: 'cursor',
      }
    }

    const argv: string[] = []
    if (opts.bypassPermissions !== false) argv.push('--force')
    argv.push('--model', model, '--print')

    const result = spawnDetached(CURSOR_BIN, argv, opts.logFile, {
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
        runtime: 'cursor',
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
        if (!tr.ok) console.warn(`[cursor] worktree teardown failed: ${tr.error}`)
      }, WORKTREE_TEARDOWN_MINUTES * 60 * 1000).unref()
    }

    return {
      ok: true,
      pid: result.pid,
      logFile: result.logFile,
      command: result.command,
      runtime: 'cursor',
    }
  },
}

function extractTaskKeyFromBranch(branch: string | null | undefined): string | null {
  if (!branch) return null
  const match = branch.match(/(?:feat\/|infra\/)?(tod|mc|inf|ves|kem|task)-(\d+)/i)
  if (!match) return null
  return `${match[1].toUpperCase()}-${match[2]}`
}

export default cursorRuntime

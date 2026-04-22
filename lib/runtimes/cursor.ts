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

import { exec } from 'child_process'
import { existsSync } from 'fs'
import type { AgentRuntime, AgentSpawnOptions, AgentSpawnResult } from './types'
import { prepareWorktree, teardownWorktree } from './worktree'

const CURSOR_BIN = process.env.CURSOR_BIN ?? '/opt/homebrew/bin/cursor-agent'

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
      return existsSync(CURSOR_BIN)
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

    const escapedPrompt = opts.prompt.replace(/'/g, "'\\''")
    const model = mapModel(opts.model)
    const permissionFlag = opts.bypassPermissions !== false ? '--force' : ''

    const cmd = `cd ${effectiveWorkingDir} && `
      + `nohup ${CURSOR_BIN} ${permissionFlag} --model ${model} --print '${escapedPrompt}' `
      + `> ${opts.logFile} 2>&1 < /dev/null & disown`

    try {
      exec(cmd, { timeout: 5000 })

      if (teardownPath) {
        setTimeout(() => {
          const tr = teardownWorktree(teardownPath!)
          if (!tr.ok) console.warn(`[cursor] worktree teardown failed: ${tr.error}`)
        }, WORKTREE_TEARDOWN_MINUTES * 60 * 1000).unref()
      }

      return {
        ok: true,
        command: cmd.slice(0, 200) + '…',
        runtime: 'cursor',
      }
    } catch (err: unknown) {
      if (teardownPath) teardownWorktree(teardownPath)
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        runtime: 'cursor',
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

export default cursorRuntime

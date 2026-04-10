// TOD-793: Claude Code CLI adapter — first implementation of AgentRuntime.
// This is a refactor of the original inline spawn logic from /api/run-agent/route.ts.
// All Claude-specific knowledge (binary path, --print flag, --permission-mode, model
// flag syntax) lives here, not in the route.

import { exec } from 'child_process'
import { existsSync } from 'fs'
import type { AgentRuntime, AgentSpawnOptions, AgentSpawnResult } from './types'

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? '/Users/kemuniagent/.local/bin/claude'

export const claudeCodeRuntime: AgentRuntime = {
  name: 'claude-code',
  displayName: 'Claude Code CLI',
  supportsSessions: false, // --print mode is single-shot; TOD-794 will add session mode
  supportsTools: true,     // Claude Code exposes Read/Write/Bash/etc via bypassPermissions

  async isAvailable() {
    try {
      return existsSync(CLAUDE_BIN)
    } catch {
      return false
    }
  },

  async spawn(opts: AgentSpawnOptions): Promise<AgentSpawnResult> {
    // Shell-escape the prompt for single-quote wrapping
    const escapedPrompt = opts.prompt.replace(/'/g, "'\\''")

    // Map model alias to Claude CLI --model flag
    const modelFlag = opts.model ? `--model ${opts.model}` : ''

    // Permission mode: bypassPermissions is Claude Code's "do anything" mode
    const permissionFlag = opts.bypassPermissions !== false
      ? '--permission-mode bypassPermissions'
      : ''

    // Always check out main before spawning to prevent feature-branch drift.
    // The spawned agent will create its own feature branch via branchInstruction
    // in the prompt if needed.
    // nohup + disown = detached background process on macOS (no setsid)
    // 2>&1 < /dev/null = no stdin, merge stderr into log
    const cmd = `cd ${opts.workingDir} && git checkout main 2>/dev/null; `
      + `nohup ${CLAUDE_BIN} ${permissionFlag} ${modelFlag} --print '${escapedPrompt}' `
      + `> ${opts.logFile} 2>&1 < /dev/null & disown`

    try {
      // exec() doesn't accept detached/stdio — those are spawn() options. We're using
      // exec because the shell chain (&&, ;, nohup … & disown) needs a shell. The
      // nohup/disown handles detachment at the shell level.
      exec(cmd, { timeout: 5000 })
      return {
        ok: true,
        command: cmd.slice(0, 200) + '…',
        runtime: 'claude-code',
      }
    } catch (err: unknown) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        runtime: 'claude-code',
      }
    }
  },
}

export default claudeCodeRuntime

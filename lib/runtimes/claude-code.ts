// TOD-793: Claude Code CLI adapter — first implementation of AgentRuntime.
// TOD-806 (2026-04-10): Now spawns into an isolated git worktree so parallel
// agents don't collide on branch state. The interactive session in ~/todero
// is never affected by agent branch operations.

import { exec } from 'child_process'
import { existsSync } from 'fs'
import type { AgentRuntime, AgentSpawnOptions, AgentSpawnResult } from './types'
import { prepareWorktree, teardownWorktree } from './worktree'

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? '/Users/kemuniagent/.local/bin/claude'

// Worktree teardown is scheduled after this many minutes. Enough time for a
// typical task (build + commit + PATCH) plus a buffer. If the agent is still
// running after this, the worktree is orphaned for the janitor to clean up.
const WORKTREE_TEARDOWN_MINUTES = 60

export const claudeCodeRuntime: AgentRuntime = {
  name: 'claude-code',
  displayName: 'Claude Code CLI',
  supportsSessions: false,
  supportsTools: true,

  async isAvailable() {
    try {
      return existsSync(CLAUDE_BIN)
    } catch {
      return false
    }
  },

  async spawn(opts: AgentSpawnOptions): Promise<AgentSpawnResult> {
    // ── TOD-806: Prepare an isolated git worktree ─────────────────────────
    // This is the fix for branch drift. Previously every spawn ran
    // `git checkout -b feat/tod-X` inside the shared ~/todero dir, which
    // switched the interactive Claude Code session out from under us.
    //
    // Now each spawn gets its own worktree at ~/agent-worktrees/<agent>-<task>-<ts>
    // with node_modules symlinked from the main repo. The agent runs there.
    // The interactive ~/todero is never touched.
    const wtResult = prepareWorktree({
      agentId: opts.agentId,
      taskKey: extractTaskKeyFromBranch(opts.branch),
      branch: opts.branch,
    })

    // If worktree setup failed, fall back to the old behavior rather than blocking
    // the spawn entirely. Log the failure prominently so it gets noticed.
    let effectiveWorkingDir = opts.workingDir
    let teardownPath: string | null = null
    if (wtResult.ok && wtResult.worktreePath) {
      effectiveWorkingDir = wtResult.worktreePath
      teardownPath = wtResult.worktreePath
    } else {
      console.warn(
        `[claude-code] worktree setup failed for ${opts.agentId} — falling back to shared dir. ` +
        `This will cause branch drift on the interactive session. Error: ${wtResult.error}`
      )
    }

    // Shell-escape the prompt for single-quote wrapping
    const escapedPrompt = opts.prompt.replace(/'/g, "'\\''")

    // Map model alias to Claude CLI --model flag
    const modelFlag = opts.model ? `--model ${opts.model}` : ''

    // Permission mode: bypassPermissions is Claude Code's "do anything" mode
    const permissionFlag = opts.bypassPermissions !== false
      ? '--permission-mode bypassPermissions'
      : ''

    // The worktree is already on the correct branch (prepareWorktree did `git worktree add -b`).
    // No need to `git checkout` again.
    // nohup + disown = detached background process on macOS (no setsid)
    // 2>&1 < /dev/null = no stdin, merge stderr into log
    const cmd = `cd ${effectiveWorkingDir} && `
      + `nohup ${CLAUDE_BIN} ${permissionFlag} ${modelFlag} --print '${escapedPrompt}' `
      + `> ${opts.logFile} 2>&1 < /dev/null & disown`

    try {
      exec(cmd, { timeout: 5000 })

      // Schedule worktree teardown after the timeout.
      // If the agent finishes faster, the teardown will just be a no-op.
      // If the agent is still running, the forced removal will kill its
      // changes — which is the correct behavior for a runaway spawn.
      if (teardownPath) {
        const teardownMs = WORKTREE_TEARDOWN_MINUTES * 60 * 1000
        setTimeout(() => {
          const tr = teardownWorktree(teardownPath!)
          if (!tr.ok) {
            console.warn(`[claude-code] worktree teardown failed for ${teardownPath}: ${tr.error}`)
          }
        }, teardownMs).unref()  // unref so the process doesn't wait on this timer
      }

      return {
        ok: true,
        command: cmd.slice(0, 200) + '…',
        runtime: 'claude-code',
      }
    } catch (err: unknown) {
      // If spawn failed, tear down the worktree immediately so we don't leak disk
      if (teardownPath) {
        teardownWorktree(teardownPath)
      }
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        runtime: 'claude-code',
      }
    }
  },
}

/**
 * Extract a task key (e.g. "TOD-806") from a branch name like "feat/tod-806"
 * so the worktree dir name reflects the task instead of falling back to "notask".
 */
function extractTaskKeyFromBranch(branch: string | null | undefined): string | null {
  if (!branch) return null
  const match = branch.match(/(?:feat\/)?(tod|mc|inf|ves|kem|task)-(\d+)/i)
  if (!match) return null
  return `${match[1].toUpperCase()}-${match[2]}`
}

export default claudeCodeRuntime

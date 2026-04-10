// TOD-793: Claude Code CLI adapter.
// TOD-806 (2026-04-10): worktree isolation.
// TOD-XXX (2026-04-10 round 7): fix silent death pattern.
//   - Switched from `exec(cmd)` with a quoted prompt → `spawn(bin, [...args])`
//     so shell escaping can't break the spawn. Prompts with parens, quotes,
//     backticks, @symbols, etc. no longer need to be escaped at all.
//   - Capture exit code and write it to the log when the child dies.
//   - Pipe stdout/stderr through to the log file immediately (no buffering),
//     so we can see "alive but working" vs "dead at spawn".
//   - Emit a "SPAWN OK" sentinel line at the very top so we can distinguish
//     "never ran" from "ran but produced nothing".

import { spawn } from 'child_process'
import { existsSync, openSync, closeSync, writeSync, appendFileSync } from 'fs'
import type { AgentRuntime, AgentSpawnOptions, AgentSpawnResult } from './types'
import { prepareWorktree, teardownWorktree } from './worktree'

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? '/Users/kemuniagent/.local/bin/claude'

// Worktree teardown timer — 60 min should cover any reasonable task.
// If the agent is still running at that point the worktree will be force-removed.
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
    // TOD-806: Prepare an isolated git worktree.
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
        `[claude-code] worktree setup failed for ${opts.agentId} — falling back to shared dir. ${wtResult.error}`
      )
    }

    // Map model alias to Claude CLI flag
    const args: string[] = []
    if (opts.bypassPermissions !== false) {
      args.push('--permission-mode', 'bypassPermissions')
    }
    if (opts.model) {
      args.push('--model', opts.model)
    }
    args.push('--print', opts.prompt)
    // Note: we intentionally do NOT use --output-format=stream-json here because
    // it changes the output contract for downstream parsers (token-ledger wrapper,
    // etc.). The regular --print output is human-readable and we pipe it to a log
    // so the buffering-hides-death problem is solved at the pipe level, not the
    // format level.

    // Write a "SPAWN OK" marker to the log BEFORE we spawn, so the log file exists
    // and we can distinguish "never wrote the marker" from "wrote the marker then died".
    try {
      const fd = openSync(opts.logFile, 'w')
      writeSync(fd, `[spawn-start] ${new Date().toISOString()} agentId=${opts.agentId} model=${opts.model ?? 'default'} workingDir=${effectiveWorkingDir}\n`)
      writeSync(fd, `[spawn-start] prompt bytes: ${opts.prompt.length}\n`)
      writeSync(fd, `[spawn-start] ---\n`)
      closeSync(fd)
    } catch (err) {
      console.warn(`[claude-code] failed to write spawn marker to ${opts.logFile}: ${err instanceof Error ? err.message : String(err)}`)
    }

    try {
      // spawn() takes args as an array — ZERO shell escaping concerns.
      // stdio: ['ignore', <logFd>, <logFd>] redirects stdout+stderr to the log file.
      const outFd = openSync(opts.logFile, 'a')
      const child = spawn(CLAUDE_BIN, args, {
        cwd: effectiveWorkingDir,
        detached: true,
        stdio: ['ignore', outFd, outFd],
        env: process.env,
      })

      // Capture exit code when the child dies. This is the KEY fix for silent
      // deaths: we always get a terminal log line telling us WHY the process
      // ended, even if claude itself wrote nothing.
      const childPid = child.pid
      child.on('exit', (code, signal) => {
        try {
          appendFileSync(
            opts.logFile,
            `\n[spawn-exit] ${new Date().toISOString()} pid=${childPid} code=${code ?? 'null'} signal=${signal ?? 'null'}\n`
          )
        } catch {
          // swallow — logging a logging error is pointless
        }
        try { closeSync(outFd) } catch {}
      })
      child.on('error', (err) => {
        try {
          appendFileSync(
            opts.logFile,
            `\n[spawn-error] ${new Date().toISOString()} ${err.message}\n`
          )
        } catch {}
      })

      // Detach so the HTTP handler can return immediately
      child.unref()

      // Schedule worktree teardown after the timeout window
      if (teardownPath) {
        const teardownMs = WORKTREE_TEARDOWN_MINUTES * 60 * 1000
        setTimeout(() => {
          const tr = teardownWorktree(teardownPath!)
          if (!tr.ok) {
            console.warn(`[claude-code] worktree teardown failed for ${teardownPath}: ${tr.error}`)
          }
        }, teardownMs).unref()
      }

      return {
        ok: true,
        pid: childPid,
        command: `${CLAUDE_BIN} ${args.slice(0, -1).join(' ')} --print <${opts.prompt.length}B>`,
        runtime: 'claude-code',
      }
    } catch (err: unknown) {
      // Spawn itself failed — tear down the worktree and log the error
      try {
        appendFileSync(
          opts.logFile,
          `\n[spawn-failure] ${new Date().toISOString()} ${err instanceof Error ? err.message : String(err)}\n`
        )
      } catch {}
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

function extractTaskKeyFromBranch(branch: string | null | undefined): string | null {
  if (!branch) return null
  const match = branch.match(/(?:feat\/)?(tod|mc|inf|ves|kem|task)-(\d+)/i)
  if (!match) return null
  return `${match[1].toUpperCase()}-${match[2]}`
}

export default claudeCodeRuntime

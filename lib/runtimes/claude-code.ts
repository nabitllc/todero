// TOD-793: Claude Code CLI adapter.
// TOD-806 (2026-04-10): git worktree isolation.
// TOD-XXX (2026-04-10 round 9): TRUE detach from parent Next.js process.
//
// Why this file has been rewritten 3 times in 24 hours:
// - v1: exec() with shell-quoted prompt → shell escape broke on @/()/backticks
// - v2: spawn() with args array → no more escaping, but children got SIGKILLed
//   whenever Next.js restarted (parent teardown killed Node's tracked children)
// - v3 (THIS): write prompt to a temp file, spawn a bash wrapper with
//   `nohup bash -c '…' &` so the child is in a new session AND ignores SIGHUP.
//   Node drops the child reference entirely. Next.js restart cannot kill it.

import { spawn } from 'child_process'
import { existsSync, writeFileSync, mkdtempSync, appendFileSync, unlinkSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { AgentRuntime, AgentSpawnOptions, AgentSpawnResult } from './types'
import { prepareWorktree, teardownWorktree } from './worktree'

const CLAUDE_BIN = process.env.CLAUDE_BIN ?? '/Users/kemuniagent/.local/bin/claude'
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
    // ── Prepare isolated worktree ───────────────────────────────────
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

    // ── Write prompt to a temp file (avoids shell escaping entirely) ─
    // Using the OS temp dir so the file lives outside the project tree.
    // Cleanup happens after the worktree teardown timer fires.
    let promptFile: string | null = null
    try {
      const tmp = mkdtempSync(join(tmpdir(), `todero-spawn-${opts.agentId}-`))
      promptFile = join(tmp, 'prompt.txt')
      writeFileSync(promptFile, opts.prompt, { encoding: 'utf8' })
    } catch (err) {
      return {
        ok: false,
        error: `failed to write prompt file: ${err instanceof Error ? err.message : String(err)}`,
        runtime: 'claude-code',
      }
    }

    // ── Write spawn header BEFORE launching so even a dead spawn is visible ─
    try {
      writeFileSync(
        opts.logFile,
        `[spawn-start] ${new Date().toISOString()} agentId=${opts.agentId} model=${opts.model ?? 'default'} workingDir=${effectiveWorkingDir}\n` +
        `[spawn-start] prompt bytes: ${opts.prompt.length} (file: ${promptFile})\n` +
        `[spawn-start] ---\n`
      )
    } catch (err) {
      console.warn(`[claude-code] failed to write spawn marker to ${opts.logFile}: ${err instanceof Error ? err.message : String(err)}`)
    }

    const modelFlag = opts.model ? `--model ${opts.model}` : ''
    const permissionFlag = opts.bypassPermissions !== false ? '--permission-mode bypassPermissions' : ''

    // ── TRUE DETACH via nohup + bash wrapper ─────────────────────────
    //
    // This shell chain is the key to surviving Next.js restarts:
    //   1. `cd <worktree>`      → agent runs in its isolated git worktree
    //   2. `nohup ... &`        → child ignores SIGHUP when the parent dies
    //   3. `</dev/null`         → no stdin connection to parent
    //   4. `>$logFile 2>&1`     → stdout+stderr go directly to the log file
    //                             (the file descriptor is owned by the CHILD,
    //                             not passed from the parent, so when Node
    //                             closes its fds the child's fd is unaffected)
    //   5. `disown`             → shell forgets the child, no reaper
    //
    // The prompt is read from $promptFile via \`"$(cat $promptFile)"\` which
    // is INSIDE the bash script — bash handles the quoting correctly for any
    // characters in the prompt (including @, (, ), backticks, single quotes).
    //
    // We spawn bash with args=['-c', script]. No shell-escape issues because
    // Node's spawn() passes args directly to execve — NOT through a shell
    // a second time.
    const script = `
set -e
cd ${JSON.stringify(effectiveWorkingDir)}
nohup ${CLAUDE_BIN} ${permissionFlag} ${modelFlag} --print "$(cat ${JSON.stringify(promptFile)})" >> ${JSON.stringify(opts.logFile)} 2>&1 </dev/null &
CHILD=$!
disown $CHILD || true
echo "[spawn-ok] child_pid=$CHILD" >> ${JSON.stringify(opts.logFile)}
`

    try {
      const child = spawn('/bin/bash', ['-c', script], {
        detached: true,
        stdio: 'ignore',       // completely severed from the parent's FDs
        env: process.env,
      })
      // Critical: unref so Node's event loop doesn't wait, AND we don't
      // attach an exit handler (no child.on('exit')). Node has zero
      // reference to the spawned claude process after this point.
      child.unref()

      // Schedule worktree teardown after the timeout window
      if (teardownPath) {
        const teardownMs = WORKTREE_TEARDOWN_MINUTES * 60 * 1000
        setTimeout(() => {
          const tr = teardownWorktree(teardownPath!)
          if (!tr.ok) {
            console.warn(`[claude-code] worktree teardown failed for ${teardownPath}: ${tr.error}`)
          }
          // Clean up the prompt temp dir too
          if (promptFile) {
            try {
              const dir = promptFile.substring(0, promptFile.lastIndexOf('/'))
              rmSync(dir, { recursive: true, force: true })
            } catch {}
          }
        }, teardownMs).unref()
      }

      return {
        ok: true,
        command: `nohup claude ${permissionFlag} ${modelFlag} --print <${opts.prompt.length}B from ${promptFile}>`,
        runtime: 'claude-code',
      }
    } catch (err: unknown) {
      try {
        appendFileSync(
          opts.logFile,
          `\n[spawn-failure] ${new Date().toISOString()} ${err instanceof Error ? err.message : String(err)}\n`
        )
      } catch {}
      if (promptFile) {
        try { unlinkSync(promptFile) } catch {}
      }
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

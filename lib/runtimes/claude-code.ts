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
    // ── Prepare isolated worktree (code-producing agents only) ──────
    // Only builder and ops (ingo) write code + commit. Everyone else
    // (tester, designer, po, auditor, deployer, SMEs) only PATCHes
    // issue fields via the API — they don't need a branch or worktree.
    // Creating worktrees for non-code agents produced 200+ zombie
    // branches (feat/designer-notask-*, feat/po-notask-*, etc.) and
    // wasted disk. DO NOT add agents to this list unless they `git commit`.
    const CODE_AGENTS = new Set(['builder', 'ops'])
    const isCodeAgent = CODE_AGENTS.has(opts.agentId)

    // Code agents MUST run in an isolated worktree. Running them in the
    // shared repo root causes concurrent edits to fight each other (an
    // agent on main reverted another session's in-flight changes once —
    // the session that reverted had no worktree and was operating on the
    // same files a human was editing). Non-code agents don't write files
    // so they're fine in the shared dir.
    if (isCodeAgent && !opts.branch) {
      return {
        ok: false,
        error: `code agent ${opts.agentId} requires a branch (for worktree isolation)`,
        runtime: 'claude-code',
      }
    }

    let effectiveWorkingDir = opts.workingDir
    let teardownPath: string | null = null

    if (isCodeAgent && opts.branch) {
      const wtResult = prepareWorktree({
        agentId: opts.agentId,
        taskKey: extractTaskKeyFromBranch(opts.branch),
        branch: opts.branch,
      })
      if (wtResult.ok && wtResult.worktreePath) {
        effectiveWorkingDir = wtResult.worktreePath
        teardownPath = wtResult.worktreePath
      } else {
        // Fail loud — no fallback. A code agent running in the shared
        // repo root is the bug this enforcement exists to prevent.
        return {
          ok: false,
          error: `worktree setup failed for ${opts.agentId} (refusing to fall back to shared dir): ${wtResult.error}`,
          runtime: 'claude-code',
        }
      }
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
    // The script does two things:
    //   1. Launch claude detached (nohup + & + disown) — survives Next.js restart
    //   2. Launch a SEPARATE detached bash watcher that polls the claude pid
    //      and writes [spawn-exit] when it dies. The watcher is also nohup'd
    //      so it outlives Next.js too. This restores the death visibility we
    //      lost by removing child.on('exit') without reattaching Node.
    const script = `
set -e
cd ${JSON.stringify(effectiveWorkingDir)}
nohup ${CLAUDE_BIN} ${permissionFlag} ${modelFlag} --print "$(cat ${JSON.stringify(promptFile)})" >> ${JSON.stringify(opts.logFile)} 2>&1 </dev/null &
CHILD=$!
disown $CHILD || true
echo "[spawn-ok] child_pid=$CHILD" >> ${JSON.stringify(opts.logFile)}
# Detached watcher: polls the child every 5s and logs [spawn-exit] when gone.
# Uses nohup so it outlives the Next.js parent. Max watch time: 90 min
# (agent should be done long before that; if not, teardown timer will GC).
nohup bash -c 'CHILD='"$CHILD"'; LOG='"${JSON.stringify(opts.logFile).replace(/'/g, "'\\''")}"'; TASK_ID='"${JSON.stringify(opts.taskId ?? '').replace(/'/g, "'\\''")}"'; SUPA_URL=https://twthgapiouiqhavrcnry.supabase.co; SUPA_KEY=${process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''}; for i in $(seq 1 1080); do if ! kill -0 $CHILD 2>/dev/null; then echo "[spawn-exit] $(date -u +%FT%TZ) pid=$CHILD watcher_detected=true" >> "$LOG"; if [ -n "$TASK_ID" ]; then CURRENT_STATUS=$(curl -sf "$SUPA_URL/rest/v1/issues?id=eq.$TASK_ID&select=status" -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" 2>/dev/null | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d[0]['"'"'status'"'"'] if d else '"'"'unknown'"'"')" 2>/dev/null || echo unknown); if [ "$CURRENT_STATUS" = "in_progress" ]; then curl -s -X PATCH "$SUPA_URL/rest/v1/issues?id=eq.$TASK_ID" -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" -H "Content-Type: application/json" -H "Prefer: return=minimal" -d '"'"'{"status":"open","started_at":null,"heartbeat_at":null,"worked_by":null}'"'"' 2>/dev/null; echo "[spawn-exit] reset to open (was in_progress) for $TASK_ID" >> "$LOG"; else curl -s -X PATCH "$SUPA_URL/rest/v1/issues?id=eq.$TASK_ID" -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" -H "Content-Type: application/json" -H "Prefer: return=minimal" -d '"'"'{"started_at":null,"heartbeat_at":null}'"'"' 2>/dev/null; echo "[spawn-exit] cleared started_at (status=$CURRENT_STATUS) for $TASK_ID" >> "$LOG"; fi; fi; exit 0; fi; sleep 5; done; echo "[spawn-watcher] 90-min timeout pid=$CHILD" >> "$LOG"; if ! kill -0 $CHILD 2>/dev/null; then echo "[spawn-exit] $(date -u +%FT%TZ) pid=$CHILD watcher_detected=true (timeout-exit)" >> "$LOG"; if [ -n "$TASK_ID" ]; then CURRENT_STATUS=$(curl -sf "$SUPA_URL/rest/v1/issues?id=eq.$TASK_ID&select=status" -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" 2>/dev/null | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d[0]['"'"'status'"'"'] if d else '"'"'unknown'"'"')" 2>/dev/null || echo unknown); if [ "$CURRENT_STATUS" = "in_progress" ]; then curl -s -X PATCH "$SUPA_URL/rest/v1/issues?id=eq.$TASK_ID" -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" -H "Content-Type: application/json" -H "Prefer: return=minimal" -d '"'"'{"status":"open","started_at":null,"heartbeat_at":null,"worked_by":null}'"'"' 2>/dev/null; echo "[spawn-exit] reset to open at 90min-timeout for $TASK_ID" >> "$LOG"; else curl -s -X PATCH "$SUPA_URL/rest/v1/issues?id=eq.$TASK_ID" -H "apikey: $SUPA_KEY" -H "Authorization: Bearer $SUPA_KEY" -H "Content-Type: application/json" -H "Prefer: return=minimal" -d '"'"'{"started_at":null,"heartbeat_at":null}'"'"' 2>/dev/null; echo "[spawn-exit] cleared started_at at 90min-timeout (status=$CURRENT_STATUS) for $TASK_ID" >> "$LOG"; fi; fi; else echo "[spawn-watcher] pid=$CHILD still alive at 90min for $TASK_ID — monitor-stale will handle" >> "$LOG"; fi' >/dev/null 2>&1 </dev/null &
disown || true
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
  const match = branch.match(/(?:feat\/|infra\/)?(tod|mc|inf|ves|kem|task)-(\d+)/i)
  if (!match) return null
  return `${match[1].toUpperCase()}-${match[2]}`
}

export default claudeCodeRuntime

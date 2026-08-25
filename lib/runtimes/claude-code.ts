// TOD-793: Claude Code CLI adapter.
// TOD-806 (2026-04-10): git worktree isolation.
// TOD-XXX (2026-04-10 round 9): TRUE detach from parent Next.js process.
//
// Why this file has been rewritten 4 times:
// - v1: exec() with shell-quoted prompt → shell escape broke on @/()/backticks
// - v2: spawn() with args array → no more escaping, but children got SIGKILLed
//   whenever Next.js restarted (parent teardown killed Node's tracked children)
// - v3: write prompt to a temp file, hand a POSIX shell `-c 'nohup … & disown'`.
//   Survived Next.js restarts on macOS — and was a guaranteed ENOENT anywhere
//   that shell does not exist at its assumed location, i.e. every Windows host.
// - v4 (THIS): spawnDetached() from ./detached-spawn. Node's own
//   detached+stdio+unref gives us everything nohup/disown/</dev/null did, on
//   every platform, with no shell and therefore no quoting.

import { existsSync, writeFileSync, mkdtempSync, unlinkSync, rmSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import type { AgentRuntime, AgentSpawnOptions, AgentSpawnResult } from './types'
import { prepareWorktree, teardownWorktree } from './worktree'
import { appendLog, spawnDetached, watchChildExit } from './detached-spawn'
import { resolveBinary } from '../paths'
import { finalizeRun } from './token-ledger'
import { recordRunOnExit } from '../memory-loop'

// Bare name by default: resolved through PATH at spawn time (`where`/`which`),
// so a `claude` installed by npm -g, Homebrew, or the official installer all
// work without an env var. CLAUDE_BIN still overrides with an explicit path.
export const CLAUDE_BIN = process.env.CLAUDE_BIN ?? 'claude'
const WORKTREE_TEARDOWN_MINUTES = 60

export const claudeCodeRuntime: AgentRuntime = {
  name: 'claude-code',
  displayName: 'Claude Code CLI',
  supportsSessions: false,
  supportsTools: true,

  async isAvailable() {
    try {
      return resolveBinary(CLAUDE_BIN) !== null
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

    // Flags as argv entries — never a joined string. An empty flag would become
    // an empty argv entry, which `claude` rejects, so build the array by push.
    const argv: string[] = []
    if (opts.bypassPermissions !== false) argv.push('--permission-mode', 'bypassPermissions')
    if (opts.model) argv.push('--model', opts.model)
    argv.push('--print')
    // TOD-2381 (agent-budget-stop) round 3: `--output-format json` is what
    // makes the ledger closable with real numbers. Plain `--print` writes only
    // the model's final text to the log — nothing token-shaped for
    // parseClaudeJsonOutput() below to read, which is why finalizeRun()'s one
    // real call site (the [spawn-exit] handler further down) previously could
    // never pass inputTokens/outputTokens/costUsd: there was nothing in the
    // log to compute them from. No other consumer parses this log file as a
    // human transcript today (grepped for readers before adding this — see
    // this piece's PR notes), so trading raw text for one JSON object costs
    // nothing currently reachable.
    argv.push('--output-format', 'json')

    // The prompt goes in on stdin, not argv: Windows caps a command line at
    // ~32k characters and Todero prompts routinely exceed that. `claude --print`
    // with no positional prompt reads stdin, which is also why no escaping of
    // quotes/backticks/$( is needed anywhere in this file any more.
    const spawnStartedAt = Date.now()
    const result = await spawnDetached(CLAUDE_BIN, argv, opts.logFile, {
      cwd: effectiveWorkingDir,
      env: process.env,
      stdinFile: promptFile,
    })

    if (!result.ok) {
      if (promptFile) {
        try { unlinkSync(promptFile) } catch { /* best effort */ }
      }
      if (teardownPath) teardownWorktree(teardownPath)
      return {
        ok: false,
        error: result.error ?? 'spawn failed',
        logFile: result.logFile,
        command: result.command,
        runtime: 'claude-code',
      }
    }

    appendLog(opts.logFile, `[spawn-ok] child_pid=${result.pid}`)

    // Portable replacement for the 40-line `nohup bash -c 'kill -0 …'` watcher:
    // poll the pid and log [spawn-exit] when it is gone.
    watchChildExit(result.pid, opts.logFile, () => {
      appendLog(opts.logFile, `[spawn-exit] agent=${opts.agentId} task=${opts.taskId ?? 'none'}`)
      // TOD-2381: close the token_ledger row (and any dangling agent_runs row
      // for this task) the moment the OS confirms the process is gone. This is
      // the only place in the codebase a spawned run's exit is actually
      // observed — everywhere else only knows it was launched. `status:
      // 'completed'` here means "the process exited", not "the task
      // succeeded": watchChildExit polls pid liveness, it does not see the
      // real exit code, so this is honestly the coarsest signal available
      // without a bigger rewrite of spawnDetached's child.on('exit') plumbing.
      const parsed = parseClaudeJsonOutput(opts.logFile)
      finalizeRun({
        logFile: opts.logFile,
        status: 'completed',
        durationSec: Math.round((Date.now() - spawnStartedAt) / 1000),
        taskId: opts.taskId ?? null,
        inputTokens: parsed?.inputTokens,
        outputTokens: parsed?.outputTokens,
        costUsd: parsed?.costUsd,
      })
      // memory-loop-write (round 2): the learning loop's write half had no
      // caller anywhere in the running product — this is that caller, one
      // agent_run_records row per dispatched run.
      void recordRunOnExit({ agentId: opts.agentId, taskId: opts.taskId ?? null })
    }, { maxMinutes: WORKTREE_TEARDOWN_MINUTES + 30 })

    // Schedule worktree teardown after the timeout window
    if (teardownPath) {
      const capturedTeardownPath = teardownPath
      const capturedPromptFile = promptFile
      setTimeout(() => {
        const tr = teardownWorktree(capturedTeardownPath)
        if (!tr.ok) {
          console.warn(`[claude-code] worktree teardown failed for ${capturedTeardownPath}: ${tr.error}`)
        }
        if (capturedPromptFile) {
          try { rmSync(dirname(capturedPromptFile), { recursive: true, force: true }) } catch { /* best effort */ }
        }
      }, WORKTREE_TEARDOWN_MINUTES * 60 * 1000).unref()
    }

    return {
      ok: true,
      pid: result.pid,
      logFile: result.logFile,
      command: `${result.command} <${opts.prompt.length}B prompt on stdin from ${promptFile}>`,
      runtime: 'claude-code',
    }
  },
}

/**
 * TOD-2381 (agent-budget-stop) round 3: the ledger's actual closing numbers.
 *
 * `claude --print --output-format json` writes exactly one JSON object to
 * stdout when the process finishes — this log file's tail, after the
 * `[spawn-start]` header lines this adapter writes before launching. Its
 * documented shape includes `total_cost_usd` and a `usage` object with
 * `input_tokens` / `output_tokens` (the same fields the Messages API's own
 * `usage` object uses) plus cache token counts. This is deliberately the
 * ONLY place in the codebase that parses this log file's content — reading
 * it as anything other than "did the spawn produce the completion JSON we
 * asked for" is out of scope.
 *
 * Best-effort: a process that never reached `--output-format json`'s
 * completion line (crashed, killed mid-run, an older `claude` binary that
 * does not support the flag) leaves nothing valid to parse. That degrades to
 * exactly the pre-existing behavior — finalizeRun() still closes the row with
 * status/duration, just without token/cost numbers — never a thrown error
 * that could break the exit-watcher's cleanup.
 */
function parseClaudeJsonOutput(logFile: string): { inputTokens?: number; outputTokens?: number; costUsd?: number } | null {
  let text: string
  try {
    text = readFileSync(logFile, 'utf8')
  } catch {
    return null
  }
  // The header block ends at the "---" marker this adapter itself writes
  // (see the `[spawn-start] ---` line above); everything after it is the
  // child process's own stdout+stderr. Falling back to the first `{` in the
  // whole file if that marker is somehow absent, rather than giving up.
  const markerIdx = text.indexOf('[spawn-start] ---\n')
  const tail = markerIdx >= 0 ? text.slice(markerIdx + '[spawn-start] ---\n'.length) : text
  const firstBrace = tail.indexOf('{')
  const lastBrace = tail.lastIndexOf('}')
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) return null
  try {
    const parsed = JSON.parse(tail.slice(firstBrace, lastBrace + 1)) as {
      total_cost_usd?: number
      usage?: { input_tokens?: number; output_tokens?: number }
    }
    const result: { inputTokens?: number; outputTokens?: number; costUsd?: number } = {}
    if (typeof parsed.usage?.input_tokens === 'number') result.inputTokens = parsed.usage.input_tokens
    if (typeof parsed.usage?.output_tokens === 'number') result.outputTokens = parsed.usage.output_tokens
    if (typeof parsed.total_cost_usd === 'number') result.costUsd = parsed.total_cost_usd
    return Object.keys(result).length > 0 ? result : null
  } catch {
    return null
  }
}

function extractTaskKeyFromBranch(branch: string | null | undefined): string | null {
  if (!branch) return null
  const match = branch.match(/(?:feat\/|infra\/)?(tod|mc|inf|ves|kem|task)-(\d+)/i)
  if (!match) return null
  return `${match[1].toUpperCase()}-${match[2]}`
}

export default claudeCodeRuntime

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
import { readLogTail, readSpawnFailures, summarizeExit } from './exit-evidence'
import { resolveBinary } from '../paths'
import { recordRunOnExit } from '../memory-loop'

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
    // pieces8/memory-attempted: the live exit record spawnDetached fills in
    // from the child's real `'exit'` event, plus the spawn timestamp the
    // duration is measured against.
    const childExit = result.exit
    const spawnStartedAt = Date.now()
    watchChildExit(result.pid, opts.logFile, () => {
      appendLog(opts.logFile, `[spawn-exit] agent=${opts.agentId} task=${opts.taskId ?? 'none'}`)
      // memory-loop-write (round 2): one agent_run_records row per run.
      //
      // pieces8/memory-attempted: unlike claude-code and openai-api, codex
      // writes no structured completion record into its log — there is no
      // `--output-format json` object and no `[trace]` line to read. What IS
      // observable is the child's real exit code/signal, the wall-clock
      // duration, any `[spawn-failure]` line, and the log's own verbatim
      // tail. That is what gets recorded, and `attempted` says exactly that
      // in as many words so nobody mistakes an exit-0 verdict for a verified
      // task outcome. Nothing here is inferred from what the run "probably"
      // did.
      const evidence = summarizeExit({
        runtime: 'codex',
        exitCode: childExit?.observed ? childExit.code : null,
        signal: childExit?.observed ? childExit.signal : null,
        durationSec: Math.round((Date.now() - spawnStartedAt) / 1000),
        spawnFailures: readSpawnFailures(opts.logFile),
        logTail: readLogTail(opts.logFile),
        logFile: opts.logFile,
      })
      void recordRunOnExit({
        agentId: opts.agentId,
        taskId: opts.taskId ?? null,
        attempted: evidence.attempted,
        succeeded: evidence.succeeded,
        failed: evidence.failed,
        exitStatus: evidence.exitStatus,
      })
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

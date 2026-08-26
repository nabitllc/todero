// Portable detached spawn — the one way Todero launches a long-running agent.
//
// Why this exists:
//   Every runtime adapter used to build a *shell string* (`nohup … & disown`)
//   and hand it to a POSIX shell or `exec()`. That is three separate
//   portability bugs in one line:
//     1. That shell does not exist on Windows  → spawn ENOENT, always.
//     2. `nohup` / `disown` / `</dev/null` are POSIX shell builtins/binaries.
//     3. The prompt had to be shell-escaped by hand, which broke on quotes,
//        backticks and `$(`.
//
//   Node already gives us everything the shell chain was emulating:
//     detached:true  → new process group / session, survives parent teardown
//     stdio fds      → stdout+stderr straight into the log file (the `>log 2>&1`)
//     'ignore' stdin → the `</dev/null`
//     windowsHide    → no console window flash on win32
//     .unref()       → Node's event loop forgets the child (the `disown`)
//
// SERVER ONLY: imports node builtins.

import { spawn } from 'child_process'
import type { ChildProcess } from 'child_process'
import { appendFileSync, closeSync, mkdirSync, openSync } from 'fs'
import { dirname } from 'path'
import { resolveBinary } from '../paths'

export interface DetachedSpawnOptions {
  /** Working directory for the child. Must exist. */
  cwd?: string
  /** Environment for the child. Defaults to the parent's env. */
  env?: NodeJS.ProcessEnv
  /**
   * Optional file to wire to the child's stdin. Use this instead of passing a
   * huge prompt through argv — Windows caps a command line at ~32k characters,
   * and agent prompts routinely exceed that.
   */
  stdinFile?: string
}

/**
 * A live record of the child's REAL exit, filled in by `child.on('exit')`.
 *
 * pieces8/memory-attempted: `watchChildExit()` below can only ever prove
 * "the pid is gone" — it polls `process.kill(pid, 0)` and never sees a code.
 * That limitation was repeatedly (and correctly) cited as the reason
 * `agent_run_records.exit_status` had to stay null... but the PARENT still
 * holds the `ChildProcess` handle from `spawn()`, and Node delivers a real
 * `'exit'` event on it with the true code/signal even for a detached,
 * `unref()`d child, as long as this server process is still alive. Nothing
 * was ever listening. Now something is.
 *
 * This object is MUTATED in place after `spawnDetached()` resolves: a caller
 * holds the reference and reads it later, from inside its `watchChildExit`
 * callback, by which point the event has normally already fired.
 *
 * `observed: false` is a real and expected state — a Next.js restart between
 * spawn and exit loses the listener the same way it loses the watcher — and
 * MUST be reported as "not observed", never as exit 0.
 */
export interface ChildExitObservation {
  /** True only once a genuine `'exit'` event arrived. */
  observed: boolean
  /** Real exit code, or null when the child was terminated by a signal / not yet observed. */
  code: number | null
  /** Real terminating signal, or null. */
  signal: string | null
  /** `Date.now()` at the moment the event fired, or null. */
  at: number | null
}

export interface DetachedSpawnResult {
  ok: boolean
  /** OS pid of the detached child, when the spawn got far enough to have one. */
  pid?: number
  /** Log file the child's stdout+stderr are appended to. */
  logFile: string
  /** Human-readable command, for debugging/UI. Never re-parsed. */
  command: string
  error?: string
  /**
   * Live exit record for this child — see `ChildExitObservation`. Present
   * whenever a child process was actually created (i.e. whenever there is a
   * pid), absent when the spawn never got that far.
   */
  exit?: ChildExitObservation
}

/** `[label] …` line appended to a log file; never throws. */
export function appendLog(logFile: string, line: string): void {
  try {
    appendFileSync(logFile, line.endsWith('\n') ? line : `${line}\n`)
  } catch {
    /* the log is best-effort — never let it break a spawn */
  }
}

/** How long to wait for the OS to confirm the child actually started. */
const SPAWN_CONFIRM_MS = 750

/**
 * Launch `bin argv…` fully detached, with stdout+stderr appended to `logFile`.
 *
 * No shell is involved: `argv` entries are passed to the OS verbatim, so
 * prompts containing quotes, `$(`, backticks or newlines need no escaping.
 *
 * The child is fire-and-forget, but the *launch* is not: this resolves only
 * once the OS has confirmed the process exists (`'spawn'`) or refused to
 * create it (`'error'` — ENOENT for a missing binary, EACCES for a
 * non-executable one). A binary that is not installed therefore returns
 * `ok:false` to the caller instead of a cheerful `ok:true` with no pid and an
 * ENOENT buried in a log file nobody reads. That distinction is the whole
 * point: on a fresh clone `claude`/`codex`/`cursor` are normally absent, and
 * the caller has to be told so it can leave the issue alone.
 */
export async function spawnDetached(
  bin: string,
  argv: string[],
  logFile: string,
  options: DetachedSpawnOptions = {}
): Promise<DetachedSpawnResult> {
  const command = `${bin} ${argv.join(' ')}`
  const shortCommand = command.length > 240 ? `${command.slice(0, 240)}…` : command

  let outFd: number | undefined
  let errFd: number | undefined
  let inFd: number | 'ignore' = 'ignore'

  try {
    mkdirSync(dirname(logFile), { recursive: true })
    outFd = openSync(logFile, 'a')
    errFd = openSync(logFile, 'a')
    if (options.stdinFile) inFd = openSync(options.stdinFile, 'r')
  } catch (err) {
    closeFd(outFd)
    closeFd(errFd)
    return {
      ok: false,
      logFile,
      command: shortCommand,
      error: `failed to open log/stdin files: ${errText(err)}`,
    }
  }

  // ── Hard-resolve the binary BEFORE spawning ─────────────────────────────
  // A bare name (`claude`) is looked up on PATH the way a shell would; an
  // explicit path is existence-checked. Either way a miss is a synchronous,
  // reported failure — never an async 'error' event the caller cannot see.
  // With shell:false, Windows also cannot find `claude.cmd` from the bare
  // name alone, so this resolution is load-bearing, not just a nicety.
  const resolvedBin = resolveBinary(bin)
  if (!resolvedBin) {
    closeFd(inFd)
    closeFd(outFd)
    closeFd(errFd)
    appendLog(logFile, `[spawn-failure] ${new Date().toISOString()} binary not found on PATH: ${bin}`)
    return {
      ok: false,
      logFile,
      command: shortCommand,
      error: `binary '${bin}' not found on PATH — install it or set the runtime's *_BIN env var`,
    }
  }

  let child: ChildProcess
  try {
    child = spawn(resolvedBin, argv, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      detached: true,
      windowsHide: true,
      stdio: [inFd, outFd, errFd],
      // Node's own docs: on Windows a detached child of a shim (.cmd) still
      // needs shell:false + an absolute path, which resolveBinary gave us.
      shell: false,
    })
  } catch (err) {
    closeFd(inFd)
    closeFd(outFd)
    closeFd(errFd)
    appendLog(logFile, `[spawn-failure] ${new Date().toISOString()} ${errText(err)} (bin=${resolvedBin})`)
    return { ok: false, logFile, command: shortCommand, error: errText(err) }
  }

  // The fds were duplicated into the child by spawn(); the parent's copies are
  // dead weight from here on.
  closeFd(inFd)
  closeFd(outFd)
  closeFd(errFd)

  // Permanent listener. Two jobs: record a *late* failure in the log, and stop
  // an unhandled 'error' from taking the whole Next.js server down.
  child.on('error', (err) => {
    appendLog(logFile, `[spawn-failure] ${new Date().toISOString()} ${errText(err)} (bin=${resolvedBin})`)
  })

  // pieces8/memory-attempted: the child's REAL exit code, which nothing in
  // this codebase had ever captured. Filled in in place; the caller reads it
  // from its watchChildExit callback (which fires on a <=5s poll, i.e.
  // normally well after this event). Listening does not re-`ref()` the
  // handle — `unref()` below still lets Node exit with the child running —
  // and this listener never throws, so it cannot affect the spawn.
  // The log line is deliberately brace-free: claude-code.ts's completion-JSON
  // reader scans this same file for the last `}`.
  const exit: ChildExitObservation = { observed: false, code: null, signal: null, at: null }
  child.on('exit', (code, signal) => {
    exit.observed = true
    exit.code = typeof code === 'number' ? code : null
    exit.signal = signal ?? null
    exit.at = Date.now()
    appendLog(
      logFile,
      `[spawn-exit-code] ${new Date().toISOString()} pid=${child.pid ?? 'unknown'} ` +
      `code=${exit.code === null ? 'null' : String(exit.code)} signal=${exit.signal ?? 'none'}`,
    )
  })

  // Node must hold no reference to the child: that is what let a Next.js
  // restart kill in-flight agents before this file existed.
  child.unref()

  // ── Wait for the OS verdict ─────────────────────────────────────────────
  const verdict = await new Promise<{ ok: true } | { ok: false; error: string }>((resolve) => {
    let settled = false
    const settle = (v: { ok: true } | { ok: false; error: string }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(v)
    }
    // Safety net only. 'spawn'/'error' fire on the next tick in practice; if
    // neither arrives we fall through to the pid check below rather than
    // hanging the HTTP handler.
    const timer = setTimeout(() => settle({ ok: true }), SPAWN_CONFIRM_MS)
    timer.unref()
    child.once('spawn', () => settle({ ok: true }))
    child.once('error', (err: NodeJS.ErrnoException) => settle({ ok: false, error: errText(err) }))
  })

  if (!verdict.ok) {
    return { ok: false, pid: undefined, logFile, command: shortCommand, error: verdict.error, exit }
  }

  // Belt and braces: ok:true without a pid is meaningless to every caller
  // (watchChildExit no-ops, the UI shows "spawned" with nothing to watch), so
  // it is reported as the failure it is.
  if (child.pid === undefined) {
    appendLog(logFile, `[spawn-failure] ${new Date().toISOString()} child reported no pid (bin=${resolvedBin})`)
    return {
      ok: false,
      logFile,
      command: shortCommand,
      error: `spawn of '${bin}' produced no pid`,
      exit,
    }
  }

  return { ok: true, pid: child.pid, logFile, command: shortCommand, exit }
}

/**
 * Poll a detached pid and run `onExit` once it is gone.
 *
 * This replaces the ~40-line `nohup bash -c 'for i in $(seq …); kill -0 …'`
 * watcher that only ever worked on macOS. `process.kill(pid, 0)` is the
 * portable equivalent of `kill -0` and works on win32.
 *
 * Honest limitation: this watcher lives in the Next.js process, so a server
 * restart forgets it. The *agent* still survives (that is what detach buys);
 * only the exit notification is lost, and the stale-issue watchdog already
 * covers that case.
 */
export function watchChildExit(
  pid: number | undefined,
  logFile: string,
  onExit: () => void | Promise<void>,
  opts: { intervalMs?: number; maxMinutes?: number } = {}
): void {
  if (!pid) return
  const intervalMs = opts.intervalMs ?? 5_000
  const deadline = Date.now() + (opts.maxMinutes ?? 90) * 60_000

  const timer = setInterval(() => {
    if (isAlive(pid)) {
      if (Date.now() > deadline) {
        clearInterval(timer)
        appendLog(logFile, `[spawn-watcher] ${opts.maxMinutes ?? 90}-min timeout pid=${pid} — still alive, handing off to watchdog`)
      }
      return
    }
    clearInterval(timer)
    appendLog(logFile, `[spawn-exit] ${new Date().toISOString()} pid=${pid} watcher_detected=true`)
    void Promise.resolve(onExit()).catch((err) => {
      appendLog(logFile, `[spawn-exit] onExit handler failed: ${errText(err)}`)
    })
  }, intervalMs)

  // Never keep the server alive just to watch an agent.
  timer.unref()
}

/** Portable `kill -0`: true when a process with this pid still exists. */
export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    // EPERM means the process exists but belongs to someone else — still alive.
    return (err as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

function closeFd(fd: number | 'ignore' | undefined): void {
  if (typeof fd !== 'number') return
  try {
    closeSync(fd)
  } catch {
    /* already closed */
  }
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

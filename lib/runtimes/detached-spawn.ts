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

export interface DetachedSpawnResult {
  ok: boolean
  /** OS pid of the detached child, when the spawn got far enough to have one. */
  pid?: number
  /** Log file the child's stdout+stderr are appended to. */
  logFile: string
  /** Human-readable command, for debugging/UI. Never re-parsed. */
  command: string
  error?: string
}

/** `[label] …` line appended to a log file; never throws. */
export function appendLog(logFile: string, line: string): void {
  try {
    appendFileSync(logFile, line.endsWith('\n') ? line : `${line}\n`)
  } catch {
    /* the log is best-effort — never let it break a spawn */
  }
}

/**
 * Launch `bin argv…` fully detached, with stdout+stderr appended to `logFile`.
 *
 * No shell is involved: `argv` entries are passed to the OS verbatim, so
 * prompts containing quotes, `$(`, backticks or newlines need no escaping.
 *
 * Returns as soon as the process is launched — this is fire-and-forget. A
 * binary that cannot be executed surfaces asynchronously, so an `error`
 * listener is always attached and writes `[spawn-failure]` into the log.
 */
export function spawnDetached(
  bin: string,
  argv: string[],
  logFile: string,
  options: DetachedSpawnOptions = {}
): DetachedSpawnResult {
  const command = `${bin} ${argv.join(' ')}`
  const shortCommand = command.length > 240 ? `${command.slice(0, 240)}…` : command

  // Resolve bare names (`claude`, `codex`) through PATH ourselves. With
  // shell:false Windows will not find `claude.cmd` from the name alone.
  let resolvedBin = bin
  if (!bin.includes('/') && !bin.includes('\\')) {
    resolvedBin = resolveBinary(bin) ?? bin
  }

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

  try {
    const child = spawn(resolvedBin, argv, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      detached: true,
      windowsHide: true,
      stdio: [inFd, outFd, errFd],
      // Node's own docs: on Windows a detached child of a shim (.cmd) still
      // needs shell:false + an absolute path, which resolveBinary gave us.
      shell: false,
    })

    // ENOENT / EACCES arrive as an async 'error' event. Without a listener
    // Node rethrows it as an uncaught exception and takes the server down.
    child.once('error', (err) => {
      appendLog(logFile, `[spawn-failure] ${new Date().toISOString()} ${errText(err)} (bin=${resolvedBin})`)
    })

    // Node must hold no reference to the child: that is what let a Next.js
    // restart kill in-flight agents before this file existed.
    child.unref()

    closeFd(inFd)
    closeFd(outFd)
    closeFd(errFd)

    return { ok: true, pid: child.pid, logFile, command: shortCommand }
  } catch (err) {
    closeFd(inFd)
    closeFd(outFd)
    closeFd(errFd)
    appendLog(logFile, `[spawn-failure] ${new Date().toISOString()} ${errText(err)} (bin=${resolvedBin})`)
    return { ok: false, logFile, command: shortCommand, error: errText(err) }
  }
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

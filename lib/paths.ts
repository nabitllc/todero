// ── Cross-platform path + binary resolution ────────────────────────────────
// TOD: Todero used to hardcode `/Users/kemuniagent/todero` and `/opt/homebrew`,
// which made the app a one-Mac appliance. Everything that needs a filesystem
// location or an external binary should come through here instead.
//
// SERVER ONLY: this module imports node builtins (os/path/fs/child_process), so
// it must never be pulled into a client component bundle.

import os from 'os'
import path from 'path'
import { existsSync } from 'fs'
import { spawnSync } from 'child_process'

export const isWindows = process.platform === 'win32'
export const isDarwin = process.platform === 'darwin'

/**
 * Return the first candidate path that exists on disk, or null.
 * null/undefined entries are skipped so callers can inline optional env vars.
 */
export function firstExistingPath(candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      if (existsSync(candidate)) return candidate
    } catch {
      // unreadable path — treat as missing
    }
  }
  return null
}

/**
 * Root of the Todero checkout. Resolution order:
 *   1. TODERO_DIR env (explicit override — always wins)
 *   2. the current working directory, when it looks like this Node project
 *      (Next.js, jest and every script in scripts/ run from the repo root)
 *   3. ~/todero — the legacy single-Mac layout, kept only as a last resort
 *
 * Deliberately does NOT hardcode a home directory: a checkout at
 * C:\Development\Todero must resolve to itself, not to a path that never existed.
 */
function detectToderoDir(): string {
  const explicit = process.env.TODERO_DIR?.trim()
  if (explicit) return explicit

  const cwd = process.cwd()
  if (existsSync(path.join(cwd, 'package.json'))) return cwd

  return path.join(os.homedir(), 'todero')
}

export const TODERO_DIR: string = detectToderoDir()

/**
 * Agent workspace: where agents read/write project files.
 * Override with TODERO_WORKSPACE_DIR.
 * (TOD-798: `todero/config` is canonical; `~/.openclaw/workspace` is dead.)
 */
export const WORKSPACE_DIR: string =
  process.env.TODERO_WORKSPACE_DIR ?? path.join(TODERO_DIR, 'config')

/** Agent config/memory/scripts repo. Override with TODERO_CONFIG_DIR. */
export const CONFIG_DIR: string =
  process.env.TODERO_CONFIG_DIR ?? path.join(TODERO_DIR, 'config')

/**
 * Where Todero writes logs. Defaults under the OS temp dir (NOT the literal
 * '/tmp', which does not exist on Windows). Override with TODERO_LOG_DIR.
 */
export const LOG_DIR: string =
  process.env.TODERO_LOG_DIR ?? path.join(os.tmpdir(), 'todero-logs')

/**
 * Where per-spawn git worktrees are created. Under the OS temp dir by default
 * so a fresh clone on any host has somewhere writable to put them without the
 * operator creating a directory first. Override with AGENT_WORKTREE_ROOT.
 */
export const WORKTREE_ROOT: string =
  process.env.AGENT_WORKTREE_ROOT ?? path.join(os.tmpdir(), 'todero-worktrees')

const binaryCache = new Map<string, string | null>()

/**
 * Resolve `name` to an absolute executable path, or null when it is not
 * installed. An explicit path (contains a separator) is existence-checked
 * directly; a bare name is looked up on PATH the way a shell would
 * (`where` on Windows, `which` elsewhere).
 * Never throws, never guesses a Homebrew/`/usr/local` prefix.
 */
export function resolveBinary(name: string): string | null {
  const key = String(name ?? '').trim()
  if (!key) return null

  const cached = binaryCache.get(key)
  if (cached !== undefined) return cached

  let resolved: string | null = null

  if (key.includes('/') || key.includes('\\')) {
    // Caller gave a concrete path (e.g. CLAUDE_BIN). Don't search PATH for it —
    // just say whether it is really there on this host.
    resolved = existsSync(key) ? key : null
    binaryCache.set(key, resolved)
    return resolved
  }

  try {
    const lookup = isWindows ? 'where' : 'which'
    const result = spawnSync(lookup, [key], {
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
    })
    if (result.status === 0 && typeof result.stdout === 'string') {
      // `where` can print several matches, one per line — take the first.
      const first = result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)[0]
      resolved = first ?? null
    }
  } catch {
    // Lookup tool missing or spawn blocked — treat as "binary not found".
    resolved = null
  }

  binaryCache.set(key, resolved)
  return resolved
}

/** Drop a cached lookup (or the whole cache) — useful in tests. */
export function clearBinaryCache(name?: string): void {
  if (name) binaryCache.delete(name)
  else binaryCache.clear()
}

/**
 * Locate the AGENTS.md that describes the agent roster.
 * Used to live at a hardcoded `~/kaos-config/AGENTS.md`, which 500'd on every
 * host but one. Returns null when no copy is present.
 */
export function resolveAgentsMdPath(): string | null {
  return firstExistingPath([
    process.env.TODERO_AGENTS_MD,
    path.join(TODERO_DIR, 'AGENTS.md'),
    path.join(CONFIG_DIR, 'AGENTS.md'),
    path.join(WORKSPACE_DIR, 'AGENTS.md'),
    path.join(os.homedir(), 'kaos-config', 'AGENTS.md'),
  ])
}

/**
 * A process listing command that exists on this platform. Callers spawn it with
 * shell:false and parse stdout — `ps aux | grep` pipelines are POSIX-only.
 */
export function processListCommand(): { command: string; args: string[] } {
  if (isWindows) {
    return {
      command: 'powershell',
      args: [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        'Get-CimInstance Win32_Process | Select-Object ProcessId,Name,CommandLine | ConvertTo-Csv -NoTypeInformation',
      ],
    }
  }
  return { command: 'ps', args: ['-eo', 'pid,etime,command'] }
}

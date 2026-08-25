// TOD-806: Git worktree isolation for spawned agents.
//
// PROBLEM
// Previously, every Builder spawn ran `git checkout -b feat/tod-X` inside the
// shared ~/todero working directory. Because all agents share the same
// filesystem, this repeatedly switched the main working tree out from under
// the interactive Claude Code session. Three recoveries in one day (2026-04-10).
//
// SOLUTION
// Each spawn gets its own isolated git worktree at
//   ~/agent-worktrees/<agent>-<taskKey>-<timestamp>
// created via `git worktree add` from main. The agent runs inside the worktree
// and its branch operations cannot affect the main checkout. After the agent
// finishes (or times out), the worktree is torn down.
//
// TRADE-OFFS
// - Each spawn duplicates the working tree (cheap — git worktree shares the
//   object database, only files are checked out)
// - node_modules is NOT installed per worktree (we symlink it from the main
//   repo to avoid ~200MB install per spawn)
// - If an agent crashes, the worktree is left behind for forensics and GC'd
//   after 24h by a janitor script
//
// LAYOUT
//   ~/agent-worktrees/
//     builder-TOD-792-1775843900/      (active)
//     tester-TOD-796-1775843800/       (completed — will be GC'd)
//     ABANDONED/                       (failed spawns, manually archived)

import { mkdirSync, existsSync, symlinkSync, writeFileSync, readdirSync, statSync, rmSync } from 'fs'
import { spawnSync } from 'child_process'
import { join } from 'path'
import { TODERO_DIR, WORKTREE_ROOT } from '../paths'

// The repo these worktrees are cut from is *this* checkout. It used to be
// `join(homedir(), 'todero')`, which does not exist on any host but one — and a
// non-existent cwd is what turned every code-agent spawn into
// "spawnSync cmd.exe ENOENT" before the spawn helper was ever reached.
const REPO_ROOT = process.env.TODERO_REPO_ROOT ?? TODERO_DIR

export interface GitResult {
  ok: boolean
  stdout: string
  stderr: string
  error?: string
}

/**
 * Run one git command with an argv array and no shell.
 *
 * execSync('git checkout main', …) hands the string to cmd.exe on Windows and
 * /bin/sh elsewhere — two different quoting dialects, and on this machine an
 * ENOENT for cmd.exe itself. spawnSync with shell:false skips the shell
 * entirely, so paths with spaces and branch names with slashes need no quoting.
 */
function git(args: string[], opts: { cwd?: string; timeout?: number } = {}): GitResult {
  const result = spawnSync('git', args, {
    cwd: opts.cwd ?? REPO_ROOT,
    shell: false,
    encoding: 'utf8',
    windowsHide: true,
    timeout: opts.timeout ?? 30_000,
  })
  const stdout = result.stdout ?? ''
  const stderr = result.stderr ?? ''
  if (result.error) {
    return { ok: false, stdout, stderr, error: result.error.message }
  }
  if (result.status !== 0) {
    return {
      ok: false,
      stdout,
      stderr,
      error: `git ${args[0]} exited ${result.status}: ${(stderr || stdout).trim().slice(0, 300)}`,
    }
  }
  return { ok: true, stdout, stderr }
}

export interface WorktreePrepareOpts {
  agentId: string
  taskKey?: string | null
  /** Branch name to create/switch to inside the worktree (e.g. feat/tod-806) */
  branch?: string | null
}

export interface WorktreePrepareResult {
  ok: boolean
  worktreePath?: string
  branch?: string
  error?: string
}

/**
 * Create a fresh git worktree for an agent spawn.
 * Returns the absolute path to the worktree (to be passed as workingDir).
 *
 * If `branch` is provided, the worktree is created on that branch (creating it
 * from main if needed). Otherwise, it's on a detached HEAD at main.
 *
 * Symlinks node_modules from the main repo so the agent can `npm run build`
 * without reinstalling 200MB of deps.
 */
export function prepareWorktree(opts: WorktreePrepareOpts): WorktreePrepareResult {
  try {
    // Ensure the worktree root directory exists
    if (!existsSync(WORKTREE_ROOT)) {
      mkdirSync(WORKTREE_ROOT, { recursive: true })
    }

    // Compute a unique worktree path
    const timestamp = Date.now()
    const safeKey = (opts.taskKey ?? 'notask').replace(/[^A-Za-z0-9_-]/g, '-')
    const dirName = `${opts.agentId}-${safeKey}-${timestamp}`
    const worktreePath = join(WORKTREE_ROOT, dirName)

    // Compute the branch — default to a fresh feat/<agent>-<ts> if not provided
    const branchName = opts.branch && opts.branch.length > 0
      ? opts.branch
      : `feat/${opts.agentId}-${safeKey.toLowerCase()}-${timestamp}`

    // Make sure the repo is on main and up-to-date before branching off
    // (We don't pull — that's the 7am/7pm window's job — just stay on main)
    // Best-effort: a dirty tree or a detached HEAD is not a reason to abort.
    git(['checkout', 'main'], { timeout: 10_000 })

    // Guard: if a worktree for this branch already exists, reuse it instead of
    // creating a second one. Two worktrees on the same branch corrupt node_modules
    // symlinks and cause ENOTEMPTY failures on next npm install.
    {
      const listed = git(['worktree', 'list', '--porcelain'], { timeout: 10_000 })
      const existingWorktrees = listed.ok ? listed.stdout : ''
      const branchLine = `branch refs/heads/${branchName}`
      if (existingWorktrees.includes(branchLine)) {
        // Extract the path of the existing worktree for this branch
        const blocks = existingWorktrees.split('\n\n')
        for (const block of blocks) {
          if (block.includes(branchLine)) {
            const pathMatch = block.match(/^worktree (.+)$/m)
            if (pathMatch?.[1] && pathMatch[1] !== REPO_ROOT) {
              console.log(`[worktree] reusing existing worktree for ${branchName}: ${pathMatch[1]}`)
              return { ok: true, worktreePath: pathMatch[1] }
            }
          }
        }
      }
      // If listing failed we just proceed with creation — worst case `git
      // worktree add` reports the collision itself.
    }

    // Check if the branch already exists locally
    const branchExistsLocal = git(
      ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`],
      { timeout: 10_000 }
    ).ok

    // Create the worktree
    // - If branch exists, use `git worktree add <path> <branch>`
    // - If not, use `git worktree add -b <branch> <path> main`
    const worktreeArgs = branchExistsLocal
      ? ['worktree', 'add', worktreePath, branchName]
      : ['worktree', 'add', '-b', branchName, worktreePath, 'main']

    const added = git(worktreeArgs, { timeout: 60_000 })
    if (!added.ok) {
      return { ok: false, error: added.error ?? 'git worktree add failed' }
    }

    // Symlink node_modules from main repo so `npm run build` works without reinstall.
    // node_modules is append-only from the worktree's perspective (agent never `npm install`s
    // in its worktree), so sharing is safe.
    const srcNodeModules = join(REPO_ROOT, 'node_modules')
    const dstNodeModules = join(worktreePath, 'node_modules')
    if (existsSync(srcNodeModules) && !existsSync(dstNodeModules)) {
      try {
        symlinkSync(srcNodeModules, dstNodeModules, 'dir')
      } catch (err) {
        console.warn(`[worktree] node_modules symlink failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // DO NOT symlink .next — each worktree must build its own .next.
    // Sharing .next between multiple tree states causes "Cannot find module './6552.js'"
    // webpack chunk collisions. The agent's first `npm run build` will create one locally.
    // (Earlier version of this file symlinked .next as an optimization; removed 2026-04-10.)

    // Symlink .env.local so API keys are available inside the worktree build.
    const srcEnv = join(REPO_ROOT, '.env.local')
    const dstEnv = join(worktreePath, '.env.local')
    if (existsSync(srcEnv) && !existsSync(dstEnv)) {
      try {
        symlinkSync(srcEnv, dstEnv)
      } catch {
        // non-fatal — build may still work if NEXT_PUBLIC vars are baked in
      }
    }

    // Write a .npmrc guard so that if an agent accidentally runs `npm install`
    // inside the worktree, it fails loudly instead of silently replacing the
    // node_modules symlink with a real (incomplete) install directory.
    // The `engine-strict` alone won't stop all installs, but the combination of
    // `ignore-scripts=false` preserved + a `fund=false / audit=false` speeds up
    // any install that does happen and keeps logs clean.
    // IMPORTANT: the real guard is the agent prompt instruction below — this is
    // a second line of defence.
    const npmrcPath = join(worktreePath, '.npmrc')
    if (!existsSync(npmrcPath)) {
      try {
        writeFileSync(npmrcPath, [
          '# KAOS WORKTREE — node_modules is symlinked from ~/todero',
          '# DO NOT run npm install here. It replaces the shared symlink.',
          '# If you need a new package, install it in ~/todero and restart.',
          'audit=false',
          'fund=false',
          'update-notifier=false',
        ].join('\n') + '\n')
      } catch {
        // non-fatal
      }
    }

    return {
      ok: true,
      worktreePath,
      branch: branchName,
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Tear down a worktree after the agent finishes.
 * Force-removes the directory and prunes the git worktree entry.
 * Best-effort: errors are logged but not thrown.
 */
export function teardownWorktree(worktreePath: string): { ok: boolean; error?: string } {
  try {
    if (!existsSync(worktreePath)) return { ok: true }
    // Ask git to remove the worktree cleanly (deletes the dir and prunes the entry)
    const removed = git(['worktree', 'remove', '--force', worktreePath], { timeout: 30_000 })
    if (!removed.ok) {
      // Fallback: force delete the directory and prune
      console.warn(`[worktree] git worktree remove failed, falling back to rm: ${removed.error}`)
      try {
        rmSync(worktreePath, { recursive: true, force: true })
      } catch (err2) {
        return {
          ok: false,
          error: err2 instanceof Error ? err2.message : String(err2),
        }
      }
      git(['worktree', 'prune'], { timeout: 10_000 })
    }
    return { ok: true }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Garbage collect stale worktrees older than `maxAgeHours`.
 * Called by a janitor script (e.g. a LaunchAgent) to clean up crashed agents.
 */
export function gcStaleWorktrees(maxAgeHours = 24): { removed: number; errors: string[] } {
  const result = { removed: 0, errors: [] as string[] }
  try {
    if (!existsSync(WORKTREE_ROOT)) return result
    const now = Date.now()
    const maxAgeMs = maxAgeHours * 60 * 60 * 1000
    const entries = readdirSync(WORKTREE_ROOT)
    for (const entry of entries) {
      if (entry === 'ABANDONED') continue
      const fullPath = join(WORKTREE_ROOT, entry)
      try {
        const s = statSync(fullPath)
        if (!s.isDirectory()) continue
        if (now - s.mtimeMs > maxAgeMs) {
          const tr = teardownWorktree(fullPath)
          if (tr.ok) result.removed++
          else result.errors.push(`${entry}: ${tr.error}`)
        }
      } catch (err) {
        result.errors.push(`${entry}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err))
  }
  return result
}

/**
 * List currently-active worktrees. Used by GET /api/run-agent/worktrees for visibility.
 */
export function listWorktrees(): Array<{ path: string; agentId: string; taskKey: string; ageSeconds: number }> {
  try {
    if (!existsSync(WORKTREE_ROOT)) return []
    const now = Date.now()
    return readdirSync(WORKTREE_ROOT)
      .filter(e => e !== 'ABANDONED')
      .map(entry => {
        const fullPath = join(WORKTREE_ROOT, entry)
        let mtime = now
        try {
          mtime = statSync(fullPath).mtimeMs
        } catch {}
        // Parse the dirname: <agent>-<taskKey>-<timestamp>
        const parts = entry.split('-')
        const agentId = parts[0] ?? 'unknown'
        const taskKey = parts.slice(1, -1).join('-') || 'unknown'
        return {
          path: fullPath,
          agentId,
          taskKey,
          ageSeconds: Math.round((now - mtime) / 1000),
        }
      })
      .sort((a, b) => a.ageSeconds - b.ageSeconds)
  } catch {
    return []
  }
}

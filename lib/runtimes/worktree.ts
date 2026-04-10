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

import { mkdirSync, existsSync, symlinkSync, readdirSync, statSync, rmSync } from 'fs'
import { execSync } from 'child_process'
import { join, dirname } from 'path'
import { homedir } from 'os'

const WORKTREE_ROOT = process.env.AGENT_WORKTREE_ROOT ?? join(homedir(), 'agent-worktrees')
const REPO_ROOT = process.env.TODERO_REPO_ROOT ?? join(homedir(), 'todero')

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
    try {
      execSync('git checkout main', { cwd: REPO_ROOT, stdio: 'pipe', timeout: 10_000 })
    } catch {
      // ignore — might be a clean repo or a stash is in the way
    }

    // Check if the branch already exists locally or remotely
    let branchExistsLocal = false
    try {
      execSync(`git show-ref --verify --quiet refs/heads/${branchName}`, {
        cwd: REPO_ROOT, stdio: 'pipe',
      })
      branchExistsLocal = true
    } catch {
      branchExistsLocal = false
    }

    // Create the worktree
    // - If branch exists, use `git worktree add <path> <branch>`
    // - If not, use `git worktree add -b <branch> <path> main`
    const worktreeCmd = branchExistsLocal
      ? `git worktree add ${JSON.stringify(worktreePath)} ${JSON.stringify(branchName)}`
      : `git worktree add -b ${JSON.stringify(branchName)} ${JSON.stringify(worktreePath)} main`

    execSync(worktreeCmd, { cwd: REPO_ROOT, stdio: 'pipe', timeout: 30_000 })

    // Symlink node_modules from main repo so `npm run build` works without reinstall
    const srcNodeModules = join(REPO_ROOT, 'node_modules')
    const dstNodeModules = join(worktreePath, 'node_modules')
    if (existsSync(srcNodeModules) && !existsSync(dstNodeModules)) {
      try {
        symlinkSync(srcNodeModules, dstNodeModules, 'dir')
      } catch (err) {
        console.warn(`[worktree] node_modules symlink failed: ${err instanceof Error ? err.message : String(err)}`)
      }
    }

    // Also symlink .next (if it exists) so the agent can skip rebuild during verification
    // — optional optimization; safe to skip if it fails
    const srcNext = join(REPO_ROOT, '.next')
    const dstNext = join(worktreePath, '.next')
    if (existsSync(srcNext) && !existsSync(dstNext)) {
      try {
        symlinkSync(srcNext, dstNext, 'dir')
      } catch {
        // ignore — non-critical
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
    try {
      execSync(`git worktree remove --force ${JSON.stringify(worktreePath)}`, {
        cwd: REPO_ROOT, stdio: 'pipe', timeout: 30_000,
      })
    } catch (err) {
      // Fallback: force delete the directory and prune
      console.warn(`[worktree] git worktree remove failed, falling back to rm: ${err instanceof Error ? err.message : String(err)}`)
      try {
        rmSync(worktreePath, { recursive: true, force: true })
        execSync('git worktree prune', { cwd: REPO_ROOT, stdio: 'pipe', timeout: 10_000 })
      } catch (err2) {
        return {
          ok: false,
          error: err2 instanceof Error ? err2.message : String(err2),
        }
      }
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

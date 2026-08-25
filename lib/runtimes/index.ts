// TOD-793: Runtime registry — selects which AgentRuntime to use at spawn time.
//
// Selection order:
//   1. Per-spawn override via opts.runtime (future: used by /api/run-agent query param)
//   2. Per-agent runtime in agent-queue.ts config (future)
//   3. Process env TODERO_RUNTIME
//   4. Highest-priority registered runtime that reports isAvailable() === true
//
// Adding a new runtime:
//   - Create lib/runtimes/<name>.ts exporting a default AgentRuntime
//   - Add a registration line below
//   - Bump the priority if you want it tried before claude-code
//   - Build + verify it shows up in `curl /api/run-agent/runtimes` (future endpoint)

import claudeCodeRuntime, { CLAUDE_BIN } from './claude-code'
import codexRuntime, { CODEX_BIN } from './codex'
import cursorRuntime, { CURSOR_BIN } from './cursor'
import { openaiApiRuntime } from './openai-api'
import type { AgentRuntime, RuntimeRegistration } from './types'
import { assertDispatchEnabled } from '../dispatch-guard'
import { resolveBinary } from '../paths'

const REGISTRY: RuntimeRegistration[] = [
  { runtime: claudeCodeRuntime, priority: 100 },
  { runtime: codexRuntime,      priority: 90  },
  { runtime: cursorRuntime,     priority: 80  },
  { runtime: openaiApiRuntime,  priority: 70  }, // openai-api
]

/**
 * Resolve an AgentRuntime by name.
 * Returns null if the named runtime isn't registered or isn't available.
 */
export async function getRuntimeByName(name: string): Promise<AgentRuntime | null> {
  assertDispatchEnabled()
  const entry = REGISTRY.find(r => r.runtime.name === name)
  if (!entry) return null
  if (!(await entry.runtime.isAvailable())) return null
  return entry.runtime
}

/**
 * Resolve the default AgentRuntime using the priority order.
 * Honors TODERO_RUNTIME env var first, then falls back to highest-priority
 * available runtime.
 */
export async function getDefaultRuntime(): Promise<AgentRuntime> {
  assertDispatchEnabled()
  return selectRuntime()
}

/**
 * The selection itself, with no dispatch guard. Separated so read-only
 * inspection (`inspectRuntime`, the /api/run-agent?dryRun=1 branch) can ask
 * "which runtime would run, and is its binary present?" without being a spawn.
 */
async function selectRuntime(): Promise<AgentRuntime> {
  // Env override
  const envName = process.env.TODERO_RUNTIME
  if (envName) {
    const entry = REGISTRY.find(r => r.runtime.name === envName)
    if (entry && await entry.runtime.isAvailable()) return entry.runtime
    console.warn(`[runtimes] TODERO_RUNTIME=${envName} requested but not available; falling back`)
  }

  // Highest-priority available runtime
  const sorted = [...REGISTRY].sort((a, b) => b.priority - a.priority)
  for (const entry of sorted) {
    if (await entry.runtime.isAvailable()) {
      return entry.runtime
    }
  }

  // No runtime available — return Claude Code as a last-ditch fallback. Its
  // spawn now resolves the `claude` binary before launching and returns
  // ok:false with "binary not found on PATH" when it is absent, so this
  // fallback reports a real failure to the caller rather than a fake success.
  return claudeCodeRuntime
}

/**
 * The executable each runtime would launch, as configured (bare name or an
 * explicit *_BIN path). `openai-api` runs the Node binary this server is
 * already running under, so it has no external dependency.
 */
const RUNTIME_BIN_SPEC: Readonly<Record<string, string>> = {
  'claude-code': CLAUDE_BIN,
  'codex': CODEX_BIN,
  'cursor': CURSOR_BIN,
  'openai-api': process.execPath,
}

export interface RuntimeInspection {
  /** Runtime that would handle a dispatch right now. */
  runtime: string
  /** Executable as configured — a bare name or an explicit *_BIN path. */
  bin: string
  /** Absolute path the bin resolves to on this host, or null when absent. */
  binResolved: string | null
  available: boolean
}

/**
 * Read-only answer to "what would happen if I dispatched?" — no guard, no
 * spawn, no side effects. `binResolved: null` is the honest signal that a
 * dispatch would fail here, and is exactly what spawnDetached() checks.
 */
export async function inspectRuntime(name?: string | null): Promise<RuntimeInspection> {
  const entry = name ? REGISTRY.find(r => r.runtime.name === name) : undefined
  const runtime = entry ? entry.runtime : await selectRuntime()
  const bin = RUNTIME_BIN_SPEC[runtime.name] ?? runtime.name
  return {
    runtime: runtime.name,
    bin,
    binResolved: resolveBinary(bin),
    available: await runtime.isAvailable(),
  }
}

/**
 * List all registered runtimes with their availability state.
 * Used by a future /api/runtimes endpoint + smoke tests.
 */
export async function listRuntimes(): Promise<Array<{ name: string; displayName: string; priority: number; available: boolean; supportsSessions: boolean; supportsTools: boolean }>> {
  type RuntimeListEntry = { name: string; displayName: string; priority: number; available: boolean; supportsSessions: boolean; supportsTools: boolean }
  const results: RuntimeListEntry[] = []
  for (const entry of REGISTRY) {
    results.push({
      name: entry.runtime.name,
      displayName: entry.runtime.displayName,
      priority: entry.priority,
      available: await entry.runtime.isAvailable(),
      supportsSessions: entry.runtime.supportsSessions,
      supportsTools: entry.runtime.supportsTools,
    })
  }
  return results
}

export type { AgentRuntime, AgentSpawnOptions, AgentSpawnResult, RuntimeRegistration } from './types'

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

import claudeCodeRuntime from './claude-code'
import type { AgentRuntime, RuntimeRegistration } from './types'

const REGISTRY: RuntimeRegistration[] = [
  { runtime: claudeCodeRuntime, priority: 100 },
  // Future:
  // { runtime: codexRuntime,     priority: 90  },  // lib/runtimes/codex.ts
  // { runtime: cursorRuntime,    priority: 80  },  // lib/runtimes/cursor.ts
  // { runtime: openaiApiRuntime, priority: 70  },  // lib/runtimes/openai-api.ts
]

/**
 * Resolve an AgentRuntime by name.
 * Returns null if the named runtime isn't registered or isn't available.
 */
export async function getRuntimeByName(name: string): Promise<AgentRuntime | null> {
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
  // Env override
  const envName = process.env.TODERO_RUNTIME
  if (envName) {
    const r = await getRuntimeByName(envName)
    if (r) return r
    console.warn(`[runtimes] TODERO_RUNTIME=${envName} requested but not available; falling back`)
  }

  // Highest-priority available runtime
  const sorted = [...REGISTRY].sort((a, b) => b.priority - a.priority)
  for (const entry of sorted) {
    if (await entry.runtime.isAvailable()) {
      return entry.runtime
    }
  }

  // No runtime available — return Claude Code as a last-ditch fallback.
  // Its spawn will fail loudly in that case, which is preferable to a silent error.
  return claudeCodeRuntime
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

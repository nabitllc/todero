// TOD-487: Route named-agent tasks through openclaw message
// instead of spinning up anonymous subagents.
//
// Named agents (builder, tester, scout, security, community, content, designer, etc.)
// are dispatched via openclaw message --agent [id] so their persistent session picks
// up the task. Anonymous subagents are reserved for truly one-off work with no named role.

import { exec } from 'child_process'
import { promisify } from 'util'
import { type AgentId, AGENT_REGISTRY } from './agent-capabilities'

const execAsync = promisify(exec)

const OPENCLAW_BIN = '/opt/homebrew/bin/openclaw'
const OPENCLAW_GATEWAY = 'http://127.0.0.1:18789'
const OPENCLAW_TOKEN = 'eb4ac84aeab1b0f85f9b9697ee3dc707170bf0bf46a735f0'

export interface DispatchResult {
  ok: boolean
  method: 'openclaw-message' | 'gateway-api' | 'subagent-fallback'
  agentId: string
  error?: string
}

/**
 * Dispatch a task to a named agent via openclaw message.
 * Falls back to gateway API if CLI unavailable, then to subagent as last resort.
 *
 * Use this instead of spawning anonymous subagents for any task
 * that maps to a named agent role.
 */
export async function dispatchToNamedAgent(
  agentId: string,
  taskPrompt: string,
  options?: { sessionKey?: string; timeout?: number }
): Promise<DispatchResult> {
  const isNamedAgent = agentId in AGENT_REGISTRY

  // If not a named agent, caller should use subagent directly
  if (!isNamedAgent) {
    return { ok: false, method: 'subagent-fallback', agentId, error: `${agentId} is not a named agent — use subagent for one-off work` }
  }

  // Method 1: openclaw message --agent CLI
  try {
    await execAsync(`${OPENCLAW_BIN} message --agent "${agentId}" --text "${taskPrompt.replace(/"/g, '\\"')}"`, {
      timeout: options?.timeout ?? 10000,
    })
    return { ok: true, method: 'openclaw-message', agentId }
  } catch {
    // CLI unavailable or failed — try gateway API
  }

  // Method 2: Gateway chat completions API
  try {
    const res = await fetch(`${OPENCLAW_GATEWAY}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENCLAW_TOKEN}`,
        'Content-Type': 'application/json',
        'x-openclaw-agent-id': agentId,
        'x-openclaw-session-key': options?.sessionKey ?? `dispatch-${agentId}-${Date.now()}`,
      },
      body: JSON.stringify({
        model: 'openclaw',
        messages: [{ role: 'user', content: taskPrompt }],
        stream: false,
      }),
    })

    if (res.ok) {
      return { ok: true, method: 'gateway-api', agentId }
    }
  } catch {
    // Gateway unreachable — fall through
  }

  return { ok: false, method: 'subagent-fallback', agentId, error: 'Both openclaw CLI and gateway unavailable' }
}

/**
 * Resolve which agent should handle a task based on type/capabilities.
 * Returns the named agent ID, or null if the task should use a one-off subagent.
 */
export function resolveAgentForTask(taskType: string, capabilities?: string[]): AgentId | null {
  const typeToAgent: Record<string, AgentId> = {
    'coding': 'builder',
    'implementation': 'builder',
    'bug': 'builder',
    'feature': 'builder',
    'review': 'tester',
    'qa': 'tester',
    'test': 'tester',
    'research': 'scout',
    'scan': 'scout',
    'security': 'security',
    'audit': 'security',
    'owasp': 'security',
    'community': 'community',
    'social': 'community',
    'content': 'content',
    'blog': 'content',
    'seo': 'content',
    'design': 'designer',
    'ux': 'ux',
    'deploy': 'deployer',
    'release': 'deployer',
  }

  const lowerType = taskType.toLowerCase()
  for (const [keyword, agent] of Object.entries(typeToAgent)) {
    if (lowerType.includes(keyword)) return agent
  }

  // Check capabilities overlap
  if (capabilities) {
    for (const [id, reg] of Object.entries(AGENT_REGISTRY)) {
      const overlap = reg.capabilities.some(c =>
        capabilities.some(req => c.toLowerCase().includes(req.toLowerCase()))
      )
      if (overlap) return id as AgentId
    }
  }

  return null // one-off subagent
}

/**
 * High-level delegation: resolve agent, dispatch via named route or subagent.
 * This is the function KAOS should call instead of spinning up anonymous subagents.
 */
export async function delegateTask(
  taskType: string,
  taskPrompt: string,
  options?: { forceAgent?: string; sessionKey?: string }
): Promise<DispatchResult> {
  const agentId = options?.forceAgent ?? resolveAgentForTask(taskType)

  if (!agentId) {
    return {
      ok: false,
      method: 'subagent-fallback',
      agentId: 'anonymous',
      error: 'No named agent matches — use anonymous subagent for this one-off task',
    }
  }

  return dispatchToNamedAgent(agentId, taskPrompt, options)
}

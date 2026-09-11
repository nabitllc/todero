import type { Agent } from "@todero/shared";
import { CONVERSATIONAL_HEARTBEAT_INTERVAL_SEC } from "./new-agent-runtime-config";

export type AgentTimer = {
  /** Whether the agent's busy timer picks up open work on its own. */
  enabled: boolean;
  /** How often the timer looks, in seconds. */
  intervalSec: number;
};

/**
 * Read an agent's busy timer from the runtime config the agents list already
 * carries, so the turn bar can say "picks this up within 2 minutes" or
 * "timer is off" from data the page has. No agent means no timer.
 */
export function readAgentTimer(agent: Pick<Agent, "runtimeConfig"> | null | undefined): AgentTimer | null {
  if (!agent) return null;
  const heartbeat = (agent.runtimeConfig as { heartbeat?: unknown } | null | undefined)?.heartbeat;
  const record = heartbeat && typeof heartbeat === "object" ? (heartbeat as Record<string, unknown>) : {};
  const enabled = record.enabled === true;
  const rawInterval = record.intervalSec;
  const intervalSec =
    typeof rawInterval === "number" && Number.isFinite(rawInterval) && rawInterval > 0
      ? rawInterval
      : CONVERSATIONAL_HEARTBEAT_INTERVAL_SEC;
  return { enabled, intervalSec };
}

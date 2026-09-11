import { isConversationalHttpAgent } from "./conversation-thread.js";

/**
 * Marks a chat-only local agent whose timer has already been decided once —
 * either by the startup backfill that gave the wave-F defaults to an agent
 * hired before them, or by the hire itself, which now sets the timer on the
 * way in.
 *
 * The startup backfill reads this stamp as "leave this one alone". Without it
 * on newly hired agents, the backfill cannot tell an agent that was never
 * configured from one a person deliberately turned off, and the next start
 * would switch the timer back on behind their back.
 */
export const TIMER_CONFIGURED_STAMP_KEY = "toderoBackfilledAt";

function heartbeatOf(runtimeConfig: unknown): Record<string, unknown> {
  if (!runtimeConfig || typeof runtimeConfig !== "object" || Array.isArray(runtimeConfig)) return {};
  const heartbeat = (runtimeConfig as Record<string, unknown>).heartbeat;
  if (!heartbeat || typeof heartbeat !== "object" || Array.isArray(heartbeat)) return {};
  return heartbeat as Record<string, unknown>;
}

/** Whether this agent's timer has been set before, by a hire or by the backfill. */
export function hasTimerConfiguredStamp(runtimeConfig: unknown): boolean {
  return heartbeatOf(runtimeConfig)[TIMER_CONFIGURED_STAMP_KEY] !== undefined;
}

/**
 * Stamp a heartbeat block, in place, when this agent is the kind the startup
 * timer backfill looks at. Everything else is left exactly as it was, so the
 * stamp never shows up on an agent it would mean nothing for.
 */
export function stampTimerConfiguredOnNewAgent(
  heartbeat: Record<string, unknown>,
  agent: { adapterType: string; adapterConfig: unknown },
  now: Date = new Date(),
): Record<string, unknown> {
  if (!isConversationalHttpAgent(agent)) return heartbeat;
  if (heartbeat[TIMER_CONFIGURED_STAMP_KEY] !== undefined) return heartbeat;
  heartbeat[TIMER_CONFIGURED_STAMP_KEY] = now.toISOString();
  return heartbeat;
}

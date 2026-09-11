/**
 * A model on this machine can be slow enough that a turn runs out of time even
 * with the ten-minute floor — the machine was busy, or the model is too big for
 * it. What must not happen is what happened on the wave-1 live loop: several
 * recovery paths firing at once, each posting to the person.
 *
 * One quiet try, then one plain sentence and the task waits for the person.
 * That is the whole policy, and it is a pure function so it can be read and
 * tested on its own.
 */
import { isConversationalHttpAgent } from "./conversation-thread.js";
import { isLocalModelAdapterConfig } from "../adapters/http/local-model-timeout.js";

/** The error the http adapter records when the model did not answer in time. */
export const SLOW_LOCAL_TURN_ERROR_CODE = "timeout";

/** Marks the one quiet try, so the try itself is never tried again. */
export const SLOW_LOCAL_TURN_RETRY_REASON = "slow_local_turn_retry";
export const SLOW_LOCAL_TURN_WAKE_REASON = "slow_local_turn_retry";

/** One try, never two. */
export const SLOW_LOCAL_TURN_MAX_RETRIES = 1;

/** A minute of quiet before the second try, so a busy machine gets to breathe. */
export const SLOW_LOCAL_TURN_RETRY_DELAY_MS = 60_000;

/**
 * The one sentence a person sees, and only after the quiet try also ran out of
 * time. Kept here so the wording has a single home.
 */
export const SLOW_LOCAL_TURN_HELD_NOTICE_BODY =
  "The model on this machine did not answer in time, twice. Nothing was lost — this task is waiting for you. Give the model more room or pick a smaller one, then start the task again.";

export type SlowLocalTurnPlan = "retry_quietly" | "hold_for_person";

/** True when this agent talks to a model on this machine over a chat endpoint. */
export function isSlowLocalTurnAgent(agent: { adapterType: string; adapterConfig: unknown }): boolean {
  if (!isConversationalHttpAgent(agent)) return false;
  const config = agent.adapterConfig;
  if (!config || typeof config !== "object" || Array.isArray(config)) return false;
  return isLocalModelAdapterConfig(config as Record<string, unknown>);
}

/**
 * How a turn that ran out of time ends. The http adapter reports `timedOut`, and
 * the heartbeat turns that into its own `timed_out` — not `failed`. Both are
 * listed because an adapter can also report the clock as a plain failure.
 */
const SLOW_LOCAL_TURN_OUTCOMES = new Set(["timed_out", "failed"]);

/**
 * What to do about a turn that just ended. `null` means this is not a slow
 * local turn and nothing here applies — every other path is left alone.
 */
export function planSlowLocalTurnRecovery(input: {
  outcome: string;
  errorCode: string | null;
  agent: { adapterType: string; adapterConfig: unknown };
  scheduledRetryReason: string | null;
}): SlowLocalTurnPlan | null {
  if (!SLOW_LOCAL_TURN_OUTCOMES.has(input.outcome)) return null;
  if (input.errorCode !== SLOW_LOCAL_TURN_ERROR_CODE) return null;
  if (!isSlowLocalTurnAgent(input.agent)) return null;
  return input.scheduledRetryReason === SLOW_LOCAL_TURN_RETRY_REASON ? "hold_for_person" : "retry_quietly";
}

import { AGENT_DEFAULT_MAX_CONCURRENT_RUNS } from "@todero/shared";
import { defaultCreateValues } from "../components/agent-config-defaults";

/** A local agent checks for work it can start every two minutes. */
export const CONVERSATIONAL_HEARTBEAT_INTERVAL_SEC = 120;
/** Without a reported number, assume the machine serves one model at a time. */
export const CONVERSATIONAL_DEFAULT_PARALLELISM = 1;
const CONVERSATIONAL_MAX_PARALLELISM = 8;

function clampParallelism(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return CONVERSATIONAL_DEFAULT_PARALLELISM;
  const floored = Math.floor(value);
  if (floored < CONVERSATIONAL_DEFAULT_PARALLELISM) return CONVERSATIONAL_DEFAULT_PARALLELISM;
  return Math.min(CONVERSATIONAL_MAX_PARALLELISM, floored);
}

export function buildNewAgentRuntimeConfig(input?: {
  heartbeatEnabled?: boolean;
  intervalSec?: number;
  cheapModel?: string;
  cheapModelEnabled?: boolean;
  /**
   * A chat-only local model. It keeps itself going on a short timer while it
   * has work it can start, and takes as many threads at once as the machine
   * can serve models.
   */
  conversational?: boolean;
  /**
   * How many models this machine can serve at the same time, as the local
   * model detect step reported it. Missing means one.
   */
  parallelism?: number | null;
}): Record<string, unknown> {
  const conversational = input?.conversational === true;
  const config: Record<string, unknown> = {
    heartbeat: {
      // A local agent left with no timer stops the moment a wake is missed.
      // The timer costs nothing while there is nothing to do, because
      // skipTimerWhenNoActionableWork skips the tick.
      enabled: input?.heartbeatEnabled ?? (conversational ? true : defaultCreateValues.heartbeatEnabled),
      intervalSec:
        input?.intervalSec ??
        (conversational ? CONVERSATIONAL_HEARTBEAT_INTERVAL_SEC : defaultCreateValues.intervalSec),
      wakeOnDemand: true,
      skipTimerWhenNoActionableWork: true,
      cooldownSec: 10,
      maxConcurrentRuns: conversational
        ? clampParallelism(input?.parallelism)
        : AGENT_DEFAULT_MAX_CONCURRENT_RUNS,
    },
  };

  const cheapModel = input?.cheapModel?.trim() ?? "";
  const cheapEnabled = input?.cheapModelEnabled ?? false;
  if (cheapEnabled) {
    config.modelProfiles = {
      cheap: {
        enabled: true,
        adapterConfig: cheapModel ? { model: cheapModel } : {},
      },
    };
  }

  return config;
}

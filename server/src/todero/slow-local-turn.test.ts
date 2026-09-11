import { describe, expect, it } from "vitest";
import {
  isSlowLocalTurnAgent,
  planSlowLocalTurnRecovery,
  SLOW_LOCAL_TURN_ERROR_CODE,
  SLOW_LOCAL_TURN_HELD_NOTICE_BODY,
  SLOW_LOCAL_TURN_MAX_RETRIES,
  SLOW_LOCAL_TURN_RETRY_REASON,
} from "./slow-local-turn.js";

/** The hire the wave-1 live loop made: a model on this machine, over a chat endpoint. */
const localAgent = {
  adapterType: "http",
  adapterConfig: {
    url: "http://127.0.0.1:11434/v1/chat/completions",
    model: "qwen2.5-coder:14b",
    localLlm: { runtimeId: "ollama", baseUrl: "http://127.0.0.1:11434", modelId: "qwen2.5-coder:14b" },
  },
};

/**
 * A turn that ran out of time, the way the heartbeat records one. `timed_out`,
 * not `failed`: the http adapter reports `timedOut` and the heartbeat gives the
 * turn its own outcome for it (services/heartbeat.ts, `outcome = "timed_out"`).
 * The first cut of this policy only looked at `failed`, so the whole quiet-try
 * path never ran on a real turn; the live test in
 * src/__tests__/heartbeat-slow-local-turn.test.ts is what found that.
 */
const timedOutTurn = { outcome: "timed_out", errorCode: SLOW_LOCAL_TURN_ERROR_CODE };

describe("isSlowLocalTurnAgent", () => {
  it("knows the agent that talks to a model on this machine", () => {
    expect(isSlowLocalTurnAgent(localAgent)).toBe(true);
  });

  it("leaves a webhook somewhere else alone", () => {
    expect(
      isSlowLocalTurnAgent({ adapterType: "http", adapterConfig: { url: "https://example.test/webhook" } }),
    ).toBe(false);
  });

  it("leaves an agent that is not an http agent alone", () => {
    expect(isSlowLocalTurnAgent({ adapterType: "codex_local", adapterConfig: {} })).toBe(false);
  });
});

describe("planSlowLocalTurnRecovery", () => {
  it("tries once, quietly, the first time the model runs out of time", () => {
    expect(
      planSlowLocalTurnRecovery({ ...timedOutTurn, agent: localAgent, scheduledRetryReason: null }),
    ).toBe("retry_quietly");
    expect(SLOW_LOCAL_TURN_MAX_RETRIES).toBe(1);
  });

  it("holds the task for the person when the quiet try runs out too", () => {
    expect(
      planSlowLocalTurnRecovery({
        ...timedOutTurn,
        agent: localAgent,
        scheduledRetryReason: SLOW_LOCAL_TURN_RETRY_REASON,
      }),
    ).toBe("hold_for_person");
  });

  it("also reads the clock when an adapter calls it a plain failure", () => {
    expect(
      planSlowLocalTurnRecovery({
        outcome: "failed",
        errorCode: SLOW_LOCAL_TURN_ERROR_CODE,
        agent: localAgent,
        scheduledRetryReason: null,
      }),
    ).toBe("retry_quietly");
  });

  it("says nothing about a turn that finished", () => {
    expect(
      planSlowLocalTurnRecovery({
        outcome: "succeeded",
        errorCode: null,
        agent: localAgent,
        scheduledRetryReason: null,
      }),
    ).toBeNull();
  });

  it("says nothing about a turn the person cancelled", () => {
    expect(
      planSlowLocalTurnRecovery({
        outcome: "cancelled",
        errorCode: SLOW_LOCAL_TURN_ERROR_CODE,
        agent: localAgent,
        scheduledRetryReason: null,
      }),
    ).toBeNull();
  });

  it("says nothing about a failure that is not the clock", () => {
    expect(
      planSlowLocalTurnRecovery({
        outcome: "failed",
        errorCode: "adapter_failed",
        agent: localAgent,
        scheduledRetryReason: null,
      }),
    ).toBeNull();
  });

  it("says nothing about a webhook somewhere else that ran out of time", () => {
    expect(
      planSlowLocalTurnRecovery({
        ...timedOutTurn,
        agent: { adapterType: "http", adapterConfig: { url: "https://example.test/webhook" } },
        scheduledRetryReason: null,
      }),
    ).toBeNull();
  });
});

describe("the sentence the person reads", () => {
  it("uses plain words only", () => {
    expect(SLOW_LOCAL_TURN_HELD_NOTICE_BODY).not.toMatch(
      /\b(issue|issues|disposition|handoff|wake|heartbeat|continuation|run)\b/i,
    );
  });
});

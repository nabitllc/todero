// @vitest-environment node
import { describe, expect, it } from "vitest";
import { AGENT_DEFAULT_MAX_CONCURRENT_RUNS } from "@todero/shared";
import {
  buildNewAgentRuntimeConfig,
  CONVERSATIONAL_HEARTBEAT_INTERVAL_SEC,
} from "./new-agent-runtime-config";

describe("buildNewAgentRuntimeConfig", () => {
  it("defaults new agents to no timer heartbeat", () => {
    expect(buildNewAgentRuntimeConfig()).toEqual({
      heartbeat: {
        enabled: false,
        intervalSec: 300,
        wakeOnDemand: true,
        skipTimerWhenNoActionableWork: true,
        cooldownSec: 10,
        maxConcurrentRuns: AGENT_DEFAULT_MAX_CONCURRENT_RUNS,
      },
    });
  });

  it("preserves explicit heartbeat settings", () => {
    expect(
      buildNewAgentRuntimeConfig({
        heartbeatEnabled: true,
        intervalSec: 3600,
      }),
    ).toEqual({
      heartbeat: {
        enabled: true,
        intervalSec: 3600,
        wakeOnDemand: true,
        skipTimerWhenNoActionableWork: true,
        cooldownSec: 10,
        maxConcurrentRuns: AGENT_DEFAULT_MAX_CONCURRENT_RUNS,
      },
    });
  });

  it("stores cheap model under modelProfiles.cheap, not primary adapterConfig", () => {
    const config = buildNewAgentRuntimeConfig({
      heartbeatEnabled: true,
      intervalSec: 600,
      cheapModel: "claude-sonnet-4-6",
      cheapModelEnabled: true,
    });

    expect(config.modelProfiles).toEqual({
      cheap: {
        enabled: true,
        adapterConfig: { model: "claude-sonnet-4-6" },
      },
    });
    // primary heartbeat config still present
    expect(config.heartbeat).toMatchObject({ enabled: true, intervalSec: 600 });
  });

  it("keeps a conversational local model checking for work every two minutes", () => {
    const config = buildNewAgentRuntimeConfig({ conversational: true });
    expect(config.heartbeat).toMatchObject({
      enabled: true,
      intervalSec: CONVERSATIONAL_HEARTBEAT_INTERVAL_SEC,
      skipTimerWhenNoActionableWork: true,
      wakeOnDemand: true,
      maxConcurrentRuns: 1,
    });
  });

  it("takes as many threads at once as the machine can serve models", () => {
    expect(buildNewAgentRuntimeConfig({ conversational: true, parallelism: 3 }).heartbeat).toMatchObject({
      maxConcurrentRuns: 3,
    });
  });

  it("falls back to one thread when nothing reported what the machine can serve", () => {
    for (const parallelism of [null, undefined, 0, -2, Number.NaN]) {
      expect(buildNewAgentRuntimeConfig({ conversational: true, parallelism }).heartbeat).toMatchObject({
        maxConcurrentRuns: 1,
      });
    }
  });

  it("leaves a tool-using agent's settings alone", () => {
    expect(buildNewAgentRuntimeConfig({ parallelism: 4 }).heartbeat).toMatchObject({
      enabled: false,
      maxConcurrentRuns: AGENT_DEFAULT_MAX_CONCURRENT_RUNS,
    });
  });

  it("omits modelProfiles when no cheap model is configured", () => {
    const config = buildNewAgentRuntimeConfig({ heartbeatEnabled: false });
    expect(config.modelProfiles).toBeUndefined();
  });

  it("persists explicit cheap-profile opt-in when using the adapter default", () => {
    const config = buildNewAgentRuntimeConfig({
      cheapModelEnabled: true,
    });
    expect(config.modelProfiles).toEqual({
      cheap: {
        enabled: true,
        adapterConfig: {},
      },
    });
  });

  it("omits modelProfiles when cheap model is set but explicitly disabled", () => {
    const config = buildNewAgentRuntimeConfig({
      cheapModel: "claude-sonnet-4-6",
      cheapModelEnabled: false,
    });
    expect(config.modelProfiles).toBeUndefined();
  });
});

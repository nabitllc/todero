// @vitest-environment node
import { describe, expect, it } from "vitest";
import { readAgentTimer } from "./agent-timer";
import { CONVERSATIONAL_HEARTBEAT_INTERVAL_SEC } from "./new-agent-runtime-config";

describe("readAgentTimer", () => {
  it("returns null when there is no agent", () => {
    expect(readAgentTimer(null)).toBeNull();
    expect(readAgentTimer(undefined)).toBeNull();
  });

  it("reads an enabled timer and its interval", () => {
    expect(readAgentTimer({ runtimeConfig: { heartbeat: { enabled: true, intervalSec: 300 } } })).toEqual({
      enabled: true,
      intervalSec: 300,
    });
  });

  it("treats a missing or disabled timer as off", () => {
    expect(readAgentTimer({ runtimeConfig: {} })).toEqual({
      enabled: false,
      intervalSec: CONVERSATIONAL_HEARTBEAT_INTERVAL_SEC,
    });
    expect(readAgentTimer({ runtimeConfig: { heartbeat: { enabled: false, intervalSec: 60 } } })).toEqual({
      enabled: false,
      intervalSec: 60,
    });
  });

  it("falls back to the conversational interval when the stored one is unusable", () => {
    expect(readAgentTimer({ runtimeConfig: { heartbeat: { enabled: true, intervalSec: 0 } } })).toEqual({
      enabled: true,
      intervalSec: CONVERSATIONAL_HEARTBEAT_INTERVAL_SEC,
    });
    expect(readAgentTimer({ runtimeConfig: { heartbeat: { enabled: true, intervalSec: "soon" } } })).toEqual({
      enabled: true,
      intervalSec: CONVERSATIONAL_HEARTBEAT_INTERVAL_SEC,
    });
  });
});

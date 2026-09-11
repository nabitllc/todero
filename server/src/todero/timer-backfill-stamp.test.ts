import { describe, expect, it } from "vitest";
import {
  TIMER_CONFIGURED_STAMP_KEY,
  hasTimerConfiguredStamp,
  stampTimerConfiguredOnNewAgent,
} from "./timer-backfill-stamp.js";

const CHAT_ONLY = {
  adapterType: "http",
  adapterConfig: { url: "http://localhost:11434/v1/chat/completions" },
};
const NOW = new Date("2026-09-11T12:00:00.000Z");

describe("stampTimerConfiguredOnNewAgent", () => {
  it("stamps a chat-only local agent, so the startup backfill never touches it", () => {
    const heartbeat: Record<string, unknown> = { enabled: true, intervalSec: 120 };
    stampTimerConfiguredOnNewAgent(heartbeat, CHAT_ONLY, NOW);
    expect(heartbeat[TIMER_CONFIGURED_STAMP_KEY]).toBe("2026-09-11T12:00:00.000Z");
  });

  it("stamps one hired with the timer off too: that is a decision, not an omission", () => {
    const heartbeat: Record<string, unknown> = { enabled: false };
    stampTimerConfiguredOnNewAgent(heartbeat, CHAT_ONLY, NOW);
    expect(hasTimerConfiguredStamp({ heartbeat })).toBe(true);
  });

  it("leaves every other kind of agent unmarked", () => {
    for (const agent of [
      { adapterType: "process", adapterConfig: {} },
      { adapterType: "http", adapterConfig: { url: "https://example.test/webhook" } },
      { adapterType: "http", adapterConfig: null },
    ]) {
      const heartbeat: Record<string, unknown> = { enabled: true };
      stampTimerConfiguredOnNewAgent(heartbeat, agent, NOW);
      expect(heartbeat[TIMER_CONFIGURED_STAMP_KEY]).toBeUndefined();
    }
  });

  it("never overwrites a stamp that is already there", () => {
    const heartbeat: Record<string, unknown> = { [TIMER_CONFIGURED_STAMP_KEY]: "2026-01-01T00:00:00.000Z" };
    stampTimerConfiguredOnNewAgent(heartbeat, CHAT_ONLY, NOW);
    expect(heartbeat[TIMER_CONFIGURED_STAMP_KEY]).toBe("2026-01-01T00:00:00.000Z");
  });
});

describe("hasTimerConfiguredStamp", () => {
  it("reads through a runtime config of any shape", () => {
    expect(hasTimerConfiguredStamp(null)).toBe(false);
    expect(hasTimerConfiguredStamp({})).toBe(false);
    expect(hasTimerConfiguredStamp({ heartbeat: {} })).toBe(false);
    expect(hasTimerConfiguredStamp({ heartbeat: [] })).toBe(false);
    expect(hasTimerConfiguredStamp({ heartbeat: { [TIMER_CONFIGURED_STAMP_KEY]: "x" } })).toBe(true);
  });
});

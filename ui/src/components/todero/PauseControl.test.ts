import { describe, expect, it } from "vitest";
import { formatPausedSinceTime, instancePauseCaption, pauseButtonLabel, pauseCaption } from "./PauseControl";

describe("pauseButtonLabel", () => {
  it("reads Pause while the organization is working and Play while it is paused", () => {
    expect(pauseButtonLabel({ status: "active" })).toBe("Pause");
    expect(pauseButtonLabel({ status: "paused" })).toBe("Play");
    // An archived organization is not something Play puts back; the button
    // keeps the same reading as an active one rather than lying about it.
    expect(pauseButtonLabel({ status: "archived" })).toBe("Pause");
    expect(pauseButtonLabel(null)).toBe("Pause");
  });
});

describe("pauseCaption", () => {
  it("says the agents are working while active", () => {
    expect(pauseCaption({ status: "active", pausedAt: null })).toBe("Agents are working");
  });

  it("says since when while paused", () => {
    const pausedAt = new Date(2026, 8, 10, 10, 42);
    expect(pauseCaption({ status: "paused", pausedAt })).toBe(
      `Paused since ${formatPausedSinceTime(pausedAt)}`,
    );
  });

  it("falls back to the plain word when the time is missing or unreadable", () => {
    expect(pauseCaption({ status: "paused", pausedAt: null })).toBe("Paused");
    expect(pauseCaption({ status: "paused", pausedAt: new Date("not a date") })).toBe("Paused");
  });
});

describe("formatPausedSinceTime", () => {
  it("formats a local clock time and rejects what it cannot read", () => {
    const formatted = formatPausedSinceTime(new Date(2026, 8, 10, 10, 42));
    expect(formatted).toMatch(/10/);
    expect(formatted).toMatch(/42/);
    expect(formatPausedSinceTime(null)).toBeNull();
    expect(formatPausedSinceTime("nonsense")).toBeNull();
  });
});

describe("instancePauseCaption", () => {
  it("says everything is paused, and since when, only while the sidebar's Pause is on", () => {
    expect(instancePauseCaption(null)).toBe("Agents are working");
    expect(instancePauseCaption({ paused: false, pausedAt: null })).toBe("Agents are working");
    expect(instancePauseCaption({ paused: true, pausedAt: null })).toBe("Everything paused");
    expect(instancePauseCaption({ paused: true, pausedAt: "2026-09-10T10:42:00Z" })).toMatch(/^Everything paused since /);
  });
});

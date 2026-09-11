import { describe, expect, it } from "vitest";
import {
  buildExtraWorkerName,
  countReadyPlanTasks,
  decideExtraWorker,
  planFeatureKeys,
  readAgentParallelism,
} from "./orchestration-rules.js";

describe("decideExtraWorker", () => {
  it("adds an agent when two features can start and the machine serves two models", () => {
    const decision = decideExtraWorker({ readyTasks: 2, runningRuns: 0, parallelism: 2, workers: 1 });
    expect(decision.hire).toBe(true);
    expect(decision.reason).toContain("1 task");
  });

  it("does not add an agent when only one task can start", () => {
    expect(decideExtraWorker({ readyTasks: 1, runningRuns: 0, parallelism: 4, workers: 1 })).toEqual({
      hire: false,
      reason: "Every task that can start already has an agent for it.",
    });
  });

  it("does not add an agent when the machine serves one model at a time", () => {
    const decision = decideExtraWorker({ readyTasks: 6, runningRuns: 0, parallelism: 1, workers: 1 });
    expect(decision.hire).toBe(false);
    expect(decision.reason).toContain("one model at a time");
  });

  it("does not add an agent past what the machine can serve", () => {
    const decision = decideExtraWorker({ readyTasks: 9, runningRuns: 0, parallelism: 2, workers: 2 });
    expect(decision.hire).toBe(false);
    expect(decision.reason).toContain("2 models at a time");
  });

  it("counts runs already going against the ready work", () => {
    expect(decideExtraWorker({ readyTasks: 3, runningRuns: 2, parallelism: 4, workers: 1 }).hire).toBe(false);
    expect(decideExtraWorker({ readyTasks: 4, runningRuns: 2, parallelism: 4, workers: 1 }).hire).toBe(true);
  });

  it("never hires the first agent", () => {
    const decision = decideExtraWorker({ readyTasks: 5, runningRuns: 0, parallelism: 4, workers: 0 });
    expect(decision.hire).toBe(false);
    expect(decision.reason).toContain("Nobody is on this work yet");
  });

  it("treats nonsense numbers as nothing rather than throwing", () => {
    expect(decideExtraWorker({
      readyTasks: Number.NaN,
      runningRuns: -4,
      parallelism: Number.POSITIVE_INFINITY,
      workers: 1,
    }).hire).toBe(false);
  });
});

describe("planFeatureKeys", () => {
  it("lists the features in the order they first appear, ignoring case and spacing", () => {
    expect(
      planFeatureKeys([
        { feature: "Sign up" },
        { feature: "Pick a dinner" },
        { feature: " sign up " },
        { feature: "Pick a dinner" },
      ]),
    ).toEqual(["sign up", "pick a dinner"]);
  });

  it("treats tasks with no feature as one group", () => {
    expect(planFeatureKeys([{ feature: "" }, { feature: "  " }])).toEqual([""]);
  });
});

describe("countReadyPlanTasks", () => {
  it("counts only the tasks with nothing in front of them", () => {
    expect(
      countReadyPlanTasks([
        { blockedByTaskIds: [] },
        { blockedByTaskIds: [] },
        { blockedByTaskIds: ["t1"] },
      ]),
    ).toBe(2);
  });
});

describe("readAgentParallelism", () => {
  it("reads the saved limit", () => {
    expect(readAgentParallelism({ heartbeat: { maxConcurrentRuns: 3 } })).toBe(3);
  });

  it("answers one when the setting is missing or unreadable", () => {
    expect(readAgentParallelism(null)).toBe(1);
    expect(readAgentParallelism({})).toBe(1);
    expect(readAgentParallelism({ heartbeat: {} })).toBe(1);
    expect(readAgentParallelism({ heartbeat: { maxConcurrentRuns: "many" } })).toBe(1);
    expect(readAgentParallelism({ heartbeat: { maxConcurrentRuns: 0 } })).toBe(1);
  });
});

describe("buildExtraWorkerName", () => {
  it("names the added agent after the first one", () => {
    expect(buildExtraWorkerName("Ash")).toBe("Ash 2");
    expect(buildExtraWorkerName("  Ash  ")).toBe("Ash 2");
  });

  it("falls back to a plain name when the first agent has none", () => {
    expect(buildExtraWorkerName("   ")).toBe("Second agent");
  });
});

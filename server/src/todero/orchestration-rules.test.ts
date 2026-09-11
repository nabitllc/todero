import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ORCHESTRATION_RULES_DEFAULTS,
  buildExtraWorkerName,
  countReadyPlanTasks,
  decideExtraWorker,
  loadOrchestrationRules,
  pickExtraWorkerFeatureKey,
  planFeatureKeys,
  readAgentParallelism,
  readyPlanFeatureKeys,
} from "./orchestration-rules.js";

function entry(feature: string, blockedByTaskIds: string[] = []) {
  return { task: { feature }, blockedByTaskIds };
}

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

describe("readyPlanFeatureKeys", () => {
  it("lists only the features with work that can start now", () => {
    expect(
      readyPlanFeatureKeys([
        entry("Sign up"),
        entry("Sign up", ["t1"]),
        entry("Pick a dinner", ["t1"]),
        entry("Invite a friend"),
      ]),
    ).toEqual(["sign up", "invite a friend"]);
  });
});

describe("pickExtraWorkerFeatureKey", () => {
  it("hands over the second feature that can start, not the second one in the plan", () => {
    // Feature B waits on feature A, so B is not the one to hand over: C is.
    expect(
      pickExtraWorkerFeatureKey([
        entry("A"),
        entry("B", ["t1"]),
        entry("C"),
        entry("C", ["t3"]),
      ]),
    ).toBe("c");
  });

  it("hands over nothing when only one feature can start", () => {
    expect(pickExtraWorkerFeatureKey([entry("A"), entry("B", ["t1"]), entry("A", ["t1"])])).toBeNull();
  });

  it("hands over nothing when the two ready tasks are in the same feature", () => {
    expect(pickExtraWorkerFeatureKey([entry("A"), entry("A"), entry("B", ["t1"])])).toBeNull();
  });

  it("hands over the second feature when both start at once", () => {
    expect(pickExtraWorkerFeatureKey([entry("A"), entry("B"), entry("A", ["t1"])])).toBe("b");
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

describe("loadOrchestrationRules", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), "todero-orchestration-rules-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("loads the checked-in defaults from the real file", () => {
    expect(loadOrchestrationRules()).toEqual(ORCHESTRATION_RULES_DEFAULTS);
  });

  it("reads every field from a well-formed file", () => {
    const filePath = path.join(dir, "rules.json");
    writeFileSync(
      filePath,
      JSON.stringify({
        judgeAfterFirstPlan: false,
        extraWorkerWhenReadyTasksAbove: 5,
        neverMoreAgentsThanModelsServed: false,
        maxJudgeRounds: 4,
        busyTimerSec: 60,
      }),
      "utf8",
    );
    expect(loadOrchestrationRules(filePath)).toEqual({
      judgeAfterFirstPlan: false,
      extraWorkerWhenReadyTasksAbove: 5,
      neverMoreAgentsThanModelsServed: false,
      maxJudgeRounds: 4,
      busyTimerSec: 60,
    });
  });

  it("falls back to defaults field-by-field for a partial file", () => {
    const filePath = path.join(dir, "partial.json");
    writeFileSync(filePath, JSON.stringify({ busyTimerSec: 30 }), "utf8");
    expect(loadOrchestrationRules(filePath)).toEqual({
      ...ORCHESTRATION_RULES_DEFAULTS,
      busyTimerSec: 30,
    });
  });

  it("falls back to defaults for a wrong-typed field instead of throwing", () => {
    const filePath = path.join(dir, "wrong-type.json");
    writeFileSync(filePath, JSON.stringify({ maxJudgeRounds: "two" }), "utf8");
    expect(loadOrchestrationRules(filePath)).toEqual(ORCHESTRATION_RULES_DEFAULTS);
  });

  it("falls back to defaults for invalid JSON instead of throwing", () => {
    const filePath = path.join(dir, "broken.json");
    writeFileSync(filePath, "{ not json", "utf8");
    expect(loadOrchestrationRules(filePath)).toEqual(ORCHESTRATION_RULES_DEFAULTS);
  });

  it("falls back to defaults for a missing file instead of throwing", () => {
    expect(loadOrchestrationRules(path.join(dir, "missing.json"))).toEqual(
      ORCHESTRATION_RULES_DEFAULTS,
    );
  });
});

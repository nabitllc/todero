import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ORCHESTRATION_RULES_DEFAULTS, loadOrchestrationRules } from "./orchestration-rules.js";

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

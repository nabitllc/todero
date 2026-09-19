import { describe, expect, it } from "vitest";
import { readStructuredPlanPath } from "./structured-plan-path";

describe("which path produced a run's plan", () => {
  it("says the runtime held the shape", () => {
    const note = readStructuredPlanPath({ toderoStructuredPlan: "held" });

    expect(note?.path).toBe("held");
    expect(note?.label).toBe("Plan: shape held");
    expect(note?.description).toMatch(/shape/i);
  });

  it("says the model wrote the block itself", () => {
    expect(readStructuredPlanPath({ toderoStructuredPlan: "prose" })?.label).toBe("Plan: written by hand");
  });

  it("says the shape came back and did not hold", () => {
    const note = readStructuredPlanPath({ toderoStructuredPlan: "unreadable" });

    expect(note?.path).toBe("unreadable");
    expect(note?.label).toBe("Plan: shape did not hold");
  });

  it("is nothing for a run that was never asked for the shape", () => {
    expect(readStructuredPlanPath({ summary: "Here is the plan." })).toBeNull();
    expect(readStructuredPlanPath(null)).toBeNull();
    expect(readStructuredPlanPath({ toderoStructuredPlan: "something else" })).toBeNull();
  });
});

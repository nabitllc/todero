import { describe, expect, it } from "vitest";
import { buildOnboardingFirstTaskDescription } from "./onboarding-first-task";

describe("buildOnboardingFirstTaskDescription", () => {
  it("includes the typed mission and does not tell the agent to ask for a goal", () => {
    const text = buildOnboardingFirstTaskDescription("Ship the marketplace");
    expect(text).toContain("Ship the marketplace");
    expect(text).toContain("Company mission (from onboarding):");
    expect(text).not.toMatch(/Don't guess; ask/);
    expect(text).not.toMatch(/settle on one concrete goal/);
    expect(text).not.toMatch(/go straight to the questions/);
    expect(text).toContain("Do not ask what the company is for");
  });

  it("keeps the ask-for-a-goal prompt only when no mission was given", () => {
    const text = buildOnboardingFirstTaskDescription("   \n");
    expect(text).toMatch(/Don't guess; ask/);
    expect(text).toContain("settle on one concrete goal");
    expect(text).not.toContain("Company mission (from onboarding):");
  });
});

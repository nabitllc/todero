import { describe, expect, it } from "vitest";
import { onboardingQuestionSteps } from "./onboarding-steps";

describe("onboardingQuestionSteps", () => {
  it("asks a new organization for its mission first and its name second", () => {
    expect(onboardingQuestionSteps("create")).toEqual({
      buildsNewOrganization: true,
      missionStep: 1,
      nameStep: 2,
    });
  });

  it("treats a wizard opened without a path the same way", () => {
    // An instance with no organizations opens straight onto the questions,
    // skipping the front door, so the path is still null at that point.
    expect(onboardingQuestionSteps(null)).toEqual({
      buildsNewOrganization: true,
      missionStep: 1,
      nameStep: 2,
    });
  });

  it("leaves the grow path asking for the name first, with no mission screen", () => {
    expect(onboardingQuestionSteps("grow")).toEqual({
      buildsNewOrganization: false,
      missionStep: null,
      nameStep: 1,
    });
  });

  it("never puts both questions on the same step", () => {
    for (const path of ["create", "grow", null] as const) {
      const steps = onboardingQuestionSteps(path);
      expect(steps.missionStep).not.toBe(steps.nameStep);
    }
  });
});

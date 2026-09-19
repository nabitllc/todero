import { describe, expect, it } from "vitest";
import { onboardingQuestionSteps } from "./onboarding-steps";

describe("onboardingQuestionSteps", () => {
  it("asks a new organization for its mission first and its name second", () => {
    expect(onboardingQuestionSteps("create", 1)).toEqual({
      buildsNewOrganization: true,
      missionStep: 1,
      nameStep: 2,
    });
  });

  it("treats a wizard opened without a path the same way", () => {
    // An instance with no organizations opens straight onto the questions,
    // skipping the front door, so the path is still null at that point.
    expect(onboardingQuestionSteps(null, 0)).toEqual({
      buildsNewOrganization: true,
      missionStep: 1,
      nameStep: 2,
    });
  });

  it("leaves the grow path asking for the name first, with no mission screen", () => {
    expect(onboardingQuestionSteps("grow", 1)).toEqual({
      buildsNewOrganization: false,
      missionStep: null,
      nameStep: 1,
    });
  });

  it("keeps the mission on step 2 for a run the app sends there", () => {
    // The dashboard opens an existing company on the mission step by number.
    // That company has a name already, so there is no first question to move
    // ahead of it — the screen it was sent to has to be the one it gets.
    expect(onboardingQuestionSteps(null, 2)).toEqual({
      buildsNewOrganization: false,
      missionStep: 2,
      nameStep: 1,
    });
  });

  it("never puts both questions on the same step", () => {
    for (const path of ["create", "grow", null] as const) {
      for (const entryStep of [0, 1, 2, 3]) {
        const steps = onboardingQuestionSteps(path, entryStep);
        expect(steps.missionStep).not.toBe(steps.nameStep);
      }
    }
  });
});

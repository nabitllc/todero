import { describe, expect, it } from "vitest";
import { ONBOARDING_FIRST_TASK_ORIGIN_KIND } from "@todero/shared";
import { isOnboardingFirstTask, missionFromFirstTaskDescription } from "./work-item-adapter";

describe("onboarding first task on the work-item view", () => {
  it("recognizes the first task by its origin", () => {
    expect(isOnboardingFirstTask({ originKind: ONBOARDING_FIRST_TASK_ORIGIN_KIND })).toBe(true);
    expect(isOnboardingFirstTask({ originKind: undefined })).toBe(false);
    expect(isOnboardingFirstTask({ originKind: "plugin:x" })).toBe(false);
  });

  it("lifts the mission out of the conversational brief", () => {
    const description = [
      "You are this company's first agent. This task is a conversation.",
      "",
      "The company mission, as the person typed it:",
      "Track every Pokemon in my Pokemon Go collection and know which ones I am missing.",
      "",
      "Do not ask what the company is for; they already told you.",
    ].join("\n");
    expect(missionFromFirstTaskDescription(description)).toBe(
      "Track every Pokemon in my Pokemon Go collection and know which ones I am missing.",
    );
  });

  it("lifts the mission out of the tool-agent brief too", () => {
    const description = "You are the Todero agent.\n\nCompany mission (from onboarding):\nShip the marketplace.\n\nA greeting has already been posted.";
    expect(missionFromFirstTaskDescription(description)).toBe("Ship the marketplace.");
  });

  it("returns nothing when the brief carries no mission", () => {
    expect(missionFromFirstTaskDescription("You are the Todero agent. Ask what they want.")).toBe("");
    expect(missionFromFirstTaskDescription(null)).toBe("");
  });
});

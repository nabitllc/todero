import { describe, expect, it } from "vitest";
import {
  DEFAULT_TASK_TITLE,
  buildOnboardingFirstTaskDescription,
  buildOnboardingFirstTaskTitle,
} from "./onboarding-first-task";

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

describe("buildOnboardingFirstTaskTitle", () => {
  it("uses the typed mission instead of the generic Todero onboarding title", () => {
    expect(buildOnboardingFirstTaskTitle("Ship the marketplace")).toBe("Ship the marketplace");
    expect(buildOnboardingFirstTaskTitle("Ship the marketplace")).not.toBe(DEFAULT_TASK_TITLE);
  });

  it("falls back to the generic title only when no mission was given", () => {
    expect(buildOnboardingFirstTaskTitle("   \n")).toBe(DEFAULT_TASK_TITLE);
  });
});

describe("conversational first task", () => {
  it("gives a chat-only agent a brief it can follow: questions, then a prose plan, no tools", () => {
    const brief = buildOnboardingFirstTaskDescription("Ship the marketplace.", { conversational: true });
    expect(brief).toContain("Ship the marketplace.");
    expect(brief).toContain("at most three questions");
    expect(brief).toContain("propose one plan");
    expect(brief).toContain("```todero-plan");
    expect(brief).toContain("done_when:");
    expect(brief).not.toContain("request_checkbox_confirmation");
    expect(brief).not.toContain("plan` document");
    expect(brief).not.toContain("hire the checked agents");
    expect(brief).toContain("do not introduce yourself again");
  });

  it("asks for the mission first when none was typed", () => {
    const brief = buildOnboardingFirstTaskDescription("   ", { conversational: true });
    expect(brief).toContain("has not written a mission yet");
  });

  it("leaves the tool-agent brief unchanged by default", () => {
    expect(buildOnboardingFirstTaskDescription("Ship the marketplace.")).toContain("request_checkbox_confirmation");
  });
});

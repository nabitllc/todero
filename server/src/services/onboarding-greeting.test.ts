import { describe, expect, it } from "vitest";
import { buildOnboardingGreeting } from "./onboarding-greeting.js";

describe("buildOnboardingGreeting", () => {
  it("introduces the agent by name and promises questions, in one line", () => {
    const greeting = buildOnboardingGreeting({
      agentName: "Nova",
      teamName: "Acme",
      goals: "Launch a marketplace for local makers.",
    });

    expect(greeting).toBe(
      "Welcome! I'm Nova, your first agent teammate on Todero. Give me a moment to read the mission and I'll come back with a couple of questions.",
    );
  });

  it("does not quote the mission back: the title and the brief already carry it", () => {
    const greeting = buildOnboardingGreeting({ agentName: "Nova", goals: "Launch a marketplace for local makers." });
    expect(greeting).not.toContain("marketplace");
    expect(greeting).not.toContain("aiming for");
    expect(greeting).not.toContain("team of agents");
  });

  it("falls back to a generic teammate intro when no agent name is set", () => {
    const greeting = buildOnboardingGreeting({ agentName: null, goals: null });
    expect(greeting).toContain("Welcome! I'm your first agent teammate on Todero.");
    expect(greeting).toContain("couple of questions");
  });
});

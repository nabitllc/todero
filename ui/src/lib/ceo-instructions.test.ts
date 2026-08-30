import { describe, expect, it } from "vitest";
import {
  LEAD_HIRE_INSTRUCTIONS_ENTRY_FILE,
  buildLeadHireInstructionsBundle,
  composeCeoInstructions,
} from "./ceo-instructions";

const BASE = {
  companyName: "Initech",
  growPath: false,
  growWorkflows: "",
  growPainPoints: "",
  growAutomate: "",
  q1: "",
  q2: "",
  q3: "",
  q4: "",
};

describe("buildLeadHireInstructionsBundle", () => {
  it("puts the typed mission on AGENTS.md — the file hire materializes for the heartbeat", () => {
    const bundle = buildLeadHireInstructionsBundle({
      ...BASE,
      companyGoal: "Ship the marketplace",
    });
    expect(bundle.entryFile).toBe(LEAD_HIRE_INSTRUCTIONS_ENTRY_FILE);
    expect(bundle.files[LEAD_HIRE_INSTRUCTIONS_ENTRY_FILE]).toContain(
      "**Mission:** Ship the marketplace",
    );
    expect(bundle.files[LEAD_HIRE_INSTRUCTIONS_ENTRY_FILE]).toContain(
      "Do not re-ask the user for information they've already shared",
    );
  });

  it("fails if hire omits mission", () => {
    expect(() =>
      buildLeadHireInstructionsBundle({
        ...BASE,
        companyGoal: "  \n",
      }),
    ).toThrow(/Lead hire requires a company mission/);
  });
});

describe("composeCeoInstructions", () => {
  it("renders the mission under Company context", () => {
    expect(
      composeCeoInstructions({
        ...BASE,
        companyGoal: "Reach 1000 sellers",
      }),
    ).toContain("**Mission:** Reach 1000 sellers");
  });
});

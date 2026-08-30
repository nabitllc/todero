import { describe, expect, it } from "vitest";
import {
  pickRecommendedAgentName,
  RECOMMENDED_AGENT_NAMES,
} from "./onboarding-agent-names";

describe("pickRecommendedAgentName", () => {
  it("returns a name from the local list", () => {
    const picked = pickRecommendedAgentName("");
    expect(RECOMMENDED_AGENT_NAMES).toContain(picked);
  });

  it("does not immediately repeat the current name when the list has another option", () => {
    expect(RECOMMENDED_AGENT_NAMES.length).toBeGreaterThan(1);
    for (let i = 0; i < 40; i++) {
      const picked = pickRecommendedAgentName("Ada");
      expect(picked).not.toBe("Ada");
      expect(RECOMMENDED_AGENT_NAMES).toContain(picked);
    }
  });
});

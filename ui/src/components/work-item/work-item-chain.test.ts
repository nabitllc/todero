import { describe, expect, it } from "vitest";
import { chainOfWhy, MISSION_HREF, MISSION_LABEL } from "./work-item-chain";

const feature = { id: "goal-1", title: "Sign up screen", level: "feature" as const };

describe("chainOfWhy", () => {
  it("is empty when the task has no goal at all", () => {
    expect(chainOfWhy({ goal: null, taskTitle: "Write the copy" })).toEqual([]);
    expect(chainOfWhy({ goal: undefined, taskTitle: "Write the copy" })).toEqual([]);
  });

  it("is empty when the task hangs straight off the mission", () => {
    expect(
      chainOfWhy({ goal: { id: "g", title: "Grow", level: "company" }, taskTitle: "Write the copy" }),
    ).toEqual([]);
  });

  it("is empty for any other level of goal", () => {
    for (const level of ["team", "agent", "task"] as const) {
      expect(chainOfWhy({ goal: { id: "g", title: "x", level }, taskTitle: "t" })).toEqual([]);
    }
  });

  it("reads Mission › Feature › Task", () => {
    const chain = chainOfWhy({ goal: feature, taskTitle: "Write the copy" });
    expect(chain.map((link) => link.label)).toEqual([MISSION_LABEL, "Sign up screen", "Write the copy"]);
  });

  it("links the mission to the goals page and the feature to its own goal", () => {
    const chain = chainOfWhy({ goal: feature, taskTitle: "Write the copy" });
    expect(chain[0].href).toBe(MISSION_HREF);
    expect(chain[1].href).toBe("/goals/goal-1");
  });

  it("leaves the task itself without a link: you are already on it", () => {
    const chain = chainOfWhy({ goal: feature, taskTitle: "Write the copy" });
    expect(chain[2].href).toBeUndefined();
  });

  it("falls back rather than showing a blank crumb", () => {
    const chain = chainOfWhy({ goal: { ...feature, title: "   " }, taskTitle: "   " });
    expect(chain[1].label).toBe("Feature");
    expect(chain[2].label).toBe("This task");
  });
});

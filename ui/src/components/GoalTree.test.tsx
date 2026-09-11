import { describe, expect, it } from "vitest";
import type { Goal } from "@todero/shared";
import { goalStatusLabel, goalTaskCountLabel, type GoalTreeGoal } from "./GoalTree";

const goal = (overrides: Partial<GoalTreeGoal>): GoalTreeGoal =>
  ({
    id: "g1",
    companyId: "c1",
    title: "Sign up",
    description: null,
    level: "feature",
    status: "active",
    parentId: null,
    ownerAgentId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  }) as Goal as GoalTreeGoal;

describe("what a goal row says about its work", () => {
  it("counts the tasks under the goal", () => {
    expect(goalTaskCountLabel(goal({ taskCount: 5, doneTaskCount: 2 }))).toBe("2 of 5 tasks done");
  });

  it("uses the singular for one task", () => {
    expect(goalTaskCountLabel(goal({ taskCount: 1, doneTaskCount: 0 }))).toBe("0 of 1 task done");
  });

  it("says so plainly when nothing hangs off the goal", () => {
    expect(goalTaskCountLabel(goal({ taskCount: 0, doneTaskCount: 0 }))).toBe("No tasks");
  });

  it("says nothing at all when the caller has no counts", () => {
    expect(goalTaskCountLabel(goal({}))).toBeNull();
  });
});

describe("goal status in the product's words", () => {
  it("reads a finished goal as Done", () => {
    expect(goalStatusLabel("achieved")).toBe("Done");
    expect(goalStatusLabel("active")).toBe("In progress");
    expect(goalStatusLabel("planned")).toBe("Planned");
    expect(goalStatusLabel("cancelled")).toBe("Cancelled");
  });

  it("passes anything else through readably", () => {
    expect(goalStatusLabel("on_hold")).toBe("on hold");
  });
});

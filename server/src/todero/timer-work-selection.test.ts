import { describe, expect, it } from "vitest";
import {
  isActionableTimerWork,
  selectActionableTimerWork,
  TIMER_ACTIONABLE_ISSUE_STATUSES,
} from "./timer-work-selection.js";

describe("isActionableTimerWork", () => {
  it("picks up a To do task with nothing in its way", () => {
    expect(isActionableTimerWork({ id: "a", status: "todo", unresolvedBlockerCount: 0 })).toBe(true);
    expect(isActionableTimerWork({ id: "a", status: "in_progress", unresolvedBlockerCount: 0 })).toBe(true);
  });

  it("leaves a task that is still waiting on another task", () => {
    expect(isActionableTimerWork({ id: "a", status: "todo", unresolvedBlockerCount: 1 })).toBe(false);
  });

  it("leaves everything that is not open work", () => {
    for (const status of ["backlog", "blocked", "in_review", "done", "cancelled"]) {
      expect(isActionableTimerWork({ id: "a", status, unresolvedBlockerCount: 0 })).toBe(false);
    }
    expect([...TIMER_ACTIONABLE_ISSUE_STATUSES]).toEqual(["todo", "in_progress"]);
  });
});

describe("selectActionableTimerWork", () => {
  it("takes the first task the agent can actually start", () => {
    const picked = selectActionableTimerWork([
      { id: "blocked-one", status: "todo", unresolvedBlockerCount: 2 },
      { id: "ready-one", status: "todo", unresolvedBlockerCount: 0 },
      { id: "later-one", status: "in_progress", unresolvedBlockerCount: 0 },
    ]);
    expect(picked?.id).toBe("ready-one");
  });

  it("skips the tick when every task is waiting on something", () => {
    expect(
      selectActionableTimerWork([
        { id: "a", status: "todo", unresolvedBlockerCount: 1 },
        { id: "b", status: "backlog", unresolvedBlockerCount: 0 },
      ]),
    ).toBeNull();
    expect(selectActionableTimerWork([])).toBeNull();
  });
});

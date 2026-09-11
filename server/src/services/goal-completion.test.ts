import { describe, expect, it } from "vitest";
import {
  GOAL_STATUS_ACTIVE,
  GOAL_STATUS_DONE,
  nextFeatureGoalStatus,
} from "./goal-completion.js";

const tally = (taskCount: number, doneTaskCount: number) => ({ taskCount, doneTaskCount });

describe("nextFeatureGoalStatus", () => {
  it("closes the feature once every task under it is done", () => {
    expect(nextFeatureGoalStatus({ currentStatus: GOAL_STATUS_ACTIVE, tally: tally(3, 3) })).toBe(
      GOAL_STATUS_DONE,
    );
    expect(nextFeatureGoalStatus({ currentStatus: "planned", tally: tally(1, 1) })).toBe(
      GOAL_STATUS_DONE,
    );
  });

  it("leaves the feature alone while work is still open", () => {
    expect(nextFeatureGoalStatus({ currentStatus: GOAL_STATUS_ACTIVE, tally: tally(3, 2) })).toBeNull();
    expect(nextFeatureGoalStatus({ currentStatus: "planned", tally: tally(4, 0) })).toBeNull();
  });

  it("says nothing when the feature has no tasks yet", () => {
    expect(nextFeatureGoalStatus({ currentStatus: "planned", tally: tally(0, 0) })).toBeNull();
  });

  it("does not rewrite a feature that is already done", () => {
    expect(nextFeatureGoalStatus({ currentStatus: GOAL_STATUS_DONE, tally: tally(2, 2) })).toBeNull();
  });

  it("opens the feature again when a task comes back", () => {
    expect(nextFeatureGoalStatus({ currentStatus: GOAL_STATUS_DONE, tally: tally(2, 1) })).toBe(
      GOAL_STATUS_ACTIVE,
    );
  });

  it("never touches a feature somebody cancelled", () => {
    expect(nextFeatureGoalStatus({ currentStatus: "cancelled", tally: tally(2, 2) })).toBeNull();
    expect(nextFeatureGoalStatus({ currentStatus: "cancelled", tally: tally(2, 0) })).toBeNull();
  });
});

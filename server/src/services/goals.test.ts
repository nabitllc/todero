import { describe, expect, it } from "vitest";
import type { Db } from "@todero/db";
import { countTasksByGoal, rollUpTaskCounts, type GoalTaskCounts } from "./goals.js";

type CountRow = { goalId: string | null; taskCount: number | string; doneTaskCount: number | string };

/**
 * A stand-in for the database that answers the one grouped read
 * countTasksByGoal makes, so the counting itself can be checked without a
 * Postgres to talk to.
 */
function readerReturning(rows: CountRow[]) {
  const reader = {
    select: () => ({
      from: () => ({
        where: () => ({
          groupBy: async () => rows,
        }),
      }),
    }),
  };
  return reader as unknown as Pick<Db, "select">;
}

const counts = (entries: Record<string, [number, number]>): Map<string, GoalTaskCounts> =>
  new Map(
    Object.entries(entries).map(([id, [taskCount, doneTaskCount]]) => [id, { taskCount, doneTaskCount }]),
  );

describe("countTasksByGoal", () => {
  it("keys each goal's own tally by its goal id", async () => {
    const tallies = await countTasksByGoal(
      readerReturning([
        { goalId: "feature-1", taskCount: 3, doneTaskCount: 1 },
        { goalId: "feature-2", taskCount: 2, doneTaskCount: 2 },
      ]),
      "company-1",
    );

    expect(tallies.get("feature-1")).toEqual({ taskCount: 3, doneTaskCount: 1 });
    expect(tallies.get("feature-2")).toEqual({ taskCount: 2, doneTaskCount: 2 });
    expect(tallies.size).toBe(2);
  });

  it("leaves out the tasks that hang off no goal at all", async () => {
    const tallies = await countTasksByGoal(
      readerReturning([
        { goalId: null, taskCount: 5, doneTaskCount: 0 },
        { goalId: "feature-1", taskCount: 1, doneTaskCount: 1 },
      ]),
      "company-1",
    );

    expect([...tallies.keys()]).toEqual(["feature-1"]);
  });

  it("reads counts that come back from the database as strings", async () => {
    const tallies = await countTasksByGoal(
      readerReturning([{ goalId: "feature-1", taskCount: "4", doneTaskCount: "2" }]),
      "company-1",
    );

    expect(tallies.get("feature-1")).toEqual({ taskCount: 4, doneTaskCount: 2 });
  });
});

describe("rollUpTaskCounts", () => {
  it("adds the work under the features into the company goal above them", () => {
    const totals = rollUpTaskCounts(
      [
        { id: "company", parentId: null },
        { id: "feature-1", parentId: "company" },
        { id: "feature-2", parentId: "company" },
      ],
      counts({ "feature-1": [3, 1], "feature-2": [2, 2] }),
    );

    expect(totals.get("company")).toEqual({ taskCount: 5, doneTaskCount: 3 });
    expect(totals.get("feature-1")).toEqual({ taskCount: 3, doneTaskCount: 1 });
    expect(totals.get("feature-2")).toEqual({ taskCount: 2, doneTaskCount: 2 });
  });

  it("counts a goal's own tasks as well as the ones beneath it", () => {
    const totals = rollUpTaskCounts(
      [
        { id: "company", parentId: null },
        { id: "feature-1", parentId: "company" },
      ],
      counts({ company: [1, 0], "feature-1": [2, 2] }),
    );

    expect(totals.get("company")).toEqual({ taskCount: 3, doneTaskCount: 2 });
  });

  it("carries the totals all the way up a deeper tree", () => {
    const totals = rollUpTaskCounts(
      [
        { id: "company", parentId: null },
        { id: "team", parentId: "company" },
        { id: "feature-1", parentId: "team" },
      ],
      counts({ "feature-1": [4, 1] }),
    );

    expect(totals.get("team")).toEqual({ taskCount: 4, doneTaskCount: 1 });
    expect(totals.get("company")).toEqual({ taskCount: 4, doneTaskCount: 1 });
  });

  it("gives every goal a tally, even one with nothing under it", () => {
    const totals = rollUpTaskCounts([{ id: "company", parentId: null }], counts({}));

    expect(totals.get("company")).toEqual({ taskCount: 0, doneTaskCount: 0 });
  });

  it("stops at a parent that is not in the list", () => {
    const totals = rollUpTaskCounts(
      [{ id: "feature-1", parentId: "goal-from-another-company" }],
      counts({ "feature-1": [2, 1] }),
    );

    expect(totals.get("feature-1")).toEqual({ taskCount: 2, doneTaskCount: 1 });
    expect(totals.has("goal-from-another-company")).toBe(false);
  });

  it("does not spin forever when two goals point at each other", () => {
    const totals = rollUpTaskCounts(
      [
        { id: "one", parentId: "two" },
        { id: "two", parentId: "one" },
      ],
      counts({ one: [1, 1] }),
    );

    expect(totals.get("one")).toEqual({ taskCount: 1, doneTaskCount: 1 });
    expect(totals.get("two")).toEqual({ taskCount: 1, doneTaskCount: 1 });
  });
});

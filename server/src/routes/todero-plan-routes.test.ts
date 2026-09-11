import { describe, expect, it } from "vitest";
import { parseToderoPlanBlock } from "@todero/shared";
import { selectApprovedPlanTasks } from "./todero-plan-routes.js";

const PLAN = parseToderoPlanBlock(
  "```todero-plan\ngoal: Ship it\ntasks:\n  - title: One\n  - title: Two\n  - title: Three\n```",
)!.plan;

describe("selectApprovedPlanTasks", () => {
  it("keeps the ticked tasks in plan order", () => {
    expect(selectApprovedPlanTasks(PLAN, ["t3", "t1"]).map((t) => t.title)).toEqual(["One", "Three"]);
  });

  it("keeps everything when nothing was unticked", () => {
    expect(selectApprovedPlanTasks(PLAN, []).map((t) => t.title)).toEqual(["One", "Two", "Three"]);
    expect(selectApprovedPlanTasks(PLAN, null)).toHaveLength(3);
  });

  it("ignores ids the plan does not have", () => {
    expect(selectApprovedPlanTasks(PLAN, ["t2", "nope", " "]).map((t) => t.id)).toEqual(["t2"]);
  });
});

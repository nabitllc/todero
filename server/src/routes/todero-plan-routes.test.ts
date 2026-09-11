import { describe, expect, it } from "vitest";
import { parseToderoPlanBlock } from "@todero/shared";
import { buildPlanFeatureGoalDrafts, selectApprovedPlanTasks } from "./todero-plan-routes.js";

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

const FEATURE_PLAN = parseToderoPlanBlock(
  [
    "```todero-plan",
    "goal: Seat neighbors at weekend dinners",
    "features:",
    "  - name: Sign up",
    "    why: People need an account",
    "    done_when: A new person can sign up in under a minute",
    "  - name: Pick a dinner",
    "    why: Dinners are the product",
    "    done_when: A signed-in person can pick one upcoming dinner",
    "  - name: Nobody asked for this",
    "    why: Left over",
    "    done_when: Never",
    "tasks:",
    "  - title: Write the sign-up flow",
    "    feature: Sign up",
    "  - title: Draft the phone-code copy",
    "    feature: sign up",
    "  - title: List the dinners",
    "    feature: Pick a dinner",
    "  - title: Decide the launch city",
    "    feature: Launch",
    "  - title: Tidy the notes",
    "```",
  ].join("\n"),
)!.plan;

describe("buildPlanFeatureGoalDrafts", () => {
  it("makes one goal per feature that has work, in plan order", () => {
    const drafts = buildPlanFeatureGoalDrafts(FEATURE_PLAN, FEATURE_PLAN.tasks);
    expect(drafts.map((draft) => draft.title)).toEqual(["Sign up", "Pick a dinner", "Launch"]);
  });

  it("describes the goal with how we know the feature is finished", () => {
    const drafts = buildPlanFeatureGoalDrafts(FEATURE_PLAN, FEATURE_PLAN.tasks);
    expect(drafts[0]!.description).toBe("A new person can sign up in under a minute");
  });

  it("puts every task of a feature on the same goal, whatever the case", () => {
    const drafts = buildPlanFeatureGoalDrafts(FEATURE_PLAN, FEATURE_PLAN.tasks);
    expect(drafts[0]!.taskIds).toEqual(["t1", "t2"]);
  });

  it("still groups a feature the plan named only on a task", () => {
    const launch = buildPlanFeatureGoalDrafts(FEATURE_PLAN, FEATURE_PLAN.tasks).find(
      (draft) => draft.title === "Launch",
    );
    expect(launch?.description).toBeNull();
    expect(launch?.taskIds).toEqual(["t4"]);
  });

  it("leaves a task that names no feature on the company goal", () => {
    const drafts = buildPlanFeatureGoalDrafts(FEATURE_PLAN, FEATURE_PLAN.tasks);
    expect(drafts.flatMap((draft) => draft.taskIds)).not.toContain("t5");
  });

  it("drops a feature whose tasks were all unticked", () => {
    const kept = selectApprovedPlanTasks(FEATURE_PLAN, ["t3"]);
    expect(buildPlanFeatureGoalDrafts(FEATURE_PLAN, kept).map((draft) => draft.title)).toEqual([
      "Pick a dinner",
    ]);
  });
});

import { describe, expect, it } from "vitest";
import { descriptionWithWaitingMarker, WAITING_ON_YOU_MARKER } from "./conversation-thread.js";
import {
  allPlanChildrenClosed,
  buildPlanSummaryTurnInstruction,
  descriptionWithoutConversationMarkers,
  descriptionWithPlanMarker,
  descriptionWithReviewMarker,
  PLAN_PENDING_MARKER,
  planConversationOutcome,
  planReviewedOutcome,
  REVIEW_PENDING_MARKER,
} from "./conversation-outcome.js";

describe("planConversationOutcome", () => {
  it("sends a child task's done to the person for review instead of closing it", () => {
    const plan = planConversationOutcome({
      issue: { status: "in_progress", description: "<!-- todero-type: Task -->\nGoal: x\n", parentId: "parent" },
      disposition: "done",
    });
    expect(plan?.outcome).toBe("review");
    expect(plan?.status).toBe("blocked");
    expect(plan?.description).toContain(WAITING_ON_YOU_MARKER);
    expect(plan?.description).toContain(REVIEW_PENDING_MARKER);
  });

  it("closes the conversation on done only during the wrap-up turn, clearing every marker", () => {
    const plan = planConversationOutcome({
      issue: {
        status: "in_progress",
        description: `<!-- todero-type: Task -->\n${WAITING_ON_YOU_MARKER}\n${PLAN_PENDING_MARKER}\nMission\n`,
        parentId: null,
      },
      disposition: "done",
      closeAllowed: true,
    });
    expect(plan?.outcome).toBe("done");
    expect(plan?.status).toBe("done");
    expect(plan?.description).not.toContain(WAITING_ON_YOU_MARKER);
    expect(plan?.description).not.toContain(PLAN_PENDING_MARKER);
  });

  it("treats a mid-conversation done, or a done right after a plan, as handing the turn back", () => {
    const early = planConversationOutcome({
      issue: { status: "in_progress", description: "Mission", parentId: null },
      disposition: "done",
    });
    expect(early?.outcome).toBe("waiting");
    expect(early?.status).toBe("blocked");
    const withPlan = planConversationOutcome({
      issue: { status: "in_progress", description: "Mission", parentId: null },
      disposition: "done",
      proposedPlan: true,
      closeAllowed: true,
    });
    expect(withPlan?.outcome).toBe("waiting");
    expect(withPlan?.description).toContain(PLAN_PENDING_MARKER);
  });

  it("marks a waiting reply that carried a plan as plan pending", () => {
    const plan = planConversationOutcome({
      issue: { status: "in_progress", description: "Mission", parentId: null },
      disposition: "waiting",
      proposedPlan: true,
    });
    expect(plan?.outcome).toBe("waiting");
    expect(plan?.description).toContain(PLAN_PENDING_MARKER);
    expect(plan?.description).toContain(WAITING_ON_YOU_MARKER);
  });

  it("leaves a task the agent no longer owns alone", () => {
    expect(planConversationOutcome({ issue: { status: "blocked", description: "", parentId: "p" }, disposition: "done" })).toBeNull();
  });
});

describe("review and plan markers", () => {
  it("do not duplicate, can be removed, and sit right after waiting-on-you", () => {
    const once = descriptionWithReviewMarker("<!-- todero-type: Task -->\nBody\n", true);
    expect(descriptionWithReviewMarker(once, true)).toBe(once);
    expect(descriptionWithReviewMarker(once, false)).toBe("<!-- todero-type: Task -->\nBody\n");
    const both = descriptionWithPlanMarker(descriptionWithWaitingMarker("Body", true), true);
    expect(both.indexOf(WAITING_ON_YOU_MARKER)).toBeLessThan(both.indexOf(PLAN_PENDING_MARKER));
    expect(both.endsWith("Body")).toBe(true);
  });
});

describe("plan wrap-up turn", () => {
  it("fires only when every child is closed", () => {
    const children = [
      { identifier: "T-2", title: "Spec", status: "done" },
      { identifier: "T-3", title: "List", status: "cancelled" },
    ];
    expect(allPlanChildrenClosed(children)).toBe(true);
    expect(allPlanChildrenClosed([{ identifier: "T-4", title: "x", status: "todo" }])).toBe(false);
    expect(allPlanChildrenClosed([])).toBe(false);
    const turn = buildPlanSummaryTurnInstruction(children);
    expect(turn).toContain("- T-2 Spec (done)");
    expect(turn).toContain("STATUS: done");
  });
});

describe("planReviewedOutcome", () => {
  const handIn = planConversationOutcome({
    issue: { status: "in_progress", description: "<!-- todero-type: Task -->\nDraft it\n", parentId: "parent" },
    disposition: "done",
  })!;

  it("closes the task when the reviewer accepts, with no marker left behind", () => {
    const accepted = planReviewedOutcome(handIn, "accept");
    expect(accepted?.outcome).toBe("done");
    expect(accepted?.status).toBe("done");
    expect(accepted?.description).not.toContain(WAITING_ON_YOU_MARKER);
    expect(accepted?.description).not.toContain(REVIEW_PENDING_MARKER);
    expect(accepted?.description).not.toContain(PLAN_PENDING_MARKER);
    expect(accepted?.description).toContain("Draft it");
  });

  it("leaves the review gate standing for a hand-off and for no review at all", () => {
    expect(planReviewedOutcome(handIn, "handoff")).toEqual(handIn);
    expect(planReviewedOutcome(handIn, "none")).toEqual(handIn);
  });

  it("writes nothing when the reviewer already sent the task back", () => {
    expect(planReviewedOutcome(handIn, "revise")).toBeNull();
  });

  it("never touches an outcome that was not a hand-in", () => {
    const waiting = planConversationOutcome({
      issue: { status: "in_progress", description: "Mission", parentId: null },
      disposition: "waiting",
    })!;
    expect(planReviewedOutcome(waiting, "accept")).toEqual(waiting);
  });
});

describe("descriptionWithoutConversationMarkers", () => {
  it("strips every conversation marker and keeps the body", () => {
    const noisy = descriptionWithReviewMarker(
      descriptionWithPlanMarker(descriptionWithWaitingMarker("<!-- todero-type: Task -->\nBody", true), true),
      true,
    );
    const clean = descriptionWithoutConversationMarkers(noisy);
    expect(clean).not.toContain(WAITING_ON_YOU_MARKER);
    expect(clean).not.toContain(REVIEW_PENDING_MARKER);
    expect(clean).not.toContain(PLAN_PENDING_MARKER);
    expect(clean).toContain("Body");
    expect(clean).toContain("<!-- todero-type: Task -->");
  });
});

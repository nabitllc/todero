import { describe, expect, it } from "vitest";
import { descriptionWithWaitingMarker, WAITING_ON_YOU_MARKER } from "./conversation-thread.js";
import {
  allPlanChildrenClosed,
  buildPlanSummaryTurnInstruction,
  descriptionWithoutConversationMarkers,
  descriptionWithPlanMarker,
  descriptionWithReviewMarker,
  parseNextProjectLine,
  PLAN_PENDING_MARKER,
  planConversationOutcome,
  planReviewedOutcome,
  REVIEW_PENDING_MARKER,
  applyMissingPlanRecovery,
  buildStopAskingForPlanInstruction,
  descriptionWithPlanTries,
  hasGivenUpOnPlan,
  planMissingPlanRecovery,
  readPlanTries,
  type MissingPlanRecoveryDeps,
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
    expect(turn).toContain("Next:");
  });
});

describe("parseNextProjectLine", () => {
  it("reads the last Next: line in a wrap-up reply", () => {
    const reply = "Shipped the onboarding flow.\n\nNext: a billing dashboard\nSTATUS: done";
    expect(parseNextProjectLine(reply)).toBe("a billing dashboard");
  });

  it("returns null when there is no Next: line", () => {
    expect(parseNextProjectLine("All done here.\nSTATUS: done")).toBeNull();
  });

  it("ignores an earlier, unrelated use of the word next", () => {
    const reply = "The next step was already done.\nEverything shipped.\nSTATUS: done";
    expect(parseNextProjectLine(reply)).toBeNull();
  });

  it("returns null for a Next: line with nothing after the colon", () => {
    expect(parseNextProjectLine("Next:   \nSTATUS: done")).toBeNull();
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

/**
 * A local model that says "Do you approve this plan?" and writes no plan is
 * asking for an answer nobody can give: there is nothing on the task to
 * approve. Todero asks once more, and then stops asking.
 */
describe("a reply that asks to approve a plan that is not there", () => {
  const BRIEF = [
    "<!-- todero-type: Task -->",
    "You are this company's first agent.",
    "",
    "```todero-plan",
    "goal: One sentence.",
    "tasks:",
    "  - title: A task",
    "```",
    "",
    "Write for the person.",
  ].join("\n");

  function recovery(over: {
    description?: string;
    reply?: string;
    disposition?: "done" | "waiting";
    parentId?: string | null;
    planBlock?: string | null;
    steeredTurn?: boolean;
  } = {}) {
    return planMissingPlanRecovery({
      issue: {
        status: "in_progress",
        description: over.description ?? BRIEF,
        parentId: over.parentId ?? null,
      },
      disposition: over.disposition ?? "waiting",
      reply: over.reply ?? "I'm ready. Here's the revised plan:  Do you approve this plan?",
      planBlock: over.planBlock ?? null,
      steeredTurn: over.steeredTurn ?? false,
      agentName: "Nova",
    });
  }

  it("asks the model once more, and does not put the task in front of the person", () => {
    const first = recovery();
    expect(first?.kind).toBe("retry");
    expect(first?.description).not.toContain(WAITING_ON_YOU_MARKER);
    expect(first?.description).not.toContain(PLAN_PENDING_MARKER);
    expect(readPlanTries(first!.description)).toBe(1);
    if (first?.kind !== "retry") throw new Error("expected a retry");
    expect(first.instruction).toContain("```todero-plan");
    expect(first.instruction).toContain("goal:");
    expect(first.instruction).toContain("tasks:");
  });

  it("hands the task to the person after that one retry, and never asks again", () => {
    const first = recovery();
    const second = recovery({ description: first!.description });
    expect(second?.kind).toBe("hand-back");
    if (second?.kind !== "hand-back") throw new Error("expected a hand-back");
    expect(second.description).toContain(WAITING_ON_YOU_MARKER);
    expect(second.description).not.toContain(PLAN_PENDING_MARKER);
    expect(second.comment).toContain("Nova");
    expect(second.comment.toLowerCase()).not.toContain("todero-plan");
    expect(second.comment.toLowerCase()).not.toContain("marker");
    // A third round of the same reply is no longer the agent's to answer.
    expect(hasGivenUpOnPlan(second.description)).toBe(true);
    expect(recovery({ description: second.description })).toBeNull();
    expect(buildStopAskingForPlanInstruction()).toMatch(/do not/i);
  });

  it("counts the tries in the description, so they survive the run that made them", () => {
    const once = descriptionWithPlanTries(BRIEF, 1);
    expect(readPlanTries(once)).toBe(1);
    expect(readPlanTries(descriptionWithPlanTries(once, 2))).toBe(2);
    expect(descriptionWithPlanTries(once, 2).match(/todero-plan-tries/g)).toHaveLength(1);
    expect(readPlanTries(BRIEF)).toBe(0);
    expect(hasGivenUpOnPlan(once)).toBe(false);
  });

  it("stays out of the way of every reply that is not the planning turn", () => {
    // An ordinary hand-in that happens to use the word accept.
    expect(recovery({ reply: "Done. Please accept the config as handed in." })).toBeNull();
    // Talking about a plan without handing the turn over on one.
    expect(recovery({ reply: "The plan is going well so far. What colour do you want?" })).toBeNull();
    // A worker's task, not the conversation.
    expect(recovery({ parentId: "parent-1" })).toBeNull();
    // The plan did arrive.
    expect(recovery({ planBlock: "```todero-plan\ngoal: x\ntasks:\n  - title: y\n```" })).toBeNull();
    // The turn closed rather than handing over.
    expect(recovery({ disposition: "done" })).toBeNull();
    // A task that was never asked for a plan in the first place.
    expect(recovery({ description: "<!-- todero-type: Task -->\nWrite the launch email." })).toBeNull();
    // A wrap-up or manager turn Todero steered itself.
    expect(recovery({ steeredTurn: true })).toBeNull();
  });
});

describe("applyMissingPlanRecovery", () => {
  type Recorded = {
    updates: Array<{ issueId: string; patch: { status?: string; description?: string } }>;
    comments: Array<{ issueId: string; body: string }>;
    wakes: Array<{ issueId: string; agentId: string }>;
    logs: string[];
  };

  function deps(): { deps: MissingPlanRecoveryDeps; recorded: Recorded } {
    const recorded: Recorded = { updates: [], comments: [], wakes: [], logs: [] };
    return {
      recorded,
      deps: {
        updateIssue: async (issueId, patch) => {
          recorded.updates.push({ issueId, patch });
        },
        addComment: async (issueId, body) => {
          recorded.comments.push({ issueId, body });
        },
        wakeAgent: async (input) => {
          recorded.wakes.push(input);
        },
        log: (message) => recorded.logs.push(message),
      },
    };
  }

  it("sends the retry back to the agent without troubling the person", async () => {
    const { deps: d, recorded } = deps();
    await applyMissingPlanRecovery(d, {
      issueId: "issue-1",
      agentId: "agent-1",
      recovery: { kind: "retry", description: "body", instruction: "write it again" },
    });
    expect(recorded.updates).toEqual([{ issueId: "issue-1", patch: { status: "todo", description: "body" } }]);
    expect(recorded.wakes).toEqual([{ issueId: "issue-1", agentId: "agent-1" }]);
    expect(recorded.comments).toHaveLength(0);
  });

  it("hands the task to the person with one plain message, and wakes nobody", async () => {
    const { deps: d, recorded } = deps();
    await applyMissingPlanRecovery(d, {
      issueId: "issue-1",
      agentId: "agent-1",
      recovery: { kind: "hand-back", description: "body", comment: "Nova could not write the plan." },
    });
    expect(recorded.updates).toEqual([{ issueId: "issue-1", patch: { status: "blocked", description: "body" } }]);
    expect(recorded.comments).toEqual([{ issueId: "issue-1", body: "Nova could not write the plan." }]);
    expect(recorded.wakes).toHaveLength(0);
  });
});

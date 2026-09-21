import { describe, expect, it } from "vitest";
import { descriptionWithWaitingMarker, WAITING_ON_YOU_MARKER } from "./conversation-thread.js";
import {
  allPlanChildrenClosed,
  buildPlanSummaryTurnInstruction,
  descriptionForDeferredReview,
  descriptionWithDeferredReviewMarker,
  descriptionWithoutConversationMarkers,
  descriptionWithPlanMarker,
  descriptionWithReviewMarker,
  parseNextProjectLine,
  PLAN_PENDING_MARKER,
  planConversationOutcome,
  hasDeferredReviewMarker,
  planReviewedOutcome,
  REVIEW_PENDING_MARKER,
} from "./conversation-outcome.js";
import {
  applyMissingPlanRecovery,
  buildStopAskingForPlanInstruction,
  descriptionWithPlanTries,
  hasGivenUpOnPlan,
  planMissingPlanRecovery,
  readPlanTries,
  SYSTEM_NOTICE_PRESENTATION,
  type MissingPlanRecoveryDeps,
} from "./missing-plan-recovery.js";

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

  it("takes off the count of turns that produced nothing as well", () => {
    // The count is one of the things the task's text says about the
    // conversation, so a task that closes carries none of it. Without this, a
    // closed task that someone comments on comes back carrying a count from
    // before it ever handed work in.
    const clean = descriptionWithoutConversationMarkers(
      "<!-- todero-empty-turns: 1 -->\n<!-- todero-type: Task -->\nBody",
    );
    expect(clean).not.toContain("todero-empty-turns");
    expect(clean).toContain("Body");
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
    conversationHasPlan?: boolean;
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
      conversationHasPlan: over.conversationHasPlan ?? false,
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

  it("catches the ways a model really writes this", () => {
    const asks = [
      "Here's the plan above. Please confirm and I'll get started.",
      "Please review the plan above and let me know if it works for you.",
      "Shall I proceed with this plan?",
      "If you're happy with the plan, say go.",
      "Here is the plan: do you approve?",
      "Thanks! Here is the plan:\n\n1. Research\n2. Build\n\nPlease confirm and I will get started.",
      "Do you approve this plan?",
      "I've written the plan out above.\n\nLet me know if this works for you and I'll begin.",
      // Sampled from real qwen2.5-coder:14b planning replies: the commonest
      // closing of all, and the three next most common, none of which the
      // first cut of this rescue caught.
      "Would you like to proceed with this plan?",
      "Here is the plan:\n\n1. Set up the repo\n2. Ship the page\n\nDo you want me to proceed?",
      "Does this plan work for you? Let me know and I'll get going.",
      "Here's the plan. Let me know if you'd like any changes before I start.",
      // Verbatim closings from twenty sampled qwen2.5-coder:14b planning
      // replies. Eleven of the twenty close on "review the plan and let me
      // know if you need any changes" — the commonest hand-over there is.
      "Please review the plan and let me know if you need any changes or additions.",
      "Please review the plan and let me know if you need any adjustments or further details.",
      "Please review the plan and let me know if any changes or additions are needed.",
      "Please review the plan and let me know if you have any feedback or additional requirements.",
      "Please review the above plan and provide your approval.",
      "Would you like to proceed with this plan, or do you have any specific changes or additions?",
    ];
    for (const reply of asks) {
      expect(recovery({ reply })?.kind, reply).toBe("retry");
    }
  });

  it("catches a plan whose block did not parse, however long the block ran", () => {
    // Verified against the parser before this test was written: both of these
    // blocks come back from `parseToderoPlanBlock` as null — the first has no
    // `goal:` line at all, the second calls it `objective:` — so the task is
    // left with nothing to approve. Both run past the closing-lines window,
    // which is the only reason the detector used to miss them: the block, not
    // the sign-off, filled the lines it was reading.
    const unparsable = [
      [
        "```",
        "1. Set up the repository and tooling",
        "2. Build the hero section",
        "3. Build the menu list",
        "4. Wire up the contact form",
        "5. Add the photo gallery",
        "6. Write the copy",
        "7. Deploy to staging",
        "8. Launch",
        "```",
      ].join("\n"),
      [
        "```todero-plan",
        "objective: Ship a landing page for the bakery.",
        "features:",
        "  - name: Hero section",
        "    why: First thing a visitor sees",
        "    done_when: The hero renders",
        "  - name: Menu list",
        "    why: People want the menu",
        "    done_when: Prices show",
        "  - name: Contact form",
        "    why: Orders come in",
        "    done_when: Mail arrives",
        "```",
      ].join("\n"),
    ];
    for (const block of unparsable) {
      const reply = [
        "Sure, here's the plan:",
        "",
        block,
        "",
        "Please review and let me know if any changes are needed.",
      ].join("\n");
      expect(recovery({ reply })?.kind, block.split("\n")[0]).toBe("retry");
    }
  });

  it("leaves a conversation that already made a plan alone, whatever the reply says", () => {
    // The plan was approved long ago and its tasks may already be finished:
    // there is no loop to rescue, and demanding a fresh plan block would
    // restart a step that is over. Every ask, old pattern or new, is quiet.
    const asks = [
      "I'm ready. Here's the revised plan:  Do you approve this plan?",
      "Please review the plan and let me know if you need any changes.",
      "Would you like to proceed with this plan?",
    ];
    for (const reply of asks) {
      expect(recovery({ reply })?.kind, reply).toBe("retry");
      expect(recovery({ reply, conversationHasPlan: true }), reply).toBeNull();
    }
  });

  it("leaves ordinary replies alone, however they are worded", () => {
    const ordinary = [
      "Done. Please accept the config as handed in.",
      "The plan is going well so far. What colour do you want?",
      "I've pushed the change. Let me know if you have any questions.",
      "Please confirm the address before I send the invoice.",
      "The deployment plan document is in the repo already.",
      // Widening "review the plan" must not swallow these: a plan already
      // settled and a sign-off that only invites questions.
      "The plan is live now. Let me know if you have any questions.",
      "I reviewed the plan document and it is out of date. Which version should I use?",
      // Taking the fenced block out of the closing lines must not turn an
      // ordinary hand-in into a plan: nothing here names a plan.
      [
        "Here's the diff from this round:",
        "",
        "```diff",
        "- const a = 1;",
        "+ const a = 2;",
        "- const b = 3;",
        "+ const b = 4;",
        "- const c = 5;",
        "+ const c = 6;",
        "- const d = 7;",
        "+ const d = 8;",
        "```",
        "",
        "Let me know if you need any changes.",
      ].join("\n"),
    ];
    for (const reply of ordinary) {
      expect(recovery({ reply }), reply).toBeNull();
    }
  });

  it("leaves a progress reply that names the plan alone, long block and all", () => {
    // The work is under way and the plan was agreed rounds ago. Each of these
    // names the plan, writes a block longer than the closing-lines window and
    // signs off politely. Reading the closing lines with the block taken out
    // brings the naming and the sign-off back together, so the block must not
    // be the only thing keeping them apart: the sentence has to be putting a
    // plan forward, not reporting on one that already exists.
    const block = [
      "```diff",
      "- const a = 1;",
      "+ const a = 2;",
      "- const b = 3;",
      "+ const b = 4;",
      "- const c = 5;",
      "+ const c = 6;",
      "- const d = 7;",
      "+ const d = 8;",
      "- const e = 9;",
      "+ const e = 10;",
      "- const f = 11;",
      "+ const f = 12;",
      "```",
    ].join("\n");
    const progress = [
      ["I finished implementing the plan we agreed on.", "", block, "", "Let me know if you need any changes."],
      ["Step 2 of the plan is done and the tests pass.", "", block, "", "Let me know if you want any tweaks."],
      ["I followed the plan document.", "", block, "", "Does this work for you?"],
    ];
    for (const lines of progress) {
      expect(recovery({ reply: lines.join("\n") }), lines[0]).toBeNull();
    }
  });
});

describe("applyMissingPlanRecovery", () => {
  type Recorded = {
    updates: Array<{ issueId: string; patch: { status?: string; description?: string } }>;
    comments: Array<{ issueId: string; body: string; presentation: unknown }>;
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
        addComment: async (issueId, body, presentation) => {
          recorded.comments.push({ issueId, body, presentation });
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
      recovery: {
        kind: "retry",
        description: "body",
        instruction: "write it again",
        fallback: { description: "stalled body", comment: "Nova could not be started again." },
      },
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
    expect(recorded.comments).toEqual([
      {
        issueId: "issue-1",
        body: "Nova could not write the plan.",
        presentation: SYSTEM_NOTICE_PRESENTATION,
      },
    ]);
    expect(recorded.wakes).toHaveLength(0);
  });

  /**
   * The echo seen live: Todero's own "stuck on the plan" message was posted
   * under the agent's name with no presentation, so the thread builder fed it
   * straight back and the 14B read its own hand-back as conversation and said
   * it again to the person. A system notice is the marking the thread builder
   * already drops.
   */
  it("posts Todero's own hand-back as a system notice, so it never returns as the agent's words", async () => {
    const { deps: d, recorded } = deps();
    await applyMissingPlanRecovery(d, {
      issueId: "issue-1",
      agentId: "agent-1",
      recovery: { kind: "hand-back", description: "body", comment: "Nova is stuck on the plan." },
    });
    expect(recorded.comments.at(-1)?.presentation).toEqual(SYSTEM_NOTICE_PRESENTATION);
    expect((recorded.comments.at(-1)?.presentation as { kind?: string } | undefined)?.kind).toBe("system_notice");
  });

  it("puts the task in front of the person when the agent cannot be brought back", async () => {
    const { deps: d, recorded } = deps();
    d.wakeAgent = async () => {
      throw new Error("the queue is down");
    };
    const kind = await applyMissingPlanRecovery(d, {
      issueId: "issue-1",
      agentId: "agent-1",
      recovery: {
        kind: "retry",
        description: "body",
        instruction: "write it again",
        fallback: { description: "stalled body", comment: "Nova could not be started again." },
      },
    });
    expect(kind).toBe("hand-back");
    // Never left sitting in todo with nobody told.
    expect(recorded.updates.at(-1)).toEqual({
      issueId: "issue-1",
      patch: { status: "blocked", description: "stalled body" },
    });
    expect(recorded.comments).toEqual([
      {
        issueId: "issue-1",
        body: "Nova could not be started again.",
        presentation: SYSTEM_NOTICE_PRESENTATION,
      },
    ]);
  });
});

/**
 * Wave 18: a hand-in handed in while the organization was on hold keeps a note
 * that a reviewer still owes it an answer. Play reads that note back.
 */
describe("the note a deferred review leaves on the task", () => {
  it("says the task is with the person, in review, and still owed an answer", () => {
    const written = descriptionForDeferredReview("<!-- todero-type: Task -->\nDraft the guide.");
    expect(hasDeferredReviewMarker(written)).toBe(true);
    expect(written).toContain(WAITING_ON_YOU_MARKER);
    expect(written).toContain(REVIEW_PENDING_MARKER);
    expect(written).toContain("Draft the guide.");
    expect(written).toContain("<!-- todero-type: Task -->");
  });

  it("says the same thing when the hand-in already wrote its own two notes", () => {
    const handedIn = descriptionWithReviewMarker(descriptionWithWaitingMarker("Draft the guide.", true), true);
    expect(descriptionForDeferredReview(handedIn)).toBe(descriptionForDeferredReview("Draft the guide."));
  });

  it("can be taken off again without losing the other two", () => {
    const written = descriptionForDeferredReview("Draft the guide.");
    const cleared = descriptionWithDeferredReviewMarker(written, false);
    expect(hasDeferredReviewMarker(cleared)).toBe(false);
    expect(cleared).toContain(WAITING_ON_YOU_MARKER);
    expect(cleared).toContain(REVIEW_PENDING_MARKER);
  });

  it("is gone once the task closes", () => {
    const written = descriptionForDeferredReview("Draft the guide.");
    expect(hasDeferredReviewMarker(descriptionWithoutConversationMarkers(written))).toBe(false);
  });

  it("is not there on a task nobody deferred", () => {
    expect(hasDeferredReviewMarker("Draft the guide.")).toBe(false);
    expect(hasDeferredReviewMarker(null)).toBe(false);
  });
});

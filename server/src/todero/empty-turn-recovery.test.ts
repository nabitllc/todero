// A turn that delivered nothing and asked for nothing: what Todero does with
// it. Wave 4 of the improvement loop; the two replies below are the real ones
// from wave 19, organization f6e02c4b-a9d6-4dcf-a397-ecaf6eab83d3.
import { describe, expect, it } from "vitest";
import {
  applyEmptyTurnRecovery,
  buildEmptyTurnHandBackComment,
  buildEmptyTurnRetryComment,
  buildEmptyTurnRetryInstruction,
  descriptionWithEmptyTurnTries,
  EMPTY_TURN_MAX_TRIES,
  EMPTY_TURN_RETRY_WAKE_REASON,
  planEmptyTurnOutcome,
  planEmptyTurnRecovery,
  readEmptyTurnTries,
  turnDeliversWork,
  emptyTurnInstructionForWake,
} from "./empty-turn-recovery.js";
import { planConversationOutcome, planReviewedOutcome } from "./conversation-outcome.js";

const BRIEF = "<!-- todero-type: Task -->\nGoal: Create four one-page guides.";

/** ZZGAAAAAAAAA-4's retry: the task brief read back, with no guide in it. */
const PARROTED_BRIEF = [
  "**ZZGAAAAAAAAA-4**",
  "- **Goal:** Create four one-page guides for houseplants that survive a dark flat.",
  "- **Feature:** Draft guides — To produce the initial content for the one-page guides.",
  "- **Done when:** Four drafts, each naming the plant, the light it needs, and how often to water it.",
  "- **What the person said:** Must have: the four one-page guides, each naming the plant, the light it needs, and how often to water it. Everything else can wait.",
  "- **Last verdict:** The review said the second guide draft must include information for three additional houseplants. Check it before you start.",
].join("\n");

/** ZZGAAAAAAAAA-11's retry: an action list about the work, and no work. */
const NEXT_STEPS_LIST = [
  "**Final Review and Next Steps:**",
  "",
  "- **Review Status:** The first guide for the Snake Plant (Sansevieria) has been finalized and formatted. It meets the criteria of being one page and ready for distribution.",
  "- **Next Steps:** We need to finalize and format the remaining three guides for the other three houseplants.",
  "",
  "**Action Required:**",
  "",
  "1. Proceed with finalizing and formatting the guides for the remaining three houseplants.",
  "2. Ensure each guide includes the plant name, light needs, watering frequency, and additional care instructions.",
  "3. Hand in the first finalized guide as specified in the task.",
].join("\n");

/** What the task was actually asked for, and did hand in once. */
const A_REAL_GUIDE = [
  "**Pothos (Epipremnum aureum)**",
  "- **Light Needs:** Can thrive in low light conditions but prefers bright, indirect light.",
  "- **Watering Needs:** Water when the top inch of soil is dry. Allow the soil to dry out completely between waterings.",
].join("\n");

const child = (description: string) => ({ status: "in_progress", description, parentId: "parent" });

describe("turnDeliversWork", () => {
  it("says no to a turn that only reads the task back", () => {
    expect(turnDeliversWork(PARROTED_BRIEF)).toBe(false);
  });

  it("says no to a turn that is only what should happen next", () => {
    expect(turnDeliversWork(NEXT_STEPS_LIST)).toBe(false);
  });

  it("says yes to the guide itself", () => {
    expect(turnDeliversWork(A_REAL_GUIDE)).toBe(true);
  });

  it("says yes to the guide even when next steps are tacked on the end", () => {
    expect(turnDeliversWork(`${A_REAL_GUIDE}\n\n**Next Steps:**\n\n1. Draft the third guide.`)).toBe(true);
  });

  it("says yes to a short hand-in written under a label", () => {
    // A worker that writes "Output:" and then the thing has handed the thing
    // in. The label was being struck out with the line under it, so a whole
    // hand-in could read as empty and cost a corrective turn nobody needed.
    expect(turnDeliversWork("Output: Snake plant — low light, water every 2 weeks.")).toBe(true);
    expect(turnDeliversWork("Progress: Ten restaurants chosen, all within a mile of downtown.")).toBe(true);
    // A label with nothing under it is still nothing.
    expect(turnDeliversWork("Output:")).toBe(false);
    expect(turnDeliversWork("Status:\nProgress:")).toBe(false);
    // Twenty characters is the bar, not forty: a plant, the light it needs and
    // how often to water it is the whole of what one of these tasks was asked
    // for, and it fits in thirty-three.
    expect(turnDeliversWork("Output: Pothos, low light, water monthly.")).toBe(true);
    // The task read back is still the task read back, however long it is.
    expect(turnDeliversWork(PARROTED_BRIEF)).toBe(false);
  });

  it("says no to nothing at all", () => {
    expect(turnDeliversWork("")).toBe(false);
    expect(turnDeliversWork("   \n\n  ")).toBe(false);
  });
});

describe("planEmptyTurnOutcome", () => {
  it("asks once more the first time, and parks it the second", () => {
    expect(
      planEmptyTurnOutcome({ issue: child(BRIEF), disposition: "waiting", reply: PARROTED_BRIEF }),
    ).toBe("retry");
    const asked = descriptionWithEmptyTurnTries(BRIEF, EMPTY_TURN_MAX_TRIES);
    expect(
      planEmptyTurnOutcome({ issue: child(asked), disposition: "waiting", reply: PARROTED_BRIEF }),
    ).toBe("waiting");
  });

  it("leaves a turn that asks the person something exactly where it is", () => {
    expect(
      planEmptyTurnOutcome({
        issue: child(BRIEF),
        disposition: "waiting",
        reply: "Which four plants should the guides cover?",
      }),
    ).toBe("waiting");
  });

  it("leaves a short question alone, where only the asking can save it", () => {
    // A long question is left alone twice over: it asks, and it is long enough
    // to read as a hand-in. A short one is only ever saved by the asking, so
    // this is the case that proves a question is what is being looked for.
    const shortQuestion = "Which four plants?";
    expect(turnDeliversWork(shortQuestion)).toBe(false);
    expect(
      planEmptyTurnOutcome({ issue: child(BRIEF), disposition: "waiting", reply: shortQuestion }),
    ).toBe("waiting");
    expect(
      planEmptyTurnRecovery({ issue: child(BRIEF), disposition: "waiting", reply: shortQuestion }),
    ).toBeNull();
  });

  it("leaves a turn that handed work in exactly where it is", () => {
    expect(
      planEmptyTurnOutcome({ issue: child(BRIEF), disposition: "waiting", reply: A_REAL_GUIDE }),
    ).toBe("waiting");
  });

  it("never retries the conversation task: its turn is the person's by design", () => {
    expect(
      planEmptyTurnOutcome({
        issue: { status: "in_progress", description: BRIEF, parentId: null },
        disposition: "waiting",
        reply: PARROTED_BRIEF,
      }),
    ).toBe("waiting");
  });

  it("has nothing to say about a turn that finished", () => {
    expect(
      planEmptyTurnOutcome({ issue: child(BRIEF), disposition: "done", reply: PARROTED_BRIEF }),
    ).toBe("waiting");
  });
});

describe("the count of empty turns", () => {
  it("is kept on the task and read back", () => {
    expect(readEmptyTurnTries(BRIEF)).toBe(0);
    const once = descriptionWithEmptyTurnTries(BRIEF, 1);
    expect(readEmptyTurnTries(once)).toBe(1);
    expect(once).toContain("Goal: Create four one-page guides.");
    // Written again, not twice.
    expect(readEmptyTurnTries(descriptionWithEmptyTurnTries(once, 2))).toBe(2);
    expect(descriptionWithEmptyTurnTries(once, 2).match(/todero-empty-turns/g)).toHaveLength(1);
    // Back to nothing once the task hands real work in.
    expect(descriptionWithEmptyTurnTries(once, 0)).not.toContain("todero-empty-turns");
  });

  it("is gone from the text a reviewer's accept closes the task with", () => {
    // The accept writes the task's text back from the copy the hand-in was
    // planned with, which was taken before the hand-in write cleared the
    // count. Closing the task is what takes it off for good.
    const handIn = planConversationOutcome({
      issue: {
        status: "in_progress",
        description: descriptionWithEmptyTurnTries(BRIEF, 1),
        parentId: "parent",
      },
      disposition: "done",
    })!;
    expect(handIn.outcome).toBe("review");
    expect(readEmptyTurnTries(handIn.description)).toBe(1);
    expect(readEmptyTurnTries(planReviewedOutcome(handIn, "accept")!.description)).toBe(0);
  });

  it("does not follow a closed task back into a new turn", () => {
    // The four steps that cost a task its one corrective turn:
    // 1. a turn that produced nothing, so the count stands at one;
    const afterAnEmptyTurn = descriptionWithEmptyTurnTries(BRIEF, 1);
    // 2. a turn that handed a real guide in — planned from the text above,
    //    which is what the reviewer is later handed;
    const handIn = planConversationOutcome({
      issue: { status: "in_progress", description: afterAnEmptyTurn, parentId: "parent" },
      disposition: "done",
    })!;
    // 3. the reviewer passes it and this organization closes on a pass, so
    //    nothing else writes the task's text in between;
    const closed = planReviewedOutcome(handIn, "accept")!;
    expect(closed.status).toBe("done");
    // 4. the person comments on the closed task, which sets it going again
    //    with the text it closed with, and that turn produces nothing.
    expect(
      planEmptyTurnOutcome({
        issue: { status: "in_progress", description: closed.description, parentId: "parent" },
        disposition: "waiting",
        reply: PARROTED_BRIEF,
      }),
    ).toBe("retry");
  });
});

describe("planEmptyTurnRecovery", () => {
  it("asks once more, off the person's desk, the first time", () => {
    const recovery = planEmptyTurnRecovery({
      issue: child(BRIEF),
      disposition: "waiting",
      reply: PARROTED_BRIEF,
    });
    expect(recovery?.kind).toBe("retry");
    if (recovery?.kind !== "retry") throw new Error("expected a retry");
    expect(readEmptyTurnTries(recovery.description)).toBe(1);
    expect(recovery.description).not.toContain("waiting-on-you");
    expect(recovery.instruction).toBe(buildEmptyTurnRetryInstruction());
    expect(recovery.comment).toBe(buildEmptyTurnRetryComment());
    expect(recovery.fallback.description).toContain("waiting-on-you");
  });

  it("puts it in front of the person the second time, and says why", () => {
    const recovery = planEmptyTurnRecovery({
      issue: child(descriptionWithEmptyTurnTries(BRIEF, EMPTY_TURN_MAX_TRIES)),
      disposition: "waiting",
      reply: NEXT_STEPS_LIST,
      agentName: "Sam",
    });
    expect(recovery?.kind).toBe("hand-back");
    if (recovery?.kind !== "hand-back") throw new Error("expected a hand-back");
    expect(recovery.description).toContain("waiting-on-you");
    expect(readEmptyTurnTries(recovery.description)).toBe(EMPTY_TURN_MAX_TRIES + 1);
    expect(recovery.comment).toBe(buildEmptyTurnHandBackComment("Sam"));
    expect(recovery.comment).toContain("twice");
  });

  it("does not say it a third time", () => {
    expect(
      planEmptyTurnRecovery({
        issue: child(descriptionWithEmptyTurnTries(BRIEF, EMPTY_TURN_MAX_TRIES + 1)),
        disposition: "waiting",
        reply: PARROTED_BRIEF,
      }),
    ).toBeNull();
  });

  it("has nothing to do with an ordinary reply", () => {
    expect(
      planEmptyTurnRecovery({ issue: child(BRIEF), disposition: "waiting", reply: A_REAL_GUIDE }),
    ).toBeNull();
  });
});

describe("what Todero says", () => {
  it("asks for the thing itself, in plain words", () => {
    const instruction = buildEmptyTurnRetryInstruction();
    expect(instruction).toContain("not a summary of the task");
    expect(instruction).toContain("STATUS: done");
    expect(instruction).not.toMatch(/todero-|marker/i);
  });

  it("tells the person what happened without shop talk", () => {
    expect(buildEmptyTurnRetryComment()).toContain("asking it once more");
    const handBack = buildEmptyTurnHandBackComment(null);
    expect(handBack).toContain("twice");
    expect(handBack).not.toMatch(/todero-|marker|disposition/i);
  });
});

describe("applyEmptyTurnRecovery", () => {
  function recorder() {
    const calls: string[] = [];
    return {
      calls,
      deps: {
        updateIssue: async (id: string, patch: { status?: string; description?: string }) => {
          calls.push(`update ${id} ${patch.status}`);
        },
        addComment: async (id: string, body: string) => {
          calls.push(`comment ${id} ${body.slice(0, 20)}`);
        },
        wakeAgent: async (input: { issueId: string; agentId: string }) => {
          calls.push(`wake ${input.agentId}`);
        },
        log: (message: string) => calls.push(`log ${message.trim()}`),
      },
    };
  }

  it("sets the task going again and says so on it", async () => {
    const recovery = planEmptyTurnRecovery({
      issue: child(BRIEF),
      disposition: "waiting",
      reply: PARROTED_BRIEF,
    });
    if (recovery?.kind !== "retry") throw new Error("expected a retry");
    const { calls, deps } = recorder();
    expect(await applyEmptyTurnRecovery(deps, { issueId: "i1", agentId: "a1", recovery })).toBe("retry");
    expect(calls[0]).toBe("update i1 todo");
    expect(calls.some((call) => call.startsWith("comment i1"))).toBe(true);
    expect(calls).toContain("wake a1");
  });

  it("puts the task in front of the person when it cannot be started again", async () => {
    const recovery = planEmptyTurnRecovery({
      issue: child(BRIEF),
      disposition: "waiting",
      reply: PARROTED_BRIEF,
    });
    if (recovery?.kind !== "retry") throw new Error("expected a retry");
    const { calls, deps } = recorder();
    const result = await applyEmptyTurnRecovery(
      { ...deps, wakeAgent: async () => { throw new Error("no runner"); } },
      { issueId: "i1", agentId: "a1", recovery },
    );
    expect(result).toBe("hand-back");
    expect(calls).toContain("update i1 blocked");
  });

  it("has a wake reason of its own so the next turn gets the right instruction", () => {
    // The heartbeat hands every wake reason to this one function and says
    // whatever comes back, so the corrective turn reaches the worker only if
    // its own reason is matched here and nothing else is.
    expect(emptyTurnInstructionForWake(EMPTY_TURN_RETRY_WAKE_REASON)).toBe(buildEmptyTurnRetryInstruction());
    expect(emptyTurnInstructionForWake("issue_children_completed")).toBeNull();
    expect(emptyTurnInstructionForWake(undefined)).toBeNull();
  });
});

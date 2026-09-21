// Repro — wave 4 of the improvement loop: a turn that produced no work and
// asked the person nothing is not parked in front of the person.
//
// Observed in wave 19 (2026-09-21), organization "Zz Gauntlet Org 0921-034835"
// (f6e02c4b-a9d6-4dcf-a397-ecaf6eab83d3). Two tasks had been sent back by the
// reviewer. On the round that came back:
//
//   ZZGAAAAAAAAA-4 wrote its own task brief out again — goal, feature, done
//   when, what the person said, the last verdict — and no guide.
//
//   ZZGAAAAAAAAA-11 wrote "Final Review and Next Steps" and an action list of
//   what still had to happen, and no guide.
//
// Neither reply carried a `STATUS: done` line, so the adapter read both as
// "waiting"; waiting means the person's turn, so both tasks were parked with
// the run log saying "[todero] Handed the turn back to the user." There was
// nothing on either task to answer. Nobody answered. Five tasks queued behind
// ZZGAAAAAAAAA-4 never ran, and the project never finished.
//
// The two replies below are the real ones, copied from those tasks' comments.
//
//   cd docs/ai_context/gauntlet
//   node checks/vitest.mjs --gauntlet server ../docs/ai_context/gauntlet/repros/empty-retry-is-not-parked.gauntlet.ts
//
// Fails on origin/main, where any reply without a status line parks the task.
import { describe, expect, it } from "vitest";
import { planConversationOutcome } from "../../../../server/src/todero/conversation-outcome.js";
import {
  descriptionWithEmptyTurnTries,
  EMPTY_TURN_MAX_TRIES,
  planEmptyTurnOutcome,
  planEmptyTurnRecovery,
  turnDeliversWork,
} from "../../../../server/src/todero/empty-turn-recovery.js";

const BRIEF = "<!-- todero-type: Task -->\nGoal: Create four one-page guides for houseplants.";

/** ZZGAAAAAAAAA-4's reply, 2026-09-21T09:01:54Z. */
const PARROTED_BRIEF = [
  "**ZZGAAAAAAAAA-4**",
  "- **Goal:** Create four one-page guides for houseplants that survive a dark flat.",
  "- **Feature:** Draft guides — To produce the initial content for the one-page guides.",
  "- **Done when:** Four drafts, each naming the plant, the light it needs, and how often to water it.",
  "- **What the person said:** Must have: the four one-page guides, each naming the plant, the light it needs, and how often to water it. Everything else can wait. Done means all four read well. Keep the plan to at most four tasks. Propose the plan now.",
  "- **Last verdict:** The review said the second guide draft must include information for three additional houseplants. Check it before you start.",
].join("\n");

/** ZZGAAAAAAAAA-11's reply, 2026-09-21T09:09:35Z. */
const NEXT_STEPS_LIST = [
  "**Final Review and Next Steps:**",
  "",
  "- **Review Status:** The first guide for the Snake Plant (Sansevieria) has been finalized and formatted. It meets the criteria of being one page and ready for distribution.",
  "- **Next Steps:** We need to finalize and format the remaining three guides for the other three houseplants. Once all four guides are complete, the task will be fully done.",
  "",
  "**Action Required:**",
  "",
  "1. Proceed with finalizing and formatting the guides for the remaining three houseplants.",
  "2. Ensure each guide includes the plant name, light needs, watering frequency, and additional care instructions.",
  "3. Hand in the first finalized guide as specified in the task.",
].join("\n");

/** What the same task handed in on the round before, and what it should write again. */
const A_REAL_GUIDE = [
  "**Pothos (Epipremnum aureum)**",
  "- **Light Needs:** Can thrive in low light conditions but prefers bright, indirect light.",
  "- **Watering Needs:** Water when the top inch of soil is dry. Allow the soil to dry out completely between waterings.",
].join("\n");

const child = (description: string) => ({ status: "in_progress", description, parentId: "parent" });

/** Where the task lands today, with no corrective step in between. */
function parkedToday(reply: string) {
  const plan = planConversationOutcome({
    issue: child(BRIEF),
    disposition: "waiting",
    proposedPlan: false,
    closeAllowed: false,
  });
  expect(plan?.outcome).toBe("waiting");
  expect(plan?.status).toBe("blocked");
  expect(plan?.description).toContain("waiting-on-you");
  return reply;
}

describe("a turn that produced nothing and asked nothing is not parked", () => {
  it("catches both wave-19 replies the first time", () => {
    for (const reply of [PARROTED_BRIEF, NEXT_STEPS_LIST]) {
      parkedToday(reply);
      expect(planEmptyTurnOutcome({ issue: child(BRIEF), disposition: "waiting", reply })).toBe("retry");
      const recovery = planEmptyTurnRecovery({ issue: child(BRIEF), disposition: "waiting", reply });
      expect(recovery?.kind).toBe("retry");
      // Off the person's desk, and the worker is told to write the thing itself.
      expect(recovery?.description).not.toContain("waiting-on-you");
      if (recovery?.kind !== "retry") throw new Error("expected a retry");
      expect(recovery.instruction).toContain("not a summary of the task");
      expect(recovery.instruction).toContain("STATUS: done");
    }
  });

  it("stops after the second one and says why in plain words", () => {
    const asked = descriptionWithEmptyTurnTries(BRIEF, EMPTY_TURN_MAX_TRIES);
    expect(
      planEmptyTurnOutcome({ issue: child(asked), disposition: "waiting", reply: PARROTED_BRIEF }),
    ).toBe("waiting");
    const recovery = planEmptyTurnRecovery({
      issue: child(asked),
      disposition: "waiting",
      reply: PARROTED_BRIEF,
      agentName: "Sam",
    });
    expect(recovery?.kind).toBe("hand-back");
    expect(recovery?.description).toContain("waiting-on-you");
    expect(recovery?.comment).toContain("twice");
    expect(recovery?.comment).not.toMatch(/todero-|marker|disposition|status line/i);
  });

  it("leaves alone the turns that are the person's to answer", () => {
    // A question is the person's turn, first time or not. Short on purpose:
    // a long question also reads as a hand-in, so only a short one shows that
    // the asking itself is what keeps the task off the retry.
    const question = "Which four plants?";
    expect(turnDeliversWork(question)).toBe(false);
    expect(planEmptyTurnOutcome({ issue: child(BRIEF), disposition: "waiting", reply: question })).toBe("waiting");
    // So is a hand-in that stopped short of the status line.
    expect(planEmptyTurnOutcome({ issue: child(BRIEF), disposition: "waiting", reply: A_REAL_GUIDE })).toBe("waiting");
    // The conversation task's waiting is the design: it is never retried.
    expect(
      planEmptyTurnOutcome({
        issue: { status: "in_progress", description: BRIEF, parentId: null },
        disposition: "waiting",
        reply: PARROTED_BRIEF,
      }),
    ).toBe("waiting");
  });
});

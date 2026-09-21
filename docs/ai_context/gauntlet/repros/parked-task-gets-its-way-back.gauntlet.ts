// Repro — wave 5 of the improvement loop: a task that was already parked in
// front of a person, with nothing on it to answer, is offered the corrective
// turn when the organization starts again.
//
// Wave 4 gave a turn that produced no work one more try, at the moment that
// turn ended. Wave 20 (2026-09-21) then reopened wave 19's organization
// (f6e02c4b-a9d6-4dcf-a397-ecaf6eab83d3) to see it work, and nothing happened:
// ZZGAAAAAAAAA-4 and ZZGAAAAAAAAA-11 had been parked before the fix existed, so
// their bad turns were over and nothing wakes a parked task. Two tasks sat
// there with a reply that asked the person nothing, five tasks queued behind
// them, and zero turns ran in fifteen minutes. Every person who updates Todero
// while a project is running is in that same position.
//
// The two replies below are the real ones, copied from those tasks' comments,
// and the task text is written by the same code that writes it in the product.
// Nothing here touches a database or a model.
//
//   cd docs/ai_context/gauntlet
//   node checks/vitest.mjs --gauntlet server ../docs/ai_context/gauntlet/repros/parked-task-gets-its-way-back.gauntlet.ts
//
// Fails on origin/main, where a parked task has no way back at all.
import { describe, expect, it } from "vitest";
import {
  descriptionWithEmptyTurnTries,
  planConversationOutcome,
  readEmptyTurnTries,
} from "../../../../server/src/todero/conversation-outcome.js";
import { hasWaitingOnYouNote } from "../../../../server/src/todero/conversation-thread.js";
import {
  buildEmptyTurnRetry,
  EMPTY_TURN_MAX_TRIES,
  EMPTY_TURN_RETRY_WAKE_REASON,
  planEmptyTurnRecovery,
} from "../../../../server/src/todero/empty-turn-recovery.js";
import {
  findParkedTasksWithNothingToAnswer,
  type ParkedTask,
} from "../../../../server/src/todero/parked-turn-recovery.js";

const BRIEF = "<!-- todero-type: Task -->\nGoal: Create four one-page guides for houseplants.";

/** ZZGAAAAAAAAA-4's reply, 2026-09-21T09:01:54Z: its own brief read back. */
const PARROTED_BRIEF = [
  "**ZZGAAAAAAAAA-4**",
  "- **Goal:** Create four one-page guides for houseplants that survive a dark flat.",
  "- **Feature:** Draft guides — To produce the initial content for the one-page guides.",
  "- **Done when:** Four drafts, each naming the plant, the light it needs, and how often to water it.",
  "- **What the person said:** Must have: the four one-page guides, each naming the plant, the light it needs, and how often to water it. Everything else can wait. Done means all four read well. Keep the plan to at most four tasks. Propose the plan now.",
  "- **Last verdict:** The review said the second guide draft must include information for three additional houseplants. Check it before you start.",
].join("\n");

/** ZZGAAAAAAAAA-11's reply, 2026-09-21T09:09:35Z: a list of what still has to happen. */
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

/** What the same task should have written: the guide itself. */
const A_REAL_GUIDE = [
  "**Pothos (Epipremnum aureum)**",
  "- **Light Needs:** Can thrive in low light conditions but prefers bright, indirect light.",
  "- **Watering Needs:** Water when the top inch of soil is dry. Allow the soil to dry out completely between waterings.",
].join("\n");

/** Exactly what wave 19 left on the task: blocked, waiting on the person. */
function parkedByWave19(description = BRIEF) {
  const plan = planConversationOutcome({
    issue: { status: "in_progress", description, parentId: "parent" },
    disposition: "waiting",
    proposedPlan: false,
    closeAllowed: false,
  });
  if (!plan) throw new Error("the task was not in a state the agent owns");
  expect(plan.status).toBe("blocked");
  expect(hasWaitingOnYouNote(plan.description)).toBe(true);
  return plan.description;
}

function parked(over: Partial<ParkedTask> = {}): ParkedTask {
  return {
    id: "zzgaaaaaaaaa-4",
    companyId: "f6e02c4b-a9d6-4dcf-a397-ecaf6eab83d3",
    identifier: "ZZGAAAAAAAAA-4",
    title: "Draft the second guide",
    description: parkedByWave19(),
    status: "blocked",
    parentId: "conversation",
    assigneeAgentId: "worker-1",
    lastComments: [{ by: "agent", body: PARROTED_BRIEF }],
    ...over,
  };
}

describe("a task parked before the fix gets its way back", () => {
  it("picks up both tasks wave 20 found sitting there", () => {
    const tasks = [
      parked(),
      parked({
        id: "zzgaaaaaaaaa-11",
        identifier: "ZZGAAAAAAAAA-11",
        title: "Finalize the first guide",
        lastComments: [{ by: "agent", body: NEXT_STEPS_LIST }],
      }),
    ];
    expect(findParkedTasksWithNothingToAnswer(tasks).map((task) => task.identifier)).toEqual([
      "ZZGAAAAAAAAA-4",
      "ZZGAAAAAAAAA-11",
    ]);
  });

  it("gives each one the same corrective turn the turn-end door gives", () => {
    const task = parked();
    const fromTheResumeDoor = buildEmptyTurnRetry({ description: task.description, agentName: "Nova" });
    // What wave 4 builds at the moment a turn ends badly, from the same task.
    const fromTheTurnEnd = planEmptyTurnRecovery({
      issue: { status: "in_progress", description: BRIEF, parentId: "conversation" },
      disposition: "waiting",
      reply: PARROTED_BRIEF,
      agentName: "Nova",
    });
    expect(fromTheTurnEnd?.kind).toBe("retry");
    expect(fromTheResumeDoor).toEqual(fromTheTurnEnd);
    // Off the person's desk, counted as the one try, and the worker is told
    // to write the thing itself.
    expect(hasWaitingOnYouNote(fromTheResumeDoor.description)).toBe(false);
    expect(readEmptyTurnTries(fromTheResumeDoor.description)).toBe(EMPTY_TURN_MAX_TRIES);
    expect(fromTheResumeDoor.instruction).toContain("not a summary of the task");
    expect(fromTheResumeDoor.instruction).toContain("STATUS: done");
    expect(fromTheResumeDoor.comment).toContain("Nothing is needed from you.");
    expect(fromTheResumeDoor.comment).not.toMatch(/todero-|marker|disposition|status line/i);
    // And the wake that carries it is the one the worker reads the
    // instruction off.
    expect(EMPTY_TURN_RETRY_WAKE_REASON).toBe("issue_turn_produced_nothing");
  });

  it("asks once and never twice", () => {
    const askedOnce = parked({
      description: descriptionWithEmptyTurnTries(parkedByWave19(), EMPTY_TURN_MAX_TRIES),
    });
    expect(findParkedTasksWithNothingToAnswer([askedOnce])).toEqual([]);
  });

  it("leaves the tasks that really are the person's", () => {
    // A question back to the person.
    expect(
      findParkedTasksWithNothingToAnswer([
        parked({ lastComments: [{ by: "agent", body: "Which four plants should I write about?" }] }),
      ]),
    ).toEqual([]);
    // A hand-in that stopped short of the status line: there is work to read.
    expect(
      findParkedTasksWithNothingToAnswer([parked({ lastComments: [{ by: "agent", body: A_REAL_GUIDE }] })]),
    ).toEqual([]);
    // A person has already answered, so the task is moving again.
    expect(
      findParkedTasksWithNothingToAnswer([
        parked({
          lastComments: [
            { by: "agent", body: PARROTED_BRIEF },
            { by: "person", body: "Just write the pothos one." },
          ],
        }),
      ]),
    ).toEqual([]);
    // The conversation task's waiting is the design, not a fault.
    expect(findParkedTasksWithNothingToAnswer([parked({ parentId: null })])).toEqual([]);
    // And a task that is only waiting for the work before it was never parked
    // on anyone.
    expect(findParkedTasksWithNothingToAnswer([parked({ description: BRIEF })])).toEqual([]);
  });
});

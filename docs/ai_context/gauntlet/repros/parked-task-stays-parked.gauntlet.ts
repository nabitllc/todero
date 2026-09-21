// Repro — wave 3 of the improvement loop: a task Todero parked on the person
// is not woken again by the backstop that chases finished work.
//
// Observed across three waves. The recovery backstop looks for tasks sitting at
// "blocked" whose earlier tasks have all finished, and brings them back. A task
// that Todero handed to the person — a question, a hand-in waiting to be read,
// a plan waiting for a yes — sits at "blocked" too, and the backstop read only
// the row, never what the task said about itself. So it woke them, again and
// again: 13 times on ZZGAAA-3 and 13 on ZZGAAA-5 in wave 16 (organization
// bddd6a6d-13a1-4268-82a0-96673b4314dd), 30 on ZZGAAA-5 in wave 17, 21 on
// ZZGAAAAA-3 in wave 18 (67d6f192-7226-472b-9feb-85d2c361e9cb).
//
// The guard that should have stopped the repeat could not: every hand-back
// stamps the task with a new blocked time, and that time is part of the key
// that says "this wake already happened". A new stamp is a new key, so every
// repeat looked like a first.
//
// This walks it with no database: the task's text is written by the same code
// that writes it in the product, and read by the same code the backstop now
// reads it with.
//
//   cd docs/ai_context/gauntlet
//   node checks/vitest.mjs --gauntlet server ../docs/ai_context/gauntlet/repros/parked-task-stays-parked.gauntlet.ts
//
// Fails on origin/main, where nothing tells the two kinds of blocked apart.
import { describe, expect, it } from "vitest";
import { buildIssueBlockersResolvedWakeStateKey } from "../../../../server/src/services/issue-dependency-wakeups.js";
import {
  descriptionForDeferredReview,
  descriptionWithPlanMarker,
  planConversationOutcome,
} from "../../../../server/src/todero/conversation-outcome.js";
import { descriptionWithWaitingMarker } from "../../../../server/src/todero/conversation-thread.js";
import { descriptionWithWaitingForManagerMarker } from "../../../../server/src/todero/manager-sendback.js";
import { isParkedOnPerson } from "../../../../server/src/todero/parked-on-person.js";

const BRIEF = "<!-- todero-type: Task -->\nReview the four draft guides and say what to fix.";

/** What the task says about itself after Todero hands it to the person. */
function handedBack(options: { proposedPlan?: boolean; handedIn?: boolean } = {}) {
  const plan = planConversationOutcome({
    issue: { status: "in_progress", description: BRIEF, parentId: options.handedIn ? "parent" : null },
    disposition: options.handedIn ? "done" : "waiting",
    proposedPlan: options.proposedPlan ?? false,
    closeAllowed: false,
  });
  if (!plan) throw new Error("the task was not in a state the agent owns");
  return plan;
}

describe("a task Todero parked on the person stays parked", () => {
  it("is not the backstop's to wake, whichever way it was parked", () => {
    // A question back to the person.
    expect(isParkedOnPerson(handedBack().description)).toBe(true);
    // A hand-in waiting to be read.
    expect(isParkedOnPerson(handedBack({ handedIn: true }).description)).toBe(true);
    // A plan waiting for a yes.
    expect(isParkedOnPerson(handedBack({ proposedPlan: true }).description)).toBe(true);
    // A hand-in that arrived while the organization was on hold.
    expect(isParkedOnPerson(descriptionForDeferredReview(BRIEF))).toBe(true);
    // A task the manager is holding while it rewrites the brief.
    expect(isParkedOnPerson(descriptionWithWaitingForManagerMarker(BRIEF, "worker-1"))).toBe(true);
  });

  it("still wakes a task that is only waiting for the work before it", () => {
    expect(isParkedOnPerson(BRIEF)).toBe(false);
    expect(isParkedOnPerson(null)).toBe(false);
  });

  it("still wakes the conversation task for its wrap-up once the plan's tasks close", () => {
    // Approving a plan clears both notes and blocks the conversation task on
    // its children (server/src/todero/plan-approval.ts). That is the one task
    // the backstop exists to bring back, so it must not look parked.
    const afterApproval = descriptionWithPlanMarker(
      descriptionWithWaitingMarker(handedBack({ proposedPlan: true }).description, false),
      false,
    );
    expect(isParkedOnPerson(afterApproval)).toBe(false);
  });

  it("shows why the repeat guard never caught it", () => {
    // Every hand-back stamps a new blocked time, and the key that says "this
    // wake already happened" is built from it. Two hand-backs, two keys.
    const key = (blockedTransitionAt: Date) =>
      buildIssueBlockersResolvedWakeStateKey({
        dependentIssueId: "zzgaaa-5",
        blockerIssueIds: ["zzgaaa-4"],
        blockedTransitionAt,
      });
    expect(key(new Date("2026-09-21T04:00:00.000Z"))).not.toBe(key(new Date("2026-09-21T04:05:00.000Z")));
  });
});

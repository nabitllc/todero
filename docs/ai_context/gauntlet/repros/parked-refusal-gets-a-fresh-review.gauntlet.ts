// Repro — wave 6 of the improvement loop: work the reviewer refused and left
// with the person is read once more when the organization starts again.
//
// Every stuck organization of waves 19, 20 and 21 ends in the same shape. A
// task handed real work in, the reviewer refused it twice, and the task is
// parked in front of a person with "I reviewed this twice and it is still not
// there. Over to you." on it. Nothing ever comes back for one of those.
//
// The reviews a hold deferred (deferred-review-find.ts) are not them: a
// reviewer did speak, and it spoke after the hand-in. The tasks parked with
// nothing to answer (parked-turn-recovery.ts) are not them either: their last
// turn was a real hand-in, and both of those rules turn such a task down by
// design. So wave 21 reopened wave 20's organization
// (42c3d5e4-f0fd-4aea-ae98-32e90707d31f) and ran zero turns, and a person who
// updates Todero the day after a project stalls gets nothing at all out of a
// fix to the reviewer.
//
// The task below is wave 21's ZZGAAAAAAAAAAAAAA-4 (organization
// 9d181fc6-75fe-4cc9-ae04-f17e86ac0332) with the reviewer's own words, and the
// task text is written by the same code that writes it in the product. Nothing
// here touches a database or a model.
//
//   cd docs/ai_context/gauntlet
//   node checks/vitest.mjs --gauntlet server ../docs/ai_context/gauntlet/repros/parked-refusal-gets-a-fresh-review.gauntlet.ts
//
// Fails on origin/main, where nothing looks at a refused hand-in ever again.
import { describe, expect, it } from "vitest";
import {
  descriptionWithRefreshedReviewMarker,
  descriptionWithReviewMarker,
  descriptionWithoutConversationMarkers,
  hasRefreshedReviewMarker,
} from "../../../../server/src/todero/conversation-outcome.js";
import { descriptionWithWaitingMarker } from "../../../../server/src/todero/conversation-thread.js";
import { findDeferredHandIns } from "../../../../server/src/todero/deferred-review-find.js";
import { findParkedTasksWithNothingToAnswer } from "../../../../server/src/todero/parked-turn-recovery.js";
import {
  findRefusedHandInsToRefresh,
  saysTheReviewerSentItBack,
  type RefusedHandIn,
} from "../../../../server/src/todero/refused-review-refresh.js";

/** ZZGAAAAAAAAAAAAAA-4's hand-in, 19:18:43Z, shortened to two of the four. */
const THE_GUIDES = [
  "1. Sansevieria (Snake Plant) — low to bright indirect light, water every two to four weeks.",
  "2. ZZ Plant — very low light, water every four to six weeks.",
].join("\n");

/** The reviewer's last word on it, 19:20:58Z, exactly as the task carries it. */
const OVER_TO_YOU = [
  "I reviewed this twice and it is still not there. Over to you.",
  "",
  "Checked 2 things. 1 met, 1 not met.",
  "",
  "- met — All four drafts have been reviewed and refined to read well.",
  "- not met — The hand-in is The refined guides, ready for publication.",
].join("\n");

const HANDED_IN_AT = new Date("2026-09-21T19:18:43.249Z");
const REFUSED_AT = new Date("2026-09-21T19:20:58.993Z");

/** What ZZGAAAAAAAAAAAAAA-4's own text says while it waits. */
const PARKED_TEXT = descriptionWithReviewMarker(
  descriptionWithWaitingMarker("<!-- todero-judge-rounds: 2 -->\nReview and refine the draft guides.", true),
  true,
);

function theParkedRefusal(overrides: Partial<RefusedHandIn> = {}): RefusedHandIn {
  return {
    id: "878fc80e-6abe-41a3-8521-521835e23c2b",
    companyId: "9d181fc6-75fe-4cc9-ae04-f17e86ac0332",
    identifier: "ZZGAAAAAAAAAAAAAA-4",
    title: "Review and refine the draft guides",
    description: PARKED_TEXT,
    parentId: "a39bfa7a-9411-45e3-89e1-8cd74528e8d9",
    assigneeAgentId: "5f7d4bf8-5c4c-4b7b-bafb-466e9db44a26",
    status: "blocked",
    deliverable: THE_GUIDES,
    handedInAt: HANDED_IN_AT,
    reviewerSpokeAt: REFUSED_AT,
    saidNobodyCouldLookAt: null,
    reviewerSentItBack: saysTheReviewerSentItBack(OVER_TO_YOU),
    personSpokeAt: null,
    alreadyRefreshed: false,
    ...overrides,
  };
}

describe("wave 6: the shape nothing used to come back for", () => {
  it("is turned down by both of the rules that already existed", () => {
    const task = theParkedRefusal();
    // The deferred rule: a reviewer spoke, and after the hand-in.
    expect(findDeferredHandIns([task])).toEqual([]);
    // The parked-turn rule: the last turn handed work in, and the task says a
    // review is pending, so it is somebody else's to settle.
    expect(findParkedTasksWithNothingToAnswer([{
      id: task.id,
      companyId: task.companyId,
      identifier: task.identifier,
      title: task.title,
      description: task.description,
      status: task.status,
      parentId: task.parentId,
      assigneeAgentId: task.assigneeAgentId,
      lastComments: [{ by: "agent", body: THE_GUIDES }, { by: "agent", body: OVER_TO_YOU }],
    }])).toEqual([]);
  });

  it("is what the new rule picks up", () => {
    expect(findRefusedHandInsToRefresh([theParkedRefusal()]).map((task) => task.identifier))
      .toEqual(["ZZGAAAAAAAAAAAAAA-4"]);
  });

  it("reads the reviewer's refusal, and does not read its pass as one", () => {
    expect(saysTheReviewerSentItBack(OVER_TO_YOU)).toBe(true);
    expect(saysTheReviewerSentItBack(
      "I reviewed this and it does what the task asked. It is ready for you to accept.",
    )).toBe(false);
  });
});

describe("wave 6: one fresh look, and only one", () => {
  it("leaves a task that has already had its look", () => {
    const looked = theParkedRefresh();
    expect(hasRefreshedReviewMarker(looked.description)).toBe(true);
    expect(findRefusedHandInsToRefresh([looked])).toEqual([]);
  });

  it("forgets that look when the task closes, so a later hand-in is reviewed again", () => {
    const closed = descriptionWithoutConversationMarkers(theParkedRefresh().description);
    expect(hasRefreshedReviewMarker(closed)).toBe(false);
  });

  it("leaves a task a person has answered since the refusal", () => {
    expect(findRefusedHandInsToRefresh([
      theParkedRefusal({ personSpokeAt: new Date("2026-09-21T19:40:00.000Z") }),
    ])).toEqual([]);
  });
});

/** The same task after this pass has taken it once. */
function theParkedRefresh(): RefusedHandIn {
  const description = descriptionWithRefreshedReviewMarker(PARKED_TEXT, true);
  return theParkedRefusal({ description, alreadyRefreshed: hasRefreshedReviewMarker(description) });
}

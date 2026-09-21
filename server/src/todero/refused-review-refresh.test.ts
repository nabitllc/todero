// Which refused hand-ins get one fresh look when an organization starts again.
//
// The rule on its own, with the database stood in for. The database half is in
// refused-review-refresh-db.test.ts next door.
import { describe, expect, it } from "vitest";
import { descriptionWithReviewMarker, descriptionWithRefreshedReviewMarker } from "./conversation-outcome.js";
import { descriptionWithWaitingMarker } from "./conversation-thread.js";
import {
  findRefusedHandInsToRefresh,
  saysTheReviewerSentItBack,
  type RefusedHandIn,
} from "./refused-review-refresh.js";

const HANDED_IN_AT = new Date("2026-09-21T19:18:43.249Z");
const REVIEWER_SPOKE_AT = new Date("2026-09-21T19:20:58.993Z");

/** What a task says when its hand-in is in front of the person, in review. */
const parkedText = () =>
  descriptionWithReviewMarker(descriptionWithWaitingMarker("Review and refine the draft guides.", true), true);

function task(overrides: Partial<RefusedHandIn> = {}): RefusedHandIn {
  return {
    id: "task-1",
    companyId: "co-1",
    identifier: "ZZG-4",
    title: "Review and refine the draft guides",
    description: parkedText(),
    parentId: "parent-1",
    assigneeAgentId: "worker-1",
    status: "blocked",
    deliverable: "1. Snake Plant — low light, water every two to four weeks.",
    handedInAt: HANDED_IN_AT,
    reviewerSpokeAt: REVIEWER_SPOKE_AT,
    saidNobodyCouldLookAt: null,
    reviewerSentItBack: true,
    personSpokeAt: null,
    alreadyRefreshed: false,
    ...overrides,
  };
}

const found = (one: RefusedHandIn) => findRefusedHandInsToRefresh([one]).map((each) => each.id);

describe("what the reviewer's last word was", () => {
  it("reads both ways the reviewer refuses work", () => {
    expect(saysTheReviewerSentItBack(
      "I reviewed this and it is not finished yet. Sending it back with what to change.",
    )).toBe(true);
    expect(saysTheReviewerSentItBack(
      "I reviewed this twice and it is still not there. Over to you.",
    )).toBe(true);
  });

  it("does not read an accepted hand-in as a refusal", () => {
    expect(saysTheReviewerSentItBack(
      "I reviewed this and it does what the task asked. It is ready for you to accept.",
    )).toBe(false);
    expect(saysTheReviewerSentItBack("")).toBe(false);
  });
});

describe("which parked refusals get one fresh look", () => {
  it("takes the one the reviewer refused and nobody has touched since", () => {
    expect(found(task())).toEqual(["task-1"]);
  });

  it("leaves one a person has answered since the refusal", () => {
    expect(found(task({ personSpokeAt: new Date("2026-09-21T19:30:00.000Z") }))).toEqual([]);
  });

  it("leaves one that has already had its fresh look", () => {
    expect(found(task({
      alreadyRefreshed: true,
      description: descriptionWithRefreshedReviewMarker(parkedText(), true),
    }))).toEqual([]);
  });

  it("leaves one no reviewer ever spoke on: that is the other rule's task", () => {
    expect(found(task({ reviewerSpokeAt: null, reviewerSentItBack: false }))).toEqual([]);
  });

  it("leaves one whose reviewer passed it", () => {
    expect(found(task({ reviewerSentItBack: false }))).toEqual([]);
  });

  it("leaves one that handed something in after the refusal", () => {
    expect(found(task({ handedInAt: new Date("2026-09-21T19:40:00.000Z") }))).toEqual([]);
  });

  it("leaves one with nothing handed in, nothing in front of the person, or nobody on it", () => {
    expect(found(task({ deliverable: "   " }))).toEqual([]);
    expect(found(task({ description: descriptionWithWaitingMarker("No review here.", true) }))).toEqual([]);
    expect(found(task({ assigneeAgentId: null }))).toEqual([]);
    expect(found(task({ parentId: null }))).toEqual([]);
    expect(found(task({ status: "todo" }))).toEqual([]);
  });
});

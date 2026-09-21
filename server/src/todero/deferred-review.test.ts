import { describe, expect, it } from "vitest";
import {
  descriptionForDeferredReview,
  descriptionWithReviewMarker,
  hasDeferredReviewMarker,
  REVIEW_PENDING_MARKER,
} from "./conversation-outcome.js";
import { descriptionWithWaitingMarker } from "./conversation-thread.js";
import {
  findDeferredHandIns,
  planDeferredSettlement,
  runDeferredReviews,
  type DeferredHandIn,
  type DeferredReviewActions,
} from "./deferred-review.js";
import type { JudgeApplyResult } from "./judge-apply.js";
import type { JudgeReviewResult } from "./judge-review.js";

const HANDED_IN_AT = new Date("2026-09-21T01:19:07Z");

function task(partial: Partial<DeferredHandIn> = {}): DeferredHandIn {
  return {
    id: "task-2",
    companyId: "co-1",
    identifier: "ZZG-2",
    title: "Write the welcome guide",
    description: descriptionForDeferredReview("Write the welcome guide."),
    parentId: "task-1",
    assigneeAgentId: "agent-1",
    status: "blocked",
    deliverable: "Here is the welcome guide.",
    handedInAt: HANDED_IN_AT,
    reviewerSpokeAt: null,
    ...partial,
  };
}

/** A hand-in that was written but never reviewed, and carries no note saying so. */
function unmarked(partial: Partial<DeferredHandIn> = {}): DeferredHandIn {
  return task({
    description: descriptionWithReviewMarker(
      descriptionWithWaitingMarker("Write the welcome guide.", true),
      true,
    ),
    ...partial,
  });
}

describe("finding the hand-ins a hold left unreviewed", () => {
  it("finds the ones that say a reviewer still owes them an answer", () => {
    const found = findDeferredHandIns([task()]);
    expect(found).toHaveLength(1);
    expect(found[0]!.id).toBe("task-2");
  });

  it("finds one handed in before the note existed, which no reviewer ever answered", () => {
    expect(findDeferredHandIns([unmarked()])).toHaveLength(1);
  });

  it("leaves one the reviewer already answered", () => {
    const answered = unmarked({ reviewerSpokeAt: new Date(HANDED_IN_AT.getTime() + 1_000) });
    expect(findDeferredHandIns([answered])).toHaveLength(0);
  });

  it("takes one whose reviewer only ever spoke about an older hand-in", () => {
    const stale = unmarked({ reviewerSpokeAt: new Date(HANDED_IN_AT.getTime() - 1_000) });
    expect(findDeferredHandIns([stale])).toHaveLength(1);
  });

  it("leaves one that handed in nothing to look at", () => {
    expect(findDeferredHandIns([unmarked({ deliverable: "   " })])).toHaveLength(0);
  });

  it("leaves one that is not waiting on anybody", () => {
    expect(findDeferredHandIns([unmarked({ description: "Write the welcome guide." })])).toHaveLength(0);
  });

  it("leaves one that is being worked on right now", () => {
    expect(findDeferredHandIns([task({ status: "in_progress" })])).toHaveLength(0);
    expect(findDeferredHandIns([task({ status: "done" })])).toHaveLength(0);
  });
});

describe("what happens to a task once its deferred review is answered", () => {
  it("closes it when the reviewer accepted it, and takes every note off", () => {
    const settlement = planDeferredSettlement(task(), "accept");
    expect(settlement?.status).toBe("done");
    expect(hasDeferredReviewMarker(settlement?.description ?? "")).toBe(false);
    expect(settlement?.description ?? "").not.toContain(REVIEW_PENDING_MARKER);
    expect(settlement?.description ?? "").toContain("Write the welcome guide.");
  });

  it("leaves it with the person when the reviewer handed it over, minus the promise", () => {
    const settlement = planDeferredSettlement(task(), "handoff");
    expect(settlement?.status).toBeUndefined();
    expect(hasDeferredReviewMarker(settlement?.description ?? "")).toBe(false);
    expect(settlement?.description ?? "").toContain(REVIEW_PENDING_MARKER);
  });

  it("takes the promise off even when nobody could review it a second time", () => {
    const settlement = planDeferredSettlement(task(), "none");
    expect(hasDeferredReviewMarker(settlement?.description ?? "")).toBe(false);
    expect(settlement?.description ?? "").toContain(REVIEW_PENDING_MARKER);
  });

  it("writes nothing when the reviewer sent it back, because that already did", () => {
    expect(planDeferredSettlement(task(), "revise")).toBeNull();
  });
});

function review(): JudgeReviewResult {
  return { outcome: { kind: "accept" }, verdict: "pass", note: "", comment: null, judgeAgent: null, skipped: null };
}

type Seen = { reviewed: string[]; applied: string[]; settled: string[]; logs: string[] };

function recorder(): Seen {
  return { reviewed: [], applied: [], settled: [], logs: [] };
}

function actions(seen: Seen, overrides: Partial<DeferredReviewActions> = {}): DeferredReviewActions {
  return {
    review: async (t) => {
      seen.reviewed.push(t.id);
      return review();
    },
    apply: async (t) => {
      seen.applied.push(t.id);
      return "accept" as JudgeApplyResult;
    },
    settle: async (t) => {
      seen.settled.push(t.id);
    },
    log: (message) => seen.logs.push(message),
    ...overrides,
  };
}

describe("running the reviews a hold deferred", () => {
  it("reviews each task once and settles it", async () => {
    const seen = recorder();
    const result = await runDeferredReviews(actions(seen), [task(), task({ id: "task-3", identifier: "ZZG-3" })]);
    expect(seen.reviewed).toEqual(["task-2", "task-3"]);
    expect(seen.applied).toEqual(["task-2", "task-3"]);
    expect(seen.settled).toEqual(["task-2", "task-3"]);
    expect(result).toEqual({ reviewed: 2, failed: 0 });
  });

  it("keeps going when one task throws, and says which one it was", async () => {
    const seen = recorder();
    const result = await runDeferredReviews(
      actions(seen, {
        review: async (t) => {
          seen.reviewed.push(t.id);
          if (t.id === "task-2") throw new Error("the reviewer went away");
          return review();
        },
      }),
      [task(), task({ id: "task-3", identifier: "ZZG-3" })],
    );
    expect(seen.reviewed).toEqual(["task-2", "task-3"]);
    expect(seen.settled).toEqual(["task-3"]);
    expect(result).toEqual({ reviewed: 1, failed: 1 });
    expect(seen.logs.join("")).toContain("ZZG-2");
    expect(seen.logs.join("")).toContain("the reviewer went away");
  });
});

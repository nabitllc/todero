import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Db } from "@todero/db";
import { logger } from "../middleware/logger.js";
import {
  descriptionForDeferredReview,
  descriptionWithReviewMarker,
  hasDeferredReviewMarker,
  REVIEW_PENDING_MARKER,
} from "./conversation-outcome.js";
import { descriptionWithWaitingMarker } from "./conversation-thread.js";
import {
  installDeferredReviewsOnResume,
  planDeferredSettlement,
  reviewDeferredHandInsOnResume,
  runDeferredReviews,
  setDeferredReviewRunner,
  type DeferredReviewActions,
} from "./deferred-review.js";
import { findDeferredHandIns, type DeferredHandIn } from "./deferred-review-find.js";
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
    saidNobodyCouldLookAt: null,
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

  it("leaves one Todero has already said nobody could look at", () => {
    const told = unmarked({ saidNobodyCouldLookAt: new Date(HANDED_IN_AT.getTime() + 1_000) });
    expect(findDeferredHandIns([told])).toHaveLength(0);
    // Marked or not: once the person has been told, only new work brings it back.
    expect(findDeferredHandIns([task({ saidNobodyCouldLookAt: new Date(HANDED_IN_AT.getTime() + 1_000) })]))
      .toHaveLength(0);
  });

  it("takes one that was handed in again after Todero said nobody could look at it", () => {
    const again = unmarked({ saidNobodyCouldLookAt: new Date(HANDED_IN_AT.getTime() - 1_000) });
    expect(findDeferredHandIns([again])).toHaveLength(1);
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

  it("writes nothing when nobody could review it a second time", () => {
    // Taking the task said everything the task itself can say; the note Todero
    // leaves on it is what tells the person, and what stops it coming round
    // again on the next start.
    expect(planDeferredSettlement(task(), "none")).toBeNull();
  });

  it("writes nothing when the reviewer sent it back, because that already did", () => {
    expect(planDeferredSettlement(task(), "revise")).toBeNull();
  });
});

function review(): JudgeReviewResult {
  return { outcome: { kind: "accept" }, verdict: "pass", note: "", comment: null, judgeAgent: null, skipped: null };
}

type Seen = { claimed: string[]; reviewed: string[]; applied: string[]; settled: string[]; logs: string[] };

function recorder(): Seen {
  return { claimed: [], reviewed: [], applied: [], settled: [], logs: [] };
}

function actions(seen: Seen, overrides: Partial<DeferredReviewActions> = {}): DeferredReviewActions {
  return {
    stillRunning: async () => true,
    claim: async (t) => {
      seen.claimed.push(t.id);
      return t.description ?? "";
    },
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
    expect(result).toEqual({ reviewed: 2, failed: 0, stopped: false });
  });

  it("stops the moment the organization is put back on hold, and leaves the rest", async () => {
    const seen = recorder();
    let running = true;
    const result = await runDeferredReviews(
      actions(seen, {
        stillRunning: async () => running,
        review: async (t) => {
          seen.reviewed.push(t.id);
          running = false;
          return review();
        },
      }),
      [task(), task({ id: "task-3", identifier: "ZZG-3" })],
    );
    expect(seen.reviewed).toEqual(["task-2"]);
    expect(seen.claimed).toEqual(["task-2"]);
    expect(result).toEqual({ reviewed: 1, failed: 0, stopped: true });
  });

  it("asks nobody about a task somebody else already took", async () => {
    const seen = recorder();
    const result = await runDeferredReviews(
      actions(seen, {
        claim: async (t) => {
          seen.claimed.push(t.id);
          return t.id === "task-2" ? null : (t.description ?? "");
        },
      }),
      [task(), task({ id: "task-3", identifier: "ZZG-3" })],
    );
    expect(seen.claimed).toEqual(["task-2", "task-3"]);
    expect(seen.reviewed).toEqual(["task-3"]);
    expect(result).toEqual({ reviewed: 1, failed: 0, stopped: false });
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
    expect(result).toEqual({ reviewed: 1, failed: 1, stopped: false });
    expect(seen.logs.join("")).toContain("ZZG-2");
    expect(seen.logs.join("")).toContain("the reviewer went away");
  });
});

/**
 * What starting an organization again actually does, end to end through the
 * seam the three doors call.
 *
 * The doors themselves are held by their own tests — an archived organization
 * opened again in `companies-service.test.ts`, Play and Resume everything in
 * `todero-pause-routes.test.ts`. All three prove that the door calls
 * `reviewDeferredHandInsOnResume`. What is proved here is the other half: that
 * the thing installed behind that call really does all three passes, and that
 * a pass that falls over does not take the others with it.
 *
 * The database is a stub that answers every read with nothing and remembers
 * how it was asked. The passes read differently — the parked-task pass joins
 * the agents table to get the worker's name, and the other two do not — so
 * which pass ran is read off the reads themselves, in the order they come.
 */
describe("what starting an organization again runs", () => {
  type Read = { joined: boolean };

  function stubDb(answer: (read: Read, index: number) => Promise<unknown[]>) {
    const reads: Read[] = [];
    const select = () => {
      const read: Read = { joined: false };
      const index = reads.length;
      reads.push(read);
      const chain: Record<string, unknown> = {
        from: () => chain,
        leftJoin: () => {
          read.joined = true;
          return chain;
        },
        where: () => chain,
        limit: () => chain,
        then: (resolve: (rows: unknown[]) => unknown, reject: (err: unknown) => unknown) =>
          answer(read, index).then(resolve, reject),
      };
      return chain;
    };
    return { reads, db: { select } as unknown as Db };
  }

  const wakeup = async () => null;

  afterEach(() => {
    setDeferredReviewRunner(null);
    vi.restoreAllMocks();
  });

  it("does the reviews, then the parked tasks, then the work that was sent back", async () => {
    const { reads, db } = stubDb(async () => []);
    installDeferredReviewsOnResume(db, wakeup);

    reviewDeferredHandInsOnResume("co-both");

    await vi.waitFor(() => expect(reads).toHaveLength(3));
    expect(reads[0]!.joined).toBe(false);
    expect(reads[1]!.joined).toBe(true);
    expect(reads[2]!.joined).toBe(false);
  });

  it("still starts the parked tasks when the reviews fall over, and says what went wrong", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    const { reads, db } = stubDb(async (_read, index) => {
      if (index === 0) throw new Error("the reviewer went away");
      return [];
    });
    installDeferredReviewsOnResume(db, wakeup);

    reviewDeferredHandInsOnResume("co-review-threw");

    await vi.waitFor(() => expect(reads).toHaveLength(3));
    expect(reads[1]!.joined).toBe(true);
    await vi.waitFor(() => expect(warn).toHaveBeenCalled());
    // The line the reviews' own catch writes, which is not the line the whole
    // run's catch writes — so this cannot be satisfied by the outer one.
    const lines = warn.mock.calls.map((call) => String(call[1]));
    expect(lines).toContain("could not review the hand-ins this organization's hold deferred");
    expect(lines).not.toContain("could not look at what this organization's hold left waiting");
  });
});

/**
 * The three doors an organization can start again through, read in the source.
 *
 * Each door has a test of its own that drives it for real — an archived
 * organization opened again in `companies-service.test.ts`, Play and Resume
 * everything in `todero-pause-routes.test.ts`. Those tests put their own
 * stand-in behind the seam, so they would still pass if nothing ever installed
 * the real thing. This reads the four lines that make the claim true: three
 * doors that call the seam, and the one place at startup that puts both passes
 * behind it.
 */
describe("the doors that start an organization again", () => {
  const read = (...parts: string[]) => readFileSync(path.resolve(__dirname, "..", ...parts), "utf8");

  it("all three ask for the hand-ins the hold deferred", () => {
    const companies = read("services", "companies.ts");
    expect(companies).toContain("if (result.reactivated) reviewDeferredHandInsOnResume(");

    const routes = read("routes", "todero-pause-routes.ts");
    // One organization started by hand, and every organization Resume
    // everything starts.
    expect(routes.match(/reviewDeferredHandInsOnResume\(/g) ?? []).toHaveLength(2);
  });

  it("startup puts both passes behind the seam", () => {
    expect(read("services", "heartbeat.ts")).toContain("installDeferredReviewsOnResume(db, enqueueWakeup)");
  });
});

// Which refused hand-ins get one fresh look when an organization starts again.
//
// The rule on its own, with the database stood in for. The database half is in
// refused-review-refresh-db.test.ts next door.
import { describe, expect, it } from "vitest";
import {
  descriptionWithReviewMarker,
  descriptionWithRefreshedReviewMarker,
  descriptionWithoutConversationMarkers,
  hasRefreshedReviewMarker,
  planConversationOutcome,
} from "./conversation-outcome.js";
import { descriptionWithWaitingMarker } from "./conversation-thread.js";
import { planJudgeOutcome, readJudgeFailRounds } from "./judge.js";
import {
  applyJudgeReview,
  buildJudgeRetryInstruction,
  instructionForConversationWake,
  JUDGE_RETRY_NOTE_KEY,
  JUDGE_RETRY_NOTE_MAX_CHARS,
  JUDGE_REVISION_WAKE_REASON,
} from "./judge-apply.js";
import {
  descriptionForAFreshAttempt,
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

describe("when the mark of a fresh look comes off", () => {
  const refreshedAndParked = () => descriptionWithRefreshedReviewMarker(parkedText(), true);

  it("comes off when the task hands work in again, so a later refusal gets its own fresh look", () => {
    const plan = planConversationOutcome({
      issue: { status: "in_progress", description: refreshedAndParked(), parentId: "parent-1" },
      disposition: "done",
    });
    expect(plan?.outcome).toBe("review");
    expect(hasRefreshedReviewMarker(plan?.description ?? "")).toBe(false);
  });

  it("comes off when the task hands the turn back without finishing", () => {
    const plan = planConversationOutcome({
      issue: { status: "in_progress", description: refreshedAndParked(), parentId: "parent-1" },
      disposition: "waiting",
    });
    expect(hasRefreshedReviewMarker(plan?.description ?? "")).toBe(false);
  });

  it("comes off when the task closes", () => {
    expect(hasRefreshedReviewMarker(descriptionWithoutConversationMarkers(refreshedAndParked()))).toBe(false);
  });
});

describe("a fresh review under a new brief is a fresh start", () => {
  /** What wave 21 left on the task: two refusals counted, at the reviewer's cap. */
  const atTheCap = descriptionWithReviewMarker(
    descriptionWithWaitingMarker("<!-- todero-judge-rounds: 2 -->\nReview and refine the draft guides.", true),
    true,
  );

  it("puts the count of refusals back to nothing, and marks the look as taken", () => {
    const fresh = descriptionForAFreshAttempt(atTheCap);
    expect(readJudgeFailRounds(fresh)).toBe(0);
    expect(hasRefreshedReviewMarker(fresh)).toBe(true);
    expect(fresh).toContain("Review and refine the draft guides.");
  });

  it("makes a refusal round one, where the same refusal on the old count was the end", () => {
    const asItWas = planJudgeOutcome({
      verdict: "fail",
      failRounds: readJudgeFailRounds(atTheCap),
      autoAcceptWhenJudgePasses: true,
    });
    expect(asItWas).toEqual({ kind: "handoff", because: "rounds_exhausted" });
    const afresh = planJudgeOutcome({
      verdict: "fail",
      failRounds: readJudgeFailRounds(descriptionForAFreshAttempt(atTheCap)),
      autoAcceptWhenJudgePasses: true,
    });
    expect(afresh).toEqual({ kind: "revise", round: 1 });
  });

  it("settles a refused fresh review by sending it back to the worker, not to the person", async () => {
    const fresh = descriptionForAFreshAttempt(atTheCap);
    const written: Array<{ status?: string; description?: string }> = [];
    const woken: string[] = [];
    const applied = await applyJudgeReview(
      {
        addComment: async () => null,
        updateIssue: async (_id, patch) => {
          written.push(patch);
          return null;
        },
        wakeAgent: async ({ agentId }) => {
          woken.push(agentId);
          return null;
        },
        log: () => {},
      },
      {
        issue: { id: "task-1", description: fresh, identifier: "ZZG-4", title: "Review and refine the draft guides" },
        assigneeAgentId: "worker-1",
        review: {
          outcome: planJudgeOutcome({
            verdict: "fail",
            failRounds: readJudgeFailRounds(fresh),
            autoAcceptWhenJudgePasses: true,
          }),
          verdict: "fail",
          note: "It does not include the actual refined guides.",
          comment: "I reviewed this and it is not finished yet. Sending it back with what to change.",
          judgeAgent: { id: "reviewer-1", name: "Nova's reviewer" } as never,
          skipped: null,
        },
      },
    );
    expect(applied).toBe("revise");
    expect(written[0]?.status).toBe("todo");
    expect(readJudgeFailRounds(written[0]?.description)).toBe(1);
    expect(woken).toEqual(["worker-1"]);
  });

  it("leaves a fresh review that passes exactly as it was", () => {
    const fresh = descriptionForAFreshAttempt(atTheCap);
    expect(planJudgeOutcome({
      verdict: "pass",
      failRounds: readJudgeFailRounds(fresh),
      autoAcceptWhenJudgePasses: true,
    })).toEqual({ kind: "accept" });
    expect(planJudgeOutcome({
      verdict: "pass",
      failRounds: readJudgeFailRounds(fresh),
      autoAcceptWhenJudgePasses: false,
    })).toEqual({ kind: "handoff", because: "passed" });
  });
});

describe("what the worker is told when a fresh review sends its work back", () => {
  const note = "It does not include the actual refined guides. Instead, it provides a plan for refining them.";

  it("still asks for the work itself, and now quotes what the reviewer says is missing", () => {
    const instruction = buildJudgeRetryInstruction(note);
    expect(instruction).toContain("hand in the work itself, complete, in this reply");
    expect(instruction).toContain(note);
  });

  it("says the same as before when the reviewer's words were not kept", () => {
    expect(buildJudgeRetryInstruction()).toBe(buildJudgeRetryInstruction(null));
    expect(buildJudgeRetryInstruction("   ")).toBe(buildJudgeRetryInstruction());
  });

  it("carries the quote from the wake that brought the worker back", () => {
    expect(instructionForConversationWake(JUDGE_REVISION_WAKE_REASON, { [JUDGE_RETRY_NOTE_KEY]: note }))
      .toBe(buildJudgeRetryInstruction(note));
    expect(instructionForConversationWake(JUDGE_REVISION_WAKE_REASON))
      .toBe(buildJudgeRetryInstruction());
  });

  // A reviewer who writes at length has its opening kept and the rest cut.
  // Nothing pinned where the cut falls, so nobody would notice it moving.
  it("keeps the opening of a long reviewer note and marks where it was cut", () => {
    const long = `${"a".repeat(JUDGE_RETRY_NOTE_MAX_CHARS)}b tail that must not survive`;
    const instruction = buildJudgeRetryInstruction(long);
    expect(instruction).toContain(`"${"a".repeat(JUDGE_RETRY_NOTE_MAX_CHARS - 1)}…"`);
    expect(instruction).not.toContain("tail that must not survive");
  });

  it("leaves a note that just fits whole", () => {
    const exact = "a".repeat(JUDGE_RETRY_NOTE_MAX_CHARS);
    expect(buildJudgeRetryInstruction(exact)).toContain(`"${exact}"`);
  });
});

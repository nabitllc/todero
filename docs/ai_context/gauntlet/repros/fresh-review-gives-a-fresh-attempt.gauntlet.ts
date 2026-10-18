// Repro — wave 7 of the improvement loop: a fresh review under a corrected
// brief gives the worker a fresh attempt, instead of one more "over to you".
//
// Wave 22 reopened wave 21's organization
// (9d181fc6-75fe-4cc9-ae04-f17e86ac0332). The parked task "Review and refine
// the draft guides" had been refused twice under the old reviewer brief, whose
// complaint was about formatting: the guides "lack any visual formatting or
// layout". Wave 6 gave that task its fresh review, and the new verdict was
// clean of the formatting complaint — it judged the content, and it was right:
// the worker's second turn had been a plan for refining the guides rather than
// the guides.
//
// And it went nowhere. Two refusals were already counted against the task
// under the old brief, so the reviewer's plan had no round left: the verdict
// opened with "I reviewed this twice and it is still not there. Over to you."
// and the task was parked again at once. Runs on the task: still two, both
// from wave 21. The worker was never once asked to try again with the
// corrected brief in force. Zero human touches, zero progress.
//
// Nothing here touches a database or a model.
//
//   cd docs/ai_context/gauntlet
//   node checks/vitest.mjs --gauntlet server ../docs/ai_context/gauntlet/repros/fresh-review-gives-a-fresh-attempt.gauntlet.ts
//
// Fails on the wave 6 tree, where the fresh review is spent on a count the old
// brief ran out.
import { describe, expect, it } from "vitest";
import {
  descriptionWithReviewMarker,
  hasRefreshedReviewMarker,
} from "../../../../server/src/todero/conversation-outcome.js";
import { descriptionWithWaitingMarker } from "../../../../server/src/todero/conversation-thread.js";
import {
  applyJudgeReview,
  buildJudgeRetryInstruction,
  instructionForConversationWake,
  JUDGE_RETRY_NOTE_KEY,
  JUDGE_REVISION_WAKE_REASON,
} from "../../../../server/src/todero/judge-apply.js";
import {
  planJudgeOutcome,
  readJudgeFailRounds,
  JUDGE_OVER_TO_YOU_OPENING,
  JUDGE_SENT_BACK_OPENING,
} from "../../../../server/src/todero/judge.js";
import { descriptionForAFreshAttempt } from "../../../../server/src/todero/refused-review-refresh.js";

/** What ZZGAAAAAAAAAAAAAA-4's own text said: two refusals counted against it. */
const AT_THE_CAP = descriptionWithReviewMarker(
  descriptionWithWaitingMarker("<!-- todero-judge-rounds: 2 -->\nReview and refine the draft guides.", true),
  true,
);

/** Wave 22's fresh verdict, in the reviewer's own words. */
const THE_FRESH_VERDICT =
  "The submission does not include the actual refined guides. Instead, it provides a plan for"
  + " refining the guides.";

/** The reviewer refusing the work it has just read. */
function refusal(description: string) {
  const outcome = planJudgeOutcome({
    verdict: "fail" as const,
    failRounds: readJudgeFailRounds(description),
    autoAcceptWhenJudgePasses: true,
  });
  return { outcome, verdict: "fail" as const, note: THE_FRESH_VERDICT, comment: "", skipped: null };
}

/** What the task and the worker got out of one refusal, with nothing else stood in. */
async function settle(description: string) {
  const written: Array<{ status?: string; description?: string }> = [];
  const woken: string[] = [];
  const review = refusal(description);
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
      issue: {
        id: "878fc80e-6abe-41a3-8521-521835e23c2b",
        identifier: "ZZGAAAAAAAAAAAAAA-4",
        title: "Review and refine the draft guides",
        description,
      },
      assigneeAgentId: "5f7d4bf8-5c4c-4b7b-bafb-466e9db44a26",
      review: review as never,
    },
  );
  return { applied, written, woken, outcome: review.outcome };
}

describe("wave 7: what wave 22's fresh verdict did to the task", () => {
  it("ran out of rounds the old brief had already spent, and parked the task again", async () => {
    const asItWas = await settle(AT_THE_CAP);
    expect(asItWas.outcome).toEqual({ kind: "handoff", because: "rounds_exhausted" });
    expect(asItWas.applied).toBe("handoff");
    // Nothing was written back and nobody was brought in: over to the person.
    expect(asItWas.written).toEqual([]);
    expect(asItWas.woken).toEqual([]);
  });
});

describe("wave 7: a fresh review under a new brief is a fresh start", () => {
  it("counts the fresh refusal as round one, and takes the look it has had", () => {
    const fresh = descriptionForAFreshAttempt(AT_THE_CAP);
    expect(readJudgeFailRounds(fresh)).toBe(0);
    expect(hasRefreshedReviewMarker(fresh)).toBe(true);
    expect(fresh).toContain("Review and refine the draft guides.");
  });

  it("sends the work back to the worker instead of handing it to the person", async () => {
    const afresh = await settle(descriptionForAFreshAttempt(AT_THE_CAP));
    expect(afresh.outcome).toEqual({ kind: "revise", round: 1 });
    expect(afresh.applied).toBe("revise");
    expect(afresh.written[0]?.status).toBe("todo");
    expect(readJudgeFailRounds(afresh.written[0]?.description)).toBe(1);
    expect(afresh.woken).toEqual(["5f7d4bf8-5c4c-4b7b-bafb-466e9db44a26"]);
  });

  it("tells the worker to hand in the work itself, and what this reviewer says is missing", () => {
    const instruction = instructionForConversationWake(JUDGE_REVISION_WAKE_REASON, {
      [JUDGE_RETRY_NOTE_KEY]: THE_FRESH_VERDICT,
    });
    expect(instruction).toContain("hand in the work itself, complete, in this reply");
    expect(instruction).toContain("does not include the actual refined guides");
    expect(instruction).toBe(buildJudgeRetryInstruction(THE_FRESH_VERDICT));
  });

  it("still passes a fresh review that passes, and never invents a third refusal", () => {
    const fresh = descriptionForAFreshAttempt(AT_THE_CAP);
    expect(planJudgeOutcome({
      verdict: "pass",
      failRounds: readJudgeFailRounds(fresh),
      autoAcceptWhenJudgePasses: true,
    })).toEqual({ kind: "accept" });
    // A second refusal after the fresh start is the one that reaches the person.
    const afterOneMore = planJudgeOutcome({
      verdict: "fail",
      failRounds: 1,
      autoAcceptWhenJudgePasses: true,
    });
    expect(afterOneMore).toEqual({ kind: "handoff", because: "rounds_exhausted" });
  });

  it("uses the reviewer's two openings the way the product writes them", () => {
    expect(JUDGE_SENT_BACK_OPENING).toContain("not finished yet");
    expect(JUDGE_OVER_TO_YOU_OPENING).toContain("still not there");
  });
});

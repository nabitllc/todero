/**
 * Turning a reviewer's verdict into what the task actually does. Kept out of
 * the heartbeat so the decision can be tested without a database: the caller
 * passes in four small actions and gets back what the task's status should
 * become.
 */
import { descriptionWithJudgeFailRounds } from "./judge.js";
import type { JudgeReviewResult } from "./judge-review.js";

export type JudgeApplyDeps = {
  /** Post a comment authored by the reviewer agent. */
  addComment: (issueId: string, body: string, agentId: string) => Promise<unknown>;
  /** Patch the task (status and description only). */
  updateIssue: (issueId: string, patch: { status?: string; description?: string }) => Promise<unknown>;
  /** Bring the worker back to a task the reviewer sent back. */
  wakeAgent: (input: { issueId: string; agentId: string; status: string }) => Promise<unknown>;
  log: (message: string) => unknown;
};

export type JudgeApplyResult =
  /** Close the task: the reviewer passed it and the company accepts passes. */
  | "accept"
  /** Hand the turn to the person: a pass they asked to see, or two failed rounds. */
  | "handoff"
  /** Already applied: the task went back to To do and the worker was woken. */
  | "revise"
  /** No review happened; keep whatever the worker's own reply asked for. */
  | "none";

export async function applyJudgeReview(
  deps: JudgeApplyDeps,
  input: {
    issue: { id: string; description: string | null };
    assigneeAgentId: string | null;
    review: JudgeReviewResult;
  },
): Promise<JudgeApplyResult> {
  const { review } = input;
  if (review.outcome.kind === "skip") return "none";

  if (review.comment && review.judgeAgent) {
    await deps.addComment(input.issue.id, review.comment, review.judgeAgent.id);
  }

  if (review.outcome.kind === "accept") {
    deps.log("[todero] The reviewer passed it; accepting the task.\n");
    return "accept";
  }

  if (review.outcome.kind === "handoff") {
    deps.log(
      review.outcome.because === "passed"
        ? "[todero] The reviewer passed it; waiting for you to accept.\n"
        : "[todero] The reviewer sent it back twice; over to you.\n",
    );
    return "handoff";
  }

  // revise: back to the worker with the reviewer's paragraph.
  await deps.updateIssue(input.issue.id, {
    status: "todo",
    description: descriptionWithJudgeFailRounds(input.issue.description, review.outcome.round),
  });
  if (input.assigneeAgentId) {
    await deps.wakeAgent({ issueId: input.issue.id, agentId: input.assigneeAgentId, status: "todo" });
  }
  deps.log(`[todero] The reviewer sent it back (round ${review.outcome.round}).\n`);
  return "revise";
}

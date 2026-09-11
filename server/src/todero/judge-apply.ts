/**
 * Turning a reviewer's verdict into what the task actually does. Kept out of
 * the heartbeat so the decision can be tested without a database: the caller
 * passes in four small actions and gets back what the task's status should
 * become.
 */
import { JUDGE_MAX_FAIL_ROUNDS, descriptionWithJudgeFailRounds, readJudgeFailRounds } from "./judge.js";
import type { JudgeOutcome } from "./judge.js";
import { descriptionWithWaitingForManagerMarker } from "./manager-sendback.js";
import type { JudgeReviewResult } from "./judge-review.js";

/**
 * Which send-back this is, counting from one.
 *
 * The reviewer's plan stops saying "revise" at the cap: the last send-back it
 * allows arrives as "over to you" instead, so the round it stands for has to
 * be read back off the task rather than taken from the outcome. Returns null
 * when the verdict was not a send-back at all.
 */
export function judgeFailRound(
  outcome: JudgeOutcome,
  description: string | null | undefined,
): number | null {
  if (outcome.kind === "revise") return outcome.round;
  if (outcome.kind === "handoff" && outcome.because === "rounds_exhausted") {
    return readJudgeFailRounds(description) + 1;
  }
  return null;
}

export type JudgeApplyDeps = {
  /** Post a comment authored by the reviewer agent. */
  addComment: (issueId: string, body: string, agentId: string) => Promise<unknown>;
  /** Patch the task (status, description, and who holds it). */
  updateIssue: (
    issueId: string,
    patch: { status?: string; description?: string; assigneeAgentId?: string },
  ) => Promise<unknown>;
  /** Bring the worker back to a task the reviewer sent back. */
  wakeAgent: (input: { issueId: string; agentId: string; status: string }) => Promise<unknown>;
  /** (Manager mode) Send the task to the manager for a rewritten brief instead of straight back to the worker. */
  wakeManagerForSendback?: (input: {
    issueId: string;
    managerId: string;
    reason: "reviewer_fail" | "person_sendback";
    failRound: number;
    taskIdentifier: string | null;
    taskTitle: string;
  }) => Promise<unknown>;
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
    issue: { id: string; description: string | null; identifier?: string | null; title?: string };
    assigneeAgentId: string | null;
    review: JudgeReviewResult;
    /** Manager mode: if true and this is a second fail, route through manager instead of worker. */
    managerMode?: boolean;
    /** Manager ID for send-back routing (required if managerMode is true). */
    managerId?: string;
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

  // Which send-back this is. The second one is the manager's: the reviewer's
  // plan calls it "over to you", and in manager mode the manager is the one
  // who takes it, rewrites the brief, and hands it back to a worker.
  const round = judgeFailRound(review.outcome, input.issue.description);
  const wakeManagerForSendback = deps.wakeManagerForSendback;
  const managerId = input.managerId;
  const shouldWakeManager = Boolean(
    input.managerMode && managerId && wakeManagerForSendback && round === JUDGE_MAX_FAIL_ROUNDS,
  );

  if (review.outcome.kind === "handoff" && !shouldWakeManager) {
    deps.log(
      review.outcome.because === "passed"
        ? "[todero] The reviewer passed it; waiting for you to accept.\n"
        : "[todero] The reviewer sent it back twice; over to you.\n",
    );
    return "handoff";
  }

  // Back to the worker with the reviewer's paragraph — or to the manager first,
  // when it is the manager's send-back. A later send-back than that (only
  // reachable if the cap is raised) goes to the person, so a task can never
  // bounce between the manager and the reviewer forever.
  let updatedDescription = descriptionWithJudgeFailRounds(input.issue.description, round ?? 1);

  if (shouldWakeManager) {
    // The manager holds the task while it rewrites the brief: Todero cancels a
    // queued turn whose agent does not own the task. The marker remembers whose
    // it was.
    updatedDescription = descriptionWithWaitingForManagerMarker(updatedDescription, input.assigneeAgentId);
  }

  await deps.updateIssue(input.issue.id, {
    status: "todo",
    description: updatedDescription,
    ...(shouldWakeManager && managerId ? { assigneeAgentId: managerId } : {}),
  });

  if (shouldWakeManager && wakeManagerForSendback && managerId) {
    await wakeManagerForSendback({
      issueId: input.issue.id,
      managerId,
      reason: "reviewer_fail",
      failRound: round ?? 1,
      taskIdentifier: input.issue.identifier ?? null,
      taskTitle: input.issue.title ?? "task",
    });
    deps.log(`[todero] The reviewer sent it back (round ${round ?? 1}); waking the manager.\n`);
  } else if (input.assigneeAgentId) {
    await deps.wakeAgent({ issueId: input.issue.id, agentId: input.assigneeAgentId, status: "todo" });
    deps.log(`[todero] The reviewer sent it back (round ${round ?? 1}).\n`);
  } else {
    deps.log(`[todero] The reviewer sent it back (round ${round ?? 1}).\n`);
  }

  return "revise";
}

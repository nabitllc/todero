/**
 * Turning a reviewer's verdict into what the task actually does. Kept out of
 * the heartbeat so the decision can be tested without a database: the caller
 * passes in four small actions and gets back what the task's status should
 * become.
 */
import { descriptionForDeferredReview } from "./conversation-outcome.js";
import { descriptionWithEmptyTurnTries, emptyTurnInstructionForWake } from "./empty-turn-recovery.js";
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

/** Why the worker is being brought back: the reviewer sent its work back. */
export const JUDGE_REVISION_WAKE_REASON = "issue_judge_revision";

/**
 * Where the reviewer's own words travel when the worker is brought back: the
 * wake carries them, and the turn is built from them at the other end.
 */
export const JUDGE_RETRY_NOTE_KEY = "judgeRetryNote";

/** How much of the reviewer's paragraph the worker's turn quotes. */
export const JUDGE_RETRY_NOTE_MAX_CHARS = 600;

function readRetryNote(context: unknown): string | null {
  if (!context || typeof context !== "object" || Array.isArray(context)) return null;
  const value = (context as Record<string, unknown>)[JUDGE_RETRY_NOTE_KEY];
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * What is added to the worker's turn when the reviewer sends work back.
 *
 * Wave 21: told its guides were not ready for publication, the worker replied
 * with a three-step plan to format and export them. That is a reasonable thing
 * to say and a useless thing to hand in — the task then had no guides on it at
 * all, and the second refusal was right. A send-back asks for the work, so the
 * turn says so.
 *
 * Wave 7 adds the reviewer's own sentence to it. A worker whose second try is
 * the first one under a corrected brief cannot see what changed: the thread
 * holds two older refusals saying something else entirely. Told in the turn
 * itself what this reviewer says is missing, it has one thing to answer.
 */
export function buildJudgeRetryInstruction(reviewerNote?: string | null): string {
  const lines = [
    "Your reviewer sent this back. Read what it asked for and hand in the work itself, complete, in"
      + " this reply — the whole thing, written out, not the parts you changed.",
    "Do not describe what you would do, and do not write a plan for doing it. The reply is the"
      + " hand-in.",
  ];
  const note = (reviewerNote ?? "").replace(/\s+/g, " ").trim();
  if (note) {
    const quoted = note.length > JUDGE_RETRY_NOTE_MAX_CHARS
      ? `${note.slice(0, JUDGE_RETRY_NOTE_MAX_CHARS - 1)}…`
      : note;
    lines.push(`What your reviewer says is missing: "${quoted}"`);
  }
  return lines.join("\n");
}

/**
 * What Todero adds to a conversational worker's turn for the reason it was
 * woken: the reviewer's send-back, a turn that produced nothing, or neither.
 *
 * The wake that brought the worker back is handed in whole, because a
 * send-back may have kept the reviewer's words on it. Nothing else is read off
 * it, and a wake without them says exactly what it said before.
 */
export function instructionForConversationWake(
  wakeReason: string | null | undefined,
  wakeContext?: unknown,
): string | null {
  if (wakeReason === JUDGE_REVISION_WAKE_REASON) return buildJudgeRetryInstruction(readRetryNote(wakeContext));
  return emptyTurnInstructionForWake(wakeReason);
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

/**
 * Why nobody reviewed a hand-in, in words a person reads.
 *
 * Wave 16's live loop: a task was handed in, the reviewer never spoke, and
 * neither the run log nor the thread said anything at all — the cause could
 * not be worked out afterwards. Every way of skipping a review now leaves one
 * line behind.
 */
export function skippedReviewReasonText(skipped: JudgeReviewResult["skipped"]): string {
  switch (skipped) {
    case "paused":
      return "the organization is paused";
    case "not_a_plan_task":
      return "this task is not part of a plan";
    case "no_deliverable":
      return "the task handed in nothing to look at";
    case "no_reviewer":
      return "this team has nobody who reviews work";
    case "no_model":
      return "the reviewer has no model to think with";
    case "no_verdict":
      return "the reviewer gave no answer";
    default:
      return "no reason was recorded";
  }
}

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
  // Anything that reaches the reviewer is real work handed in, so the count of
  // turns that produced none starts again here. This function writes the task's
  // text back, and the copy it is handed was taken before the hand-in was
  // saved; without this, an empty turn, a real hand-in and a send-back left the
  // count standing, which skipped the one corrective turn the next empty turn
  // is owed and then told the person the task had produced no work twice.
  //
  // This is one of three places the count is cleared, not the only one: the
  // hand-in write clears it (`heartbeat.ts`), this clears it on every text it
  // writes, and closing a task clears it for good
  // (`descriptionWithoutConversationMarkers`), which is what catches the
  // accept that closes a task without coming through here at all.
  const description = descriptionWithEmptyTurnTries(input.issue.description, 0);
  if (review.outcome.kind === "skip") {
    // A hold is the one skip that comes back. Waves 16-18: the hand-in was
    // right, the reviewer was simply not allowed to speak, and nothing ever
    // asked again — the task sat in front of a person who was never told, and
    // every task behind it waited with it. The task now says it is still owed
    // an answer, and starting the organization again gives it one.
    if (review.skipped === "paused") {
      await deps.updateIssue(input.issue.id, {
        description: descriptionForDeferredReview(description),
      });
      deps.log(
        "[todero] No reviewer looked at this hand-in: the organization is paused."
          + " It will be reviewed when the organization starts again.\n",
      );
      return "none";
    }
    deps.log(`[todero] No reviewer looked at this hand-in: ${skippedReviewReasonText(review.skipped)}.\n`);
    return "none";
  }

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
  let updatedDescription = descriptionWithJudgeFailRounds(description, round ?? 1);

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

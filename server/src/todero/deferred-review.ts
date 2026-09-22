/**
 * The reviews a hold deferred, and what starting an organization again does
 * about them.
 *
 * Waves 16, 17 and 18 of the improvement loop all failed the same way. A task
 * handed its work in, the organization was on hold at that second, and nothing
 * may talk to a model during a hold — so no reviewer looked at it. That was
 * right. What was wrong is that nothing ever came back for it: the task sat in
 * front of a person who was never told, and every task waiting on it waited
 * with it. On wave 17 one task held up six others for thirty-five minutes and
 * the whole run finished with nothing done.
 *
 * So a hand-in a hold skipped is remembered (judge-apply writes the note), and
 * the moment an organization starts again — Play, Resume everything, or an
 * archived organization opened again — the reviews it owes are run here.
 *
 * Nothing in here reaches for the heartbeat. The runner is handed its db, its
 * way of waking an agent and its log, and the one composition that knows all
 * three installs it at startup.
 */
import { eq } from "drizzle-orm";
import { companies, type Db } from "@todero/db";
import { logger } from "../middleware/logger.js";
import { issueService } from "../services/issues.js";
import {
  enqueueWakesForClosedIssue,
  type ClosedIssueWake,
} from "../services/issue-closed-wakeups.js";
import {
  descriptionWithDeferredReviewMarker,
  descriptionWithoutConversationMarkers,
} from "./conversation-outcome.js";
import {
  claimDeferredHandIn,
  loadDeferredHandIns,
  noReviewerNote,
  type DeferredHandIn,
} from "./deferred-review-find.js";
import {
  applyJudgeReview,
  JUDGE_RETRY_NOTE_KEY,
  skippedReviewReasonText,
  type JudgeApplyResult,
} from "./judge-apply.js";
import { reviewConversationHandIn, type JudgeReviewResult } from "./judge-review.js";
import { readAutoAcceptWhenJudgePasses } from "./judge.js";
import { recoverParkedTurns } from "./parked-turn-recovery.js";
import { refreshRefusedHandIns } from "./refused-review-refresh.js";

export type { DeferredHandIn } from "./deferred-review-find.js";

/**
 * What to write on a task once its deferred review has an answer.
 *
 * An accept closes the task the same way a person's Accept does. A send-back
 * already rewrote the task on its way back to the worker, and an answer nobody
 * could give is recorded by the note Todero leaves on the task instead - so
 * both of those write nothing here.
 */
export function planDeferredSettlement(
  task: { description: string | null },
  applied: JudgeApplyResult,
): { status?: string; description: string } | null {
  if (applied === "revise" || applied === "none") return null;
  if (applied === "accept") {
    return { status: "done", description: descriptionWithoutConversationMarkers(task.description) };
  }
  return { description: descriptionWithDeferredReviewMarker(task.description, false) };
}

export type DeferredReviewActions = {
  /** Is the organization still running? Asked before every task, not once. */
  stillRunning: () => Promise<boolean>;
  /** Take the task, or null when somebody else already has it. */
  claim: (task: DeferredHandIn) => Promise<string | null>;
  review: (task: DeferredHandIn) => Promise<JudgeReviewResult>;
  apply: (task: DeferredHandIn, review: JudgeReviewResult) => Promise<JudgeApplyResult>;
  settle: (task: DeferredHandIn, applied: JudgeApplyResult, review: JudgeReviewResult) => Promise<unknown>;
  log: (message: string) => unknown;
};

export type DeferredReviewTally = {
  reviewed: number;
  failed: number;
  /** Put back on hold part-way through; whatever is left waits for the next start. */
  stopped: boolean;
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Review them one at a time. One task that goes wrong must never cost the
 * others theirs: that is the whole failure this exists to undo.
 *
 * Two things are asked before every single task, not once at the top. Whether
 * the organization is still running, because a person can put it back on hold
 * while this is half done and each task takes minutes on a small machine. And
 * whether this pass can take the task at all, because another pass may have
 * taken it in the meantime.
 */
export async function runDeferredReviews(
  actions: DeferredReviewActions,
  tasks: DeferredHandIn[],
): Promise<DeferredReviewTally> {
  let reviewed = 0;
  let failed = 0;
  for (const task of tasks) {
    if (!(await actions.stillRunning())) {
      actions.log(
        "[todero] The organization was put on hold again. The work still waiting for an answer"
          + " will be looked at when it starts once more.\n",
      );
      return { reviewed, failed, stopped: true };
    }
    try {
      const text = await actions.claim(task);
      // Somebody else is already reviewing this hand-in.
      if (text === null) continue;
      const taken = { ...task, description: text };
      const review = await actions.review(taken);
      const applied = await actions.apply(taken, review);
      await actions.settle(taken, applied, review);
      reviewed += 1;
    } catch (error) {
      failed += 1;
      actions.log(
        `[todero] Could not review the work handed in on ${task.identifier ?? task.title}: ${messageOf(error)}\n`,
      );
    }
  }
  return { reviewed, failed, stopped: false };
}

export type DeferredReviewWakeup = (agentId: string, wakeup: ClosedIssueWake) => Promise<unknown>;

export type DeferredReviewDeps = {
  enqueueWakeup: DeferredReviewWakeup;
  log?: (message: string) => unknown;
};

export type DeferredReviewOutcome = DeferredReviewTally & {
  /** A pass for this organization was already under way, so this call did nothing. */
  alreadyRunning: boolean;
};

const NOTHING_TO_DO: DeferredReviewOutcome = { reviewed: 0, failed: 0, stopped: false, alreadyRunning: false };

/** One pass per organization at a time, for as long as that pass is running. */
const passes = new Map<string, Promise<DeferredReviewOutcome>>();

/**
 * The reviews one organization owes, run now. Everything a hand-in needs is
 * read back off the task: the work from its Output document, the reviewer
 * through the agent who handed it in, the accept-on-pass setting off the
 * organization.
 *
 * Only one pass per organization runs at a time. Resume everything starts one
 * for every organization at once, and a hold and a Play inside the minutes a
 * pass takes would start a second over the same hand-ins; the second one does
 * nothing and says so.
 */
export function reviewDeferredHandIns(
  db: Db,
  deps: DeferredReviewDeps,
  input: { companyId: string },
): Promise<DeferredReviewOutcome> {
  if (passes.has(input.companyId)) {
    return Promise.resolve({ ...NOTHING_TO_DO, alreadyRunning: true });
  }
  const pass = runOneDeferredReviewPass(db, deps, input).finally(() => {
    passes.delete(input.companyId);
  });
  passes.set(input.companyId, pass);
  return pass;
}

async function readCompanyStatus(db: Db, companyId: string): Promise<string | null> {
  const row = await db
    .select({ status: companies.status })
    .from(companies)
    .where(eq(companies.id, companyId))
    .limit(1)
    .then((rows) => rows[0] ?? null);
  return row?.status ?? null;
}

async function runOneDeferredReviewPass(
  db: Db,
  deps: DeferredReviewDeps,
  input: { companyId: string },
): Promise<DeferredReviewOutcome> {
  const tasks = await loadDeferredHandIns(db, input.companyId);
  if (tasks.length === 0) return NOTHING_TO_DO;
  const tally = await runReviewPass(db, deps, {
    companyId: input.companyId,
    tasks,
    claim: (task) => claimDeferredHandIn(db, task),
  });
  return { ...tally, alreadyRunning: false };
}

/**
 * Review a list of hand-ins and write what the reviewer decided onto each
 * task. Everything a hand-in needs is read back off the task, so the only
 * thing a caller brings besides the list is how a task is taken: the reviews a
 * hold deferred flip their own mark, and a refusal being looked at again flips
 * its own.
 */
export async function runReviewPass(
  db: Db,
  deps: DeferredReviewDeps,
  input: {
    companyId: string;
    tasks: DeferredHandIn[];
    claim: (task: DeferredHandIn) => Promise<string | null>;
  },
): Promise<DeferredReviewTally> {
  const log = deps.log ?? ((message: string) => logger.info({ companyId: input.companyId }, message.trim()));

  const company = await db
    .select({ name: companies.name, interactionResolverGovernance: companies.interactionResolverGovernance })
    .from(companies)
    .where(eq(companies.id, input.companyId))
    .limit(1)
    .then((rows) => rows[0] ?? null);
  const autoAcceptWhenJudgePasses = readAutoAcceptWhenJudgePasses(company?.interactionResolverGovernance ?? {});
  const issuesSvc = issueService(db);
  // What the organization was doing, read again immediately before each task
  // rather than assumed from the fact that something started it a while ago.
  let statusWhenTaken: string | null = null;

  const tally = await runDeferredReviews(
    {
      log,
      stillRunning: async () => {
        statusWhenTaken = await readCompanyStatus(db, input.companyId);
        return statusWhenTaken === "active";
      },
      claim: input.claim,
      review: (task) =>
        reviewConversationHandIn(db, {
          issue: {
            id: task.id,
            companyId: task.companyId,
            title: task.title,
            description: task.description,
            parentId: task.parentId,
          },
          deliverable: task.deliverable,
          leadAgentId: task.assigneeAgentId ?? "",
          companyName: company?.name ?? null,
          companyStatus: statusWhenTaken,
          autoAcceptWhenJudgePasses,
        }),
      apply: (task, review) =>
        applyJudgeReview(
          {
            addComment: (id, body, judgeAgentId) => issuesSvc.addComment(id, body, { agentId: judgeAgentId }),
            updateIssue: (id, patch) =>
              issuesSvc.update(id, { ...patch, actorAgentId: task.assigneeAgentId ?? undefined }),
            // The reviewer's own sentence rides along with the wake, so the
            // worker's turn can say what this reviewer wants rather than
            // leaving it to find that out from a thread holding older
            // refusals that said something else.
            wakeAgent: ({ issueId, agentId }) =>
              deps.enqueueWakeup(agentId, {
                source: "automation",
                triggerDetail: "system",
                reason: "issue_judge_revision",
                payload: { issueId, mutation: "update" },
                requestedByActorType: "system",
                requestedByActorId: null,
                contextSnapshot: {
                  issueId,
                  source: "issue.deferred_review",
                  [JUDGE_RETRY_NOTE_KEY]: review.note ?? null,
                },
              }).catch(() => null),
            log,
          },
          {
            issue: {
              id: task.id,
              identifier: task.identifier,
              title: task.title,
              description: descriptionWithoutConversationMarkers(task.description),
            },
            assigneeAgentId: task.assigneeAgentId,
            review,
          },
        ),
      settle: async (task, applied, review) => {
        // Nobody could look at it, and nobody will without the person: a team
        // with no reviewer, a reviewer with no model, a reviewer that said
        // nothing usable. Say so on the task, once. Without this the same task
        // is picked up and written to on every single start, for nothing.
        if (applied === "none" && review.skipped && review.skipped !== "paused") {
          await issuesSvc.addComment(
            task.id,
            noReviewerNote(skippedReviewReasonText(review.skipped)),
            {},
            { authorType: "system" },
          );
          log(
            `[todero] Nobody could look at the work handed in on ${task.identifier ?? task.title}:`
              + ` ${skippedReviewReasonText(review.skipped)}. It is waiting for the person.\n`,
          );
        }
        const settlement = planDeferredSettlement(task, applied);
        if (!settlement) return;
        // Writing back exactly what the task already says costs the person a
        // change on their board and a line in the task's history for nothing.
        if (settlement.status === undefined && settlement.description === task.description) return;
        await issuesSvc.update(task.id, {
          ...settlement,
          actorAgentId: task.assigneeAgentId ?? undefined,
        });
        if (applied !== "accept") return;
        // Closing a task through the API wakes whatever was queued behind it
        // and, once it was the last one, the parent for its wrap-up. This
        // close does not go through that route, so the same two wakes are
        // raised here - without them the tasks this one was blocking stay
        // blocked, which is exactly what the loop kept seeing.
        await enqueueWakesForClosedIssue(
          {
            listWakeableBlockedDependents: (blockerIssueId) =>
              issuesSvc.listWakeableBlockedDependents(blockerIssueId),
            getWakeableParentAfterChildCompletion: (parentIssueId) =>
              issuesSvc.getWakeableParentAfterChildCompletion(parentIssueId),
            enqueueWakeup: (agentId, wakeup) => deps.enqueueWakeup(agentId, wakeup),
            log: (message) => {
              log(message);
            },
          },
          {
            issue: { id: task.id, companyId: task.companyId, parentId: task.parentId },
            source: "issue.deferred_review_accepted",
          },
        );
      },
    },
    input.tasks,
  );
  return tally;
}

/**
 * The seam the three places an organization can start again call, so none of
 * them has to know how a review is run. Nothing happens until the wiring puts
 * a runner here, which keeps every one of those callers testable on its own.
 */
export type DeferredReviewRunner = (companyId: string) => Promise<unknown>;

let runner: DeferredReviewRunner | null = null;

export function setDeferredReviewRunner(next: DeferredReviewRunner | null): void {
  runner = next;
}

/**
 * The one composition, installed where the db and a way to wake an agent are
 * both in hand.
 *
 * Three things happen at this door, in this order. First the hand-ins nobody
 * answered while the organization was on hold. Then the tasks that were parked
 * in front of the person with nothing on them to answer — a task parked before
 * the corrective turn existed has no other way back, because nothing wakes a
 * parked task. Last, the work the reviewer refused and left with the person:
 * each of those is read once more, the way the reviewer reads work today. The
 * reviews go first: one of them may accept a hand-in and unblock the very
 * tasks the later passes would otherwise walk over.
 *
 * Each pass is caught on its own. They are three different ways back into a
 * stuck organization, and one falling over — a database read that fails, a
 * reviewer that is not there — must not cost the others their turn. Whatever
 * went wrong is written down in plain words rather than swallowed.
 */
export function installDeferredReviewsOnResume(db: Db, enqueueWakeup: DeferredReviewWakeup): void {
  setDeferredReviewRunner(async (companyId) => {
    let reviews: unknown = null;
    try {
      reviews = await reviewDeferredHandIns(db, { enqueueWakeup }, { companyId });
    } catch (err: unknown) {
      logger.warn({ err, companyId }, "could not review the hand-ins this organization's hold deferred");
    }
    try {
      await recoverParkedTurns(db, { enqueueWakeup }, { companyId });
    } catch (err: unknown) {
      logger.warn({ err, companyId }, "could not start the tasks parked with nothing to answer");
    }
    try {
      await refreshRefusedHandIns(db, { enqueueWakeup }, { companyId });
    } catch (err: unknown) {
      logger.warn({ err, companyId }, "could not look again at the work the reviewer sent back");
    }
    return reviews;
  });
}

/**
 * An organization has started again. Fire and forget: nobody who pressed Play
 * waits while a model on this machine reads a hand-in.
 */
export function reviewDeferredHandInsOnResume(companyId: string): void {
  const run = runner;
  if (!run) return;
  void Promise.resolve()
    .then(() => run(companyId))
    .catch((err: unknown) => {
      // Each pass writes its own line, so this one only ever covers what went
      // wrong around them both.
      logger.warn({ err, companyId }, "could not look at what this organization's hold left waiting");
    });
}

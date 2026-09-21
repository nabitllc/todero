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
import { and, desc, eq, isNull } from "drizzle-orm";
import { companies, issueComments, issues, type Db } from "@todero/db";
import { logger } from "../middleware/logger.js";
import { documentService } from "../services/documents.js";
import { issueService } from "../services/issues.js";
import {
  enqueueWakesForClosedIssue,
  type ClosedIssueWake,
} from "../services/issue-closed-wakeups.js";
import {
  CONVERSATION_OUTPUT_DOCUMENT_KEY,
  descriptionWithDeferredReviewMarker,
  descriptionWithoutConversationMarkers,
  hasDeferredReviewMarker,
} from "./conversation-outcome.js";
import { applyJudgeReview, type JudgeApplyResult } from "./judge-apply.js";
import { findJudgeAgentForHandIn, reviewConversationHandIn, type JudgeReviewResult } from "./judge-review.js";
import { readAutoAcceptWhenJudgePasses } from "./judge.js";
import { isWaitingOnPersonToAccept } from "./manager-person-comment.js";

/** A task whose hand-in is still owed a reviewer's answer. */
export type DeferredHandIn = {
  id: string;
  companyId: string;
  identifier: string | null;
  title: string;
  description: string | null;
  parentId: string | null;
  assigneeAgentId: string | null;
  status: string;
  /** The work itself, as the reviewer will read it: the task's Output document. */
  deliverable: string;
  /** When that hand-in was last written. */
  handedInAt: Date | null;
  /** The last time the reviewer said anything on this task, if it ever did. */
  reviewerSpokeAt: Date | null;
};

/**
 * Which of a company's stopped tasks are still owed a review.
 *
 * Two ways in. One is the note judge-apply leaves when a hold skips a review.
 * The other is the observable truth of the same thing, for tasks handed in
 * before that note existed: the work is in front of the person, there is
 * something to look at, and the reviewer has said nothing about it since it
 * arrived. That second one is what lets an organization that is already stuck
 * be rescued rather than only the next one prevented.
 */
export function findDeferredHandIns(tasks: DeferredHandIn[]): DeferredHandIn[] {
  return tasks.filter((task) => {
    if (task.status !== "blocked") return false;
    if (hasDeferredReviewMarker(task.description)) return true;
    if (!isWaitingOnPersonToAccept(task.description)) return false;
    if (!task.deliverable.trim()) return false;
    if (!task.reviewerSpokeAt || !task.handedInAt) return !task.reviewerSpokeAt;
    return task.reviewerSpokeAt.getTime() < task.handedInAt.getTime();
  });
}

/** The newest thing one agent said on one task. */
async function lastCommentAt(db: Db, issueId: string, agentId: string): Promise<Date | null> {
  const row = await db
    .select({ createdAt: issueComments.createdAt })
    .from(issueComments)
    .where(and(
      eq(issueComments.issueId, issueId),
      eq(issueComments.authorAgentId, agentId),
      isNull(issueComments.deletedAt),
    ))
    .orderBy(desc(issueComments.createdAt))
    .limit(1)
    .then((rows) => rows[0] ?? null);
  return row?.createdAt ?? null;
}

/** Read a company's stopped tasks and keep the ones still owed a review. */
export async function loadDeferredHandIns(db: Db, companyId: string): Promise<DeferredHandIn[]> {
  const rows = await db
    .select({
      id: issues.id,
      companyId: issues.companyId,
      identifier: issues.identifier,
      title: issues.title,
      description: issues.description,
      parentId: issues.parentId,
      assigneeAgentId: issues.assigneeAgentId,
      status: issues.status,
    })
    .from(issues)
    .where(and(eq(issues.companyId, companyId), eq(issues.status, "blocked")));

  const documents = documentService(db);
  const candidates: DeferredHandIn[] = [];
  for (const row of rows) {
    // Nobody handed it in, so there is nobody whose reviewer to look up.
    if (!row.assigneeAgentId) continue;
    if (!hasDeferredReviewMarker(row.description) && !isWaitingOnPersonToAccept(row.description)) continue;
    const output = await documents
      .getIssueDocumentByKey(row.id, CONVERSATION_OUTPUT_DOCUMENT_KEY)
      .catch(() => null);
    const reviewer = await findJudgeAgentForHandIn(db, {
      companyId,
      leadAgentId: row.assigneeAgentId,
    }).catch(() => null);
    candidates.push({
      ...row,
      deliverable: output?.body ?? "",
      handedInAt: output?.updatedAt ?? null,
      reviewerSpokeAt: reviewer ? await lastCommentAt(db, row.id, reviewer.id) : null,
    });
  }
  return findDeferredHandIns(candidates);
}

/**
 * What to write on a task once its deferred review has an answer.
 *
 * The promise comes off whatever the answer was, so one hand-in is never
 * reviewed twice. An accept closes the task the same way a person's Accept
 * does. A send-back already rewrote the task on its way back to the worker,
 * so there is nothing left to write.
 */
export function planDeferredSettlement(
  task: { description: string | null },
  applied: JudgeApplyResult,
): { status?: string; description: string } | null {
  if (applied === "revise") return null;
  if (applied === "accept") {
    return { status: "done", description: descriptionWithoutConversationMarkers(task.description) };
  }
  return { description: descriptionWithDeferredReviewMarker(task.description, false) };
}

export type DeferredReviewActions = {
  review: (task: DeferredHandIn) => Promise<JudgeReviewResult>;
  apply: (task: DeferredHandIn, review: JudgeReviewResult) => Promise<JudgeApplyResult>;
  settle: (task: DeferredHandIn, applied: JudgeApplyResult) => Promise<unknown>;
  log: (message: string) => unknown;
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Review them one at a time. One task that goes wrong must never cost the
 * others theirs: that is the whole failure this exists to undo.
 */
export async function runDeferredReviews(
  actions: DeferredReviewActions,
  tasks: DeferredHandIn[],
): Promise<{ reviewed: number; failed: number }> {
  let reviewed = 0;
  let failed = 0;
  for (const task of tasks) {
    try {
      const review = await actions.review(task);
      const applied = await actions.apply(task, review);
      await actions.settle(task, applied);
      reviewed += 1;
    } catch (error) {
      failed += 1;
      actions.log(
        `[todero] Could not review the work handed in on ${task.identifier ?? task.title}: ${messageOf(error)}\n`,
      );
    }
  }
  return { reviewed, failed };
}

export type DeferredReviewWakeup = (agentId: string, wakeup: ClosedIssueWake) => Promise<unknown>;

export type DeferredReviewDeps = {
  enqueueWakeup: DeferredReviewWakeup;
  log?: (message: string) => unknown;
};

/**
 * The reviews one organization owes, run now. Everything a hand-in needs is
 * read back off the task: the work from its Output document, the reviewer
 * through the agent who handed it in, the accept-on-pass setting off the
 * organization.
 */
export async function reviewDeferredHandIns(
  db: Db,
  deps: DeferredReviewDeps,
  input: { companyId: string },
): Promise<{ reviewed: number; failed: number }> {
  const log = deps.log ?? ((message: string) => logger.info({ companyId: input.companyId }, message.trim()));
  const tasks = await loadDeferredHandIns(db, input.companyId);
  if (tasks.length === 0) return { reviewed: 0, failed: 0 };

  const company = await db
    .select({ name: companies.name, interactionResolverGovernance: companies.interactionResolverGovernance })
    .from(companies)
    .where(eq(companies.id, input.companyId))
    .limit(1)
    .then((rows) => rows[0] ?? null);
  const autoAcceptWhenJudgePasses = readAutoAcceptWhenJudgePasses(company?.interactionResolverGovernance ?? {});
  const issuesSvc = issueService(db);

  return runDeferredReviews(
    {
      log,
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
          // The organization is running again by the time this is called; that
          // is the whole point of calling it here.
          companyStatus: "active",
          autoAcceptWhenJudgePasses,
        }),
      apply: (task, review) =>
        applyJudgeReview(
          {
            addComment: (id, body, judgeAgentId) => issuesSvc.addComment(id, body, { agentId: judgeAgentId }),
            updateIssue: (id, patch) =>
              issuesSvc.update(id, { ...patch, actorAgentId: task.assigneeAgentId ?? undefined }),
            wakeAgent: ({ issueId, agentId }) =>
              deps.enqueueWakeup(agentId, {
                source: "automation",
                triggerDetail: "system",
                reason: "issue_judge_revision",
                payload: { issueId, mutation: "update" },
                requestedByActorType: "system",
                requestedByActorId: null,
                contextSnapshot: { issueId, source: "issue.deferred_review" },
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
      settle: async (task, applied) => {
        const settlement = planDeferredSettlement(task, applied);
        if (!settlement) return;
        await issuesSvc.update(task.id, {
          ...settlement,
          actorAgentId: task.assigneeAgentId ?? undefined,
        });
        if (applied !== "accept") return;
        // Closing a task through the API wakes whatever was queued behind it
        // and, once it was the last one, the parent for its wrap-up. This
        // close does not go through that route, so the same two wakes are
        // raised here — without them the tasks this one was blocking stay
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
    tasks,
  );
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

/** The one composition, installed where the db and a way to wake an agent are both in hand. */
export function installDeferredReviewsOnResume(db: Db, enqueueWakeup: DeferredReviewWakeup): void {
  setDeferredReviewRunner((companyId) => reviewDeferredHandIns(db, { enqueueWakeup }, { companyId }));
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
      logger.warn({ err, companyId }, "could not review the hand-ins this organization's hold deferred");
    });
}

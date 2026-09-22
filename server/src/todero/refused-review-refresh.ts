/**
 * The way back for a hand-in the reviewer refused.
 *
 * Wave 6 of the improvement loop, and the second wall three waves in a row ran
 * into. Every stuck organization ends the same way: a task handed real work
 * in, the reviewer refused it twice, and the task is parked in front of a
 * person with "over to you" on it. Nothing ever comes back for those. The
 * reviews a hold deferred are not them — a reviewer did speak. The tasks
 * parked with nothing to answer are not them either — a real hand-in is
 * exactly what they have. So reopening wave 20's organization in wave 21 ran
 * not one turn, and a person who updates Todero the day after a project stalls
 * gets nothing at all from a fix to the reviewer.
 *
 * So every resume gives each of them one fresh review, under whatever the
 * reviewer's brief says today. Once: a mark on the task says it has had its
 * look, and that mark comes off when the task hands work in again or closes.
 * A task at the reviewer's two-refusal cap is still offered one, because that
 * cap counted refusals under the old brief.
 *
 * The rule is pure and sits at the top; the database reads are under it, and
 * the reviewing itself is the same pass the deferred reviews run through.
 */
import { and, desc, eq, isNull } from "drizzle-orm";
import { issueComments, issues, type Db } from "@todero/db";
import { logger } from "../middleware/logger.js";
import { documentService } from "../services/documents.js";
import {
  CONVERSATION_OUTPUT_DOCUMENT_KEY,
  descriptionWithRefreshedReviewMarker,
  hasRefreshedReviewMarker,
  hasReviewPendingNote,
} from "./conversation-outcome.js";
import {
  runReviewPass,
  type DeferredReviewDeps,
  type DeferredReviewTally,
} from "./deferred-review.js";
import { type DeferredHandIn } from "./deferred-review-find.js";
import {
  descriptionWithJudgeFailRounds,
  JUDGE_OVER_TO_YOU_OPENING,
  JUDGE_SENT_BACK_OPENING,
} from "./judge.js";
import { findJudgeAgentForHandIn } from "./judge-review.js";

/** A parked task whose last word from the reviewer was a refusal. */
export type RefusedHandIn = DeferredHandIn & {
  /** Was that newest reviewer comment a send-back rather than a pass? */
  reviewerSentItBack: boolean;
  /** The last time a person said anything on this task. */
  personSpokeAt: Date | null;
  /** Todero has already given this refusal its one fresh look. */
  alreadyRefreshed: boolean;
};

/**
 * Is this comment the reviewer refusing the work? Both of its refusals open
 * with a fixed sentence, and those are the sentences this reads.
 */
export function saysTheReviewerSentItBack(body: string | null | undefined): boolean {
  const text = (body ?? "").trim();
  if (!text) return false;
  return text.startsWith(JUDGE_SENT_BACK_OPENING) || text.startsWith(JUDGE_OVER_TO_YOU_OPENING);
}

/**
 * Which parked tasks are a refused hand-in waiting on nobody.
 *
 * A task whose reviewer never spoke belongs to the deferred rule next door,
 * not here. A task a person has answered is already moving. A task that handed
 * work in after the refusal has a newer hand-in than the refusal, so the
 * refusal is not the last thing that happened to it. And a task that has had
 * its fresh look keeps it: one look, not one on every start.
 */
export function findRefusedHandInsToRefresh(tasks: RefusedHandIn[]): RefusedHandIn[] {
  return tasks.filter((task) => {
    if (task.status !== "blocked") return false;
    if (!task.parentId || !task.assigneeAgentId) return false;
    if (!hasReviewPendingNote(task.description)) return false;
    if (task.alreadyRefreshed) return false;
    if (!task.deliverable.trim()) return false;
    if (!task.reviewerSpokeAt || !task.reviewerSentItBack) return false;
    if (task.handedInAt && task.handedInAt.getTime() > task.reviewerSpokeAt.getTime()) return false;
    if (task.personSpokeAt && task.personSpokeAt.getTime() >= task.reviewerSpokeAt.getTime()) return false;
    return true;
  });
}

/** The newest thing one agent said on one task, with its words. */
async function lastCommentBy(
  db: Db,
  issueId: string,
  agentId: string,
): Promise<{ body: string; createdAt: Date } | null> {
  const row = await db
    .select({ body: issueComments.body, createdAt: issueComments.createdAt })
    .from(issueComments)
    .where(and(
      eq(issueComments.issueId, issueId),
      eq(issueComments.authorAgentId, agentId),
      isNull(issueComments.deletedAt),
    ))
    .orderBy(desc(issueComments.createdAt))
    .limit(1)
    .then((rows) => rows[0] ?? null);
  return row ? { body: row.body, createdAt: row.createdAt } : null;
}

/** The last time a person said anything on one task. */
async function lastPersonCommentAt(db: Db, issueId: string): Promise<Date | null> {
  const row = await db
    .select({ createdAt: issueComments.createdAt })
    .from(issueComments)
    .where(and(
      eq(issueComments.issueId, issueId),
      eq(issueComments.authorType, "user"),
      isNull(issueComments.deletedAt),
    ))
    .orderBy(desc(issueComments.createdAt))
    .limit(1)
    .then((rows) => rows[0] ?? null);
  return row?.createdAt ?? null;
}

/** Read a company's stopped tasks and keep the refusals owed a fresh look. */
export async function loadRefusedHandInsToRefresh(db: Db, companyId: string): Promise<RefusedHandIn[]> {
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
  const candidates: RefusedHandIn[] = [];
  for (const row of rows) {
    // The task's own text rules most of them out, and reading it costs nothing.
    if (!row.parentId || !row.assigneeAgentId) continue;
    if (!hasReviewPendingNote(row.description)) continue;
    if (hasRefreshedReviewMarker(row.description)) continue;
    const output = await documents
      .getIssueDocumentByKey(row.id, CONVERSATION_OUTPUT_DOCUMENT_KEY)
      .catch(() => null);
    if (!output?.body?.trim()) continue;
    const reviewer = await findJudgeAgentForHandIn(db, {
      companyId,
      leadAgentId: row.assigneeAgentId,
    }).catch(() => null);
    const lastFromReviewer = reviewer ? await lastCommentBy(db, row.id, reviewer.id) : null;
    candidates.push({
      ...row,
      deliverable: output.body,
      handedInAt: output.updatedAt ?? null,
      reviewerSpokeAt: lastFromReviewer?.createdAt ?? null,
      reviewerSentItBack: saysTheReviewerSentItBack(lastFromReviewer?.body),
      personSpokeAt: await lastPersonCommentAt(db, row.id),
      saidNobodyCouldLookAt: null,
      alreadyRefreshed: false,
    });
  }
  return findRefusedHandInsToRefresh(candidates);
}

/**
 * The text a refused hand-in goes into its fresh review with: the mark that
 * says it has had its one look, and the count of refusals back to nothing.
 *
 * Wave 22 is why the count goes back. Wave 21's organization was reopened, the
 * parked task was read again under the corrected brief, and the new verdict
 * was about the work rather than its formatting — a real, answerable
 * complaint. It still went straight to the person: two refusals had already
 * been counted against the task under the old brief, so the reviewer's plan
 * had no round left to spend and said "over to you" instead of sending it
 * back. The worker was never asked to try again. A look under a new brief is a
 * first look, so the refusals the old brief counted are not held against it.
 */
export function descriptionForAFreshAttempt(description: string | null | undefined): string {
  return descriptionWithJudgeFailRounds(descriptionWithRefreshedReviewMarker(description, true), 0);
}

/**
 * Take a task before anything talks to a model about it, by writing the mark
 * that says it has had its fresh look. One statement, with the task's own text
 * as the condition, so of two passes over the same organization only one can
 * take the same refusal — and a machine that stops half way through leaves the
 * task marked rather than coming round for ever.
 *
 * The same statement puts the count of refusals back to nothing, so the
 * reviewer that is about to read the work has a round to spend on it.
 *
 * Returns the task's new text, or null when somebody else got there first.
 */
export async function claimRefusedHandIn(db: Db, task: DeferredHandIn): Promise<string | null> {
  const next = descriptionForAFreshAttempt(task.description);
  const taken = await db
    .update(issues)
    .set({ description: next, updatedAt: new Date() })
    .where(and(
      eq(issues.id, task.id),
      task.description === null ? isNull(issues.description) : eq(issues.description, task.description),
    ))
    .returning({ id: issues.id });
  return taken.length > 0 ? next : null;
}

export type RefusedReviewOutcome = DeferredReviewTally & {
  /** A pass for this organization was already under way, so this call did nothing. */
  alreadyRunning: boolean;
};

const NOTHING_TO_DO: RefusedReviewOutcome = { reviewed: 0, failed: 0, stopped: false, alreadyRunning: false };

/** One pass per organization at a time, for as long as that pass is running. */
const passes = new Map<string, Promise<RefusedReviewOutcome>>();

/**
 * The refusals one organization is owed a second opinion on, looked at now.
 * Only one pass per organization runs at a time: Resume everything starts one
 * for every organization at once, and a hold and a Play inside the minutes a
 * pass takes would start a second over the same tasks.
 */
export function refreshRefusedHandIns(
  db: Db,
  deps: DeferredReviewDeps,
  input: { companyId: string },
): Promise<RefusedReviewOutcome> {
  if (passes.has(input.companyId)) return Promise.resolve({ ...NOTHING_TO_DO, alreadyRunning: true });
  const pass = runOneRefusedReviewPass(db, deps, input).finally(() => {
    passes.delete(input.companyId);
  });
  passes.set(input.companyId, pass);
  return pass;
}

async function runOneRefusedReviewPass(
  db: Db,
  deps: DeferredReviewDeps,
  input: { companyId: string },
): Promise<RefusedReviewOutcome> {
  const log = deps.log ?? ((message: string) => logger.info({ companyId: input.companyId }, message.trim()));
  const tasks = await loadRefusedHandInsToRefresh(db, input.companyId);
  if (tasks.length === 0) return NOTHING_TO_DO;
  log(
    `[todero] ${tasks.length} piece${tasks.length === 1 ? "" : "s"} of work the reviewer sent back`
      + " will be read once more, the way the reviewer reads work today.\n",
  );
  const tally = await runReviewPass(db, { ...deps, log }, {
    companyId: input.companyId,
    tasks,
    claim: (task) => claimRefusedHandIn(db, task),
  });
  return { ...tally, alreadyRunning: false };
}

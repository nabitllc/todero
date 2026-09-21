/**
 * Which of an organization's stopped tasks are still owed a reviewer's answer,
 * and how one is taken so only one pass reviews it.
 *
 * Lifted out of deferred-review.ts when that file reached its size limit: the
 * finding is the half that was being changed, and it is the half a person has
 * to be able to read on its own, because it is the rule that decides whether a
 * task nobody has answered is picked back up or left in front of the person.
 */
import { and, desc, eq, isNull, like } from "drizzle-orm";
import { issueComments, issues, type Db } from "@todero/db";
import { documentService } from "../services/documents.js";
import {
  CONVERSATION_OUTPUT_DOCUMENT_KEY,
  descriptionWithDeferredReviewMarker,
  hasDeferredReviewMarker,
} from "./conversation-outcome.js";
import { findJudgeAgentForHandIn } from "./judge-review.js";
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
  /**
   * The last time Todero itself said on this task that nobody could look at the
   * work. Once it has said so, the task waits for the person rather than coming
   * round again every time the organization starts.
   */
  saidNobodyCouldLookAt: Date | null;
};

/**
 * The opening of the note Todero leaves when nobody could look at a hand-in.
 * Fixed, because the finder reads it back: a task Todero has already spoken
 * about is not offered up again until there is new work on it.
 */
export const NO_REVIEWER_NOTE_OPENING = "Nobody could look at the work handed in on this task";

export function noReviewerNote(reason: string): string {
  return `${NO_REVIEWER_NOTE_OPENING}: ${reason}. It is waiting for you.`;
}

/**
 * Which of a company's stopped tasks are still owed a review.
 *
 * Two ways in. One is the note judge-apply leaves when a hold skips a review.
 * The other is the observable truth of the same thing, for tasks handed in
 * before that note existed: the work is in front of the person, there is
 * something to look at, and the reviewer has said nothing about it since it
 * arrived. That second one is what lets an organization that is already stuck
 * be rescued rather than only the next one prevented.
 *
 * One way back out, which both of those answer to: if Todero has already said
 * on the task that nobody could look at the work, the task is the person's now
 * and is left alone until there is something new to look at. Without that, a
 * team with no reviewer has the same task picked up and written to on every
 * single start, for ever.
 */
export function findDeferredHandIns(tasks: DeferredHandIn[]): DeferredHandIn[] {
  return tasks.filter((task) => {
    if (task.status !== "blocked") return false;
    // Todero has already told the person nobody could look at this one. Only
    // work handed in since then brings it back.
    if (
      task.saidNobodyCouldLookAt
      && (!task.handedInAt || task.saidNobodyCouldLookAt.getTime() >= task.handedInAt.getTime())
    ) {
      return false;
    }
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

/** The newest note Todero left on one task saying nobody could look at the work. */
async function lastNoReviewerNoteAt(db: Db, issueId: string): Promise<Date | null> {
  const row = await db
    .select({ createdAt: issueComments.createdAt })
    .from(issueComments)
    .where(and(
      eq(issueComments.issueId, issueId),
      isNull(issueComments.deletedAt),
      like(issueComments.body, `${NO_REVIEWER_NOTE_OPENING}%`),
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
      saidNobodyCouldLookAt: await lastNoReviewerNoteAt(db, row.id),
    });
  }
  return findDeferredHandIns(candidates);
}

/**
 * Take a task before anything talks to a model about it.
 *
 * One statement, and the task's own text is the condition, so of two passes
 * over the same organization only one can take the same hand-in - Resume
 * everything starts a pass for every organization, and a hold and a Play
 * seconds later start another over the same tasks.
 *
 * Taking it flips the mark that says a review is still owed, which is what
 * makes the write a real change either way: a task that carried the mark stops
 * carrying it, and one found without it carries it while the reviewer reads, so
 * a machine that stops mid-way leaves the work findable.
 *
 * Returns the task's new text, or null when somebody else got there first.
 */
export async function claimDeferredHandIn(db: Db, task: DeferredHandIn): Promise<string | null> {
  const next = descriptionWithDeferredReviewMarker(
    task.description,
    !hasDeferredReviewMarker(task.description),
  );
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

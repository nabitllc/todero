/**
 * Gauntlet item 4: a person's send-back is one call.
 *
 * The task page used to send two: a status change to To do, then the note.
 * The status change woke the agent on its own, so the worker could start its
 * next turn before the note it was meant to read had landed. Here the task
 * goes back to To do, the review and waiting markers come off, the note is
 * stored, and only then is the agent's wake queued, with the note's id on it,
 * the same wake a person's comment on a blocked task raises.
 */
import { Router } from "express";
import type { Db } from "@todero/db";
import { badRequest, notFound } from "../errors.js";
import { logger } from "../middleware/logger.js";
import { issueService } from "../services/issues.js";
import type { IssueAssignmentWakeupDeps } from "../services/issue-assignment-wakeup.js";
import { descriptionWithoutConversationMarkers } from "../todero/conversation-outcome.js";

/** The wake a send-back raises: the same one a person's comment on a blocked task raises. */
export const SEND_BACK_WAKE_REASON = "issue_reopened_via_comment";

/** What the person reads when the note is empty. */
export const SEND_BACK_EMPTY_NOTE_MESSAGE = "Say what should change before the task goes back.";

export function toderoSendBackRoutes(db: Db, deps: { heartbeat?: IssueAssignmentWakeupDeps } = {}) {
  const router = Router();
  const issuesSvc = issueService(db);

  router.post("/issues/:id/send-back", async (req, res) => {
    const issueId = req.params.id as string;
    const body = (req.body ?? {}) as { note?: unknown };
    const note = typeof body.note === "string" ? body.note.trim() : "";
    if (!note) throw badRequest(SEND_BACK_EMPTY_NOTE_MESSAGE);

    const issue = await issuesSvc.getById(issueId);
    if (!issue) throw notFound("Task not found");

    // No auth middleware in a bare test app: the actor is then simply absent.
    const actorUserId = (req as { actor?: { userId?: string | null } }).actor?.userId ?? null;
    const previousStatus = issue.status;

    await issuesSvc.update(issueId, {
      status: "todo",
      description: descriptionWithoutConversationMarkers(issue.description),
      actorUserId,
    });
    const comment = await issuesSvc.addComment(issueId, note, actorUserId ? { userId: actorUserId } : {});

    // The wake comes last, carrying the note, so the turn it starts reads it.
    if (deps.heartbeat && issue.assigneeAgentId) {
      await deps.heartbeat
        .wakeup(issue.assigneeAgentId, {
          source: "automation",
          triggerDetail: "system",
          reason: SEND_BACK_WAKE_REASON,
          payload: { issueId, commentId: comment.id, mutation: "comment", reopenedFrom: previousStatus },
          requestedByActorType: actorUserId ? "user" : "system",
          requestedByActorId: actorUserId,
          contextSnapshot: {
            issueId,
            taskId: issueId,
            commentId: comment.id,
            wakeCommentId: comment.id,
            source: "issue.comment.reopen",
            wakeReason: SEND_BACK_WAKE_REASON,
            reopenedFrom: previousStatus,
          },
        })
        .catch((err: unknown) => {
          logger.warn({ err, issueId }, "send-back stored, but the agent's wake could not be queued");
        });
    }

    res.json({ issueId, status: "todo", commentId: comment.id });
  });

  return router;
}

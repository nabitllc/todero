/**
 * What happens to something a person types on a task once the organization has
 * a manager (spec items 2 and 5).
 *
 *  - On the conversation task: nothing changes. The manager already owns it.
 *  - On a worker's task that is waiting for the person to accept or send back:
 *    the task goes to the manager first, which rewrites the brief in one
 *    paragraph and hands it back.
 *  - On a worker's task the worker is still doing: the worker answers as it
 *    does today, and the conversation task gets one line so the manager and the
 *    person can see it happened.
 */
import type { Db } from "@todero/db";
import { REVIEW_PENDING_MARKER } from "./conversation-outcome.js";
import { getManager, listWorkers } from "./manager-mode.js";
import { descriptionWithWaitingForManagerMarker } from "./manager-sendback.js";
import { buildPersonWroteLine, MANAGER_SENDBACK_WAKE_REASON } from "./manager-wave.js";

export type PersonCommentRoute = "manager_sendback" | "copy_manager" | "none";

/** The decision on its own, with no database in sight. */
export function routePersonComment(input: {
  managerMode: boolean;
  parentIssueId: string | null;
  reviewPending: boolean;
  assigneeIsManager: boolean;
}): PersonCommentRoute {
  if (!input.managerMode) return "none";
  // The conversation task is the manager's own; it answers there as always.
  if (!input.parentIssueId) return "none";
  if (input.assigneeIsManager) return "none";
  return input.reviewPending ? "manager_sendback" : "copy_manager";
}

/** True when the task is sitting in front of the person for an accept or a send-back. */
export function isWaitingOnPersonToAccept(description: string | null | undefined): boolean {
  return Boolean(description && description.includes(REVIEW_PENDING_MARKER));
}

export type PersonCommentWake = {
  agentId: string;
  reason: string;
  issueId: string;
  contextSnapshot: Record<string, unknown>;
};

export type PersonCommentDeps = {
  updateIssue: (
    issueId: string,
    patch: { status?: string; description?: string; assigneeAgentId?: string },
  ) => Promise<unknown>;
  addComment: (issueId: string, body: string, agentId: string) => Promise<unknown>;
};

/**
 * Apply the routing above. Returns the turn the caller should queue, if any —
 * the caller owns queueing so this stays testable and so the route keeps its
 * single place where turns are raised.
 */
export async function applyPersonCommentInManagerMode(
  db: Db,
  deps: PersonCommentDeps,
  input: {
    issue: {
      id: string;
      companyId: string;
      parentId: string | null;
      identifier: string | null;
      title: string;
      description: string | null;
      assigneeAgentId: string | null;
    };
    /** What the person wrote, passed to the manager so it has the reason in hand. */
    note: string;
  },
): Promise<{ route: PersonCommentRoute; wake: PersonCommentWake | null }> {
  const workers = await listWorkers(db, input.issue.companyId).catch(() => []);
  const manager = workers.length > 0 ? await getManager(db, input.issue.companyId).catch(() => null) : null;
  if (!manager) return { route: "none", wake: null };

  const route = routePersonComment({
    managerMode: workers.length > 0,
    parentIssueId: input.issue.parentId,
    reviewPending: isWaitingOnPersonToAccept(input.issue.description),
    assigneeIsManager: input.issue.assigneeAgentId === manager.id,
  });
  if (route === "none") return { route, wake: null };

  if (input.issue.parentId) {
    await deps.addComment(
      input.issue.parentId,
      buildPersonWroteLine({ identifier: input.issue.identifier, title: input.issue.title }),
      manager.id,
    );
  }

  if (route === "copy_manager") return { route, wake: null };

  // The manager holds the task while it rewrites the brief, and the marker
  // remembers whose task it was. The review marker comes off: the person has
  // answered, so the task is no longer waiting on them.
  const description = descriptionWithWaitingForManagerMarker(
    (input.issue.description ?? "").split(REVIEW_PENDING_MARKER).join("").trim(),
    input.issue.assigneeAgentId,
  );
  await deps.updateIssue(input.issue.id, {
    status: "todo",
    description,
    assigneeAgentId: manager.id,
  });

  return {
    route,
    wake: {
      agentId: manager.id,
      reason: MANAGER_SENDBACK_WAKE_REASON,
      issueId: input.issue.id,
      contextSnapshot: {
        issueId: input.issue.id,
        taskId: input.issue.id,
        source: "issue.person_sendback",
        wakeReason: MANAGER_SENDBACK_WAKE_REASON,
        managerSendbackReason: "person_sendback",
        managerSendbackNote: input.note,
      },
    },
  };
}

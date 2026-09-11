import { Router } from "express";
import type { Db } from "@todero/db";
import {
  buildToderoPlanTaskDescription,
  parseToderoPlanBlock,
  type ToderoPlan,
  type ToderoPlanTask,
} from "@todero/shared";
import { documentService } from "../services/documents.js";
import { issueService } from "../services/issues.js";
import {
  queueIssueAssignmentWakeup,
  type IssueAssignmentWakeupDeps,
} from "../services/issue-assignment-wakeup.js";
import {
  CONVERSATION_PLAN_DOCUMENT_KEY,
  descriptionWithWaitingMarker,
} from "../todero/conversation-thread.js";
import { descriptionWithPlanMarker } from "../todero/conversation-outcome.js";

/**
 * The tasks the person kept, in plan order. An empty or missing `keep` means
 * all of them; unknown ids are ignored rather than rejected, so a stale card
 * cannot fail the whole approval.
 */
export function selectApprovedPlanTasks(plan: ToderoPlan, keep: string[] | null | undefined): ToderoPlanTask[] {
  if (!keep || keep.length === 0) return plan.tasks;
  const wanted = new Set(keep.map((id) => id.trim()).filter(Boolean));
  return plan.tasks.filter((task) => wanted.has(task.id));
}

function readKeepIds(body: unknown): string[] | null {
  if (!body || typeof body !== "object") return null;
  const keep = (body as Record<string, unknown>).keep;
  if (!Array.isArray(keep)) return null;
  return keep.filter((value): value is string => typeof value === "string");
}

/**
 * Approving a proposed plan: Todero, not the model, creates one child task per
 * kept item under the conversation task, chained so each unlocks the next, and
 * wakes the agent on the first. The parent stays blocked on its children, which
 * is a valid disposition for recovery and what the dependency wake needs to
 * bring the agent back for a summary once the last child closes.
 */
export function toderoPlanRoutes(db: Db, deps: { heartbeat: IssueAssignmentWakeupDeps }) {
  const router = Router();
  const issuesSvc = issueService(db);
  const documentsSvc = documentService(db);

  router.post("/issues/:id/plan/approve", async (req, res) => {
    if (req.actor.type !== "board") {
      res.status(403).json({ error: "Only a person can approve a plan" });
      return;
    }
    const issueId = req.params.id as string;
    const issue = await issuesSvc.getById(issueId);
    if (!issue) {
      res.status(404).json({ error: "Issue not found" });
      return;
    }
    if (!issue.assigneeAgentId) {
      res.status(409).json({ error: "The task has no agent to work the plan" });
      return;
    }

    const document = await documentsSvc.getIssueDocumentByKey(issue.id, CONVERSATION_PLAN_DOCUMENT_KEY).catch(() => null);
    const parsed = parseToderoPlanBlock(document?.body ?? "");
    if (!parsed) {
      res.status(409).json({ error: "This task has no plan to approve yet" });
      return;
    }
    const kept = selectApprovedPlanTasks(parsed.plan, readKeepIds(req.body));
    if (kept.length === 0) {
      res.status(400).json({ error: "Keep at least one task" });
      return;
    }

    // The person's answers from the planning conversation ride along on every
    // child, so the agent does not ask for them a second time on each task.
    const personSaid = await issuesSvc
      .listComments(issue.id, { order: "asc", limit: 50 })
      .then((rows) =>
        rows
          .filter((row) => !row.authorAgentId && !row.derivedAuthorAgentId && row.authorType !== "agent" && !row.presentation)
          .map((row) => row.body ?? "")
          .filter((body) => body.trim()),
      )
      .catch(() => [] as string[]);

    const children: Array<{ id: string; identifier: string | null; title: string; status: string }> = [];
    let previousId: string | null = null;
    for (const [index, task] of kept.entries()) {
      const child = await issuesSvc.create(issue.companyId, {
        title: task.title,
        description: buildToderoPlanTaskDescription(parsed.plan, task, { personSaid }),
        // Every child is To do from the start: the blocker chain keeps the
        // later ones queued, and closing a task through the API only wakes
        // dependents that are not in backlog.
        status: "todo",
        parentId: issue.id,
        assigneeAgentId: issue.assigneeAgentId,
        projectId: issue.projectId ?? null,
        goalId: issue.goalId ?? null,
        priority: issue.priority ?? null,
        blockedByIssueIds: previousId ? [previousId] : [],
      });
      children.push({ id: child.id, identifier: child.identifier ?? null, title: child.title, status: child.status });
      previousId = child.id;
    }

    const parent = await issuesSvc.update(issue.id, {
      status: "blocked",
      blockedByIssueIds: children.map((child) => child.id),
      description: descriptionWithPlanMarker(descriptionWithWaitingMarker(issue.description, false), false),
      actorUserId: req.actor.userId ?? null,
    });

    // Only the first child is woken here; the ones behind it wait on their
    // blocker and get their own wake when it closes.
    const first = children[0]!;
    await queueIssueAssignmentWakeup({
      heartbeat: deps.heartbeat,
      issue: { id: first.id, assigneeAgentId: issue.assigneeAgentId, status: first.status },
      reason: "issue_assigned",
      mutation: "create",
      contextSource: "issue.plan_approve",
      requestedByActorType: "user",
      requestedByActorId: req.actor.userId ?? null,
    });

    res.status(201).json({ parent, children });
  });

  return router;
}

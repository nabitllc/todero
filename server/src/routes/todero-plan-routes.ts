import { Router } from "express";
import type { Db } from "@todero/db";
import { parseToderoPlanBlock, resolveToderoPlanTaskDependencies, type ToderoPlan, type ToderoPlanTask } from "@todero/shared";
import { agentService } from "../services/agents.js";
import { documentService } from "../services/documents.js";
import { issueService } from "../services/issues.js";
import { CONVERSATION_PLAN_DOCUMENT_KEY } from "../todero/conversation-thread.js";
import {
  selectApprovedPlanTasks,
  buildPlanFeatureGoalDrafts,
  createPlanChildren,
  hireForPlan,
  wakeReadyChildren,
  type PlanFeatureGoalDraft,
} from "../todero/plan-approval.js";
import type { IssueAssignmentWakeupDeps } from "../services/issue-assignment-wakeup.js";
import { getManager, listWorkers } from "../todero/manager-mode.js";
import { MANAGER_ASSIGNMENT_WAKE_REASON } from "../todero/manager-wave.js";
import { logger } from "../middleware/logger.js";

// Re-export from plan-approval for backward compatibility with existing tests
export { selectApprovedPlanTasks, buildPlanFeatureGoalDrafts, type PlanFeatureGoalDraft } from "../todero/plan-approval.js";

function readKeepIds(body: unknown): string[] | null {
  if (!body || typeof body !== "object") return null;
  const keep = (body as Record<string, unknown>).keep;
  if (!Array.isArray(keep)) return null;
  return keep.filter((value): value is string => typeof value === "string");
}

/**
 * Approving a proposed plan: Todero, not the model, creates one child task per
 * kept item under the conversation task and wakes the agent on every task that
 * can start straight away. Order comes from the plan: a task that named an
 * `after` waits for it, and a task that named nothing waits only for the task
 * before it inside its own feature — so separate features run side by side.
 * When the machine can serve more than one model and there is more ready work
 * than one agent can take, a second agent is added and takes the second
 * feature that has work ready now. The parent stays blocked on its children,
 * which is a valid disposition for recovery and what the dependency wake needs
 * to bring the agent back for a summary once the last child closes.
 */
export function toderoPlanRoutes(db: Db, deps: { heartbeat: IssueAssignmentWakeupDeps }) {
  const router = Router();
  const issuesSvc = issueService(db);
  const documentsSvc = documentService(db);
  const agentsSvc = agentService(db);

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

    const primaryAgent = await agentsSvc.getById(issue.assigneeAgentId).catch(() => null);

    const ordered = resolveToderoPlanTaskDependencies(kept);

    // Hire the reviewer, and a second agent when the work allows it. When the
    // organization asks a person to approve a new teammate, both wait for that
    // approval and the task says so.
    const { extraWorker, extraWorkerFeatureKey, extraWorkerReason, hiresPendingApproval } =
      await hireForPlan(db, {
        primaryAgent,
        ordered,
        issue: { id: issue.id, companyId: issue.companyId },
        actorUserId: req.actor.userId ?? null,
      });

    // Manager mode: the organization has a worker, so the first agent manages
    // rather than does. Read the team after hiring, so a second agent added
    // just now is counted.
    const workers = await listWorkers(db, issue.companyId).catch(() => []);
    const manager = workers.length > 0 ? await getManager(db, issue.companyId).catch(() => null) : null;
    const managerMode = workers.length > 0 && Boolean(manager) && manager?.id === issue.assigneeAgentId;

    // Create feature goals and child issues
    const planResult = await createPlanChildren(db, {
      issue: {
        id: issue.id,
        companyId: issue.companyId,
        assigneeAgentId: issue.assigneeAgentId,
        description: issue.description,
        goalId: issue.goalId ?? null,
        projectId: issue.projectId ?? null,
        priority: issue.priority ?? null,
      },
      plan: parsed.plan,
      kept,
      personSaid,
      actorUserId: req.actor.userId ?? null,
      extraWorker,
      extraWorkerFeatureKey,
      workers: managerMode ? workers.map((worker) => ({ id: worker.id, name: worker.name })) : [],
    });

    // In manager mode the first agent hands the work out before anybody starts:
    // one turn on the conversation task, in the fixed `assignments:` shape.
    // Whoever it names ends up with the task, and the tasks that can start now
    // are brought to their workers on the back of that reply. If that turn
    // cannot even be queued, the tasks start on the rule's own sharing-out
    // rather than sitting still.
    let assignmentTurnQueued = false;
    if (managerMode && manager) {
      try {
        await deps.heartbeat.wakeup(manager.id, {
          source: "assignment",
          triggerDetail: "system",
          reason: MANAGER_ASSIGNMENT_WAKE_REASON,
          payload: { issueId: issue.id, mutation: "update" },
          requestedByActorType: "user",
          requestedByActorId: req.actor.userId ?? null,
          contextSnapshot: {
            issueId: issue.id,
            taskId: issue.id,
            source: "issue.plan_approve",
            wakeReason: MANAGER_ASSIGNMENT_WAKE_REASON,
            readyChildIssueIds: planResult.children.filter((child) => child.canStartNow).map((child) => child.id),
          },
        });
        assignmentTurnQueued = true;
      } catch (err) {
        logger.warn({ err, issueId: issue.id }, "failed to ask the manager to hand the plan out");
      }
    }

    // Wake ready children
    if (!assignmentTurnQueued) {
      await wakeReadyChildren(deps.heartbeat, planResult.children, {
        actorUserId: req.actor.userId ?? null,
      });
    }

    res.status(201).json({
      parent: planResult.parent,
      goals: planResult.goals,
      children: planResult.children,
      extraWorker: extraWorker ? { id: extraWorker.id, name: extraWorker.name } : null,
      extraWorkerReason,
      hiresPendingApproval,
    });
  });

  return router;
}

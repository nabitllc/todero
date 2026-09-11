import { Router } from "express";
import type { Db } from "@todero/db";
import {
  buildToderoPlanTaskDescription,
  parseToderoPlanBlock,
  type ToderoPlan,
  type ToderoPlanTask,
} from "@todero/shared";
import { agentService } from "../services/agents.js";
import { documentService } from "../services/documents.js";
import { FEATURE_GOAL_LEVEL, GOAL_STATUS_ACTIVE } from "../services/goal-completion.js";
import { goalService } from "../services/goals.js";
import { issueService } from "../services/issues.js";
import { logger } from "../middleware/logger.js";
import {
  queueIssueAssignmentWakeup,
  type IssueAssignmentWakeupDeps,
} from "../services/issue-assignment-wakeup.js";
import {
  CONVERSATION_PLAN_DOCUMENT_KEY,
  descriptionWithWaitingMarker,
} from "../todero/conversation-thread.js";
import { descriptionWithPlanMarker } from "../todero/conversation-outcome.js";
import { ensureJudgeAgentForLead } from "../todero/judge-agent.js";

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

/** One goal to create for one feature of the plan, and the tasks that hang off it. */
export type PlanFeatureGoalDraft = {
  /** The feature name, matched case-insensitively against what the tasks named. */
  key: string;
  title: string;
  /** How we know the feature is finished — the plan's `done_when`. */
  description: string | null;
  taskIds: string[];
};

/**
 * The feature goals an approved plan needs. One goal per feature that has at
 * least one kept task, in plan order, so the Goals page shows the shape of the
 * work rather than a flat list of tasks. A task naming a feature the plan never
 * declared still gets a goal, named after what the task said: a small model
 * sometimes writes a feature into a task and forgets to declare it, and that is
 * not a reason to lose the grouping. A task naming no feature gets no goal and
 * stays on the company goal.
 */
export function buildPlanFeatureGoalDrafts(
  plan: ToderoPlan,
  kept: ToderoPlanTask[],
): PlanFeatureGoalDraft[] {
  const drafts: PlanFeatureGoalDraft[] = [];
  const byKey = new Map<string, PlanFeatureGoalDraft>();

  const keyOf = (name: string) => name.trim().toLowerCase();
  const add = (title: string, description: string | null): PlanFeatureGoalDraft => {
    const key = keyOf(title);
    const existing = byKey.get(key);
    if (existing) {
      if (!existing.description && description) existing.description = description;
      return existing;
    }
    const draft: PlanFeatureGoalDraft = { key, title: title.trim(), description, taskIds: [] };
    byKey.set(key, draft);
    drafts.push(draft);
    return draft;
  };

  for (const feature of plan.features) {
    if (!feature.name.trim()) continue;
    add(feature.name, feature.doneWhen.trim() || feature.why.trim() || null);
  }
  for (const task of kept) {
    const name = task.feature.trim();
    if (!name) continue;
    add(name, null).taskIds.push(task.id);
  }

  return drafts.filter((draft) => draft.taskIds.length > 0);
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
  const goalsSvc = goalService(db);
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
    // The plan's features become goals under the company goal, and each task
    // is linked to its feature's goal. That is the hierarchy the Goals page
    // shows: the company goal, the features under it, the tasks under those.
    const companyGoal = issue.goalId
      ? await goalsSvc.getById(issue.goalId).catch(() => null)
      : await goalsSvc.getDefaultCompanyGoal(issue.companyId).catch(() => null);
    const companyGoalId = companyGoal?.id ?? null;
    const goalIdByTaskId = new Map<string, string>();
    const featureGoals: Array<{ id: string; title: string }> = [];
    for (const draft of buildPlanFeatureGoalDrafts(parsed.plan, kept)) {
      const goal = await goalsSvc.create(issue.companyId, {
        title: draft.title,
        description: draft.description,
        level: FEATURE_GOAL_LEVEL,
        status: GOAL_STATUS_ACTIVE,
        parentId: companyGoalId,
        ownerAgentId: issue.assigneeAgentId,
      });
      featureGoals.push({ id: goal.id, title: goal.title });
      for (const taskId of draft.taskIds) goalIdByTaskId.set(taskId, goal.id);
    }

    // The first approved plan in a company is also when its reviewer is
    // hired: a second agent on the same local model that reads finished work
    // before it reaches the person. A failure here never blocks the approval.
    try {
      const lead = await agentsSvc.getById(issue.assigneeAgentId);
      if (lead) {
        await ensureJudgeAgentForLead(db, agentsSvc, {
          id: lead.id,
          companyId: lead.companyId,
          name: lead.name,
          adapterType: lead.adapterType,
          adapterConfig: lead.adapterConfig,
        });
      }
    } catch (err) {
      logger.warn({ err, issueId: issue.id }, "failed to hire the reviewer on plan approval");
    }

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
        goalId: goalIdByTaskId.get(task.id) ?? companyGoalId ?? issue.goalId ?? null,
        priority: issue.priority ?? null,
        blockedByIssueIds: previousId ? [previousId] : [],
      });
      children.push({ id: child.id, identifier: child.identifier ?? null, title: child.title, status: child.status });
      previousId = child.id;
    }

    // The conversation task stays on the company goal: it is the brief for the
    // whole thing, not one feature of it.
    const parent = await issuesSvc.update(issue.id, {
      status: "blocked",
      blockedByIssueIds: children.map((child) => child.id),
      description: descriptionWithPlanMarker(descriptionWithWaitingMarker(issue.description, false), false),
      ...(issue.goalId || !companyGoalId ? {} : { goalId: companyGoalId }),
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

    res.status(201).json({ parent, children, goals: featureGoals });
  });

  return router;
}

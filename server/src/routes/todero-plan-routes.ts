import { Router } from "express";
import type { Db } from "@todero/db";
import {
  buildToderoPlanTaskDescription,
  parseToderoPlanBlock,
  resolveToderoPlanTaskDependencies,
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
  buildExtraWorkerName,
  countReadyPlanTasks,
  decideExtraWorker,
  pickExtraWorkerFeatureKey,
  readAgentParallelism,
} from "../todero/orchestration-rules.js";
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
  // Only the plan's declared features become goals. A task that names
  // something else ("All", "Everything", a typo) stays under the mission
  // goal rather than minting a feature nobody planned.
  for (const task of kept) {
    const name = task.feature.trim();
    if (!name) continue;
    byKey.get(keyOf(name))?.taskIds.push(task.id);
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
  const goalsSvc = goalService(db);
  const agentsSvc = agentService(db);

  /**
   * A second agent for the same work: same kind of connection, same settings,
   * same manager. Only for an agent that talks to a model over HTTP — that is
   * the local-model case, where the connection is a URL and a model name and
   * carries no credentials to copy.
   */
  async function hireExtraWorker(primary: {
    id: string;
    companyId: string;
    name: string;
    role: string;
    title: string | null;
    reportsTo: string | null;
    adapterType: string;
    adapterConfig: Record<string, unknown>;
    runtimeConfig: Record<string, unknown>;
    defaultEnvironmentId: string | null;
  }) {
    if (primary.adapterType !== "http") return null;
    return agentsSvc.create(primary.companyId, {
      name: buildExtraWorkerName(primary.name),
      role: primary.role,
      title: primary.title,
      reportsTo: primary.reportsTo,
      adapterType: primary.adapterType,
      adapterConfig: primary.adapterConfig,
      runtimeConfig: primary.runtimeConfig,
      defaultEnvironmentId: primary.defaultEnvironmentId,
    });
  }

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

    const primaryAgent = await agentsSvc.getById(issue.assigneeAgentId).catch(() => null);

    // The first approved plan in a company is also when its reviewer is
    // hired: a second agent on the same local model that reads finished work
    // before it reaches the person. A failure here never blocks the approval.
    try {
      if (primaryAgent) {
        await ensureJudgeAgentForLead(db, agentsSvc, {
          id: primaryAgent.id,
          companyId: primaryAgent.companyId,
          name: primaryAgent.name,
          adapterType: primaryAgent.adapterType,
          adapterConfig: primaryAgent.adapterConfig,
        });
      }
    } catch (err) {
      logger.warn({ err, issueId: issue.id }, "failed to hire the reviewer on plan approval");
    }

    // What waits for what. A task that named an `after` waits for it; a task
    // that named nothing waits only for the task before it in its own feature,
    // so the first task of every feature can start at the same time.
    const ordered = resolveToderoPlanTaskDependencies(kept);

    // Does a second agent help? Only if the machine can serve another model,
    // there is ready work nobody can pick up, and there is a second feature
    // with work that can start now to hand over. That last check matters: a
    // feature whose first task waits on another feature would leave the added
    // agent idle from the moment it is hired.
    const decision = decideExtraWorker({
      readyTasks: countReadyPlanTasks(ordered),
      // Nothing is running on work that does not exist yet.
      runningRuns: 0,
      parallelism: readAgentParallelism(primaryAgent?.runtimeConfig),
      workers: 1,
    });
    const handoverFeatureKey = pickExtraWorkerFeatureKey(ordered);
    const extraWorker =
      decision.hire && primaryAgent && handoverFeatureKey !== null
        ? await hireExtraWorker(primaryAgent).catch(() => null)
        : null;
    // The added agent takes that feature; the first agent keeps the rest.
    const extraWorkerFeatureKey = extraWorker ? handoverFeatureKey : null;
    const extraWorkerReason = !decision.hire
      ? decision.reason
      : handoverFeatureKey === null
        ? "Only one feature can start right now, so a second agent would have nothing to pick up."
        : extraWorker
          ? decision.reason
          : "A second agent could have helped, but this agent's connection cannot be shared with one.";

    const children: Array<{
      id: string;
      identifier: string | null;
      title: string;
      status: string;
      canStartNow: boolean;
      assigneeAgentId: string;
    }> = [];
    const issueIdByPlanTaskId = new Map<string, string>();
    for (const entry of ordered) {
      const blockedByIssueIds = entry.blockedByTaskIds
        .map((planTaskId) => issueIdByPlanTaskId.get(planTaskId))
        .filter((id): id is string => Boolean(id));
      const assigneeAgentId =
        extraWorkerFeatureKey !== null &&
        entry.task.feature.trim().toLowerCase() === extraWorkerFeatureKey &&
        extraWorker
          ? extraWorker.id
          : issue.assigneeAgentId;
      const child = await issuesSvc.create(issue.companyId, {
        title: entry.task.title,
        description: buildToderoPlanTaskDescription(parsed.plan, entry.task, { personSaid }),
        // Every child is To do from the start, whether or not something has to
        // finish first. A task parked in the backlog is skipped by the wake that
        // fires when its blocker closes, so it would sit there for ever; the
        // blocker chain is what holds it back, not the status.
        status: "todo",
        parentId: issue.id,
        assigneeAgentId,
        projectId: issue.projectId ?? null,
        goalId: goalIdByTaskId.get(entry.task.id) ?? companyGoalId ?? issue.goalId ?? null,
        priority: issue.priority ?? null,
        blockedByIssueIds,
      });
      issueIdByPlanTaskId.set(entry.task.id, child.id);
      children.push({
        id: child.id,
        identifier: child.identifier ?? null,
        canStartNow: blockedByIssueIds.length === 0,
        title: child.title,
        status: child.status,
        assigneeAgentId,
      });
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

    // Wake every task that can start now, not only the first one. The rest are
    // woken by the dependency wake when the task they wait on closes.
    for (const child of children.filter((row) => row.canStartNow)) {
      await queueIssueAssignmentWakeup({
        heartbeat: deps.heartbeat,
        issue: { id: child.id, assigneeAgentId: child.assigneeAgentId, status: child.status },
        reason: "issue_assigned",
        mutation: "create",
        contextSource: "issue.plan_approve",
        requestedByActorType: "user",
        requestedByActorId: req.actor.userId ?? null,
      });
    }

    res.status(201).json({
      parent,
      goals: featureGoals,
      children,
      extraWorker: extraWorker ? { id: extraWorker.id, name: extraWorker.name } : null,
      extraWorkerReason,
    });
  });

  return router;
}

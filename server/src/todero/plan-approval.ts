import type { Db } from "@todero/db";
import type { ToderoPlan, ToderoPlanTask } from "@todero/shared";
import {
  buildToderoPlanTaskDescription,
  resolveToderoPlanTaskDependencies,
} from "@todero/shared";
import { logger } from "../middleware/logger.js";
import { agentService } from "../services/agents.js";
import { FEATURE_GOAL_LEVEL, GOAL_STATUS_ACTIVE } from "../services/goal-completion.js";
import { goalService } from "../services/goals.js";
import { issueService } from "../services/issues.js";
import {
  buildExtraWorkerName,
  countReadyPlanTasks,
  decideExtraWorker,
  pickExtraWorkerFeatureKey,
  readAgentParallelism,
} from "./orchestration-rules.js";
import {
  queueIssueAssignmentWakeup,
  type IssueAssignmentWakeupDeps,
} from "../services/issue-assignment-wakeup.js";
import { descriptionWithWaitingMarker } from "./conversation-thread.js";
import { descriptionWithPlanMarker } from "./conversation-outcome.js";
import { ensureJudgeAgentForLead, findJudgeAgentForLead } from "./judge-agent.js";
import {
  buildPendingHireComment,
  readRequireBoardApprovalForNewAgents,
  requestHireApproval,
} from "./plan-hire-approval.js";

/**
 * The tasks the person kept, in plan order. An empty or missing `keep` means
 * all of them; unknown ids are ignored rather than rejected, so a stale card
 * cannot fail the whole approval.
 */
export function selectApprovedPlanTasks(
  plan: ToderoPlan,
  keep: string[] | null | undefined,
): ToderoPlanTask[] {
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

/**
 * Create feature goals and child issues for an approved plan. Returns the
 * children and goals created, ready to be woken.
 */
export async function createPlanChildren(
  db: Db,
  input: {
    issue: {
      id: string;
      companyId: string;
      assigneeAgentId: string;
      description: string | null;
      goalId: string | null;
      projectId: string | null;
      priority: string | null;
    };
    plan: ToderoPlan;
    kept: ToderoPlanTask[];
    personSaid: string[];
    actorUserId: string | null;
    extraWorker: { id: string; name: string } | null;
    extraWorkerFeatureKey: string | null;
  },
): Promise<{
  children: Array<{
    id: string;
    identifier: string | null;
    title: string;
    status: string;
    canStartNow: boolean;
    assigneeAgentId: string;
  }>;
  parent: { id: string; status: string } | null;
  goals: Array<{ id: string; title: string }>;
}> {
  const issuesSvc = issueService(db);
  const goalsSvc = goalService(db);

  // The plan's features become goals under the company goal, and each task
  // is linked to its feature's goal. That is the hierarchy the Goals page
  // shows: the company goal, the features under it, the tasks under those.
  const companyGoal = input.issue.goalId
    ? await goalsSvc.getById(input.issue.goalId).catch(() => null)
    : await goalsSvc.getDefaultCompanyGoal(input.issue.companyId).catch(() => null);
  const companyGoalId = companyGoal?.id ?? null;
  const goalIdByTaskId = new Map<string, string>();
  const featureGoals: Array<{ id: string; title: string }> = [];
  for (const draft of buildPlanFeatureGoalDrafts(input.plan, input.kept)) {
    const goal = await goalsSvc.create(input.issue.companyId, {
      title: draft.title,
      description: draft.description,
      level: FEATURE_GOAL_LEVEL,
      status: GOAL_STATUS_ACTIVE,
      parentId: companyGoalId,
      ownerAgentId: input.issue.assigneeAgentId,
    });
    featureGoals.push({ id: goal.id, title: goal.title });
    for (const taskId of draft.taskIds) goalIdByTaskId.set(taskId, goal.id);
  }

  // What waits for what. A task that named an `after` waits for it; a task
  // that named nothing waits only for the task before it in its own feature,
  // so the first task of every feature can start at the same time.
  const ordered = resolveToderoPlanTaskDependencies(input.kept);

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
      input.extraWorkerFeatureKey !== null &&
      entry.task.feature.trim().toLowerCase() === input.extraWorkerFeatureKey &&
      input.extraWorker
        ? input.extraWorker.id
        : input.issue.assigneeAgentId;
    const child = await issuesSvc.create(input.issue.companyId, {
      title: entry.task.title,
      description: buildToderoPlanTaskDescription(input.plan, entry.task, {
        personSaid: input.personSaid,
      }),
      // Every child is To do from the start, whether or not something has to
      // finish first. A task parked in the backlog is skipped by the wake that
      // fires when its blocker closes, so it would sit there for ever; the
      // blocker chain is what holds it back, not the status.
      status: "todo",
      parentId: input.issue.id,
      assigneeAgentId,
      projectId: input.issue.projectId ?? null,
      goalId: goalIdByTaskId.get(entry.task.id) ?? companyGoalId ?? input.issue.goalId ?? null,
      priority: input.issue.priority ?? undefined,
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
  const parent = await issuesSvc.update(input.issue.id, {
    status: "blocked",
    blockedByIssueIds: children.map((child) => child.id),
    description: descriptionWithPlanMarker(descriptionWithWaitingMarker(input.issue.description, false), false),
    ...(input.issue.goalId || !companyGoalId ? {} : { goalId: companyGoalId }),
    actorUserId: input.actorUserId ?? null,
  });

  return { children, parent, goals: featureGoals };
}

/**
 * Hire a reviewer and optionally an extra worker for a plan approval.
 * Returns the extra worker if hired (all failures are non-fatal, caught
 * and logged).
 */
export async function hireForPlan(
  db: Db,
  input: {
    primaryAgent: {
      id: string;
      companyId: string;
      name: string;
      adapterType: string;
      adapterConfig?: Record<string, unknown>;
      runtimeConfig?: Record<string, unknown>;
      role?: string;
      title?: string | null;
      reportsTo?: string | null;
      defaultEnvironmentId?: string | null;
    } | null;
    ordered: ReturnType<typeof resolveToderoPlanTaskDependencies>;
    /** The conversation task, so the person is told on it what waits for them. */
    issue?: { id: string; companyId: string } | null;
    actorUserId?: string | null;
  },
): Promise<{
  extraWorker: { id: string; name: string } | null;
  extraWorkerFeatureKey: string | null;
  extraWorkerReason: string;
  /** True when the teammates added here wait for a person's approval. */
  hiresPendingApproval: boolean;
}> {
  const agentsSvc = agentService(db);

  // Does this organization want a person to say yes before a new teammate
  // starts? When it does, the additions below take the same path a person's
  // own hire takes. A failed read keeps the old behaviour: hire and start.
  const companyId = input.primaryAgent?.companyId ?? input.issue?.companyId ?? null;
  let requiresApproval = false;
  if (companyId) {
    try {
      requiresApproval = await readRequireBoardApprovalForNewAgents(db, companyId);
    } catch (err) {
      logger.warn({ err }, "failed to read the new-teammate approval setting on plan approval");
    }
  }
  const pendingHireNames: string[] = [];

  // The first approved plan in a company is also when its reviewer is
  // hired: a second agent on the same local model that reads finished work
  // before it reaches the person. A failure here never blocks the approval.
  try {
    if (input.primaryAgent) {
      const lead = {
        id: input.primaryAgent.id,
        companyId: input.primaryAgent.companyId,
        name: input.primaryAgent.name,
        adapterType: input.primaryAgent.adapterType,
        adapterConfig: input.primaryAgent.adapterConfig ?? {},
      };
      const alreadyHired = requiresApproval
        ? await findJudgeAgentForLead(db, { companyId: lead.companyId, leadAgentId: lead.id }).catch(() => null)
        : null;
      const reviewer = await ensureJudgeAgentForLead(
        db,
        agentsSvc,
        lead,
        requiresApproval ? { status: "pending_approval" } : {},
      );
      if (requiresApproval && reviewer && !alreadyHired) {
        await requestHireApproval(db, {
          companyId: lead.companyId,
          agent: {
            id: reviewer.id,
            name: reviewer.name,
            title: "Reviewer",
            capabilities: "Reviews finished work against what the task asked for.",
            adapterType: reviewer.adapterType,
            adapterConfig: reviewer.adapterConfig,
          },
          requestedByUserId: input.actorUserId ?? null,
        });
        pendingHireNames.push(reviewer.name);
      }
    }
  } catch (err) {
    logger.warn({ err }, "failed to hire the reviewer on plan approval");
  }

  // Does a second agent help? Only if the machine can serve another model,
  // there is ready work nobody can pick up, and there is a second feature
  // with work that can start now to hand over. That last check matters: a
  // feature whose first task waits on another feature would leave the added
  // agent idle from the moment it is hired.
  const decision = decideExtraWorker({
    readyTasks: countReadyPlanTasks(input.ordered),
    // Nothing is running on work that does not exist yet.
    runningRuns: 0,
    parallelism: readAgentParallelism(input.primaryAgent?.runtimeConfig),
    workers: 1,
  });
  const handoverFeatureKey = pickExtraWorkerFeatureKey(input.ordered);
  const extraWorker =
    decision.hire && input.primaryAgent && handoverFeatureKey !== null
      ? await hireExtraWorker(
          db,
          input.primaryAgent,
          requiresApproval ? { status: "pending_approval" } : {},
        ).catch(() => null)
      : null;
  if (requiresApproval && extraWorker && input.primaryAgent) {
    try {
      await requestHireApproval(db, {
        companyId: input.primaryAgent.companyId,
        agent: {
          id: extraWorker.id,
          name: extraWorker.name,
          role: input.primaryAgent.role ?? "",
          title: input.primaryAgent.title ?? null,
          reportsTo: input.primaryAgent.reportsTo ?? null,
          adapterType: input.primaryAgent.adapterType,
          adapterConfig: input.primaryAgent.adapterConfig ?? {},
          runtimeConfig: input.primaryAgent.runtimeConfig ?? {},
        },
        requestedByUserId: input.actorUserId ?? null,
      });
      pendingHireNames.push(extraWorker.name);
    } catch (err) {
      logger.warn({ err }, "failed to ask for approval for the second agent on plan approval");
    }
  }
  // The added agent takes that feature; the first agent keeps the rest. A
  // teammate still waiting for a person's yes gets no work: the first agent
  // keeps all of it until the person answers.
  const extraWorkerFeatureKey = extraWorker && !requiresApproval ? handoverFeatureKey : null;
  const extraWorkerReason = !decision.hire
    ? decision.reason
    : handoverFeatureKey === null
      ? "Only one feature can start right now, so a second agent would have nothing to pick up."
      : extraWorker
        ? requiresApproval
          ? "A second agent was added and waits for your approval in the Inbox; the first agent keeps the work until then."
          : decision.reason
        : "A second agent could have helped, but this agent's connection cannot be shared with one.";

  // One short line on the task, so the person knows why nothing moved.
  if (pendingHireNames.length > 0 && input.issue) {
    try {
      await issueService(db).addComment(
        input.issue.id,
        buildPendingHireComment(pendingHireNames),
        { userId: input.actorUserId ?? undefined },
      );
    } catch (err) {
      logger.warn({ err }, "failed to say on the task that a new teammate waits for approval");
    }
  }

  return {
    extraWorker,
    extraWorkerFeatureKey,
    extraWorkerReason,
    hiresPendingApproval: pendingHireNames.length > 0,
  };
}

/**
 * A second agent for the same work: same kind of connection, same settings,
 * same manager. Only for an agent that talks to a model over HTTP — that is
 * the local-model case, where the connection is a URL and a model name and
 * carries no credentials to copy.
 */
async function hireExtraWorker(
  db: Db,
  primary: {
    id: string;
    companyId: string;
    name: string;
    adapterType: string;
    adapterConfig?: Record<string, unknown>;
    runtimeConfig?: Record<string, unknown>;
    role?: string;
    title?: string | null;
    reportsTo?: string | null;
    defaultEnvironmentId?: string | null;
  },
  options: { status?: "idle" | "pending_approval" } = {},
) {
  if (primary.adapterType !== "http") return null;
  const agentsSvc = agentService(db);
  return agentsSvc.create(primary.companyId, {
    name: buildExtraWorkerName(primary.name),
    role: primary.role ?? "",
    title: primary.title ?? null,
    reportsTo: primary.reportsTo ?? null,
    adapterType: primary.adapterType,
    adapterConfig: primary.adapterConfig ?? {},
    runtimeConfig: primary.runtimeConfig ?? {},
    defaultEnvironmentId: primary.defaultEnvironmentId ?? null,
    // When the organization asks a person first, the record exists but does
    // no work until they say yes.
    ...(options.status ? { status: options.status } : {}),
  });
}

/**
 * Wake every child task that can start now. The rest are woken by the
 * dependency wake when the task they wait on closes.
 */
export async function wakeReadyChildren(
  heartbeatDeps: IssueAssignmentWakeupDeps,
  children: Array<{
    id: string;
    canStartNow: boolean;
    assigneeAgentId: string;
    status: string;
  }>,
  options: {
    actorUserId: string | null;
  },
): Promise<void> {
  for (const child of children.filter((row) => row.canStartNow)) {
    await queueIssueAssignmentWakeup({
      heartbeat: heartbeatDeps,
      issue: { id: child.id, assigneeAgentId: child.assigneeAgentId, status: child.status },
      reason: "issue_assigned",
      mutation: "create",
      contextSource: "issue.plan_approve",
      requestedByActorType: "user",
      requestedByActorId: options.actorUserId ?? null,
    });
  }
}

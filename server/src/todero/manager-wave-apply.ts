/**
 * The manager wave, applied half. Each function takes the few small actions it
 * needs as arguments, so what the manager's reply does to a task can be tested
 * without a database — the same shape `judge-apply.ts` uses.
 */
import { descriptionWithManagerAssignmentMarker } from "./manager-assignment.js";
import {
  descriptionWithGuidanceMarker,
  descriptionWithoutWaitingForManagerMarker,
  parseManagerSendbackGuidance,
  readWaitingForManagerWorkerId,
} from "./manager-sendback.js";
import {
  buildManagerAssignedComment,
  buildReviewVerdictLine,
  MANAGER_GUIDANCE_DOCUMENT_KEY,
  resolveManagerAssignments,
  taskLabel,
  type AssignableWorker,
} from "./manager-wave.js";

export type ManagerWaveDeps = {
  /** Patch a task. Only the fields the manager may change. */
  updateIssue: (
    issueId: string,
    patch: { status?: string; description?: string; assigneeAgentId?: string },
  ) => Promise<unknown>;
  /** Post a comment authored by an agent. */
  addComment: (issueId: string, body: string, agentId: string) => Promise<unknown>;
  /** Bring a worker back to a task. */
  wakeWorker: (input: { issueId: string; agentId: string }) => Promise<unknown>;
  /** Keep a piece of text on the task as one of its documents. */
  saveDocument?: (input: { issueId: string; key: string; title: string; body: string }) => Promise<unknown>;
  log: (message: string) => unknown;
};

export type ManagerAssignmentChild = {
  id: string;
  identifier: string | null;
  title: string;
  description: string | null;
  assigneeAgentId: string;
};

export type ManagerAssignmentApplyResult = {
  /** True when at least one task went where the manager's own reply put it. */
  managerNamedThem: boolean;
  /** Tasks whose worker actually changed. */
  moved: number;
  /** Who ends up with each task, in the order they were given. */
  assignedTo: Array<{ taskId: string; agentId: string }>;
};

/**
 * The manager's assignment reply, applied. Anything it named moves and is
 * stamped so the task can show "Assigned by Nova"; anything it did not name
 * keeps the worker Todero's rule already gave it. Every task that can start now
 * is then brought to its worker.
 */
export async function applyManagerAssignmentReply(
  deps: ManagerWaveDeps,
  input: {
    managerId: string;
    conversationIssueId: string;
    reply: string;
    children: ManagerAssignmentChild[];
    workers: AssignableWorker[];
    /** The tasks nothing is holding up, which are the ones to start. */
    readyChildIssueIds: string[];
  },
): Promise<ManagerAssignmentApplyResult> {
  const resolved = resolveManagerAssignments(
    input.managerId,
    input.reply,
    input.children.map((child) => ({
      id: child.id,
      identifier: child.identifier,
      title: child.title,
      assigneeAgentId: child.assigneeAgentId,
    })),
    input.workers,
  );

  const childById = new Map(input.children.map((child) => [child.id, child]));
  const workerById = new Map(input.workers.map((worker) => [worker.id, worker]));
  const rows: Array<{ identifier: string | null; title: string; workerName: string }> = [];
  let managerNamedThem = false;
  let moved = 0;

  for (const entry of resolved) {
    const child = childById.get(entry.taskId);
    if (!child) continue;
    const changed = entry.assigneeAgentId !== child.assigneeAgentId;
    if (entry.assignedByManagerId) managerNamedThem = true;
    if (changed || entry.assignedByManagerId) {
      await deps.updateIssue(child.id, {
        ...(changed ? { assigneeAgentId: entry.assigneeAgentId } : {}),
        ...(entry.assignedByManagerId
          ? { description: descriptionWithManagerAssignmentMarker(child.description, entry.assignedByManagerId) }
          : {}),
      });
      if (changed) moved += 1;
    }
    rows.push({
      identifier: child.identifier,
      title: child.title,
      workerName: workerById.get(entry.assigneeAgentId)?.name ?? "the team",
    });
  }

  if (rows.length > 0) {
    await deps.addComment(
      input.conversationIssueId,
      buildManagerAssignedComment(rows, { managerNamedThem }),
      input.managerId,
    );
  }

  const ready = new Set(input.readyChildIssueIds);
  for (const entry of resolved) {
    if (!ready.has(entry.taskId)) continue;
    await deps.wakeWorker({ issueId: entry.taskId, agentId: entry.assigneeAgentId });
  }

  deps.log(
    managerNamedThem
      ? `[todero] The manager handed the work out; ${moved} task(s) changed hands.\n`
      : "[todero] The manager's reply named nobody, so the usual rule stands.\n",
  );

  return {
    managerNamedThem,
    moved,
    assignedTo: resolved.map((entry) => ({ taskId: entry.taskId, agentId: entry.assigneeAgentId })),
  };
}

export type ManagerGuidanceApplyResult = {
  /** The paragraph that was kept, or null when the reply carried none. */
  guidance: string | null;
  /** Who the task ends up with. */
  assigneeAgentId: string;
  /** True when the manager's reply moved the task to somebody else. */
  reassigned: boolean;
};

/**
 * The manager's reply to a task that came back, applied: its paragraph becomes
 * the task's guidance, the task goes to To do, and the worker is brought back
 * to it. A reply with no paragraph in it still clears the task and starts the
 * worker — the wave never leaves a task parked on the manager.
 */
export async function applyManagerGuidanceReply(
  deps: ManagerWaveDeps,
  input: {
    managerId: string;
    reply: string;
    task: ManagerAssignmentChild;
    workers: AssignableWorker[];
  },
): Promise<ManagerGuidanceApplyResult> {
  const guidance = parseManagerSendbackGuidance(input.reply ?? "").trim() || null;

  // Whoever had the task before the manager took it. Falls back to the first
  // worker, then to whoever holds it now, so the task is never left parked.
  const previousWorkerId = readWaitingForManagerWorkerId(input.task.description);
  const goesBackTo =
    (previousWorkerId && input.workers.some((worker) => worker.id === previousWorkerId) ? previousWorkerId : null) ??
    (input.workers[0]?.id ?? input.task.assigneeAgentId);

  const [resolved] = resolveManagerAssignments(
    input.managerId,
    input.reply,
    [
      {
        id: input.task.id,
        identifier: input.task.identifier,
        title: input.task.title,
        assigneeAgentId: goesBackTo,
      },
    ],
    input.workers,
  );
  const assigneeAgentId = resolved?.assigneeAgentId ?? goesBackTo;
  const reassigned = Boolean(resolved?.assignedByManagerId) && assigneeAgentId !== previousWorkerId;

  let description = descriptionWithoutWaitingForManagerMarker(input.task.description);
  if (guidance) description = descriptionWithGuidanceMarker(description);
  if (reassigned) description = descriptionWithManagerAssignmentMarker(description, input.managerId);

  if (guidance && deps.saveDocument) {
    await deps.saveDocument({
      issueId: input.task.id,
      key: MANAGER_GUIDANCE_DOCUMENT_KEY,
      title: "What to change",
      body: guidance,
    });
  }

  await deps.updateIssue(input.task.id, {
    status: "todo",
    description,
    assigneeAgentId,
  });

  if (guidance) {
    // The worker is chat-only: the thread is its whole memory, so the
    // paragraph has to be said on the task, not only filed against it.
    await deps.addComment(input.task.id, `What to change on ${taskLabel(input.task)}:\n\n${guidance}`, input.managerId);
  }

  await deps.wakeWorker({ issueId: input.task.id, agentId: assigneeAgentId });

  deps.log(
    guidance
      ? `[todero] The manager rewrote the brief for ${taskLabel(input.task)}.\n`
      : `[todero] The manager said nothing usable; ${taskLabel(input.task)} goes back as it was.\n`,
  );

  return { guidance, assigneeAgentId, reassigned };
}

/**
 * The verdict line on the conversation task. The manager reads it there rather
 * than being brought back for it, which is what the wave asks for: a pass costs
 * nothing, a second send-back is what starts a turn.
 */
export async function postReviewVerdictLine(
  deps: Pick<ManagerWaveDeps, "addComment" | "log">,
  input: {
    conversationIssueId: string;
    reviewerAgentId: string;
    task: { identifier: string | null; title: string };
    verdict: "passed" | "sent-back";
    round?: number;
    managerName?: string | null;
  },
): Promise<void> {
  const line = buildReviewVerdictLine({
    identifier: input.task.identifier,
    title: input.task.title,
    verdict: input.verdict,
    round: input.round,
    managerName: input.managerName ?? null,
  });
  await deps.addComment(input.conversationIssueId, line, input.reviewerAgentId);
  deps.log(`[todero] ${line}\n`);
}

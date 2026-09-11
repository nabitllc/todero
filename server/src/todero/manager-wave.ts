/**
 * The manager wave, pure half. Once an organization has a worker, the first
 * agent stops doing tasks and manages them: it assigns the plan's tasks, reads
 * the reviewer's verdicts, and rewrites the brief for anything sent back.
 *
 * Everything the manager "does" is a reply in a fixed shape that Todero parses
 * (see `packages/shared/src/todero-assignments.ts`). This module holds the
 * pieces that need no database: the reasons the manager is brought back, the
 * rule Todero falls back to when the reply has no usable shape, and the short
 * lines posted on the conversation task so a person can follow along.
 */
import { agentNameMatches, parseToderoPlanAssignmentsBlock, taskRefMatches } from "@todero/shared";

/** Brought back to hand the plan's tasks out. */
export const MANAGER_ASSIGNMENT_WAKE_REASON = "manager_assignment";
/** Brought back to rewrite the brief for a task that came back. */
export const MANAGER_SENDBACK_WAKE_REASON = "manager_sendback_guidance";
/**
 * Where the manager's rewritten brief is kept — an issue document next to the
 * existing "plan", "output" and "next" keys, so nothing new is stored in a
 * column of its own.
 */
export const MANAGER_GUIDANCE_DOCUMENT_KEY = "guidance";

export type RuleAssignableTask = { id: string; feature: string };
export type AssignableWorker = { id: string; name: string };

/**
 * Todero's own rule, used before the manager has said anything and whenever
 * its reply cannot be read: keep one feature with one worker, and give the next
 * feature to whoever is carrying the fewest tasks so far. One worker takes all.
 * The manager is never in `workers`, so it never picks up a task of its own.
 */
export function assignTasksByRule(
  tasks: RuleAssignableTask[],
  workers: AssignableWorker[],
): Map<string, string> {
  const byTaskId = new Map<string, string>();
  if (workers.length === 0) return byTaskId;
  if (workers.length === 1) {
    const only = workers[0]!.id;
    for (const task of tasks) byTaskId.set(task.id, only);
    return byTaskId;
  }

  const load = new Map<string, number>(workers.map((worker) => [worker.id, 0]));
  const workerByFeature = new Map<string, string>();
  let unnamed = 0;

  const lightest = (): string => {
    let picked = workers[0]!.id;
    let best = load.get(picked) ?? 0;
    for (const worker of workers) {
      const carried = load.get(worker.id) ?? 0;
      if (carried < best) {
        picked = worker.id;
        best = carried;
      }
    }
    return picked;
  };

  for (const task of tasks) {
    const feature = task.feature.trim().toLowerCase();
    // A task that names no feature is its own bucket: nothing to keep together.
    // The two prefixes keep a real feature from ever colliding with a bucket.
    const key = feature ? `feature:${feature}` : `unnamed:${(unnamed += 1)}`;
    let workerId = workerByFeature.get(key);
    if (!workerId) {
      workerId = lightest();
      workerByFeature.set(key, workerId);
    }
    byTaskId.set(task.id, workerId);
    load.set(workerId, (load.get(workerId) ?? 0) + 1);
  }

  return byTaskId;
}

export type ManagerResolvedAssignment = {
  taskId: string;
  assigneeAgentId: string;
  /** The manager's id when the manager named this one, null when the rule stood. */
  assignedByManagerId: string | null;
};

/**
 * Read the manager's reply and work out who ends up with each task. Tolerant
 * on purpose, and per task: a task the manager named goes where it said, and a
 * task it forgot, mis-spelled, or handed to somebody who is not on the team
 * keeps whoever Todero's rule already gave it to. A reply with no usable shape
 * at all therefore changes nothing, which is exactly the fallback the wave asks
 * for.
 */
export function resolveManagerAssignments(
  managerId: string,
  managerReply: string,
  tasks: Array<{ id: string; identifier: string | null; title: string; assigneeAgentId: string }>,
  workers: AssignableWorker[],
): ManagerResolvedAssignment[] {
  const parsed = parseToderoPlanAssignmentsBlock(managerReply ?? "");
  const named = parsed?.assignments ?? [];

  return tasks.map((task) => {
    const match = named.find((assignment) =>
      taskRefMatches(assignment.taskRef, task.identifier ?? "", task.title),
    );
    const worker = match
      ? workers.find((candidate) => agentNameMatches(candidate.name, match.agentName))
      : undefined;
    if (!worker) {
      return { taskId: task.id, assigneeAgentId: task.assigneeAgentId, assignedByManagerId: null };
    }
    return { taskId: task.id, assigneeAgentId: worker.id, assignedByManagerId: managerId };
  });
}

/** How a task reads in a one-line note: "ZZW-1 — Draft the guide". */
export function taskLabel(task: { identifier: string | null; title: string }): string {
  const identifier = (task.identifier ?? "").trim();
  return identifier ? `${identifier} — ${task.title}` : task.title;
}

/**
 * The short note the manager leaves on the conversation task once it has handed
 * the work out, so a person can see who got what without opening every task.
 */
export function buildManagerAssignedComment(
  rows: Array<{ identifier: string | null; title: string; workerName: string }>,
  options: { managerNamedThem: boolean },
): string {
  const lines = rows.map((row) => `- ${taskLabel(row)} → ${row.workerName}`);
  const head = options.managerNamedThem
    ? "Here is who is doing what:"
    : "Here is who is doing what (shared out by the usual rule):";
  return [head, ...lines].join("\n");
}

/**
 * The one line the conversation task gets after the reviewer reads a task, so
 * the manager and the person see the verdict without another turn.
 */
export function buildReviewVerdictLine(input: {
  identifier: string | null;
  title: string;
  verdict: "passed" | "sent-back";
  round?: number;
  managerName?: string | null;
}): string {
  const label = taskLabel(input);
  if (input.verdict === "passed") return `${label}: the reviewer passed it.`;
  if ((input.round ?? 1) >= 2) {
    return input.managerName
      ? `${label}: the reviewer sent it back again; ${input.managerName} is rewriting the brief.`
      : `${label}: the reviewer sent it back again.`;
  }
  return `${label}: the reviewer sent it back.`;
}

/** The one line that copies the manager on something a person typed elsewhere. */
export function buildPersonWroteLine(task: { identifier: string | null; title: string }): string {
  return `The person wrote on ${taskLabel(task)}.`;
}

/**
 * What the manager is asked for when a task comes back. One paragraph, plain,
 * and the same `STATUS:` ending every other turn uses.
 */
export function buildManagerSendbackInstruction(input: {
  identifier: string | null;
  title: string;
  reason: "reviewer_fail" | "person_sendback";
  note?: string | null;
  workerNames: string[];
}): string {
  const label = taskLabel(input);
  const lines = [
    input.reason === "reviewer_fail"
      ? `The reviewer sent ${label} back a second time.`
      : `The person sent ${label} back.`,
  ];
  const note = (input.note ?? "").trim();
  if (note) {
    lines.push("", "What they said:", note);
  }
  lines.push(
    "",
    "Write one short paragraph for whoever picks it up: what should change, in plain words. No list, no plan block.",
  );
  if (input.workerNames.length > 0) {
    lines.push(
      "",
      `If somebody else should take it, add this shape on its own lines (the team is ${input.workerNames.join(", ")}):`,
      "```",
      "assignments:",
      `- ${label}: <name>`,
      "```",
    );
  }
  lines.push("", "Then end with `STATUS: done`.");
  return lines.join("\n");
}

/**
 * Manager assignment, the parts with no database in them: what the manager is
 * asked when it hands the plan's tasks out, and the marker a task carries so a
 * person can see the manager named that assignee.
 *
 * Reading the manager's reply and working out who ends up with what lives in
 * `manager-wave.ts` (`resolveManagerAssignments`), which is the one
 * implementation of that rule.
 */

export interface ManagerAssignmentContext {
  taskId: string;
  taskIdentifier: string | null;
  taskTitle: string;
  taskFeature: string;
}

export interface ManagerAssignmentWorker {
  id: string;
  name: string;
  openTaskCount: number;
}

/**
 * Build a turn instruction for the manager to assign plan children to workers.
 * Lists each task (identifier, title, feature) and each worker (name, open task count),
 * with the rule of thumb to guide the assignments.
 */
export function buildManagerAssignmentTurnInstruction(
  tasks: ManagerAssignmentContext[],
  workers: ManagerAssignmentWorker[],
): string {
  const lines: string[] = [
    "Assign each task to a worker. Balance by open task count; keep one feature with one worker when possible.",
    "Here are the tasks:",
  ];

  for (const task of tasks) {
    const identifier = task.taskIdentifier ? ` (${task.taskIdentifier})` : "";
    lines.push(`- ${task.taskTitle}${identifier}`);
    if (task.taskFeature.trim()) {
      lines.push(`  Feature: ${task.taskFeature}`);
    }
  }

  lines.push("");
  lines.push("And the team:");
  for (const worker of workers) {
    const plural = worker.openTaskCount === 1 ? "task" : "tasks";
    lines.push(`- ${worker.name}: ${worker.openTaskCount} open ${plural}`);
  }

  lines.push("");
  lines.push("Respond in this shape:");
  lines.push("```");
  lines.push("assignments:");
  lines.push("- <task-id-or-title>: <agent-name>");
  lines.push("- <another-task>: <another-agent>");
  lines.push("```");

  return lines.join("\n");
}

/**
 * Add an HTML comment marker to a description indicating which manager assigned this task.
 */
export function descriptionWithManagerAssignmentMarker(
  description: string | null | undefined,
  managerId: string,
): string {
  const comment = `<!-- todero-assigned-by: ${managerId} -->`;
  if (!description || !description.trim()) {
    return comment;
  }
  // Keep exactly one marker: remove any existing one first
  const cleaned = description.replace(/<!--\s*todero-assigned-by:\s*[^<]*?-->\s*/g, "");
  return `${cleaned.trim()}\n${comment}`;
}

/**
 * Read the manager assignment marker from a description.
 */
export function readManagerAssignmentMarker(description: string | null | undefined): string | null {
  if (!description) return null;
  const match = description.match(/<!--\s*todero-assigned-by:\s*([^<]+?)\s*-->/);
  return match ? match[1]!.trim() : null;
}

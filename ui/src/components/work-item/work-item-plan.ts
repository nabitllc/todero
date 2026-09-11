/**
 * Joining a plan line to the task it became. The plan document names its tasks
 * with ids of its own, and approving it creates real tasks with real ids, so
 * the two are matched on the id first and on the title otherwise — the title is
 * what approval copies across, and it is what the person reads in both places.
 *
 * The point of the join is the status: the Plan tab is the record of what was
 * agreed, and a record that cannot say which parts are done is half a record.
 */
import { taskRowLabel, type WorkItemTaskRow } from "./work-item-model";

function normalize(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

/** The task a plan line became, or null while the plan has made none yet. */
export function planTaskRow(
  planTask: { id: string; title: string },
  tasks: WorkItemTaskRow[] | undefined,
): WorkItemTaskRow | null {
  if (!tasks || tasks.length === 0) return null;
  const byId = tasks.find((task) => task.id === planTask.id);
  if (byId) return byId;
  const wanted = normalize(planTask.title);
  return tasks.find((task) => normalize(task.title) === wanted) ?? null;
}

/** One of the six status words, or Queued — or null when there is no task yet. */
export function planTaskStatusLabel(
  planTask: { id: string; title: string },
  tasks: WorkItemTaskRow[] | undefined,
): string | null {
  const row = planTaskRow(planTask, tasks);
  return row ? taskRowLabel(row) : null;
}

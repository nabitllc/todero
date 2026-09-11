/**
 * The chain of why, above the title: Mission › Feature › Task.
 *
 * It needs no call of its own. The task already carries the goal it was created
 * under, and an approved plan puts one goal per feature under the company's
 * mission — so the feature goal on the task is the middle link, the Goals page
 * is the first, and the task itself is the last.
 *
 * A task with no feature goal has no chain to show. The trail of identifiers
 * beside the type stamp already says where it sits; inventing a "Mission ›
 * Task" crumb for a one-off would say less than nothing.
 */
import type { GoalLevel } from "@todero/shared";

export type ChainLink = {
  id: string;
  label: string;
  /** Absent on the last link: you are already looking at it. */
  href?: string;
};

export type TaskGoal = {
  id: string;
  title: string;
  level: GoalLevel;
};

/** The Goals page, which is what "Mission" opens. */
export const MISSION_HREF = "/goals";
export const MISSION_LABEL = "Mission";

export function chainOfWhy(args: {
  goal: TaskGoal | null | undefined;
  taskTitle: string;
}): ChainLink[] {
  const goal = args.goal;
  if (!goal || goal.level !== "feature") return [];
  const title = args.taskTitle.trim();
  return [
    { id: "mission", label: MISSION_LABEL, href: MISSION_HREF },
    { id: goal.id, label: goal.title.trim() || "Feature", href: `/goals/${goal.id}` },
    { id: "task", label: title || "This task" },
  ];
}

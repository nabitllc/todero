import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@todero/db";
import { goals, issues } from "@todero/db";

/**
 * A feature goal is one feature of an approved plan. Its tasks are the plan
 * tasks that named that feature, so "the feature is finished" is simply "every
 * task linked to it is finished" — nobody has to close it by hand.
 */
export const FEATURE_GOAL_LEVEL = "feature";

/** The goal status that means finished, and the one that means still running. */
export const GOAL_STATUS_DONE = "achieved";
export const GOAL_STATUS_ACTIVE = "active";

export type FeatureGoalTally = {
  /** Tasks linked to the goal, cancelled ones left out. */
  taskCount: number;
  /** Of those, how many are done. */
  doneTaskCount: number;
};

/**
 * The status a feature goal should have, or null to leave it alone.
 *
 * - No tasks yet: nothing to conclude from, leave it.
 * - Every task done: the feature is done.
 * - A task reopened after the feature was closed: the feature is running again.
 * - A cancelled goal is never reopened or closed by this rule; a person
 *   cancelled it on purpose.
 */
export function nextFeatureGoalStatus(input: {
  currentStatus: string;
  tally: FeatureGoalTally;
}): string | null {
  if (input.currentStatus === "cancelled") return null;
  const { taskCount, doneTaskCount } = input.tally;
  if (taskCount <= 0) return null;
  const allDone = doneTaskCount >= taskCount;
  if (allDone) return input.currentStatus === GOAL_STATUS_DONE ? null : GOAL_STATUS_DONE;
  return input.currentStatus === GOAL_STATUS_DONE ? GOAL_STATUS_ACTIVE : null;
}

export async function tallyFeatureGoalTasks(db: Db, goalId: string): Promise<FeatureGoalTally> {
  const rows = await db
    .select({
      taskCount: sql<number>`count(*)`,
      doneTaskCount: sql<number>`count(*) filter (where ${issues.status} = 'done')`,
    })
    .from(issues)
    .where(and(eq(issues.goalId, goalId), sql`${issues.status} <> 'cancelled'`));
  const row = rows[0];
  return {
    taskCount: Number(row?.taskCount ?? 0),
    doneTaskCount: Number(row?.doneTaskCount ?? 0),
  };
}

/**
 * Brings one feature goal's status in line with its tasks. Called wherever a
 * task's status changes. Returns the new status when it changed, else null.
 * Only feature goals move: a company or team goal is a person's call.
 */
export async function syncFeatureGoalCompletion(
  db: Db,
  goalId: string | null | undefined,
): Promise<string | null> {
  if (!goalId) return null;
  const goal = await db
    .select()
    .from(goals)
    .where(eq(goals.id, goalId))
    .then((rows) => rows[0] ?? null);
  if (!goal || goal.level !== FEATURE_GOAL_LEVEL) return null;

  const tally = await tallyFeatureGoalTasks(db, goal.id);
  const next = nextFeatureGoalStatus({ currentStatus: goal.status, tally });
  if (!next) return null;

  await db.update(goals).set({ status: next, updatedAt: new Date() }).where(eq(goals.id, goal.id));
  return next;
}

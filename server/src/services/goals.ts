import { and, asc, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "@todero/db";
import { goals, issues } from "@todero/db";

type GoalReader = Pick<Db, "select">;

export async function getDefaultCompanyGoal(db: GoalReader, companyId: string) {
  const activeRootGoal = await db
    .select()
    .from(goals)
    .where(
      and(
        eq(goals.companyId, companyId),
        eq(goals.level, "company"),
        eq(goals.status, "active"),
        isNull(goals.parentId),
      ),
    )
    .orderBy(asc(goals.createdAt))
    .then((rows) => rows[0] ?? null);
  if (activeRootGoal) return activeRootGoal;

  const anyRootGoal = await db
    .select()
    .from(goals)
    .where(
      and(
        eq(goals.companyId, companyId),
        eq(goals.level, "company"),
        isNull(goals.parentId),
      ),
    )
    .orderBy(asc(goals.createdAt))
    .then((rows) => rows[0] ?? null);
  if (anyRootGoal) return anyRootGoal;

  return db
    .select()
    .from(goals)
    .where(and(eq(goals.companyId, companyId), eq(goals.level, "company")))
    .orderBy(asc(goals.createdAt))
    .then((rows) => rows[0] ?? null);
}

/**
 * How much of the work under each goal is finished. Cancelled tasks are left
 * out of both numbers: work that was called off is not work still owed, so a
 * goal whose only open task was cancelled still counts as finished.
 */
export type GoalTaskCounts = { taskCount: number; doneTaskCount: number };

export async function countTasksByGoal(
  db: GoalReader,
  companyId: string,
): Promise<Map<string, GoalTaskCounts>> {
  const rows = await db
    .select({
      goalId: issues.goalId,
      taskCount: sql<number>`count(*)`,
      doneTaskCount: sql<number>`count(*) filter (where ${issues.status} = 'done')`,
    })
    .from(issues)
    .where(and(eq(issues.companyId, companyId), sql`${issues.status} <> 'cancelled'`))
    .groupBy(issues.goalId);

  const counts = new Map<string, GoalTaskCounts>();
  for (const row of rows) {
    if (!row.goalId) continue;
    counts.set(row.goalId, {
      taskCount: Number(row.taskCount ?? 0),
      doneTaskCount: Number(row.doneTaskCount ?? 0),
    });
  }
  return counts;
}

export function goalService(db: Db) {
  return {
    list: (companyId: string) => db.select().from(goals).where(eq(goals.companyId, companyId)),

    /** The Goals page list: every goal plus how many tasks hang off it. */
    listWithTaskCounts: async (companyId: string) => {
      const [rows, counts] = await Promise.all([
        db.select().from(goals).where(eq(goals.companyId, companyId)),
        countTasksByGoal(db, companyId),
      ]);
      return rows.map((goal) => ({
        ...goal,
        taskCount: counts.get(goal.id)?.taskCount ?? 0,
        doneTaskCount: counts.get(goal.id)?.doneTaskCount ?? 0,
      }));
    },

    getById: (id: string) =>
      db
        .select()
        .from(goals)
        .where(eq(goals.id, id))
        .then((rows) => rows[0] ?? null),

    getDefaultCompanyGoal: (companyId: string) => getDefaultCompanyGoal(db, companyId),

    create: (companyId: string, data: Omit<typeof goals.$inferInsert, "companyId">) =>
      db
        .insert(goals)
        .values({ ...data, companyId })
        .returning()
        .then((rows) => rows[0]),

    update: (id: string, data: Partial<typeof goals.$inferInsert>) =>
      db
        .update(goals)
        .set({ ...data, updatedAt: new Date() })
        .where(eq(goals.id, id))
        .returning()
        .then((rows) => rows[0] ?? null),

    remove: (id: string) =>
      db
        .delete(goals)
        .where(eq(goals.id, id))
        .returning()
        .then((rows) => rows[0] ?? null),
  };
}

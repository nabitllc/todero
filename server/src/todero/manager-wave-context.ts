/**
 * What the manager needs in front of it to hand work out, read straight from
 * the database. Kept next to the rest of the wave rather than inside the timer
 * service, which is already far too long.
 */
import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import type { Db } from "@todero/db";
import { agents, goals, issues } from "@todero/db";
import { listWorkers, type ManagerModeAgent } from "./manager-mode.js";

/** Statuses that mean a task is off somebody's plate. */
export const CLOSED_TASK_STATUSES = ["done", "cancelled"];

export type ManagerWaveChild = {
  id: string;
  identifier: string | null;
  title: string;
  description: string | null;
  assigneeAgentId: string;
  /** The feature the task belongs to, which is the goal it hangs off. */
  feature: string;
};

export type ManagerWaveWorker = { id: string; name: string; openTaskCount: number };

/** The open tasks of a plan, oldest first, with the feature each belongs to. */
export async function loadOpenPlanChildren(
  db: Db,
  input: { companyId: string; issueId: string },
): Promise<ManagerWaveChild[]> {
  const rows = await db
    .select({
      id: issues.id,
      identifier: issues.identifier,
      title: issues.title,
      description: issues.description,
      assigneeAgentId: issues.assigneeAgentId,
      feature: goals.title,
    })
    .from(issues)
    .leftJoin(goals, eq(goals.id, issues.goalId))
    .where(
      and(
        eq(issues.companyId, input.companyId),
        eq(issues.parentId, input.issueId),
        notInArray(issues.status, CLOSED_TASK_STATUSES),
      ),
    )
    .orderBy(asc(issues.createdAt), asc(issues.id));

  return rows
    .filter((row): row is typeof row & { assigneeAgentId: string } => Boolean(row.assigneeAgentId))
    .map((row) => ({
      id: row.id,
      identifier: row.identifier ?? null,
      title: row.title,
      description: row.description ?? null,
      assigneeAgentId: row.assigneeAgentId,
      feature: row.feature ?? "",
    }));
}

/** The team, each with how much it is already carrying. */
export async function loadWorkersWithLoad(db: Db, companyId: string): Promise<ManagerWaveWorker[]> {
  const workers: ManagerModeAgent[] = await listWorkers(db, companyId);
  if (workers.length === 0) return [];
  const rows = await db
    .select({ assigneeAgentId: issues.assigneeAgentId })
    .from(issues)
    .where(
      and(
        eq(issues.companyId, companyId),
        inArray(
          issues.assigneeAgentId,
          workers.map((worker) => worker.id),
        ),
        notInArray(issues.status, CLOSED_TASK_STATUSES),
      ),
    );
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (!row.assigneeAgentId) continue;
    counts.set(row.assigneeAgentId, (counts.get(row.assigneeAgentId) ?? 0) + 1);
  }
  return workers.map((worker) => ({
    id: worker.id,
    name: worker.name,
    openTaskCount: counts.get(worker.id) ?? 0,
  }));
}

/** One task, with the fields the wave's appliers need. */
export async function loadManagerWaveTask(
  db: Db,
  issueId: string,
): Promise<(ManagerWaveChild & { companyId: string; parentId: string | null }) | null> {
  const [row] = await db
    .select({
      id: issues.id,
      companyId: issues.companyId,
      parentId: issues.parentId,
      identifier: issues.identifier,
      title: issues.title,
      description: issues.description,
      assigneeAgentId: issues.assigneeAgentId,
      feature: goals.title,
    })
    .from(issues)
    .leftJoin(goals, eq(goals.id, issues.goalId))
    .where(eq(issues.id, issueId))
    .limit(1);
  if (!row || !row.assigneeAgentId) return null;
  return {
    id: row.id,
    companyId: row.companyId,
    parentId: row.parentId ?? null,
    identifier: row.identifier ?? null,
    title: row.title,
    description: row.description ?? null,
    assigneeAgentId: row.assigneeAgentId,
    feature: row.feature ?? "",
  };
}

/** An agent's name, for the one-line notes. Null when it has gone. */
export async function readAgentName(db: Db, agentId: string): Promise<string | null> {
  const [row] = await db.select({ name: agents.name }).from(agents).where(eq(agents.id, agentId)).limit(1);
  return row?.name ?? null;
}

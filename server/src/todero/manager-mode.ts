/**
 * Manager mode: when an organization has two or more workers, the first agent
 * (the manager) stops doing tasks and manages them instead. These helpers check
 * and query the manager, workers, and reviewer roles.
 */
import { and, eq, ne, sql } from "drizzle-orm";
import type { Db } from "@todero/db";
import { agents } from "@todero/db";
import { JUDGE_AGENT_METADATA_KEY, isJudgeAgentMetadataFor } from "./judge-agent.js";

export interface ManagerModeAgent {
  id: string;
  name: string;
  role: string;
  reportsTo: string | null;
}

/**
 * True when the organization has two or more workers with role "worker",
 * or one worker plus the manager (i.e., at least one worker other than the manager).
 * When true, the manager exists and does not receive plan children.
 */
export async function isManagerMode(db: Db, companyId: string): Promise<boolean> {
  const workers = await listWorkers(db, companyId);
  return workers.length >= 1;
}

/** The roles that can only ever be a teammate, never the lead. */
const TEAMMATE_ROLES: ReadonlySet<string> = new Set(["worker", "reviewer"]);

export type ManagerCandidate = {
  id: string;
  name: string;
  role: string;
  reportsTo: string | null;
  status?: string | null;
};

/**
 * Pick the manager out of a roster ordered oldest first: an agent with role
 * "ceo" wins; otherwise the oldest agent that reports to nobody and is not a
 * worker or a reviewer. The onboarding wizard files the first agent under
 * "general", so a real organization rarely has a "ceo" at all.
 */
export function pickManagerFromRoster<T extends ManagerCandidate>(roster: readonly T[]): T | null {
  const live = roster.filter((row) => row.status !== "terminated");
  const ceo = live.find((row) => row.role === "ceo" && !row.reportsTo) ?? live.find((row) => row.role === "ceo");
  if (ceo) return ceo;
  return live.find((row) => !row.reportsTo && !TEAMMATE_ROLES.has(row.role)) ?? null;
}

/**
 * The manager: the first agent in the organization (see pickManagerFromRoster).
 * Returns null if there is no manager yet.
 */
export async function getManager(db: Db, companyId: string): Promise<ManagerModeAgent | null> {
  const roster = await db
    .select({
      id: agents.id,
      name: agents.name,
      role: agents.role,
      reportsTo: agents.reportsTo,
      status: agents.status,
    })
    .from(agents)
    .where(eq(agents.companyId, companyId))
    .orderBy(agents.createdAt, agents.id);
  const manager = pickManagerFromRoster(roster);
  if (!manager) return null;
  return { id: manager.id, name: manager.name, role: manager.role, reportsTo: manager.reportsTo };
}

/**
 * All workers in the organization: agents with role "worker". A teammate still
 * waiting for a person's yes is left out — it exists, but it does no work, so
 * the manager must not hand it anything.
 */
export async function listWorkers(db: Db, companyId: string): Promise<ManagerModeAgent[]> {
  return db
    .select({
      id: agents.id,
      name: agents.name,
      role: agents.role,
      reportsTo: agents.reportsTo,
    })
    .from(agents)
    .where(
      and(
        eq(agents.companyId, companyId),
        eq(agents.role, "worker"),
        ne(agents.status, "pending_approval"),
      ),
    )
    .orderBy(agents.createdAt, agents.id);
}

/**
 * The reviewer: the agent hired to review work, identified by its metadata
 * marker rather than its role. A reviewer hired before the manager wave
 * carries the role it was given then, and the startup backfill only reaches
 * organizations that are neither archived nor paused; the marker has always
 * been there, so it is what the lookup trusts.
 * Returns null if there is no reviewer yet.
 */
export async function listReviewer(db: Db, companyId: string): Promise<ManagerModeAgent | null> {
  const manager = await getManager(db, companyId);
  if (!manager) return null;

  const reviewers = await db
    .select({
      id: agents.id,
      name: agents.name,
      role: agents.role,
      reportsTo: agents.reportsTo,
      metadata: agents.metadata,
    })
    .from(agents)
    .where(
      and(
        eq(agents.companyId, companyId),
        ne(agents.status, "terminated"),
        sql`${agents.metadata} -> ${JUDGE_AGENT_METADATA_KEY} ->> 'forAgentId' = ${manager.id}`,
      ),
    );

  for (const reviewer of reviewers) {
    if (isJudgeAgentMetadataFor(reviewer.metadata, manager.id)) {
      return {
        id: reviewer.id,
        name: reviewer.name,
        role: reviewer.role,
        reportsTo: reviewer.reportsTo,
      };
    }
  }

  return null;
}

import { and, eq, notInArray } from "drizzle-orm";
import type { Db } from "@todero/db";
import { agents, companies, issues, issueDocuments } from "@todero/db";
import { isConversationalHttpAgent } from "./conversation-thread.js";
import { isJudgeAgentMetadataFor } from "./judge-agent.js";
import { TIMER_CONFIGURED_STAMP_KEY } from "./timer-backfill-stamp.js";
import { pickManagerFromRoster } from "./manager-mode.js";

/**
 * Organizations a startup backfill never writes to. Archived ones are gone,
 * and a paused one is deliberately standing still: a person pressed pause and
 * expects to come back to exactly what they left.
 */
const SKIPPED_COMPANY_STATUSES = ["archived", "paused"];

/** The organizations a backfill is allowed to touch. */
async function selectBackfillableCompanies(db: Db): Promise<Array<{ id: string }>> {
  return db
    .select({ id: companies.id })
    .from(companies)
    .where(notInArray(companies.status, SKIPPED_COMPANY_STATUSES));
}

/**
 * Result of running the startup backfills for timer config and backlog-to-todo conversion.
 * Logged at startup once the database is ready.
 */
export type StartupBackfillsResult = {
  timerBackfill: {
    companiesProcessed: number;
    agentsBackfilled: number;
    /** Only the organizations something changed in, for one log line each. */
    perCompany: Array<{ companyId: string; agentsBackfilled: number }>;
  };
  backlogBackfill: {
    companiesProcessed: number;
    issuesConverted: number;
    perCompany: Array<{ companyId: string; issuesConverted: number }>;
  };
  roleBackfill: {
    companiesProcessed: number;
    agentsRetagged: number;
    perCompany: Array<{ companyId: string; agentsRetagged: number }>;
  };
};

/**
 * Written on the conversation task once its plan's children have been looked
 * at, so a second start leaves them alone — and so a person can park a child
 * in Backlog later on purpose without it being moved back. An HTML comment in
 * the task's own description, which is where this codebase already keeps its
 * markers; no new column.
 */
export const BACKLOG_BACKFILL_MARKER = "<!-- todero-backlog-backfill: done -->";

function hasBacklogBackfillMarker(description: string | null | undefined): boolean {
  return typeof description === "string" && description.includes(BACKLOG_BACKFILL_MARKER);
}

function descriptionWithBacklogBackfillMarker(description: string | null | undefined): string {
  const body = typeof description === "string" ? description : "";
  if (body.includes(BACKLOG_BACKFILL_MARKER)) return body;
  return body.trim().length > 0 ? `${body.replace(/\s+$/, "")}\n${BACKLOG_BACKFILL_MARKER}` : BACKLOG_BACKFILL_MARKER;
}

/**
 * Item A: Timer backfill.
 *
 * Agents hired before wave F have the busy timer off, so open To do tasks sit until a person
 * pokes them. At startup, every agent that is a chat-only conversational http agent whose
 * runtimeConfig.heartbeat.enabled is not true gets the wave-F defaults:
 * - enabled: true
 * - intervalSec: 120
 * - maxConcurrentRuns: 1
 * - skipTimerWhenNoActionableWork: true
 * - cooldownSec: kept if set
 *
 * Stamps runtimeConfig.heartbeat.toderoBackfilledAt so the backfill never re-applies. Every
 * agent hired since wave F carries that stamp from the moment it is created
 * (`stampTimerConfiguredOnNewAgent`), so an agent whose timer a person switched off is left
 * off — only an agent from before the stamp existed is ever touched here.
 * Skips archived and paused organizations.
 * Idempotent.
 */
async function runTimerBackfill(db: Db): Promise<StartupBackfillsResult["timerBackfill"]> {
  const activeOrgs = await selectBackfillableCompanies(db);

  let totalBackfilled = 0;
  const perCompany: Array<{ companyId: string; agentsBackfilled: number }> = [];

  for (const org of activeOrgs) {
    let backfilledHere = 0;
    // Get all conversational agents in this org whose timer is not enabled
    const agentsToBackfill = await db
      .select({
        id: agents.id,
        adapterType: agents.adapterType,
        adapterConfig: agents.adapterConfig,
        runtimeConfig: agents.runtimeConfig,
      })
      .from(agents)
      .where(eq(agents.companyId, org.id));

    for (const agent of agentsToBackfill) {
      // Check if this is a conversational HTTP agent
      if (!isConversationalHttpAgent({ adapterType: agent.adapterType, adapterConfig: agent.adapterConfig })) {
        continue;
      }

      // Parse the current runtime config
      const runtimeConfig = (agent.runtimeConfig ?? {}) as Record<string, unknown>;
      const heartbeat = (runtimeConfig.heartbeat ?? {}) as Record<string, unknown>;

      // Check if timer is already enabled
      if (heartbeat.enabled === true) {
        continue;
      }

      // Already configured once — by an earlier start, or by the hire itself.
      // A person's decision to leave the timer off stands.
      if (heartbeat[TIMER_CONFIGURED_STAMP_KEY] !== undefined) {
        continue;
      }

      // Build the new heartbeat config with wave-F defaults
      const updatedHeartbeat: Record<string, unknown> = {
        enabled: true,
        intervalSec: 120,
        maxConcurrentRuns: 1,
        skipTimerWhenNoActionableWork: true,
        [TIMER_CONFIGURED_STAMP_KEY]: new Date().toISOString(),
      };

      // Keep cooldownSec if already set
      if (heartbeat.cooldownSec !== undefined) {
        updatedHeartbeat.cooldownSec = heartbeat.cooldownSec;
      }

      // Preserve any other fields from the existing heartbeat config
      for (const [key, value] of Object.entries(heartbeat)) {
        if (
          !["enabled", "intervalSec", "maxConcurrentRuns", "skipTimerWhenNoActionableWork", TIMER_CONFIGURED_STAMP_KEY].includes(
            key,
          )
        ) {
          updatedHeartbeat[key] = value;
        }
      }

      // Update the agent
      const updatedRuntimeConfig = {
        ...runtimeConfig,
        heartbeat: updatedHeartbeat,
      };

      await db
        .update(agents)
        .set({ runtimeConfig: updatedRuntimeConfig })
        .where(eq(agents.id, agent.id));

      totalBackfilled++;
      backfilledHere++;
    }
    if (backfilledHere > 0) perCompany.push({ companyId: org.id, agentsBackfilled: backfilledHere });
  }

  return {
    companiesProcessed: activeOrgs.length,
    agentsBackfilled: totalBackfilled,
    perCompany,
  };
}

/**
 * Item B: Backlog-to-To do backfill.
 *
 * Plans approved before wave H created children in Backlog, which the chain never wakes
 * and the timer never picks. For every organization that is neither archived nor paused,
 * every issue in status backlog whose parent has an issue document with key "plan" and
 * which has an assignee agent is moved to todo. Blockers are untouched, so the chain still
 * holds order and only the unblocked child can actually start.
 *
 * Marks the parent conversation task once its plan has been looked at, so a second start
 * changes nothing and a person can park a child in Backlog later on purpose. The marker is
 * an HTML comment in the parent's own description; no new column.
 */
async function runBacklogBackfill(db: Db): Promise<StartupBackfillsResult["backlogBackfill"]> {
  const activeOrgs = await selectBackfillableCompanies(db);

  let totalConverted = 0;
  const perCompany: Array<{ companyId: string; issuesConverted: number }> = [];

  for (const org of activeOrgs) {
    // The tasks that carry a plan, and have not been looked at yet.
    const planParents = await db
      .select({ id: issues.id, description: issues.description })
      .from(issues)
      .innerJoin(issueDocuments, and(eq(issueDocuments.issueId, issues.id), eq(issueDocuments.key, "plan")))
      .where(eq(issues.companyId, org.id))
      .then((rows) => rows.filter((row) => !hasBacklogBackfillMarker(row.description)));
    if (planParents.length === 0) continue;
    const planParentIds = new Set(planParents.map((row) => row.id));

    // Their children that a plan approval left in Backlog. The chain of
    // blockers is untouched, so only the first one can actually start.
    const backlogChildren = await db
      .select({
        id: issues.id,
        parentId: issues.parentId,
        assigneeAgentId: issues.assigneeAgentId,
      })
      .from(issues)
      .where(and(eq(issues.companyId, org.id), eq(issues.status, "backlog")))
      .then((rows) =>
        rows.filter(
          (row) => row.parentId !== null && row.assigneeAgentId !== null && planParentIds.has(row.parentId),
        ),
      );

    let convertedHere = 0;
    for (const child of backlogChildren) {
      await db.update(issues).set({ status: "todo" }).where(eq(issues.id, child.id));
      totalConverted++;
      convertedHere++;
    }
    if (convertedHere > 0) perCompany.push({ companyId: org.id, issuesConverted: convertedHere });

    // Every plan looked at is marked, converted or not: a second start leaves
    // these children alone, and a person can park one in Backlog on purpose.
    for (const parent of planParents) {
      await db
        .update(issues)
        .set({ description: descriptionWithBacklogBackfillMarker(parent.description) })
        .where(eq(issues.id, parent.id));
    }
  }

  return {
    companiesProcessed: activeOrgs.length,
    issuesConverted: totalConverted,
    perCompany,
  };
}

/**
 * Item C: role backfill.
 *
 * The manager wave reads an agent's role: the first agent manages, agents with
 * role "worker" do the tasks, and the reviewer is the one with role
 * "reviewer". Teams put together before the wave do not say that. A second
 * agent hired for the same work copied the first agent's own role, so it reads
 * as another "ceo"; the reviewer was hired as "general". Left alone, such an
 * organization would never see its own team — the manager would keep doing the
 * tasks, and the reviewer would sit in the catch-all group on the Agents page.
 *
 * This gives those two the role they have had in practice all along. It is a
 * data fix, not a schema one: only the `role` (and a missing reporting line)
 * changes.
 *
 * The manager is the oldest agent with role "ceo" — a copied second agent is
 * always younger. Only an agent that reports to it, carries the manager's own
 * role and talks to a model over HTTP is retagged, which is exactly what the
 * old second hire looked like; anybody a person made themselves is left alone.
 * Skips archived and paused organizations. Idempotent.
 */
async function runRoleBackfill(db: Db): Promise<StartupBackfillsResult["roleBackfill"]> {
  const activeOrgs = await selectBackfillableCompanies(db);

  let totalRetagged = 0;
  const perCompany: Array<{ companyId: string; agentsRetagged: number }> = [];

  for (const org of activeOrgs) {
    const roster = await db
      .select({
        id: agents.id,
        role: agents.role,
        reportsTo: agents.reportsTo,
        status: agents.status,
        adapterType: agents.adapterType,
        metadata: agents.metadata,
      })
      .from(agents)
      .where(eq(agents.companyId, org.id))
      .orderBy(agents.createdAt, agents.id);

    // Same rule as getManager: a "ceo" wins, else the oldest agent that reports
    // to nobody and is not a worker or a reviewer (the wizard files the first
    // agent as "general").
    const manager = pickManagerFromRoster(roster.map((row) => ({ ...row, name: "" })));
    if (!manager) continue;

    let retaggedHere = 0;
    for (const agent of roster) {
      if (agent.id === manager.id || agent.status === "terminated") continue;

      const isReviewer = isJudgeAgentMetadataFor(agent.metadata, manager.id);
      const isCopiedSecondHire =
        !isReviewer &&
        agent.role === manager.role &&
        agent.reportsTo === manager.id &&
        agent.adapterType === "http";

      if (!isReviewer && !isCopiedSecondHire) continue;

      const role = isReviewer ? "reviewer" : "worker";
      const reportsTo = agent.reportsTo ?? manager.id;
      if (agent.role === role && agent.reportsTo === reportsTo) continue;

      await db.update(agents).set({ role, reportsTo }).where(eq(agents.id, agent.id));
      totalRetagged++;
      retaggedHere++;
    }
    if (retaggedHere > 0) perCompany.push({ companyId: org.id, agentsRetagged: retaggedHere });
  }

  return {
    companiesProcessed: activeOrgs.length,
    agentsRetagged: totalRetagged,
    perCompany,
  };
}

/**
 * Run all startup backfills.
 * Failure logs but does not block startup.
 */
export async function runStartupBackfills(db: Db): Promise<StartupBackfillsResult> {
  const timerBackfill = await runTimerBackfill(db);
  const backlogBackfill = await runBacklogBackfill(db);
  const roleBackfill = await runRoleBackfill(db);

  return {
    timerBackfill,
    backlogBackfill,
    roleBackfill,
  };
}

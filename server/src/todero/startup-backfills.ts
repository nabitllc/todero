import { and, eq, notInArray } from "drizzle-orm";
import type { Db } from "@todero/db";
import { agents, companies, issues, issueDocuments } from "@todero/db";
import { isConversationalHttpAgent } from "./conversation-thread.js";
import { TIMER_CONFIGURED_STAMP_KEY } from "./timer-backfill-stamp.js";

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
 * Run all startup backfills.
 * Failure logs but does not block startup.
 */
export async function runStartupBackfills(db: Db): Promise<StartupBackfillsResult> {
  const timerBackfill = await runTimerBackfill(db);
  const backlogBackfill = await runBacklogBackfill(db);

  return {
    timerBackfill,
    backlogBackfill,
  };
}

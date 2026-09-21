// The backstop that wakes a task once everything it waited for is finished,
// against a real database.
//
// Wave 3 of the improvement loop. The backstop looked for tasks sitting at
// "blocked" whose earlier tasks were all finished, and woke them. A task that
// Todero had handed back to the person sits at "blocked" too, so the backstop
// could not tell the two apart and woke it over and over: 13 times on ZZGAAA-3
// and 13 on ZZGAAA-5 in wave 16, 30 on ZZGAAA-5 in wave 17, 21 on ZZGAAAAA-3 in
// wave 18. Each hand-back moved the task's blocked timestamp, so the guard that
// suppresses a repeat of the same wake never matched.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { agents, authUsers, companies, createDb, heartbeatRuns, issueRelations, issues } from "@todero/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../../__tests__/helpers/embedded-postgres.js";
import { descriptionWithWaitingMarker } from "../../todero/conversation-thread.js";
import {
  descriptionWithDeferredReviewMarker,
  descriptionWithReviewMarker,
} from "../../todero/conversation-outcome.js";
import { descriptionWithWaitingForManagerMarker } from "../../todero/manager-sendback.js";
import { recoveryService } from "./service.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping the embedded Postgres backstop tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("the backstop that wakes a task whose earlier work is finished", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("todero-wake-backstop-");
    db = createDb(tempDb.connectionString);
    const now = new Date();
    await db.insert(authUsers).values({
      id: "responsible-user",
      name: "Responsible User",
      email: "responsible-user@example.test",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
  }, 30_000);

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  /**
   * One finished task and one task that waited on it. The second one's text is
   * whatever the test says it is, which is the whole point: the two shapes are
   * identical apart from what the task says about itself.
   */
  async function seed(description: string) {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const earlierId = randomUUID();
    const waitingId = randomUUID();
    const issuePrefix = `W${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

    await db.insert(companies).values({
      id: companyId,
      name: "Zz Backstop Org",
      issuePrefix,
      status: "active",
      requireBoardApprovalForNewAgents: false,
      defaultResponsibleUserId: "responsible-user",
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Nova",
      role: "general",
      status: "active",
      adapterType: "http",
      adapterConfig: { url: "http://127.0.0.1:1/v1/chat/completions", method: "POST" },
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values([
      {
        id: earlierId,
        companyId,
        title: "Write initial drafts",
        description: "Write the four drafts.",
        status: "done",
        priority: "medium",
        assigneeAgentId: agentId,
        issueNumber: 1,
        identifier: `${issuePrefix}-1`,
        completedAt: new Date(),
      },
      {
        id: waitingId,
        companyId,
        title: "Review the drafts",
        description,
        status: "blocked",
        priority: "medium",
        assigneeAgentId: agentId,
        issueNumber: 2,
        identifier: `${issuePrefix}-2`,
        blockedTransitionAt: new Date(),
      },
    ]);
    await db.insert(issueRelations).values({
      companyId,
      issueId: earlierId,
      relatedIssueId: waitingId,
      type: "blocks",
    });
    return { companyId, agentId, waitingId };
  }

  /** Run the backstop over one organization and say who it asked to be woken. */
  async function runBackstop(companyId: string) {
    const woken: string[] = [];
    const service = recoveryService(db, {
      enqueueWakeup: async (agentId: string) => {
        woken.push(agentId);
        // A real wake hands back the turn it queued; the backstop only counts
        // a task as healed when it gets one.
        return { id: randomUUID() } as unknown as typeof heartbeatRuns.$inferSelect;
      },
    });
    const result = await service.reconcileResolvedDependencyWakeBackstop({ companyId });
    return { woken, result };
  }

  it("wakes a task that is only waiting on the work before it", async () => {
    const { companyId, agentId } = await seed("Review the four drafts and say what to fix.");
    const { woken, result } = await runBackstop(companyId);
    expect(woken).toEqual([agentId]);
    expect(result.healed).toBe(1);
  }, 30_000);

  // One case per way a task can be parked, each written on its own. A single
  // case carrying two of these notes at once would still pass if only one of
  // them were honoured, which is exactly the hole this is here to close.
  const PARKED_ON_A_PERSON: Array<{ what: string; note: (description: string) => string }> = [
    {
      what: "a task Todero handed back to the person",
      note: (description) => descriptionWithWaitingMarker(description, true),
    },
    {
      what: "a hand-in that is waiting to be reviewed",
      note: (description) => descriptionWithReviewMarker(description, true),
    },
    {
      what: "a hand-in whose review was put off while the organization was on hold",
      note: (description) => descriptionWithDeferredReviewMarker(description, true),
    },
    {
      what: "a task the manager is holding while it rewrites the brief",
      note: (description) => descriptionWithWaitingForManagerMarker(description, "worker-agent"),
    },
  ];

  for (const parked of PARKED_ON_A_PERSON) {
    it(`leaves ${parked.what} alone`, async () => {
      const { companyId } = await seed(parked.note("Review the four drafts and say what to fix."));
      const { woken, result } = await runBackstop(companyId);
      expect(woken).toEqual([]);
      expect(result.healed).toBe(0);
      expect(result.parkedOnPersonSkipped).toBe(1);
    }, 30_000);
  }
});

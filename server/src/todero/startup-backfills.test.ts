import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  agents,
  companies,
  createDb,
  documents,
  issues,
  issueDocuments,
  issueRelations,
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "@todero/db";
import { normalizeRuntimeConfigForNewAgent } from "../services/agents.js";
import { issueService } from "../services/issues.js";
import { runStartupBackfills } from "./startup-backfills.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("startup backfills", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("todero-startup-backfills-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    // Clean up in dependency order
    await db.delete(issueRelations);
    await db.delete(issueDocuments);
    await db.delete(documents);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  describe("timer backfill", () => {
    it("backfills a conversational agent whose timer is not enabled with wave-F defaults", async () => {
      // Create a company
      const company = await db
        .insert(companies)
        .values({
          name: `Timer Test ${randomUUID()}`,
          issuePrefix: `TT${randomUUID().slice(0, 6).toUpperCase()}`,
        })
        .returning()
        .then((rows) => rows[0]!);

      // Create a conversational agent with no timer config
      const agent = await db
        .insert(agents)
        .values({
          companyId: company.id,
          name: "Local LLM",
          adapterType: "http",
          adapterConfig: {
            url: "http://localhost:11434/v1/chat/completions",
          },
          runtimeConfig: {
            heartbeat: {},
          },
        })
        .returning()
        .then((rows) => rows[0]!);

      // Run the backfill
      const result = await runStartupBackfills(db);

      // Verify results
      expect(result.timerBackfill.companiesProcessed).toBe(1);
      expect(result.timerBackfill.agentsBackfilled).toBe(1);

      // Verify the agent was updated
      const updated = await db
        .select()
        .from(agents)
        .where(eq(agents.id, agent.id))
        .then((rows) => rows[0]!);

      const heartbeat = (updated.runtimeConfig as Record<string, unknown>).heartbeat as Record<string, unknown>;
      expect(heartbeat.enabled).toBe(true);
      expect(heartbeat.intervalSec).toBe(120);
      expect(heartbeat.maxConcurrentRuns).toBe(1);
      expect(heartbeat.skipTimerWhenNoActionableWork).toBe(true);
      expect(heartbeat.toderoBackfilledAt).toBeDefined();
      expect(typeof heartbeat.toderoBackfilledAt).toBe("string");
    });

    it("leaves an agent with enabled timer alone", async () => {
      const company = await db
        .insert(companies)
        .values({
          name: `Timer Test ${randomUUID()}`,
          issuePrefix: `TT${randomUUID().slice(0, 6).toUpperCase()}`,
        })
        .returning()
        .then((rows) => rows[0]!);

      const agent = await db
        .insert(agents)
        .values({
          companyId: company.id,
          name: "Local LLM",
          adapterType: "http",
          adapterConfig: {
            url: "http://localhost:11434/v1/chat/completions",
          },
          runtimeConfig: {
            heartbeat: {
              enabled: true,
              intervalSec: 60,
            },
          },
        })
        .returning()
        .then((rows) => rows[0]!);

      const originalRuntimeConfig = agent.runtimeConfig;

      // Run the backfill
      const result = await runStartupBackfills(db);

      // Verify no agents were backfilled
      expect(result.timerBackfill.agentsBackfilled).toBe(0);

      // Verify the agent was not changed
      const updated = await db
        .select()
        .from(agents)
        .where(eq(agents.id, agent.id))
        .then((rows) => rows[0]!);

      expect(updated.runtimeConfig).toEqual(originalRuntimeConfig);
    });

    it("is idempotent: a backfilled agent is not re-backfilled", async () => {
      const company = await db
        .insert(companies)
        .values({
          name: `Timer Test ${randomUUID()}`,
          issuePrefix: `TT${randomUUID().slice(0, 6).toUpperCase()}`,
        })
        .returning()
        .then((rows) => rows[0]!);

      const agent = await db
        .insert(agents)
        .values({
          companyId: company.id,
          name: "Local LLM",
          adapterType: "http",
          adapterConfig: {
            url: "http://localhost:11434/v1/chat/completions",
          },
          runtimeConfig: {
            heartbeat: {
              enabled: true,
              intervalSec: 120,
              toderoBackfilledAt: new Date().toISOString(),
            },
          },
        })
        .returning()
        .then((rows) => rows[0]!);

      // Run the backfill
      const result = await runStartupBackfills(db);

      // Verify no agents were backfilled (already has the marker)
      expect(result.timerBackfill.agentsBackfilled).toBe(0);
    });

    /**
     * Wave J item A: the off switch sticks. The stamp is what separates an
     * agent that was never configured from one a person deliberately turned
     * off, so this case — stamped and off — must survive every start. It is
     * the one that isolates the stamp guard: `enabled` is false here, so the
     * enabled guard cannot carry the test on its own.
     */
    it("leaves an agent a person turned off alone", async () => {
      const company = await db
        .insert(companies)
        .values({
          name: `Timer Test ${randomUUID()}`,
          issuePrefix: `TT${randomUUID().slice(0, 6).toUpperCase()}`,
        })
        .returning()
        .then((rows) => rows[0]!);

      const agent = await db
        .insert(agents)
        .values({
          companyId: company.id,
          name: "Local LLM",
          adapterType: "http",
          adapterConfig: {
            url: "http://localhost:11434/v1/chat/completions",
          },
          runtimeConfig: {
            heartbeat: {
              enabled: false,
              intervalSec: 120,
              toderoBackfilledAt: new Date("2026-09-01T00:00:00.000Z").toISOString(),
            },
          },
        })
        .returning()
        .then((rows) => rows[0]!);

      const originalRuntimeConfig = agent.runtimeConfig;

      const result = await runStartupBackfills(db);

      expect(result.timerBackfill.agentsBackfilled).toBe(0);

      const updated = await db
        .select()
        .from(agents)
        .where(eq(agents.id, agent.id))
        .then((rows) => rows[0]!);

      expect(updated.runtimeConfig).toEqual(originalRuntimeConfig);
      const heartbeat = (updated.runtimeConfig as Record<string, unknown>).heartbeat as Record<string, unknown>;
      expect(heartbeat.enabled).toBe(false);
    });

    /**
     * The case the stamp exists for: an agent hired today is stamped on the
     * way in, so turning its timer off later survives the next start. Without
     * the stamp at the hire, this agent looks exactly like a legacy one and
     * the timer comes back on behind the person's back.
     */
    it("leaves an agent hired today alone after a person turns its timer off", async () => {
      const company = await db
        .insert(companies)
        .values({
          name: `Timer Test ${randomUUID()}`,
          issuePrefix: `TT${randomUUID().slice(0, 6).toUpperCase()}`,
        })
        .returning()
        .then((rows) => rows[0]!);

      const adapterConfig = { url: "http://localhost:11434/v1/chat/completions" };
      // Exactly what the hire stores: the wizard's conversational defaults
      // through the server's own normalizer.
      const hiredRuntimeConfig = normalizeRuntimeConfigForNewAgent(
        { heartbeat: { enabled: true, intervalSec: 120, maxConcurrentRuns: 1 } },
        { adapterType: "http", adapterConfig },
      );
      const heartbeatAtHire = hiredRuntimeConfig.heartbeat as Record<string, unknown>;
      expect(heartbeatAtHire.toderoBackfilledAt).toBeDefined();

      const agent = await db
        .insert(agents)
        .values({
          companyId: company.id,
          name: "Local LLM",
          adapterType: "http",
          adapterConfig,
          runtimeConfig: hiredRuntimeConfig,
        })
        .returning()
        .then((rows) => rows[0]!);

      // The person turns the timer off.
      await db
        .update(agents)
        .set({ runtimeConfig: { ...hiredRuntimeConfig, heartbeat: { ...heartbeatAtHire, enabled: false } } })
        .where(eq(agents.id, agent.id));

      const result = await runStartupBackfills(db);
      expect(result.timerBackfill.agentsBackfilled).toBe(0);

      const updated = await db
        .select()
        .from(agents)
        .where(eq(agents.id, agent.id))
        .then((rows) => rows[0]!);
      const heartbeat = (updated.runtimeConfig as Record<string, unknown>).heartbeat as Record<string, unknown>;
      expect(heartbeat.enabled).toBe(false);
    });

    /**
     * Wave J live verification: a paused organization is standing still on
     * purpose, and a start must not write to it.
     */
    it("skips paused organizations", async () => {
      const company = await db
        .insert(companies)
        .values({
          name: `Timer Test ${randomUUID()}`,
          issuePrefix: `TT${randomUUID().slice(0, 6).toUpperCase()}`,
          status: "paused",
          pauseReason: "The person pressed pause",
          pausedAt: new Date(),
        })
        .returning()
        .then((rows) => rows[0]!);

      const agent = await db
        .insert(agents)
        .values({
          companyId: company.id,
          name: "Local LLM",
          adapterType: "http",
          adapterConfig: {
            url: "http://localhost:11434/v1/chat/completions",
          },
          runtimeConfig: {
            heartbeat: {},
          },
        })
        .returning()
        .then((rows) => rows[0]!);

      const result = await runStartupBackfills(db);

      expect(result.timerBackfill.companiesProcessed).toBe(0);
      expect(result.timerBackfill.agentsBackfilled).toBe(0);

      const updated = await db
        .select()
        .from(agents)
        .where(eq(agents.id, agent.id))
        .then((rows) => rows[0]!);

      const heartbeat = (updated.runtimeConfig as Record<string, unknown>).heartbeat as Record<string, unknown>;
      expect(heartbeat.enabled).toBeUndefined();
      expect(heartbeat.toderoBackfilledAt).toBeUndefined();
    });

    it("preserves cooldownSec if already set", async () => {
      const company = await db
        .insert(companies)
        .values({
          name: `Timer Test ${randomUUID()}`,
          issuePrefix: `TT${randomUUID().slice(0, 6).toUpperCase()}`,
        })
        .returning()
        .then((rows) => rows[0]!);

      const agent = await db
        .insert(agents)
        .values({
          companyId: company.id,
          name: "Local LLM",
          adapterType: "http",
          adapterConfig: {
            url: "http://localhost:11434/v1/chat/completions",
          },
          runtimeConfig: {
            heartbeat: {
              cooldownSec: 20,
            },
          },
        })
        .returning()
        .then((rows) => rows[0]!);

      // Run the backfill
      const result = await runStartupBackfills(db);

      // Verify agent was backfilled
      expect(result.timerBackfill.agentsBackfilled).toBe(1);

      // Verify cooldownSec was preserved
      const updated = await db
        .select()
        .from(agents)
        .where(eq(agents.id, agent.id))
        .then((rows) => rows[0]!);

      const heartbeat = (updated.runtimeConfig as Record<string, unknown>).heartbeat as Record<string, unknown>;
      expect(heartbeat.cooldownSec).toBe(20);
    });

    it("skips archived organizations", async () => {
      // Create an archived company
      const company = await db
        .insert(companies)
        .values({
          name: `Timer Test ${randomUUID()}`,
          issuePrefix: `TT${randomUUID().slice(0, 6).toUpperCase()}`,
          status: "archived",
        })
        .returning()
        .then((rows) => rows[0]!);

      const agent = await db
        .insert(agents)
        .values({
          companyId: company.id,
          name: "Local LLM",
          adapterType: "http",
          adapterConfig: {
            url: "http://localhost:11434/v1/chat/completions",
          },
          runtimeConfig: {
            heartbeat: {},
          },
        })
        .returning()
        .then((rows) => rows[0]!);

      // Run the backfill
      const result = await runStartupBackfills(db);

      // Verify archived org was processed but agent was not backfilled
      expect(result.timerBackfill.companiesProcessed).toBe(0);
      expect(result.timerBackfill.agentsBackfilled).toBe(0);

      // Verify the agent was not changed
      const updated = await db
        .select()
        .from(agents)
        .where(eq(agents.id, agent.id))
        .then((rows) => rows[0]!);

      const heartbeat = (updated.runtimeConfig as Record<string, unknown>).heartbeat as Record<string, unknown>;
      expect(heartbeat.enabled).toBeUndefined();
    });
  });

  describe("backlog-to-todo backfill", () => {
    it("moves backlog children with plan-carrying parents to todo", async () => {
      const company = await db
        .insert(companies)
        .values({
          name: `Backlog Test ${randomUUID()}`,
          issuePrefix: `BT${randomUUID().slice(0, 6).toUpperCase()}`,
        })
        .returning()
        .then((rows) => rows[0]!);

      const agent = await db
        .insert(agents)
        .values({
          companyId: company.id,
          name: "Worker",
          adapterType: "process",
          adapterConfig: {},
        })
        .returning()
        .then((rows) => rows[0]!);

      // Create a parent issue
      const parent = await db
        .insert(issues)
        .values({
          companyId: company.id,
          title: "Parent Task",
          status: "in_progress",
        })
        .returning()
        .then((rows) => rows[0]!);

      // Create a plan document
      const doc = await db
        .insert(documents)
        .values({
          companyId: company.id,
          latestBody: "# Plan",
        })
        .returning()
        .then((rows) => rows[0]!);

      // Link the document to the parent
      await db.insert(issueDocuments).values({
        companyId: company.id,
        issueId: parent.id,
        documentId: doc.id,
        key: "plan",
      });

      // Create backlog children
      const backlogChild = await db
        .insert(issues)
        .values({
          companyId: company.id,
          parentId: parent.id,
          title: "Backlog Child",
          status: "backlog",
          assigneeAgentId: agent.id,
        })
        .returning()
        .then((rows) => rows[0]!);

      // Run the backfill
      const result = await runStartupBackfills(db);

      // Verify results
      expect(result.backlogBackfill.companiesProcessed).toBe(1);
      expect(result.backlogBackfill.issuesConverted).toBe(1);

      // Verify the issue was converted
      const updated = await db
        .select()
        .from(issues)
        .where(eq(issues.id, backlogChild.id))
        .then((rows) => rows[0]!);

      expect(updated.status).toBe("todo");
    });

    /**
     * Wave J item B: a chain of children all move to To do, and the chain
     * still holds order — the blocker relation is untouched, so only the
     * child nothing waits on is ready to be picked up.
     */
    it("moves a chain of backlog children to todo and keeps the order", async () => {
      const company = await db
        .insert(companies)
        .values({
          name: `Backlog Test ${randomUUID()}`,
          issuePrefix: `BT${randomUUID().slice(0, 6).toUpperCase()}`,
        })
        .returning()
        .then((rows) => rows[0]!);

      const agent = await db
        .insert(agents)
        .values({
          companyId: company.id,
          name: "Worker",
          adapterType: "process",
          adapterConfig: {},
        })
        .returning()
        .then((rows) => rows[0]!);

      const parent = await db
        .insert(issues)
        .values({ companyId: company.id, title: "Parent Task", status: "in_progress" })
        .returning()
        .then((rows) => rows[0]!);

      const doc = await db
        .insert(documents)
        .values({ companyId: company.id, latestBody: "# Plan" })
        .returning()
        .then((rows) => rows[0]!);

      await db.insert(issueDocuments).values({
        companyId: company.id,
        issueId: parent.id,
        documentId: doc.id,
        key: "plan",
      });

      const first = await db
        .insert(issues)
        .values({
          companyId: company.id,
          parentId: parent.id,
          title: "First",
          status: "backlog",
          assigneeAgentId: agent.id,
        })
        .returning()
        .then((rows) => rows[0]!);

      const second = await db
        .insert(issues)
        .values({
          companyId: company.id,
          parentId: parent.id,
          title: "Second",
          status: "backlog",
          assigneeAgentId: agent.id,
        })
        .returning()
        .then((rows) => rows[0]!);

      // The second waits for the first: `issueId` blocks `relatedIssueId`.
      await db.insert(issueRelations).values({
        companyId: company.id,
        issueId: first.id,
        relatedIssueId: second.id,
        type: "blocks",
      });

      const result = await runStartupBackfills(db);

      expect(result.backlogBackfill.issuesConverted).toBe(2);

      const rows = await db
        .select({ id: issues.id, status: issues.status })
        .from(issues)
        .where(eq(issues.parentId, parent.id));
      expect(rows.map((row) => row.status).sort()).toEqual(["todo", "todo"]);

      // The chain still holds: the same readiness check the wake path uses
      // says only the first one can start.
      const readiness = await issueService(db).listDependencyReadiness(company.id, [first.id, second.id]);
      expect(readiness.get(first.id)?.isDependencyReady).toBe(true);
      expect(readiness.get(second.id)?.isDependencyReady).toBe(false);
      expect(readiness.get(second.id)?.unresolvedBlockerIssueIds).toEqual([first.id]);
    });

    it("skips paused organizations", async () => {
      const company = await db
        .insert(companies)
        .values({
          name: `Backlog Test ${randomUUID()}`,
          issuePrefix: `BT${randomUUID().slice(0, 6).toUpperCase()}`,
          status: "paused",
          pauseReason: "The person pressed pause",
          pausedAt: new Date(),
        })
        .returning()
        .then((rows) => rows[0]!);

      const agent = await db
        .insert(agents)
        .values({
          companyId: company.id,
          name: "Worker",
          adapterType: "process",
          adapterConfig: {},
        })
        .returning()
        .then((rows) => rows[0]!);

      const parent = await db
        .insert(issues)
        .values({ companyId: company.id, title: "Parent Task", status: "in_progress" })
        .returning()
        .then((rows) => rows[0]!);

      const doc = await db
        .insert(documents)
        .values({ companyId: company.id, latestBody: "# Plan" })
        .returning()
        .then((rows) => rows[0]!);

      await db.insert(issueDocuments).values({
        companyId: company.id,
        issueId: parent.id,
        documentId: doc.id,
        key: "plan",
      });

      const child = await db
        .insert(issues)
        .values({
          companyId: company.id,
          parentId: parent.id,
          title: "Backlog Child",
          status: "backlog",
          assigneeAgentId: agent.id,
        })
        .returning()
        .then((rows) => rows[0]!);

      const result = await runStartupBackfills(db);

      expect(result.backlogBackfill.companiesProcessed).toBe(0);
      expect(result.backlogBackfill.issuesConverted).toBe(0);

      const rows = await db
        .select({ status: issues.status, description: issues.description })
        .from(issues)
        .where(eq(issues.id, child.id));
      expect(rows[0]!.status).toBe("backlog");

      // Not even the parent's description is rewritten in a paused organization.
      const parentAfter = await db
        .select({ description: issues.description })
        .from(issues)
        .where(eq(issues.id, parent.id))
        .then((all) => all[0]!);
      expect(parentAfter.description).toBe(parent.description);
    });

    it("leaves backlog issues without plan-carrying parents alone", async () => {
      const company = await db
        .insert(companies)
        .values({
          name: `Backlog Test ${randomUUID()}`,
          issuePrefix: `BT${randomUUID().slice(0, 6).toUpperCase()}`,
        })
        .returning()
        .then((rows) => rows[0]!);

      const agent = await db
        .insert(agents)
        .values({
          companyId: company.id,
          name: "Worker",
          adapterType: "process",
          adapterConfig: {},
        })
        .returning()
        .then((rows) => rows[0]!);

      // Create a parent issue without a plan
      const parent = await db
        .insert(issues)
        .values({
          companyId: company.id,
          title: "Parent Task",
          status: "in_progress",
        })
        .returning()
        .then((rows) => rows[0]!);

      // Create a backlog child
      const backlogChild = await db
        .insert(issues)
        .values({
          companyId: company.id,
          parentId: parent.id,
          title: "Backlog Child",
          status: "backlog",
          assigneeAgentId: agent.id,
        })
        .returning()
        .then((rows) => rows[0]!);

      // Run the backfill
      const result = await runStartupBackfills(db);

      // Verify no issues were converted
      expect(result.backlogBackfill.issuesConverted).toBe(0);

      // Verify the issue was not changed
      const updated = await db
        .select()
        .from(issues)
        .where(eq(issues.id, backlogChild.id))
        .then((rows) => rows[0]!);

      expect(updated.status).toBe("backlog");
    });

    it("is idempotent: running twice changes nothing the second time", async () => {
      const company = await db
        .insert(companies)
        .values({
          name: `Backlog Test ${randomUUID()}`,
          issuePrefix: `BT${randomUUID().slice(0, 6).toUpperCase()}`,
        })
        .returning()
        .then((rows) => rows[0]!);

      const agent = await db
        .insert(agents)
        .values({
          companyId: company.id,
          name: "Worker",
          adapterType: "process",
          adapterConfig: {},
        })
        .returning()
        .then((rows) => rows[0]!);

      // Create a parent issue
      const parent = await db
        .insert(issues)
        .values({
          companyId: company.id,
          title: "Parent Task",
          status: "in_progress",
        })
        .returning()
        .then((rows) => rows[0]!);

      // Create a plan document
      const doc = await db
        .insert(documents)
        .values({
          companyId: company.id,
          latestBody: "# Plan",
        })
        .returning()
        .then((rows) => rows[0]!);

      // Link the document to the parent
      await db.insert(issueDocuments).values({
        companyId: company.id,
        issueId: parent.id,
        documentId: doc.id,
        key: "plan",
      });

      // Create backlog children
      await db.insert(issues).values({
        companyId: company.id,
        parentId: parent.id,
        title: "Backlog Child",
        status: "backlog",
        assigneeAgentId: agent.id,
      });

      // Run the backfill first time
      const result1 = await runStartupBackfills(db);
      expect(result1.backlogBackfill.issuesConverted).toBe(1);

      // Run the backfill second time
      const result2 = await runStartupBackfills(db);

      // Verify nothing changed the second time
      expect(result2.backlogBackfill.issuesConverted).toBe(0);
    });

    /**
     * Wave J item B: once a plan has been looked at, a child a person parks in
     * Backlog on purpose stays there.
     */
    it("leaves a child parked in Backlog after the first pass alone", async () => {
      const company = await db
        .insert(companies)
        .values({
          name: `Backlog Test ${randomUUID()}`,
          issuePrefix: `BT${randomUUID().slice(0, 6).toUpperCase()}`,
        })
        .returning()
        .then((rows) => rows[0]!);

      const agent = await db
        .insert(agents)
        .values({
          companyId: company.id,
          name: "Worker",
          adapterType: "process",
          adapterConfig: {},
        })
        .returning()
        .then((rows) => rows[0]!);

      const parent = await db
        .insert(issues)
        .values({ companyId: company.id, title: "Parent Task", status: "in_progress" })
        .returning()
        .then((rows) => rows[0]!);

      const doc = await db
        .insert(documents)
        .values({ companyId: company.id, latestBody: "# Plan" })
        .returning()
        .then((rows) => rows[0]!);

      await db.insert(issueDocuments).values({
        companyId: company.id,
        issueId: parent.id,
        documentId: doc.id,
        key: "plan",
      });

      const child = await db
        .insert(issues)
        .values({
          companyId: company.id,
          parentId: parent.id,
          title: "Child",
          status: "todo",
          assigneeAgentId: agent.id,
        })
        .returning()
        .then((rows) => rows[0]!);

      // First pass: nothing to move, but the plan is marked as looked at.
      await runStartupBackfills(db);

      // The person parks the child afterwards.
      await db.update(issues).set({ status: "backlog" }).where(eq(issues.id, child.id));

      const second = await runStartupBackfills(db);
      expect(second.backlogBackfill.issuesConverted).toBe(0);
      const parked = await db
        .select()
        .from(issues)
        .where(eq(issues.id, child.id))
        .then((rows) => rows[0]!);
      expect(parked.status).toBe("backlog");
    });

    it("skips archived organizations", async () => {
      // Create an archived company
      const company = await db
        .insert(companies)
        .values({
          name: `Backlog Test ${randomUUID()}`,
          issuePrefix: `BT${randomUUID().slice(0, 6).toUpperCase()}`,
          status: "archived",
        })
        .returning()
        .then((rows) => rows[0]!);

      const agent = await db
        .insert(agents)
        .values({
          companyId: company.id,
          name: "Worker",
          adapterType: "process",
          adapterConfig: {},
        })
        .returning()
        .then((rows) => rows[0]!);

      // Create a parent issue
      const parent = await db
        .insert(issues)
        .values({
          companyId: company.id,
          title: "Parent Task",
          status: "in_progress",
        })
        .returning()
        .then((rows) => rows[0]!);

      // Create a plan document
      const doc = await db
        .insert(documents)
        .values({
          companyId: company.id,
          latestBody: "# Plan",
        })
        .returning()
        .then((rows) => rows[0]!);

      // Link the document to the parent
      await db.insert(issueDocuments).values({
        companyId: company.id,
        issueId: parent.id,
        documentId: doc.id,
        key: "plan",
      });

      // Create backlog child
      const backlogChild = await db
        .insert(issues)
        .values({
          companyId: company.id,
          parentId: parent.id,
          title: "Backlog Child",
          status: "backlog",
          assigneeAgentId: agent.id,
        })
        .returning()
        .then((rows) => rows[0]!);

      // Run the backfill
      const result = await runStartupBackfills(db);

      // Verify archived org was skipped
      expect(result.backlogBackfill.companiesProcessed).toBe(0);
      expect(result.backlogBackfill.issuesConverted).toBe(0);

      // Verify the issue was not changed
      const updated = await db
        .select()
        .from(issues)
        .where(eq(issues.id, backlogChild.id))
        .then((rows) => rows[0]!);

      expect(updated.status).toBe("backlog");
    });
  });
});

import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "@todero/db";
import { buildJudgeAgentMetadata } from "./judge-agent.js";
import { getManager, isManagerMode, listReviewer, listWorkers } from "./manager-mode.js";
import { findJudgeAgentForHandIn } from "./judge-review.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("manager mode", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  let companyId: string;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("todero-manager-mode-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function createCompany() {
    const company = await db
      .insert(companies)
      .values({
        name: `Manager Test ${randomUUID()}`,
        issuePrefix: `MT${randomUUID().slice(0, 6).toUpperCase()}`,
      })
      .returning()
      .then((rows) => rows[0]!);
    companyId = company.id;
    return company;
  }

  async function createAgent(role: string, name: string, reportsTo?: string) {
    return db
      .insert(agents)
      .values({
        companyId,
        name,
        role,
        adapterType: "http",
        adapterConfig: {},
        ...(reportsTo && { reportsTo }),
      })
      .returning()
      .then((rows) => rows[0]!);
  }

  describe("isManagerMode", () => {
    it("returns false when there are no workers", async () => {
      await createCompany();
      const manager = await createAgent("ceo", "Manager");
      const result = await isManagerMode(db, companyId);
      expect(result).toBe(false);
    });

    it("returns true when there is one worker", async () => {
      await createCompany();
      const manager = await createAgent("ceo", "Manager");
      const worker = await createAgent("worker", "Worker One", manager.id);
      const result = await isManagerMode(db, companyId);
      expect(result).toBe(true);
    });

    it("returns true when there are two workers", async () => {
      await createCompany();
      const manager = await createAgent("ceo", "Manager");
      await createAgent("worker", "Worker One", manager.id);
      await createAgent("worker", "Worker Two", manager.id);
      const result = await isManagerMode(db, companyId);
      expect(result).toBe(true);
    });

    it("does not count agents with other roles as workers", async () => {
      await createCompany();
      const manager = await createAgent("ceo", "Manager");
      await createAgent("general", "Helper", manager.id);
      await createAgent("reviewer", "Reviewer", manager.id);
      const result = await isManagerMode(db, companyId);
      expect(result).toBe(false);
    });
  });

  describe("getManager", () => {
    it("returns the ceo agent", async () => {
      await createCompany();
      const manager = await createAgent("ceo", "Nova");
      const result = await getManager(db, companyId);
      expect(result).toEqual({
        id: manager.id,
        name: "Nova",
        role: "ceo",
        reportsTo: null,
      });
    });

    it("returns null when there is no ceo", async () => {
      await createCompany();
      const result = await getManager(db, companyId);
      expect(result).toBeNull();
    });

    it("treats the first agent the wizard filed as general as the manager", async () => {
      await createCompany();
      const lead = await createAgent("general", "Nova");
      await createAgent("worker", "Ash", lead.id);
      const result = await getManager(db, companyId);
      expect(result?.id).toBe(lead.id);
    });

    it("prefers a ceo over an older general agent", async () => {
      await createCompany();
      await createAgent("general", "Older");
      const ceo = await createAgent("ceo", "Manager");
      const result = await getManager(db, companyId);
      expect(result?.id).toBe(ceo.id);
    });

    it("never picks a worker or a reviewer as the manager", async () => {
      await createCompany();
      await createAgent("worker", "Ash");
      await createAgent("reviewer", "Judge");
      const result = await getManager(db, companyId);
      expect(result).toBeNull();
    });
  });

  describe("listWorkers", () => {
    it("returns all workers", async () => {
      await createCompany();
      const manager = await createAgent("ceo", "Manager");
      const worker1 = await createAgent("worker", "Ada", manager.id);
      const worker2 = await createAgent("worker", "Nova", manager.id);
      const result = await listWorkers(db, companyId);
      expect(result).toHaveLength(2);
      expect(result.map((w) => w.id).sort()).toEqual([worker1.id, worker2.id].sort());
    });

    it("returns empty array when there are no workers", async () => {
      await createCompany();
      await createAgent("ceo", "Manager");
      const result = await listWorkers(db, companyId);
      expect(result).toEqual([]);
    });

    it("does not return agents with other roles", async () => {
      await createCompany();
      const manager = await createAgent("ceo", "Manager");
      await createAgent("worker", "Worker One", manager.id);
      await createAgent("general", "Helper", manager.id);
      await createAgent("reviewer", "Reviewer", manager.id);
      const result = await listWorkers(db, companyId);
      expect(result).toHaveLength(1);
      expect(result[0]!.role).toBe("worker");
    });
  });

  describe("findJudgeAgentForHandIn", () => {
    it("finds the reviewer hired for the manager when a worker hands in", async () => {
      await createCompany();
      const manager = await createAgent("general", "Nova");
      const worker = await createAgent("worker", "Ash", manager.id);
      const [reviewer] = await db
        .insert(agents)
        .values({
          companyId,
          name: "Nova's reviewer",
          role: "reviewer",
          reportsTo: manager.id,
          status: "idle",
          adapterType: "http",
          adapterConfig: {},
          runtimeConfig: {},
          permissions: {},
          metadata: buildJudgeAgentMetadata(manager.id),
        })
        .returning({ id: agents.id });
      const forWorker = await findJudgeAgentForHandIn(db, { companyId, leadAgentId: worker.id });
      expect(forWorker?.id).toBe(reviewer!.id);
      const forManager = await findJudgeAgentForHandIn(db, { companyId, leadAgentId: manager.id });
      expect(forManager?.id).toBe(reviewer!.id);
    });

    it("finds nothing when the organization has no reviewer", async () => {
      await createCompany();
      const manager = await createAgent("general", "Nova");
      const worker = await createAgent("worker", "Ash", manager.id);
      expect(await findJudgeAgentForHandIn(db, { companyId, leadAgentId: worker.id })).toBeNull();
    });
  });

  describe("listReviewer", () => {
    it("returns the reviewer when it exists", async () => {
      await createCompany();
      const manager = await createAgent("ceo", "Manager");
      const reviewer = await db
        .insert(agents)
        .values({
          companyId,
          name: "The Reviewer",
          role: "reviewer",
          adapterType: "http",
          adapterConfig: {},
          reportsTo: manager.id,
          metadata: buildJudgeAgentMetadata(manager.id),
        })
        .returning()
        .then((rows) => rows[0]!);
      const result = await listReviewer(db, companyId);
      expect(result).toEqual({
        id: reviewer.id,
        name: "The Reviewer",
        role: "reviewer",
        reportsTo: manager.id,
      });
    });

    it("returns null when there is no reviewer", async () => {
      await createCompany();
      await createAgent("ceo", "Manager");
      const result = await listReviewer(db, companyId);
      expect(result).toBeNull();
    });

    it("returns null when there is no manager", async () => {
      await createCompany();
      const result = await listReviewer(db, companyId);
      expect(result).toBeNull();
    });

    it("ignores reviewers with wrong metadata", async () => {
      await createCompany();
      const manager = await createAgent("ceo", "Manager");
      const wrongManager = await createAgent("ceo", "Other");
      const reviewer = await db
        .insert(agents)
        .values({
          companyId,
          name: "Wrong Reviewer",
          role: "reviewer",
          adapterType: "http",
          adapterConfig: {},
          reportsTo: manager.id,
          metadata: buildJudgeAgentMetadata(wrongManager.id),
        })
        .returning()
        .then((rows) => rows[0]!);
      const result = await listReviewer(db, companyId);
      expect(result).toBeNull();
    });

    it("ignores agents with other roles", async () => {
      await createCompany();
      const manager = await createAgent("ceo", "Manager");
      await createAgent("general", "Not a reviewer");
      const result = await listReviewer(db, companyId);
      expect(result).toBeNull();
    });

    it("finds a reviewer hired before the manager wave, whatever role it carries", async () => {
      await createCompany();
      const manager = await createAgent("ceo", "Manager");
      const reviewer = await db
        .insert(agents)
        .values({
          companyId,
          name: "The Reviewer",
          // What the reviewer was hired as before the wave named the role.
          role: "general",
          adapterType: "http",
          adapterConfig: {},
          metadata: buildJudgeAgentMetadata(manager.id),
        })
        .returning()
        .then((rows) => rows[0]!);
      const result = await listReviewer(db, companyId);
      expect(result?.id).toBe(reviewer.id);
    });
  });
});

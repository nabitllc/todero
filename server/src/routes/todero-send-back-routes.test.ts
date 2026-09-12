// Gauntlet item 4, the ordinary twin of the item check
// (src/__tests__/send-back-route.gauntlet.ts), so CI keeps guarding it: a
// person's send-back is one call, and the agent's wake comes after the note.
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { agents, companies, createDb, issueComments, issues } from "@todero/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "../__tests__/helpers/embedded-postgres.js";
import { errorHandler } from "../middleware/index.js";
import { SEND_BACK_WAKE_REASON, toderoSendBackRoutes } from "./todero-send-back-routes.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("POST /api/issues/:id/send-back", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("send-back-route-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(issueComments);
    await db.delete(issues);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  async function seedHandedInTask() {
    const companyId = randomUUID();
    const agentId = randomUUID();
    const issueId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "Send-back Co",
      issuePrefix: `T${companyId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Nova",
      role: "general",
      status: "idle",
      adapterType: "http",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    await db.insert(issues).values({
      id: issueId,
      companyId,
      title: "Draft the one-page concept",
      status: "blocked",
      description: "<!-- todero-blocked-by: waiting-on-you -->\n<!-- todero-review: pending -->\nGoal: a concept page",
      assigneeAgentId: agentId,
    });
    return { companyId, agentId, issueId };
  }

  function appWith(heartbeat?: { wakeup: ReturnType<typeof vi.fn> }) {
    const app = express();
    app.use(express.json());
    app.use("/api", toderoSendBackRoutes(db, heartbeat ? { heartbeat: heartbeat as never } : {}));
    app.use(errorHandler);
    return app;
  }

  it("puts the task back to To do, stores the note, and only then wakes the agent with the note", async () => {
    const { agentId, issueId } = await seedHandedInTask();
    const order: string[] = [];
    const wakeup = vi.fn(async () => {
      const notes = await db.select({ id: issueComments.id }).from(issueComments).where(eq(issueComments.issueId, issueId));
      order.push(notes.length > 0 ? "note-was-there" : "note-missing");
      return null;
    });

    const res = await request(appWith({ wakeup }))
      .post(`/api/issues/${issueId}/send-back`)
      .send({ note: "Please add a paragraph on why this matters for the diners." });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ issueId, status: "todo" });
    expect(typeof res.body.commentId).toBe("string");

    const [row] = await db.select({ status: issues.status, description: issues.description }).from(issues).where(eq(issues.id, issueId));
    expect(row?.status).toBe("todo");
    expect(row?.description ?? "").not.toContain("todero-review: pending");
    expect(row?.description ?? "").not.toContain("waiting-on-you");
    expect(row?.description ?? "").toContain("Goal: a concept page");

    expect(wakeup).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["note-was-there"]);
    const [wokeAgentId, wake] = wakeup.mock.calls[0] as unknown as [string, { reason: string; payload: { commentId: string } }];
    expect(wokeAgentId).toBe(agentId);
    expect(wake.reason).toBe(SEND_BACK_WAKE_REASON);
    expect(wake.payload.commentId).toBe(res.body.commentId);
  });

  it("works without a wake queue, as the bare item check runs it", async () => {
    const { issueId } = await seedHandedInTask();
    const res = await request(appWith()).post(`/api/issues/${issueId}/send-back`).send({ note: "Shorter, please." });
    expect(res.status).toBe(200);
    const notes = await db.select({ body: issueComments.body }).from(issueComments).where(eq(issueComments.issueId, issueId));
    expect(notes.map((n) => n.body)).toEqual(["Shorter, please."]);
  });

  it("refuses an empty note, and a task that does not exist", async () => {
    const app = appWith();
    expect((await request(app).post(`/api/issues/${randomUUID()}/send-back`).send({ note: "   " })).status).toBe(400);
    expect((await request(app).post(`/api/issues/${randomUUID()}/send-back`).send({ note: "Real note." })).status).toBe(404);
  });
});

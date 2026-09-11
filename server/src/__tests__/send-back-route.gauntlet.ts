/**
 * Gauntlet item 4: a person's send-back is one call. Today the UI sends two
 * (a status change, then the note) and the worker can start before the note
 * lands. Fails until server/src/routes/todero-send-back-routes.ts exists.
 */
import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { agents, companies, createDb, issueComments, issues } from "@todero/db";
import { getEmbeddedPostgresTestSupport, startEmbeddedPostgresTestDatabase } from "./helpers/embedded-postgres.js";
import { toderoSendBackRoutes } from "../routes/todero-send-back-routes.js";
import { errorHandler } from "../middleware/index.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

describeEmbeddedPostgres("POST /api/issues/:issueId/send-back", () => {
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

  it("puts the task back to To do and posts the note in one call", async () => {
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

    const app = express();
    app.use(express.json());
    app.use("/api", toderoSendBackRoutes(db));
    app.use(errorHandler);

    const res = await request(app)
      .post(`/api/issues/${issueId}/send-back`)
      .send({ note: "Please add a paragraph on why this matters for the diners." });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ issueId, status: "todo" });
    expect(typeof res.body.commentId).toBe("string");

    const [row] = await db.select({ status: issues.status, description: issues.description }).from(issues).where(eq(issues.id, issueId));
    expect(row?.status).toBe("todo");
    expect(row?.description ?? "").not.toContain("todero-review: pending");

    const notes = await db.select({ body: issueComments.body }).from(issueComments).where(eq(issueComments.issueId, issueId));
    expect(notes.map((n) => n.body)).toContain("Please add a paragraph on why this matters for the diners.");
  });

  it("refuses an empty note", async () => {
    const app = express();
    app.use(express.json());
    app.use("/api", toderoSendBackRoutes(db));
    app.use(errorHandler);
    const res = await request(app).post(`/api/issues/${randomUUID()}/send-back`).send({ note: "   " });
    expect(res.status).toBe(400);
  });
});

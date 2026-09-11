import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { activityLog, companies, createDb } from "@todero/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { toderoPauseRoutes } from "../routes/todero-pause-routes.js";
import { errorHandler } from "../middleware/index.js";

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres pause route tests on this host: ${embeddedPostgresSupport.reason ?? "unsupported environment"}`,
  );
}

describeEmbeddedPostgres("Play / Pause routes", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const boardUserId = randomUUID();

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("todero-pause-routes-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    await db.delete(activityLog);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function createApp() {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { actor: Record<string, unknown> }).actor = {
        type: "board",
        source: "local_implicit",
        userId: boardUserId,
        isInstanceAdmin: true,
      };
      next();
    });
    app.use("/api", toderoPauseRoutes(db));
    app.use(errorHandler);
    return app;
  }

  async function insertCompany(name: string, status: "active" | "paused" = "active", pauseReason?: string) {
    const id = randomUUID();
    await db.insert(companies).values({
      id,
      name,
      status,
      pauseReason: pauseReason ?? null,
      pausedAt: status === "paused" ? new Date("2026-09-10T10:42:00Z") : null,
      issuePrefix: `T${id.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    });
    return id;
  }

  function readCompany(companyId: string) {
    return db
      .select({ status: companies.status, pauseReason: companies.pauseReason, pausedAt: companies.pausedAt })
      .from(companies)
      .where(eq(companies.id, companyId))
      .then((rows) => rows[0] ?? null);
  }

  function readActions(companyId: string) {
    return db
      .select({ action: activityLog.action, details: activityLog.details })
      .from(activityLog)
      .where(eq(activityLog.companyId, companyId))
      .then((rows) => rows);
  }

  it("pause flips the three columns and writes one activity line", async () => {
    const companyId = await insertCompany("Pause Co");
    const app = createApp();

    const response = await request(app).post(`/api/companies/${companyId}/pause`).send({});
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "paused", pauseReason: "manual" });

    const row = await readCompany(companyId);
    expect(row?.status).toBe("paused");
    expect(row?.pauseReason).toBe("manual");
    expect(row?.pausedAt).toBeInstanceOf(Date);

    const actions = await readActions(companyId);
    expect(actions.map((entry) => entry.action)).toEqual(["company.paused"]);
    expect(actions[0]?.details).toMatchObject({ reason: "manual", scope: "company" });
  });

  it("refuses a second pause", async () => {
    const companyId = await insertCompany("Double Pause Co");
    const app = createApp();

    await request(app).post(`/api/companies/${companyId}/pause`).send({}).expect(200);
    const second = await request(app).post(`/api/companies/${companyId}/pause`).send({});
    expect(second.status).toBe(409);

    // The refusal must not have written a second line either.
    const actions = await readActions(companyId);
    expect(actions).toHaveLength(1);
  });

  it("resume clears the two columns, writes a line, and refuses a second resume", async () => {
    const companyId = await insertCompany("Resume Co", "paused", "manual");
    const app = createApp();

    const response = await request(app).post(`/api/companies/${companyId}/resume`).send({});
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ status: "active", pauseReason: null, pausedAt: null });

    const row = await readCompany(companyId);
    expect(row).toMatchObject({ status: "active", pauseReason: null, pausedAt: null });

    const actions = await readActions(companyId);
    expect(actions.map((entry) => entry.action)).toEqual(["company.resumed"]);
    expect(actions[0]?.details).toMatchObject({ scope: "company", previousReason: "manual" });

    const second = await request(app).post(`/api/companies/${companyId}/resume`).send({});
    expect(second.status).toBe(409);
  });

  it("answers 404 for an organization that does not exist", async () => {
    const app = createApp();
    await request(app).post(`/api/companies/${randomUUID()}/pause`).send({}).expect(404);
  });

  it("pause everything tags each organization master and leaves an archived one alone", async () => {
    const activeId = await insertCompany("Active Co");
    const handPausedId = await insertCompany("Hand Paused Co", "paused", "manual");
    const archivedId = randomUUID();
    await db.insert(companies).values({
      id: archivedId,
      name: "Archived Co",
      status: "archived",
      issuePrefix: `T${archivedId.replace(/-/g, "").slice(0, 6).toUpperCase()}`,
    });
    const app = createApp();

    const response = await request(app).post("/api/instance/pause-all").send({});
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ paused: 1, companyIds: [activeId] });

    expect(await readCompany(activeId)).toMatchObject({ status: "paused", pauseReason: "master" });
    expect(await readCompany(handPausedId)).toMatchObject({ status: "paused", pauseReason: "manual" });
    expect(await readCompany(archivedId)).toMatchObject({ status: "archived" });
  });

  it("resume everything puts back only what the master switch paused", async () => {
    const masterId = await insertCompany("Master Co");
    const handPausedId = await insertCompany("Hand Paused Co", "paused", "manual");
    const app = createApp();

    await request(app).post("/api/instance/pause-all").send({}).expect(200);
    const response = await request(app).post("/api/instance/resume-all").send({});
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ resumed: 1, companyIds: [masterId] });

    expect(await readCompany(masterId)).toMatchObject({ status: "active", pauseReason: null, pausedAt: null });
    // The organization the person paused by hand stays paused.
    expect(await readCompany(handPausedId)).toMatchObject({ status: "paused", pauseReason: "manual" });

    const masterActions = await db
      .select({ action: activityLog.action })
      .from(activityLog)
      .where(and(eq(activityLog.companyId, masterId), eq(activityLog.action, "company.resumed")));
    expect(masterActions).toHaveLength(1);
  });

  it("refuses the instance switch to a caller who is not an instance admin", async () => {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      (req as unknown as { actor: Record<string, unknown> }).actor = {
        type: "board",
        source: "session",
        userId: boardUserId,
        isInstanceAdmin: false,
        companyIds: [],
      };
      next();
    });
    app.use("/api", toderoPauseRoutes(db));
    app.use(errorHandler);

    await request(app).post("/api/instance/pause-all").send({}).expect(403);
    await request(app).post("/api/instance/resume-all").send({}).expect(403);
  });
});

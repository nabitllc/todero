import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  activityLog,
  agents,
  companies,
  createDb,
  documents,
  goals,
  issueComments,
  issueDocuments,
  issues,
} from "@todero/db";
import {
  getEmbeddedPostgresTestSupport,
  startEmbeddedPostgresTestDatabase,
} from "./helpers/embedded-postgres.js";
import { actorMiddleware } from "../middleware/auth.js";
import { errorHandler } from "../middleware/index.js";
import { goalRoutes } from "../routes/goals.js";
import { issueRoutes } from "../routes/issues.js";
import { toderoPlanRoutes } from "../routes/todero-plan-routes.js";
import { documentService } from "../services/documents.js";
import { CONVERSATION_PLAN_DOCUMENT_KEY } from "../todero/conversation-thread.js";

const PLAN_BLOCK = [
  "Here is what I propose.",
  "",
  "```todero-plan",
  "goal: A place to track the Pokemon I am missing",
  "features:",
  "  - name: Collection list",
  "    why: I need to see what I have",
  "    done_when: Every Pokemon I own shows in one list",
  "  - name: Missing list",
  "    why: The point of the whole thing",
  "    done_when: I can see what I still need",
  "tasks:",
  "  - title: Write down how the list is organised",
  "    feature: Collection list",
  "    output: A one-page note",
  "  - title: Sketch the collection screen",
  "    feature: Collection list",
  "    output: A sketch",
  "  - title: Decide how missing ones are spotted",
  "    feature: Missing list",
  "    output: A decision",
  "```",
].join("\n");

const embeddedPostgresSupport = await getEmbeddedPostgresTestSupport();
const describeEmbeddedPostgres = embeddedPostgresSupport.supported ? describe : describe.skip;

if (!embeddedPostgresSupport.supported) {
  console.warn(
    `Skipping embedded Postgres plan-goal route tests on this host: ${
      embeddedPostgresSupport.reason ?? "unsupported environment"
    }`,
  );
}

describeEmbeddedPostgres("goals from an approved plan", () => {
  let db!: ReturnType<typeof createDb>;
  let tempDb: Awaited<ReturnType<typeof startEmbeddedPostgresTestDatabase>> | null = null;
  const wakeup = vi.fn(async () => null);

  beforeAll(async () => {
    tempDb = await startEmbeddedPostgresTestDatabase("todero-plan-feature-goals-routes-");
    db = createDb(tempDb.connectionString);
  }, 20_000);

  afterEach(async () => {
    wakeup.mockClear();
    await db.delete(activityLog);
    await db.delete(issueComments);
    await db.delete(issueDocuments);
    await db.delete(documents);
    await db.delete(issues);
    await db.delete(goals);
    await db.delete(agents);
    await db.delete(companies);
  });

  afterAll(async () => {
    await tempDb?.cleanup();
  });

  function createApp() {
    const app = express();
    app.use(express.json());
    app.use(actorMiddleware(db, { deploymentMode: "local_trusted" }));
    app.use("/api", toderoPlanRoutes(db, { heartbeat: { wakeup } }));
    app.use("/api", issueRoutes(db, {} as never));
    app.use("/api", goalRoutes(db));
    app.use(errorHandler);
    return app;
  }

  async function seedCompany() {
    const companyId = randomUUID();
    await db.insert(companies).values({
      id: companyId,
      name: "PoGo Collection",
      issuePrefix: `P${companyId.replace(/-/g, "").slice(0, 5).toUpperCase()}`,
      requireBoardApprovalForNewAgents: false,
    });
    const companyGoal = await db
      .insert(goals)
      .values({
        companyId,
        title: "Know which Pokemon I am missing",
        level: "company",
        status: "active",
      })
      .returning()
      .then((rows) => rows[0]!);
    const agentId = randomUUID();
    await db.insert(agents).values({
      id: agentId,
      companyId,
      name: "Ash",
      role: "assistant",
      status: "running",
      adapterType: "http_agent",
      adapterConfig: {},
      runtimeConfig: {},
      permissions: {},
    });
    return { companyId, companyGoalId: companyGoal.id, agentId };
  }

  async function seedConversationTaskWithPlan(companyId: string, agentId: string) {
    const issue = await db
      .insert(issues)
      .values({
        companyId,
        title: "Get started",
        status: "blocked",
        priority: "medium",
        assigneeAgentId: agentId,
      })
      .returning()
      .then((rows) => rows[0]!);
    await documentService(db).upsertIssueDocument({
      issueId: issue.id,
      key: CONVERSATION_PLAN_DOCUMENT_KEY,
      title: "Plan",
      format: "markdown",
      body: PLAN_BLOCK,
    });
    return issue;
  }

  it("turns each feature of the plan into a goal under the company goal", async () => {
    const { companyId, companyGoalId, agentId } = await seedCompany();
    const issue = await seedConversationTaskWithPlan(companyId, agentId);

    const approved = await request(createApp())
      .post(`/api/issues/${issue.id}/plan/approve`)
      .send({})
      .expect(201);

    const featureGoals = await db
      .select()
      .from(goals)
      .where(eq(goals.level, "feature"))
      .orderBy(asc(goals.createdAt));
    expect(featureGoals.map((goal) => goal.title)).toEqual(["Collection list", "Missing list"]);
    expect(featureGoals.every((goal) => goal.parentId === companyGoalId)).toBe(true);
    expect(featureGoals[0]!.description).toBe("Every Pokemon I own shows in one list");
    expect(featureGoals[0]!.ownerAgentId).toBe(agentId);
    expect(approved.body.goals).toHaveLength(2);
  });

  it("links each task to its own feature goal and leaves the conversation on the company goal", async () => {
    const { companyId, companyGoalId, agentId } = await seedCompany();
    const issue = await seedConversationTaskWithPlan(companyId, agentId);

    const approved = await request(createApp())
      .post(`/api/issues/${issue.id}/plan/approve`)
      .send({})
      .expect(201);

    const featureGoals = await db
      .select()
      .from(goals)
      .where(eq(goals.level, "feature"))
      .orderBy(asc(goals.createdAt));
    const byTitle = new Map(featureGoals.map((goal) => [goal.title, goal.id]));
    const children = await db
      .select()
      .from(issues)
      .where(eq(issues.parentId, issue.id))
      .orderBy(asc(issues.createdAt));

    expect(children.map((child) => child.goalId)).toEqual([
      byTitle.get("Collection list"),
      byTitle.get("Collection list"),
      byTitle.get("Missing list"),
    ]);
    expect(approved.body.parent.goalId).toBe(companyGoalId);
  });

  it("marks a task from the plan as a Task, so the view does not guess from depth", async () => {
    const { companyId, agentId } = await seedCompany();
    const issue = await seedConversationTaskWithPlan(companyId, agentId);

    await request(createApp()).post(`/api/issues/${issue.id}/plan/approve`).send({}).expect(201);

    const children = await db.select().from(issues).where(eq(issues.parentId, issue.id));
    expect(children.every((child) => child.description?.startsWith("<!-- todero-type: Task -->"))).toBe(
      true,
    );
  });

  it("finishes the feature goal once every task under it is done, and opens it again if one comes back", async () => {
    const { companyId, companyGoalId } = await seedCompany();
    const featureGoal = await db
      .insert(goals)
      .values({
        companyId,
        title: "Collection list",
        description: "Every Pokemon I own shows in one list",
        level: "feature",
        status: "active",
        parentId: companyGoalId,
      })
      .returning()
      .then((rows) => rows[0]!);
    const seeded = await db
      .insert(issues)
      .values([
        { companyId, title: "First", status: "todo", priority: "medium", goalId: featureGoal.id },
        { companyId, title: "Second", status: "todo", priority: "medium", goalId: featureGoal.id },
      ])
      .returning();
    const app = createApp();
    const readGoalStatus = async () =>
      db
        .select()
        .from(goals)
        .where(eq(goals.id, featureGoal.id))
        .then((rows) => rows[0]!.status);

    await request(app).patch(`/api/issues/${seeded[0]!.id}`).send({ status: "done" }).expect(200);
    expect(await readGoalStatus()).toBe("active");

    await request(app).patch(`/api/issues/${seeded[1]!.id}`).send({ status: "done" }).expect(200);
    expect(await readGoalStatus()).toBe("achieved");

    await request(app)
      .patch(`/api/issues/${seeded[1]!.id}`)
      .send({ status: "todo" })
      .expect(200);
    expect(await readGoalStatus()).toBe("active");
  });

  it("counts the tasks under every goal for the Goals page", async () => {
    const { companyId, companyGoalId } = await seedCompany();
    const featureGoal = await db
      .insert(goals)
      .values({ companyId, title: "Missing list", level: "feature", status: "active", parentId: companyGoalId })
      .returning()
      .then((rows) => rows[0]!);
    await db.insert(issues).values([
      { companyId, title: "Done one", status: "done", priority: "medium", goalId: featureGoal.id },
      { companyId, title: "Open one", status: "todo", priority: "medium", goalId: featureGoal.id },
      { companyId, title: "Called off", status: "cancelled", priority: "medium", goalId: featureGoal.id },
    ]);

    const listed = await request(createApp())
      .get(`/api/companies/${companyId}/goals`)
      .expect(200);

    const row = listed.body.find((goal: { id: string }) => goal.id === featureGoal.id);
    expect(row).toMatchObject({ taskCount: 2, doneTaskCount: 1 });
    const company = listed.body.find((goal: { id: string }) => goal.id === companyGoalId);
    expect(company).toMatchObject({ taskCount: 0, doneTaskCount: 0 });
  });
});

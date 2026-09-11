import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseToderoPlanBlock } from "@todero/shared";

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
}));
const mockDocumentService = vi.hoisted(() => ({
  getIssueDocumentByKey: vi.fn(),
}));
const mockAgentService = vi.hoisted(() => ({
  getById: vi.fn(),
  create: vi.fn(),
}));

vi.mock("../services/issues.js", () => ({ issueService: () => mockIssueService }));
vi.mock("../services/documents.js", () => ({ documentService: () => mockDocumentService }));
vi.mock("../services/agents.js", () => ({ agentService: () => mockAgentService }));

const { selectApprovedPlanTasks, toderoPlanRoutes } = await import("./todero-plan-routes.js");

const PLAN = parseToderoPlanBlock(
  "```todero-plan\ngoal: Ship it\ntasks:\n  - title: One\n  - title: Two\n  - title: Three\n```",
)!.plan;

describe("selectApprovedPlanTasks", () => {
  it("keeps the ticked tasks in plan order", () => {
    expect(selectApprovedPlanTasks(PLAN, ["t3", "t1"]).map((t) => t.title)).toEqual(["One", "Three"]);
  });

  it("keeps everything when nothing was unticked", () => {
    expect(selectApprovedPlanTasks(PLAN, []).map((t) => t.title)).toEqual(["One", "Two", "Three"]);
    expect(selectApprovedPlanTasks(PLAN, null)).toHaveLength(3);
  });

  it("ignores ids the plan does not have", () => {
    expect(selectApprovedPlanTasks(PLAN, ["t2", "nope", " "]).map((t) => t.id)).toEqual(["t2"]);
  });
});

/**
 * The approve route end to end, with the database and the wake queue stubbed:
 * what gets created, what starts in To do, who each task goes to, and whether a
 * second agent is added at all. The scheduling rules have their own unit tests;
 * these are here to catch the wiring between them and real tasks.
 */

type CreatedIssue = {
  id: string;
  input: {
    title: string;
    status: string;
    assigneeAgentId: string;
    blockedByIssueIds: string[];
  };
};

const CONVERSATION_ISSUE = {
  id: "issue-parent",
  companyId: "company-1",
  assigneeAgentId: "agent-1",
  description: "A conversation",
  projectId: null,
  goalId: null,
  priority: null,
};

const PRIMARY_AGENT = {
  id: "agent-1",
  companyId: "company-1",
  name: "Ash",
  role: "worker",
  title: null,
  reportsTo: null,
  adapterType: "http",
  adapterConfig: { url: "http://localhost:11434/v1/chat/completions", model: "qwen" },
  runtimeConfig: { heartbeat: { maxConcurrentRuns: 1 } },
  defaultEnvironmentId: null,
};

function planDocument(body: string) {
  return { id: "doc-1", body };
}

/** A plan block with one `tasks:` entry per line group given. */
function planBlock(tasks: Array<{ title: string; feature: string; after?: string }>) {
  const lines = ["```todero-plan", "goal: Ship something people can use", "tasks:"];
  for (const task of tasks) {
    lines.push(`  - title: ${task.title}`);
    lines.push(`    feature: ${task.feature}`);
    lines.push("    output: a draft");
    if (task.after) lines.push(`    after: ${task.after}`);
  }
  lines.push("```");
  return lines.join("\n");
}

const wakeup = vi.fn(async () => undefined);

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { actor: unknown }).actor = { type: "board", userId: "person-1" };
    next();
  });
  app.use("/api", toderoPlanRoutes({} as never, { heartbeat: { wakeup } }));
  return app;
}

function createdIssues(): CreatedIssue[] {
  return mockIssueService.create.mock.calls.map((call, index) => ({
    id: `issue-${index + 1}`,
    input: call[1] as CreatedIssue["input"],
  }));
}

function wakenIssueIds(): string[] {
  return wakeup.mock.calls.map((call) => (call as unknown as [string, { payload: { issueId: string } }])[1].payload.issueId);
}

function wakenAgentIds(): string[] {
  return wakeup.mock.calls.map((call) => (call as unknown as [string])[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIssueService.getById.mockResolvedValue(CONVERSATION_ISSUE);
  mockIssueService.update.mockImplementation(async (id: string, input: Record<string, unknown>) => ({
    id,
    ...input,
  }));
  let createdCount = 0;
  mockIssueService.create.mockImplementation(async (_companyId: string, input: Record<string, unknown>) => {
    createdCount += 1;
    return {
      id: `issue-${createdCount}`,
      identifier: `TOD-${createdCount}`,
      title: input.title as string,
      status: input.status as string,
    };
  });
  mockAgentService.getById.mockResolvedValue(PRIMARY_AGENT);
  mockAgentService.create.mockResolvedValue({ id: "agent-2", name: "Ash 2" });
});

describe("POST /issues/:id/plan/approve", () => {
  it("starts the first task of every feature at once and holds the rest", async () => {
    mockDocumentService.getIssueDocumentByKey.mockResolvedValue(
      planDocument(
        planBlock([
          { title: "Draft the sign up screen", feature: "Sign up" },
          { title: "Write the sign up words", feature: "Sign up" },
          { title: "List the dinners", feature: "Dinner" },
        ]),
      ),
    );

    const res = await request(buildApp()).post("/api/issues/issue-parent/plan/approve").send({});

    expect(res.status).toBe(201);
    const created = createdIssues();
    expect(created.map((row) => [row.input.title, row.input.status])).toEqual([
      ["Draft the sign up screen", "todo"],
      ["Write the sign up words", "backlog"],
      ["List the dinners", "todo"],
    ]);
    // The second sign-up task waits on the real task that was created for the
    // first one, not on a plan id.
    expect(created[1]!.input.blockedByIssueIds).toEqual(["issue-1"]);
    expect(created[0]!.input.blockedByIssueIds).toEqual([]);
    expect(created[2]!.input.blockedByIssueIds).toEqual([]);
    // Both tasks that can start are woken, not just the first.
    expect(wakenIssueIds()).toEqual(["issue-1", "issue-3"]);
    // The conversation task waits on its children.
    expect(mockIssueService.update).toHaveBeenCalledWith(
      "issue-parent",
      expect.objectContaining({ status: "blocked", blockedByIssueIds: ["issue-1", "issue-2", "issue-3"] }),
    );
  });

  it("keeps a stated order across features, so only the first task starts", async () => {
    mockDocumentService.getIssueDocumentByKey.mockResolvedValue(
      planDocument(
        planBlock([
          { title: "Draft the sign up screen", feature: "Sign up" },
          { title: "List the dinners", feature: "Dinner", after: "Draft the sign up screen" },
        ]),
      ),
    );

    const res = await request(buildApp()).post("/api/issues/issue-parent/plan/approve").send({});

    expect(res.status).toBe(201);
    const created = createdIssues();
    expect(created.map((row) => row.input.status)).toEqual(["todo", "backlog"]);
    expect(created[1]!.input.blockedByIssueIds).toEqual(["issue-1"]);
    expect(wakenIssueIds()).toEqual(["issue-1"]);
    expect(res.body.extraWorker).toBeNull();
  });

  it("adds a second agent and gives it the other feature when the machine can serve two models", async () => {
    mockAgentService.getById.mockResolvedValue({
      ...PRIMARY_AGENT,
      runtimeConfig: { heartbeat: { maxConcurrentRuns: 2 } },
    });
    mockDocumentService.getIssueDocumentByKey.mockResolvedValue(
      planDocument(
        planBlock([
          { title: "Draft the sign up screen", feature: "Sign up" },
          { title: "Write the sign up words", feature: "Sign up" },
          { title: "List the dinners", feature: "Dinner" },
          { title: "Pick tonight's dinner", feature: "Dinner" },
        ]),
      ),
    );

    const res = await request(buildApp()).post("/api/issues/issue-parent/plan/approve").send({});

    expect(res.status).toBe(201);
    expect(mockAgentService.create).toHaveBeenCalledTimes(1);
    expect(mockAgentService.create.mock.calls[0]![1]).toMatchObject({
      name: "Ash 2",
      adapterType: "http",
    });
    expect(res.body.extraWorker).toEqual({ id: "agent-2", name: "Ash 2" });
    const created = createdIssues();
    expect(created.map((row) => row.input.assigneeAgentId)).toEqual([
      "agent-1",
      "agent-1",
      "agent-2",
      "agent-2",
    ]);
    // Each agent is woken on the task it can actually start.
    expect(wakenAgentIds()).toEqual(["agent-1", "agent-2"]);
    expect(wakenIssueIds()).toEqual(["issue-1", "issue-3"]);
  });

  it("gives the second agent a feature that can start now, not the second one in the plan", async () => {
    mockAgentService.getById.mockResolvedValue({
      ...PRIMARY_AGENT,
      runtimeConfig: { heartbeat: { maxConcurrentRuns: 2 } },
    });
    mockDocumentService.getIssueDocumentByKey.mockResolvedValue(
      planDocument(
        planBlock([
          { title: "Draft the sign up screen", feature: "Sign up" },
          // This feature cannot start until the sign up screen is handed in.
          { title: "List the dinners", feature: "Dinner", after: "Draft the sign up screen" },
          { title: "Write the invite", feature: "Invite" },
        ]),
      ),
    );

    const res = await request(buildApp()).post("/api/issues/issue-parent/plan/approve").send({});

    expect(res.status).toBe(201);
    expect(res.body.extraWorker).toEqual({ id: "agent-2", name: "Ash 2" });
    const byTitle = new Map(createdIssues().map((row) => [row.input.title, row.input]));
    expect(byTitle.get("Write the invite")).toMatchObject({ assigneeAgentId: "agent-2", status: "todo" });
    expect(byTitle.get("List the dinners")).toMatchObject({ assigneeAgentId: "agent-1", status: "backlog" });
    // The added agent has work from the first minute.
    expect(wakenAgentIds()).toContain("agent-2");
  });

  it("does not add an agent when only one feature can start", async () => {
    mockAgentService.getById.mockResolvedValue({
      ...PRIMARY_AGENT,
      runtimeConfig: { heartbeat: { maxConcurrentRuns: 4 } },
    });
    mockDocumentService.getIssueDocumentByKey.mockResolvedValue(
      planDocument(
        planBlock([
          { title: "Draft the sign up screen", feature: "Sign up" },
          { title: "List the dinners", feature: "Dinner", after: "Draft the sign up screen" },
          { title: "Write the invite", feature: "Invite", after: "Draft the sign up screen" },
        ]),
      ),
    );

    const res = await request(buildApp()).post("/api/issues/issue-parent/plan/approve").send({});

    expect(res.status).toBe(201);
    expect(mockAgentService.create).not.toHaveBeenCalled();
    expect(res.body.extraWorker).toBeNull();
    expect(createdIssues().every((row) => row.input.assigneeAgentId === "agent-1")).toBe(true);
  });

  it("says so plainly when the agent's connection cannot be shared with a second agent", async () => {
    mockAgentService.getById.mockResolvedValue({
      ...PRIMARY_AGENT,
      adapterType: "claude-local",
      runtimeConfig: { heartbeat: { maxConcurrentRuns: 2 } },
    });
    mockDocumentService.getIssueDocumentByKey.mockResolvedValue(
      planDocument(
        planBlock([
          { title: "Draft the sign up screen", feature: "Sign up" },
          { title: "List the dinners", feature: "Dinner" },
        ]),
      ),
    );

    const res = await request(buildApp()).post("/api/issues/issue-parent/plan/approve").send({});

    expect(res.status).toBe(201);
    expect(mockAgentService.create).not.toHaveBeenCalled();
    expect(res.body.extraWorker).toBeNull();
    expect(res.body.extraWorkerReason).toContain("cannot be shared");
    expect(createdIssues().every((row) => row.input.assigneeAgentId === "agent-1")).toBe(true);
  });

  it("turns down a plan that has no tasks left and a task with no plan at all", async () => {
    mockDocumentService.getIssueDocumentByKey.mockResolvedValue(planDocument("no plan here"));
    const noPlan = await request(buildApp()).post("/api/issues/issue-parent/plan/approve").send({});
    expect(noPlan.status).toBe(409);

    mockDocumentService.getIssueDocumentByKey.mockResolvedValue(
      planDocument(planBlock([{ title: "Draft the sign up screen", feature: "Sign up" }])),
    );
    const nothingKept = await request(buildApp())
      .post("/api/issues/issue-parent/plan/approve")
      .send({ keep: ["nope"] });
    expect(nothingKept.status).toBe(400);
    expect(mockIssueService.create).not.toHaveBeenCalled();
  });
});

import express from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseToderoPlanBlock } from "@todero/shared";

const mockIssueService = vi.hoisted(() => ({
  getById: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  listComments: vi.fn(),
  addComment: vi.fn(),
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
const mockGoalService = vi.hoisted(() => ({
  getById: vi.fn(),
  getDefaultCompanyGoal: vi.fn(),
  create: vi.fn(),
}));
const mockJudgeAgent = vi.hoisted(() => ({
  ensureJudgeAgentForLead: vi.fn(async () => null as null | Record<string, unknown>),
  findJudgeAgentForLead: vi.fn(async () => null as null | Record<string, unknown>),
}));
vi.mock("../todero/judge-agent.js", () => mockJudgeAgent);
vi.mock("../services/goals.js", () => ({ goalService: () => mockGoalService }));
const mockApprovalService = vi.hoisted(() => ({
  create: vi.fn(async (companyId: string, data: Record<string, unknown>) => ({
    id: "approval-1",
    companyId,
    ...data,
  })),
}));
vi.mock("../services/approvals.js", () => ({ approvalService: () => mockApprovalService }));

const { buildPlanFeatureGoalDrafts, selectApprovedPlanTasks, toderoPlanRoutes } = await import("./todero-plan-routes.js");

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

const FEATURE_PLAN = parseToderoPlanBlock(
  [
    "```todero-plan",
    "goal: Seat neighbors at weekend dinners",
    "features:",
    "  - name: Sign up",
    "    why: People need an account",
    "    done_when: A new person can sign up in under a minute",
    "  - name: Pick a dinner",
    "    why: Dinners are the product",
    "    done_when: A signed-in person can pick one upcoming dinner",
    "  - name: Nobody asked for this",
    "    why: Left over",
    "    done_when: Never",
    "tasks:",
    "  - title: Write the sign-up flow",
    "    feature: Sign up",
    "  - title: Draft the phone-code copy",
    "    feature: sign up",
    "  - title: List the dinners",
    "    feature: Pick a dinner",
    "  - title: Decide the launch city",
    "    feature: Launch",
    "  - title: Tidy the notes",
    "```",
  ].join("\n"),
)!.plan;

describe("buildPlanFeatureGoalDrafts", () => {
  it("makes one goal per feature that has work, in plan order", () => {
    const drafts = buildPlanFeatureGoalDrafts(FEATURE_PLAN, FEATURE_PLAN.tasks);
    expect(drafts.map((draft) => draft.title)).toEqual(["Sign up", "Pick a dinner"]);
  });

  it("describes the goal with how we know the feature is finished", () => {
    const drafts = buildPlanFeatureGoalDrafts(FEATURE_PLAN, FEATURE_PLAN.tasks);
    expect(drafts[0]!.description).toBe("A new person can sign up in under a minute");
  });

  it("puts every task of a feature on the same goal, whatever the case", () => {
    const drafts = buildPlanFeatureGoalDrafts(FEATURE_PLAN, FEATURE_PLAN.tasks);
    expect(drafts[0]!.taskIds).toEqual(["t1", "t2"]);
  });

  it("does not mint a goal for a feature the plan never declared; that task stays on the mission goal", () => {
    const drafts = buildPlanFeatureGoalDrafts(FEATURE_PLAN, FEATURE_PLAN.tasks);
    expect(drafts.find((draft) => draft.title === "Launch")).toBeUndefined();
    expect(drafts.flatMap((draft) => draft.taskIds)).not.toContain("t4");
  });

  it("leaves a task that names no feature on the company goal", () => {
    const drafts = buildPlanFeatureGoalDrafts(FEATURE_PLAN, FEATURE_PLAN.tasks);
    expect(drafts.flatMap((draft) => draft.taskIds)).not.toContain("t5");
  });

  it("drops a feature whose tasks were all unticked", () => {
    const kept = selectApprovedPlanTasks(FEATURE_PLAN, ["t3"]);
    expect(buildPlanFeatureGoalDrafts(FEATURE_PLAN, kept).map((draft) => draft.title)).toEqual([
      "Pick a dinner",
    ]);
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

/**
 * Only the one read the approve path makes straight on the database: does this
 * organization want a person to approve a new teammate first?
 */
let requireBoardApprovalForNewAgents = false;
const stubDb = {
  select: () => ({
    from: () => ({
      where: () => ({
        limit: async () => [{ require: requireBoardApprovalForNewAgents }],
      }),
    }),
  }),
};

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as unknown as { actor: unknown }).actor = { type: "board", userId: "person-1" };
    next();
  });
  app.use("/api", toderoPlanRoutes(stubDb as never, { heartbeat: { wakeup } }));
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
  requireBoardApprovalForNewAgents = false;
  mockJudgeAgent.ensureJudgeAgentForLead.mockResolvedValue(null);
  mockJudgeAgent.findJudgeAgentForLead.mockResolvedValue(null);
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
  mockIssueService.listComments.mockResolvedValue([]);
  mockGoalService.getById.mockResolvedValue(null);
  mockGoalService.getDefaultCompanyGoal.mockResolvedValue({ id: "goal-company", title: "Ship something people can use" });
  let createdGoalCount = 0;
  mockGoalService.create.mockImplementation(async (_companyId: string, input: Record<string, unknown>) => {
    createdGoalCount += 1;
    return { id: `goal-${createdGoalCount}`, title: input.title as string };
  });
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
      ["Write the sign up words", "todo"],
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

  it("leaves a task that has to wait in To do, so the wake reaches it when its blocker closes", async () => {
    mockDocumentService.getIssueDocumentByKey.mockResolvedValue(
      planDocument(
        planBlock([
          { title: "Draft the sign up screen", feature: "Sign up" },
          { title: "Write the sign up words", feature: "Sign up" },
        ]),
      ),
    );

    const res = await request(buildApp()).post("/api/issues/issue-parent/plan/approve").send({});

    expect(res.status).toBe(201);
    const waiting = createdIssues()[1]!;
    // Not "backlog": the wake that fires when a blocker closes skips a task
    // sitting in the backlog, so a task parked there would never start.
    expect(waiting.input.status).toBe("todo");
    expect(waiting.input.blockedByIssueIds).toEqual(["issue-1"]);
    // It is the blocker chain that holds it back, not the status: only the
    // task that can start now is woken.
    expect(wakenIssueIds()).toEqual(["issue-1"]);
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
    expect(created.map((row) => row.input.status)).toEqual(["todo", "todo"]);
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
    expect(byTitle.get("List the dinners")).toMatchObject({ assigneeAgentId: "agent-1", status: "todo" });
    // The added agent has work from the first minute.
    expect(wakenAgentIds()).toContain("agent-2");
  });

  /**
   * When the organization asks a person to approve a new teammate, the two
   * hires the approval makes take that same path: the records exist but do no
   * work, and the task says in plain words what the person has to answer.
   */
  describe("when the organization asks a person to approve a new teammate", () => {
    const REVIEWER = {
      id: "agent-judge",
      name: "Ash's reviewer",
      companyId: "company-1",
      status: "pending_approval",
      adapterType: "http",
      adapterConfig: { url: "http://localhost:11434/v1/chat/completions", model: "qwen" },
    };

    function twoFeaturePlan() {
      mockAgentService.getById.mockResolvedValue({
        ...PRIMARY_AGENT,
        runtimeConfig: { heartbeat: { maxConcurrentRuns: 2 } },
      });
      mockDocumentService.getIssueDocumentByKey.mockResolvedValue(
        planDocument(
          planBlock([
            { title: "Draft the sign up screen", feature: "Sign up" },
            { title: "Write the invite", feature: "Invite" },
          ]),
        ),
      );
    }

    it("asks for approval for both hires and gives the second agent no work yet", async () => {
      requireBoardApprovalForNewAgents = true;
      mockJudgeAgent.ensureJudgeAgentForLead.mockResolvedValue(REVIEWER);
      twoFeaturePlan();

      const res = await request(buildApp()).post("/api/issues/issue-parent/plan/approve").send({});

      expect(res.status).toBe(201);
      expect(mockJudgeAgent.ensureJudgeAgentForLead).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ id: "agent-1" }),
        { status: "pending_approval" },
      );
      // The second agent's record exists but does nothing until the person says yes.
      expect(mockAgentService.create).toHaveBeenCalledWith(
        "company-1",
        expect.objectContaining({ status: "pending_approval" }),
      );
      expect(mockApprovalService.create).toHaveBeenCalledTimes(2);
      expect(mockApprovalService.create.mock.calls.every((call) => call[1].type === "hire_agent")).toBe(true);
      expect(res.body.hiresPendingApproval).toBe(true);
      // Every task stays with the agent the person already approved.
      expect(createdIssues().every((row) => row.input.assigneeAgentId === "agent-1")).toBe(true);
      expect(wakenAgentIds().every((id) => id === "agent-1")).toBe(true);
    });

    it("says on the task, in plain words, what is waiting for the person", async () => {
      requireBoardApprovalForNewAgents = true;
      mockJudgeAgent.ensureJudgeAgentForLead.mockResolvedValue(REVIEWER);
      twoFeaturePlan();

      await request(buildApp()).post("/api/issues/issue-parent/plan/approve").send({});

      expect(mockIssueService.addComment).toHaveBeenCalledTimes(1);
      const body = mockIssueService.addComment.mock.calls[0]![1] as string;
      expect(body).toContain("Ash's reviewer");
      expect(body).toContain("Inbox");
      for (const forbidden of ["issue", "disposition", "handoff", "run", "wake", "heartbeat"]) {
        expect(body.toLowerCase()).not.toContain(forbidden);
      }
    });

    it("changes nothing when the setting is off", async () => {
      requireBoardApprovalForNewAgents = false;
      mockJudgeAgent.ensureJudgeAgentForLead.mockResolvedValue({ ...REVIEWER, status: "idle" });
      twoFeaturePlan();

      const res = await request(buildApp()).post("/api/issues/issue-parent/plan/approve").send({});

      expect(res.status).toBe(201);
      expect(mockJudgeAgent.ensureJudgeAgentForLead).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ id: "agent-1" }),
        {},
      );
      expect(mockApprovalService.create).not.toHaveBeenCalled();
      expect(mockIssueService.addComment).not.toHaveBeenCalled();
      expect(res.body.hiresPendingApproval).toBe(false);
      expect(mockAgentService.create).toHaveBeenCalledWith(
        "company-1",
        expect.not.objectContaining({ status: expect.anything() }),
      );
      // The second agent picks up its feature straight away, as before.
      expect(createdIssues().some((row) => row.input.assigneeAgentId === "agent-2")).toBe(true);
    });
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

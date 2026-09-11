import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseToderoPlanBlock, resolveToderoPlanTaskDependencies } from "@todero/shared";

let childCounter = 0;
const mockIssueService = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  addComment: vi.fn(),
}));
const mockGoalService = vi.hoisted(() => ({
  getById: vi.fn(),
  getDefaultCompanyGoal: vi.fn(),
  create: vi.fn(),
}));
const mockAgentService = vi.hoisted(() => ({
  create: vi.fn(),
}));
const mockJudgeAgent = vi.hoisted(() => ({
  ensureJudgeAgentForLead: vi.fn(),
  findJudgeAgentForLead: vi.fn(),
}));
const mockHireApproval = vi.hoisted(() => ({
  readRequireBoardApprovalForNewAgents: vi.fn(),
  requestHireApproval: vi.fn(),
}));

vi.mock("../services/issues.js", () => ({ issueService: () => mockIssueService }));
vi.mock("../services/goals.js", () => ({ goalService: () => mockGoalService }));
vi.mock("../services/agents.js", () => ({ agentService: () => mockAgentService }));
vi.mock("./judge-agent.js", () => mockJudgeAgent);
vi.mock("./plan-hire-approval.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./plan-hire-approval.js")>()),
  ...mockHireApproval,
}));

const {
  selectApprovedPlanTasks,
  buildPlanFeatureGoalDrafts,
  createPlanChildren,
  hireForPlan,
} = await import("./plan-approval.js");

const db = {} as never;

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
});

/** Two features, the first with two tasks in a row, so a chain and a handover both exist. */
const CHAIN_PLAN = parseToderoPlanBlock(
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
    "tasks:",
    "  - title: Write the sign-up flow",
    "    feature: Sign up",
    "  - title: Draft the phone-code copy",
    "    feature: Sign up",
    "  - title: List the dinners",
    "    feature: Pick a dinner",
    "```",
  ].join("\n"),
)!.plan;

const CONVERSATION_TASK = {
  id: "issue-1",
  companyId: "company-1",
  assigneeAgentId: "agent-1",
  description: "Seat neighbors",
  goalId: null,
  projectId: null,
  priority: "medium",
};

beforeEach(() => {
  childCounter = 0;
  vi.clearAllMocks();
  mockIssueService.create.mockImplementation(async (_companyId: string, data: Record<string, unknown>) => {
    childCounter += 1;
    return {
      id: `child-${childCounter}`,
      identifier: `PAP-${childCounter}`,
      title: data.title,
      status: data.status,
    };
  });
  mockIssueService.update.mockImplementation(async (id: string, data: Record<string, unknown>) => ({
    id,
    status: data.status,
  }));
  mockIssueService.addComment.mockResolvedValue({ id: "comment-1" });
  mockGoalService.getDefaultCompanyGoal.mockResolvedValue({ id: "goal-company" });
  mockGoalService.getById.mockResolvedValue({ id: "goal-company" });
  mockGoalService.create.mockImplementation(async (_companyId: string, data: Record<string, unknown>) => ({
    id: `goal-${String(data.title).toLowerCase().replace(/\s+/g, "-")}`,
    title: data.title,
  }));
  mockJudgeAgent.findJudgeAgentForLead.mockResolvedValue(null);
  mockJudgeAgent.ensureJudgeAgentForLead.mockResolvedValue({
    id: "judge-1",
    name: "Ash's reviewer",
    adapterType: "http",
    adapterConfig: { model: "qwen" },
  });
  mockAgentService.create.mockResolvedValue({ id: "agent-2", name: "Ash 2" });
  mockHireApproval.readRequireBoardApprovalForNewAgents.mockResolvedValue(false);
  mockHireApproval.requestHireApproval.mockResolvedValue({ id: "approval-1" });
});

describe("createPlanChildren", () => {
  const baseInput = {
    issue: CONVERSATION_TASK,
    plan: CHAIN_PLAN,
    kept: CHAIN_PLAN.tasks,
    personSaid: ["Seat neighbors at weekend dinners"],
    actorUserId: "person-1",
    extraWorker: null,
    extraWorkerFeatureKey: null,
  };

  it("creates every child in To do, never in the backlog", async () => {
    const result = await createPlanChildren(db, baseInput);

    expect(result.children).toHaveLength(3);
    for (const call of mockIssueService.create.mock.calls) {
      expect(call[1].status).toBe("todo");
    }
  });

  it("chains a feature's second task behind its first and leaves the other feature free", async () => {
    const result = await createPlanChildren(db, baseInput);

    const blockedBy = mockIssueService.create.mock.calls.map((call) => call[1].blockedByIssueIds);
    expect(blockedBy).toEqual([[], ["child-1"], []]);
    expect(result.children.map((child) => child.canStartNow)).toEqual([true, false, true]);
  });

  it("blocks the conversation task on its own children", async () => {
    await createPlanChildren(db, baseInput);

    expect(mockIssueService.update).toHaveBeenCalledWith(
      "issue-1",
      expect.objectContaining({
        status: "blocked",
        blockedByIssueIds: ["child-1", "child-2", "child-3"],
      }),
    );
  });

  it("makes one goal per declared feature and hangs each task off its own", async () => {
    const result = await createPlanChildren(db, baseInput);

    expect(result.goals.map((goal) => goal.title)).toEqual(["Sign up", "Pick a dinner"]);
    const goalIds = mockIssueService.create.mock.calls.map((call) => call[1].goalId);
    expect(goalIds).toEqual(["goal-sign-up", "goal-sign-up", "goal-pick-a-dinner"]);
  });

  it("hands one feature to the second agent and keeps the rest with the first", async () => {
    const result = await createPlanChildren(db, {
      ...baseInput,
      extraWorker: { id: "agent-2", name: "Ash 2" },
      extraWorkerFeatureKey: "pick a dinner",
    });

    expect(result.children.map((child) => child.assigneeAgentId)).toEqual([
      "agent-1",
      "agent-1",
      "agent-2",
    ]);
  });

  it("creates only the tasks the person kept", async () => {
    const kept = selectApprovedPlanTasks(CHAIN_PLAN, ["t1"]);
    const result = await createPlanChildren(db, { ...baseInput, kept });

    expect(result.children.map((child) => child.title)).toEqual(["Write the sign-up flow"]);
  });
});

describe("hireForPlan", () => {
  const primaryAgent = {
    id: "agent-1",
    companyId: "company-1",
    name: "Ash",
    adapterType: "http",
    adapterConfig: { url: "http://localhost:11434/v1/chat/completions" },
    runtimeConfig: { heartbeat: { maxConcurrentRuns: 2 } },
  };
  const ordered = resolveToderoPlanTaskDependencies(CHAIN_PLAN.tasks);
  const input = {
    primaryAgent,
    ordered,
    issue: { id: "issue-1", companyId: "company-1" },
    actorUserId: "person-1",
  };

  it("hires the reviewer and a second agent outright when the organization does not ask first", async () => {
    const result = await hireForPlan(db, input);

    expect(mockJudgeAgent.ensureJudgeAgentForLead).toHaveBeenCalledWith(
      db,
      expect.anything(),
      expect.objectContaining({ id: "agent-1" }),
      {},
    );
    expect(mockHireApproval.requestHireApproval).not.toHaveBeenCalled();
    expect(mockIssueService.addComment).not.toHaveBeenCalled();
    expect(result.hiresPendingApproval).toBe(false);
    expect(result.extraWorker).toEqual({ id: "agent-2", name: "Ash 2" });
    // The added agent takes the second feature that can start now.
    expect(result.extraWorkerFeatureKey).toBe("pick a dinner");
  });

  it("asks first when the organization requires it, and gives the waiting teammates no work", async () => {
    mockHireApproval.readRequireBoardApprovalForNewAgents.mockResolvedValue(true);

    const result = await hireForPlan(db, input);

    expect(mockJudgeAgent.ensureJudgeAgentForLead).toHaveBeenCalledWith(
      db,
      expect.anything(),
      expect.objectContaining({ id: "agent-1" }),
      { status: "pending_approval" },
    );
    expect(mockAgentService.create).toHaveBeenCalledWith(
      "company-1",
      expect.objectContaining({ status: "pending_approval" }),
    );
    expect(mockHireApproval.requestHireApproval).toHaveBeenCalledTimes(2);
    expect(result.hiresPendingApproval).toBe(true);
    // The first agent keeps all of the work until the person answers.
    expect(result.extraWorkerFeatureKey).toBeNull();
  });

  it("says on the task, in plain words, that the new teammates wait in the Inbox", async () => {
    mockHireApproval.readRequireBoardApprovalForNewAgents.mockResolvedValue(true);

    await hireForPlan(db, input);

    expect(mockIssueService.addComment).toHaveBeenCalledTimes(1);
    const body = String(mockIssueService.addComment.mock.calls[0]![1]);
    expect(body).toContain("Inbox");
    for (const forbidden of ["issue", "disposition", "handoff", "run", "wake", "heartbeat"]) {
      expect(body.toLowerCase()).not.toContain(forbidden);
    }
  });

  it("does not ask twice for a reviewer that already waits for approval", async () => {
    mockHireApproval.readRequireBoardApprovalForNewAgents.mockResolvedValue(true);
    mockJudgeAgent.findJudgeAgentForLead.mockResolvedValue({ id: "judge-1", name: "Ash's reviewer" });

    await hireForPlan(db, input);

    // Only the second agent is asked about; the reviewer was already asked for.
    expect(mockHireApproval.requestHireApproval).toHaveBeenCalledTimes(1);
    expect(mockHireApproval.requestHireApproval).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ agent: expect.objectContaining({ id: "agent-2" }) }),
    );
  });

  it("keeps today's behaviour when the approval setting cannot be read", async () => {
    mockHireApproval.readRequireBoardApprovalForNewAgents.mockRejectedValue(new Error("database is down"));

    const result = await hireForPlan(db, input);

    expect(mockHireApproval.requestHireApproval).not.toHaveBeenCalled();
    expect(result.hiresPendingApproval).toBe(false);
    expect(result.extraWorkerFeatureKey).toBe("pick a dinner");
  });

  it("adds no second agent when the machine serves one model at a time", async () => {
    const result = await hireForPlan(db, {
      ...input,
      primaryAgent: { ...primaryAgent, runtimeConfig: { heartbeat: { maxConcurrentRuns: 1 } } },
    });

    expect(mockAgentService.create).not.toHaveBeenCalled();
    expect(result.extraWorker).toBeNull();
    expect(result.extraWorkerReason).toContain("one model at a time");
  });
});

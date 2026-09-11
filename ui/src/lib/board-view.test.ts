import { describe, expect, it } from "vitest";
import { ONBOARDING_FIRST_TASK_ORIGIN_KIND, type Agent, type Goal, type Issue } from "@todero/shared";
import { boardTaskViewFor, boardViewFor, openChildCounts, ownersForColumn } from "./board-view";

const NOW = new Date("2026-09-11T12:00:00Z").getTime();

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "task-1",
    identifier: "TAM-1",
    title: "Write the sign up words",
    status: "todo",
    description: null,
    blockedBy: null,
    goalId: null,
    parentId: null,
    assigneeAgentId: "agent-1",
    assigneeUserId: null,
    ancestors: [],
    updatedAt: new Date(NOW - 3 * 3_600_000),
    ...overrides,
  } as unknown as Issue;
}

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    name: "Nova",
    companyId: "company-1",
    status: "idle",
    runtimeConfig: { heartbeat: { maxConcurrentRuns: 1 } },
    ...overrides,
  } as unknown as Agent;
}

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "goal-1",
    companyId: "company-1",
    title: "Sign up works",
    description: "A person can sign up.",
    level: "feature",
    status: "active",
    parentId: null,
    ownerAgentId: null,
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
    ...overrides,
  } as Goal;
}

function build(overrides: {
  issues?: Issue[];
  goals?: Goal[];
  agents?: Agent[];
  live?: Set<string>;
  groupBy?: "feature" | "agent";
  agentFilter?: string | null;
  organizationPaused?: boolean;
} = {}) {
  return boardViewFor({
    issues: overrides.issues ?? [issue()],
    goals: overrides.goals ?? [goal()],
    agents: overrides.agents ?? [agent()],
    liveIssueIds: overrides.live ?? new Set<string>(),
    groupBy: overrides.groupBy,
    agentFilter: overrides.agentFilter,
    organizationPaused: overrides.organizationPaused,
    now: NOW,
  });
}

describe("boardTaskViewFor", () => {
  it("feeds columnFor the same pieces the task page reads", () => {
    const view = boardTaskViewFor({
      issue: issue({ description: "<!-- todero-review: pending -->" }),
      agentsById: new Map([["agent-1", agent()]]),
      liveIssueIds: new Set(),
    });
    expect(view).toMatchObject({ status: "todo", reviewPending: true, assigneeName: "Nova", paused: false });
  });

  it("reads a paused assignee off the agent", () => {
    const view = boardTaskViewFor({
      issue: issue(),
      agentsById: new Map([["agent-1", agent({ status: "paused" as Agent["status"] })]]),
      liveIssueIds: new Set(),
    });
    expect(view.paused).toBe(true);
  });

  it("holds every task of a paused organization, whoever it belongs to", () => {
    const view = boardTaskViewFor({
      issue: issue(),
      agentsById: new Map([["agent-1", agent()]]),
      liveIssueIds: new Set(),
      organizationPaused: true,
    });
    expect(view.paused).toBe(true);
  });

  it("lets a turn already under way finish while the organization is paused", () => {
    const view = boardTaskViewFor({
      issue: issue(),
      agentsById: new Map([["agent-1", agent()]]),
      liveIssueIds: new Set(["task-1"]),
      organizationPaused: true,
    });
    expect(view).toMatchObject({ paused: false, agentWorking: true });
  });

  it("marks the reviewer as holding in-review work", () => {
    const view = boardTaskViewFor({
      issue: issue({ status: "in_review" as Issue["status"] }),
      agentsById: new Map(),
      liveIssueIds: new Set(),
    });
    expect(view.reviewRunning).toBe(true);
  });
});

describe("openChildCounts", () => {
  it("counts only the children that are still open", () => {
    const counts = openChildCounts([
      { id: "a", parentId: "p", status: "todo" },
      { id: "b", parentId: "p", status: "done" },
      { id: "c", parentId: "p", status: "cancelled" },
      { id: "d", parentId: null, status: "todo" },
    ] as Array<Pick<Issue, "id" | "parentId" | "status">>);
    expect(counts.get("p")).toBe(1);
  });
});

describe("boardViewFor", () => {
  it("puts each card in exactly one row and one column", () => {
    const view = build({
      issues: [issue({ id: "a", goalId: "goal-1" }), issue({ id: "b", identifier: "TAM-2", goalId: null })],
    });
    expect(view.byId.size).toBe(2);
    expect(view.cards.get("goal-1")!.working.map((card) => card.id)).toEqual(["a"]);
    expect(view.cards.get("mission")!.working.map((card) => card.id)).toEqual(["b"]);
  });

  it("counts every column across the whole board", () => {
    const view = build({
      issues: [
        issue({ id: "a", goalId: "goal-1", status: "done" }),
        issue({ id: "b", goalId: "goal-1", status: "todo" }),
        issue({ id: "c", goalId: "goal-1", status: "todo", description: "<!-- todero-plan: pending -->" }),
      ],
    });
    expect(view.totalByColumn).toMatchObject({ done: 1, working: 1, "your-turn": 1, queued: 0, review: 0 });
  });

  it("puts the Brief row on top", () => {
    const view = build({
      issues: [
        issue({ id: "a", goalId: "goal-1" }),
        issue({ id: "brief", identifier: "TAM-0", originKind: ONBOARDING_FIRST_TASK_ORIGIN_KIND as Issue["originKind"] }),
      ],
    });
    expect(view.rows[0]?.kind).toBe("brief");
    expect(view.cards.get("brief")!.working.map((card) => card.id)).toEqual(["brief"]);
  });

  it("shows how long a card has stood where it stands", () => {
    expect(build().byId.get("task-1")?.timeText).toBe("3 h");
  });

  it("gives a live card the writing glyph", () => {
    const view = build({ live: new Set(["task-1"]) });
    expect(view.byId.get("task-1")).toMatchObject({ column: "working", glyph: "writing" });
  });

  it("gives a card waiting on the person the your-turn glyph", () => {
    const view = build({ issues: [issue({ description: "<!-- todero-review: pending -->" })] });
    expect(view.byId.get("task-1")).toMatchObject({ column: "your-turn", glyph: "your-turn" });
  });

  it("gives a paused card the paused glyph and parks it in Queued", () => {
    const view = build({ agents: [agent({ status: "paused" as Agent["status"] })] });
    expect(view.byId.get("task-1")).toMatchObject({ column: "queued", glyph: "paused" });
  });

  it("stands a paused organization's work in Queued", () => {
    const view = build({ organizationPaused: true });
    expect(view.byId.get("task-1")).toMatchObject({ column: "queued", glyph: "paused" });
  });

  it("leaves a live turn in Agent working even while the organization is paused", () => {
    const view = build({ organizationPaused: true, live: new Set(["task-1"]) });
    expect(view.byId.get("task-1")).toMatchObject({ column: "working", glyph: "writing" });
  });

  it("says the reviewer has it, not the agent, when a turn runs on handed-over work", () => {
    const view = build({
      issues: [issue({ status: "in_review" as Issue["status"] })],
      live: new Set(["task-1"]),
    });
    expect(view.byId.get("task-1")).toMatchObject({ column: "review", glyph: "review" });
  });

  it("reports the work-in-progress badge from what is standing in Agent working", () => {
    const view = build();
    expect(view.wip).toHaveLength(1);
    expect(view.wip[0]).toMatchObject({ agentName: "Nova", activeCount: 1, limit: 1, atLimit: true });
  });

  it("draws one agent's cards but still counts what everyone is carrying", () => {
    const kai = agent({ id: "agent-2", name: "Kai" });
    const view = build({
      issues: [issue({ id: "a" }), issue({ id: "b", identifier: "TAM-2", assigneeAgentId: "agent-2" })],
      agents: [agent(), kai],
      agentFilter: "agent-1",
    });
    expect([...view.byId.keys()]).toEqual(["a"]);
    expect(view.wip.find((status) => status.agentId === "agent-2")).toMatchObject({ activeCount: 1 });
  });

  it("groups by agent when asked", () => {
    const view = build({ groupBy: "agent" });
    expect(view.rows.map((row) => row.id)).toEqual(["agent-1"]);
    expect(view.cards.get("agent-1")!.working).toHaveLength(1);
  });

  it("names the agents that own a step in the header", () => {
    const view = build();
    expect(ownersForColumn("working", view, [agent()])).toEqual(["Nova"]);
    expect(ownersForColumn("queued", view, [agent()])).toEqual([]);
    expect(ownersForColumn("done", view, [agent()])).toEqual([]);
  });
});

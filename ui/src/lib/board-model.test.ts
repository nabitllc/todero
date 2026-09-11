import { describe, expect, it } from "vitest";
import type { Agent, Goal, Issue } from "@todero/shared";
import { turnSentence } from "../components/work-item/turn-sentence";
import {
  BOARD_COLUMNS,
  BOARD_COLUMN_LABELS,
  BOARD_MISSION_ROW_ID,
  BOARD_PHONE_COLUMN_ORDER,
  BOARD_UNASSIGNED_ROW_ID,
  agentRowIdFor,
  agentRowsFor,
  columnFor,
  rowIdFor,
  rowProgressText,
  rowsFor,
  timeInColumnText,
  wipBadgeText,
  wipFor,
  wipLimitFor,
  type BoardColumn,
  type BoardTaskView,
} from "./board-model";

const ONBOARDING_FIRST_TASK_ORIGIN_KIND = "onboarding_first_task";

function view(overrides: Partial<BoardTaskView> = {}): BoardTaskView {
  return {
    status: "todo",
    blockedBy: null,
    assigneeName: "Nova",
    assigneeId: "agent-1",
    ...overrides,
  };
}

function goal(overrides: Partial<Goal> = {}): Goal {
  return {
    id: "goal-1",
    companyId: "company-1",
    title: "Sign up works",
    description: "A person can sign up and get in.",
    level: "feature",
    status: "active",
    parentId: null,
    ownerAgentId: null,
    createdAt: new Date("2026-09-01T00:00:00Z"),
    updatedAt: new Date("2026-09-01T00:00:00Z"),
    ...overrides,
  } as Goal;
}

function task(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "task-1",
    status: "todo",
    goalId: null,
    description: null,
    ancestors: [],
    ...overrides,
  } as unknown as Issue;
}

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent-1",
    name: "Nova",
    status: "idle",
    runtimeConfig: { heartbeat: { maxConcurrentRuns: 1 } },
    ...overrides,
  } as unknown as Agent;
}

describe("the five columns", () => {
  it("names every column in plain words", () => {
    expect(BOARD_COLUMNS).toEqual(["queued", "working", "review", "your-turn", "done"]);
    expect(BOARD_COLUMNS.map((column) => BOARD_COLUMN_LABELS[column])).toEqual([
      "Queued",
      "Agent working",
      "Review",
      "Your turn",
      "Done",
    ]);
  });

  it("puts Your turn first on a phone and keeps the rest in order", () => {
    expect(BOARD_PHONE_COLUMN_ORDER[0]).toBe("your-turn");
    expect([...BOARD_PHONE_COLUMN_ORDER].sort()).toEqual([...BOARD_COLUMNS].sort());
  });
});

describe("columnFor", () => {
  it("puts done in Done", () => {
    expect(columnFor(view({ status: "done" }))).toBe("done");
  });

  it("puts cancelled in Done", () => {
    expect(columnFor(view({ status: "cancelled" }))).toBe("done");
  });

  it("keeps a finished task in Done even when a marker is still set", () => {
    expect(columnFor(view({ status: "done", reviewPending: true, agentWorking: true }))).toBe("done");
  });

  it("keeps the person's turn in Your turn while the organization is paused", () => {
    expect(columnFor(view({ status: "blocked", paused: true, reviewPending: true }))).toBe("your-turn");
    expect(columnFor(view({ status: "blocked", paused: true, planPending: true }))).toBe("your-turn");
    expect(columnFor(view({ status: "blocked", paused: true, waitingOnYou: true }))).toBe("your-turn");
  });

  it("puts paused work in Queued", () => {
    expect(columnFor(view({ status: "in_progress", paused: true }))).toBe("queued");
  });

  it("lets paused beat a live agent, the way the turn sentence does", () => {
    expect(columnFor(view({ status: "in_progress", paused: true, agentWorking: true }))).toBe("queued");
  });

  it("puts a live agent in Agent working", () => {
    expect(columnFor(view({ status: "todo", agentWorking: true }))).toBe("working");
  });

  it("lets a live agent beat a blocker", () => {
    expect(
      columnFor(view({ status: "todo", agentWorking: true, blockedBy: { kind: "item", id: "b", identifier: "TAM-2" } })),
    ).toBe("working");
  });

  it("puts handed-in work waiting to be accepted in Your turn", () => {
    expect(columnFor(view({ status: "in_progress", reviewPending: true }))).toBe("your-turn");
  });

  it("puts a plan waiting for a yes in Your turn", () => {
    expect(columnFor(view({ status: "todo", planPending: true }))).toBe("your-turn");
  });

  it("puts a question waiting for an answer in Your turn", () => {
    expect(columnFor(view({ status: "todo", waitingOnYou: true }))).toBe("your-turn");
  });

  it("reads the waiting-on-you blocker as Your turn too", () => {
    expect(columnFor(view({ status: "blocked", blockedBy: { kind: "waiting-on-you" } }))).toBe("your-turn");
  });

  it("lets Your turn beat the reviewer", () => {
    expect(columnFor(view({ status: "in_progress", reviewRunning: true, reviewPending: true }))).toBe("your-turn");
  });

  it("puts work the reviewer holds in Review", () => {
    expect(columnFor(view({ status: "in_progress", reviewRunning: true }))).toBe("review");
  });

  it("reads a live turn on handed-over work as the reviewer's, not the agent's", () => {
    expect(columnFor(view({ status: "in_progress", reviewRunning: true, agentWorking: true }))).toBe("review");
  });

  it("lets a question waiting for an answer beat the reviewer too", () => {
    expect(columnFor(view({ status: "in_progress", reviewRunning: true, waitingOnYou: true }))).toBe("your-turn");
  });

  it("lets a plan waiting for a yes beat the reviewer too", () => {
    expect(columnFor(view({ status: "in_progress", reviewRunning: true, planPending: true }))).toBe("your-turn");
  });

  it("keeps paused ahead of the reviewer, the way the turn sentence does", () => {
    expect(columnFor(view({ status: "in_progress", reviewRunning: true, paused: true }))).toBe("queued");
  });

  it("leaves finished work in Done even while the reviewer flag is still set", () => {
    expect(columnFor(view({ status: "done", reviewRunning: true }))).toBe("done");
  });

  it("puts work queued behind another task in Queued", () => {
    expect(columnFor(view({ status: "todo", blockedBy: { kind: "item", id: "b", identifier: "TAM-2" } }))).toBe("queued");
  });

  it("puts a parent waiting on its own plan in Queued", () => {
    expect(columnFor(view({ status: "todo", openChildCount: 2 }))).toBe("queued");
  });

  it("puts hard-blocked work in Queued", () => {
    expect(columnFor(view({ status: "blocked" }))).toBe("queued");
  });

  it("puts work nobody has picked up in Queued", () => {
    expect(columnFor(view({ status: "new", assigneeId: null, assigneeName: null }))).toBe("queued");
  });

  it("puts in-progress work in Agent working", () => {
    expect(columnFor(view({ status: "in_progress" }))).toBe("working");
  });

  it("puts assigned to-do work about to start in Agent working", () => {
    expect(columnFor(view({ status: "todo" }))).toBe("working");
  });

  it("keeps unassigned to-do work in Queued", () => {
    expect(columnFor(view({ status: "todo", assigneeId: null, assigneeName: null }))).toBe("queued");
  });

  it("puts every column in the vocabulary and nowhere else", () => {
    const seen = new Set<BoardColumn>();
    for (const status of ["new", "todo", "in_progress", "blocked", "done", "cancelled"] as const) {
      seen.add(columnFor(view({ status })));
    }
    seen.add(columnFor(view({ reviewRunning: true })));
    seen.add(columnFor(view({ reviewPending: true })));
    expect([...seen].every((column) => (BOARD_COLUMNS as readonly string[]).includes(column))).toBe(true);
  });
});

describe("the card and the task page never disagree", () => {
  const STATUSES = ["new", "todo", "in_progress", "blocked", "done", "cancelled"] as const;
  const MARKERS = [
    "reviewRunning",
    "agentWorking",
    "reviewPending",
    "planPending",
    "waitingOnYou",
    "paused",
  ] as const;

  /** Every state the board can meet: each status against every marker set. */
  function everyView(): BoardTaskView[] {
    const views: BoardTaskView[] = [];
    for (const status of STATUSES) {
      for (let mask = 0; mask < 1 << MARKERS.length; mask += 1) {
        const overrides: Partial<BoardTaskView> = { status };
        MARKERS.forEach((marker, index) => {
          if (mask & (1 << index)) overrides[marker] = true;
        });
        views.push(view(overrides));
        views.push(view({ ...overrides, blockedBy: { kind: "item", id: "b", identifier: "TAM-9" } }));
        views.push(view({ ...overrides, openChildCount: 2 }));
      }
    }
    return views;
  }

  it("stands a card in Review only where the task says the reviewer has it", () => {
    for (const candidate of everyView()) {
      if (columnFor(candidate) !== "review") continue;
      expect(turnSentence(candidate).text).toBe("With the reviewer");
    }
  });

  it("stands a card in Agent working wherever the task says the agent is writing", () => {
    for (const candidate of everyView()) {
      if (!turnSentence(candidate).text.endsWith("is writing")) continue;
      expect(columnFor(candidate)).toBe("working");
    }
  });

  it("stands a card in Your turn wherever the task offers the person a button", () => {
    for (const candidate of everyView()) {
      if (turnSentence(candidate).tone !== "action") continue;
      expect(columnFor(candidate)).toBe("your-turn");
    }
  });

  it("stands paused work in Queued wherever the task says Paused", () => {
    for (const candidate of everyView()) {
      if (turnSentence(candidate).text !== "Paused") continue;
      expect(columnFor(candidate)).toBe("queued");
    }
  });

  it("stands finished work in Done wherever the task says it is over", () => {
    for (const candidate of everyView()) {
      if (turnSentence(candidate).tone !== "done") continue;
      expect(columnFor(candidate)).toBe("done");
    }
  });
});

describe("rowsFor", () => {
  it("puts the Brief on top", () => {
    const rows = rowsFor({
      tasks: [
        task({ id: "feature-task", goalId: "goal-1" }),
        task({ id: "brief", originKind: ONBOARDING_FIRST_TASK_ORIGIN_KIND as Issue["originKind"] }),
      ],
      goals: [goal()],
    });
    expect(rows[0]).toMatchObject({ id: "brief", kind: "brief", title: "Brief" });
  });

  it("gives one row per feature goal, in plan order", () => {
    const rows = rowsFor({
      tasks: [],
      goals: [
        goal({ id: "goal-1", title: "Sign up works" }),
        goal({ id: "goal-2", title: "Menu loads" }),
        goal({ id: "goal-3", title: "The company", level: "company" }),
      ],
    });
    expect(rows.map((row) => row.title)).toEqual(["Sign up works", "Menu loads"]);
  });

  it("counts progress per feature and leaves cancelled work counted as finished", () => {
    const rows = rowsFor({
      tasks: [
        task({ id: "a", goalId: "goal-1", status: "done" }),
        task({ id: "b", goalId: "goal-1", status: "cancelled" }),
        task({ id: "c", goalId: "goal-1", status: "todo" }),
        task({ id: "d", goalId: "goal-1", status: "in_progress" }),
      ],
      goals: [goal()],
    });
    expect(rows[0]).toMatchObject({ doneCount: 2, totalCount: 4 });
    expect(rowProgressText(rows[0]!.doneCount, rows[0]!.totalCount)).toBe("2 of 4 done");
  });

  it("carries the feature's done-when as the row subtitle", () => {
    const rows = rowsFor({ tasks: [], goals: [goal({ description: "A person can sign up and get in." })] });
    expect(rows[0]?.doneWhen).toBe("A person can sign up and get in.");
  });

  it("collapses a finished feature by default and leaves an active one open", () => {
    const rows = rowsFor({
      tasks: [],
      goals: [goal({ id: "goal-1", status: "achieved" }), goal({ id: "goal-2", status: "active" })],
    });
    expect(rows[0]?.collapsedByDefault).toBe(true);
    expect(rows[1]?.collapsedByDefault).toBe(false);
  });

  it("puts work that belongs to no feature in Mission, at the bottom", () => {
    const rows = rowsFor({
      tasks: [task({ id: "a", goalId: "goal-1" }), task({ id: "b", goalId: null })],
      goals: [goal()],
    });
    expect(rows.at(-1)).toMatchObject({ id: BOARD_MISSION_ROW_ID, title: "Mission", totalCount: 1 });
  });

  it("treats a goal that is not a feature as no feature at all", () => {
    const rows = rowsFor({
      tasks: [task({ id: "a", goalId: "goal-company" })],
      goals: [goal({ id: "goal-company", level: "company" })],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(BOARD_MISSION_ROW_ID);
  });

  it("draws no Mission row when every task has a feature", () => {
    const rows = rowsFor({ tasks: [task({ id: "a", goalId: "goal-1" })], goals: [goal()] });
    expect(rows.some((row) => row.id === BOARD_MISSION_ROW_ID)).toBe(false);
  });

  it("keeps the Brief out of Mission", () => {
    const rows = rowsFor({
      tasks: [task({ id: "brief", originKind: ONBOARDING_FIRST_TASK_ORIGIN_KIND as Issue["originKind"] })],
      goals: [],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe("brief");
  });

  it("says so when a row holds no tasks yet", () => {
    expect(rowProgressText(0, 0)).toBe("no tasks yet");
  });
});

describe("rowIdFor", () => {
  const rows = rowsFor({
    tasks: [
      task({ id: "brief", originKind: ONBOARDING_FIRST_TASK_ORIGIN_KIND as Issue["originKind"] }),
      task({ id: "a", goalId: "goal-1" }),
      task({ id: "b", goalId: null }),
    ],
    goals: [goal()],
  });

  it("sends the brief to its own row", () => {
    expect(rowIdFor(task({ id: "brief" }), rows)).toBe("brief");
  });

  it("sends a feature task to its feature", () => {
    expect(rowIdFor(task({ id: "a", goalId: "goal-1" }), rows)).toBe("goal-1");
  });

  it("sends everything else to Mission", () => {
    expect(rowIdFor(task({ id: "b", goalId: null }), rows)).toBe(BOARD_MISSION_ROW_ID);
  });
});

describe("agentRowsFor", () => {
  it("gives one row per agent that is carrying something", () => {
    const rows = agentRowsFor({
      tasks: [
        { id: "a", status: "todo", assigneeAgentId: "agent-1" },
        { id: "b", status: "done", assigneeAgentId: "agent-1" },
      ],
      agents: [agent({ id: "agent-1", name: "Nova" }), agent({ id: "agent-2", name: "Kai" })],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "agent-1", title: "Nova", doneCount: 1, totalCount: 2 });
  });

  it("collects work nobody has yet", () => {
    const rows = agentRowsFor({
      tasks: [{ id: "a", status: "todo", assigneeAgentId: null }],
      agents: [],
    });
    expect(rows[0]).toMatchObject({ id: BOARD_UNASSIGNED_ROW_ID, title: "Nobody yet" });
    expect(agentRowIdFor({ assigneeAgentId: null })).toBe(BOARD_UNASSIGNED_ROW_ID);
    expect(agentRowIdFor({ assigneeAgentId: "agent-1" })).toBe("agent-1");
  });
});

describe("the work-in-progress limit", () => {
  it("reads what the agent was hired with", () => {
    expect(wipLimitFor(agent({ runtimeConfig: { heartbeat: { maxConcurrentRuns: 1 } } as never }))).toBe(1);
  });

  it("falls back to the house default when nothing was recorded", () => {
    expect(wipLimitFor(agent({ runtimeConfig: {} as never }))).toBe(20);
    expect(wipLimitFor(agent({ runtimeConfig: { heartbeat: { maxConcurrentRuns: 0 } } as never }))).toBe(20);
  });

  it("reads 1 of 1 when one task is with the agent", () => {
    const statuses = wipFor({
      agents: [agent()],
      tasks: [{ id: "a", assigneeAgentId: "agent-1" }],
      columnOf: () => "working",
    });
    expect(statuses).toHaveLength(1);
    expect(wipBadgeText(statuses[0]!)).toBe("1 of 1");
    expect(statuses[0]?.atLimit).toBe(true);
  });

  it("reads 0 of 1 when nothing is moving", () => {
    const statuses = wipFor({
      agents: [agent()],
      tasks: [{ id: "a", assigneeAgentId: "agent-1" }],
      columnOf: () => "queued",
    });
    expect(wipBadgeText(statuses[0]!)).toBe("0 of 1");
    expect(statuses[0]?.atLimit).toBe(false);
  });

  it("counts only the tasks standing in Agent working", () => {
    const statuses = wipFor({
      agents: [agent({ runtimeConfig: { heartbeat: { maxConcurrentRuns: 3 } } as never })],
      tasks: [
        { id: "a", assigneeAgentId: "agent-1" },
        { id: "b", assigneeAgentId: "agent-1" },
        { id: "c", assigneeAgentId: "agent-1" },
      ],
      columnOf: (id) => (id === "c" ? "done" : "working"),
    });
    expect(wipBadgeText(statuses[0]!)).toBe("2 of 3");
  });

  it("ignores work nobody has", () => {
    const statuses = wipFor({
      agents: [agent()],
      tasks: [{ id: "a", assigneeAgentId: null }],
      columnOf: () => "working",
    });
    expect(statuses[0]?.activeCount).toBe(0);
  });

  it("leaves out agents who cannot take work", () => {
    const statuses = wipFor({
      agents: [
        agent({ id: "a1", status: "terminated" as Agent["status"] }),
        agent({ id: "a2", status: "pending_approval" as Agent["status"] }),
        agent({ id: "a3", status: "paused" as Agent["status"] }),
      ],
      tasks: [],
      columnOf: () => "queued",
    });
    expect(statuses.map((status) => status.agentId)).toEqual(["a3"]);
  });
});

describe("timeInColumnText", () => {
  const now = new Date("2026-09-11T12:00:00Z").getTime();

  it("says just now for anything under a minute", () => {
    expect(timeInColumnText(new Date(now - 30_000), now)).toBe("just now");
  });

  it("counts minutes, then hours, then days", () => {
    expect(timeInColumnText(new Date(now - 12 * 60_000), now)).toBe("12 m");
    expect(timeInColumnText(new Date(now - 3 * 3_600_000), now)).toBe("3 h");
    expect(timeInColumnText(new Date(now - 2 * 86_400_000), now)).toBe("2 d");
  });

  it("says nothing when there is no time to report", () => {
    expect(timeInColumnText(null, now)).toBeNull();
    expect(timeInColumnText("not a date", now)).toBeNull();
  });
});

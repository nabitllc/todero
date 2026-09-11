// @vitest-environment jsdom

import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Agent, Issue } from "@todero/shared";
import { BOARD_PARK_NOTE, dropTaskFor, useBoardDrop } from "./BoardDragHandlers";

const mockIssuesApi = vi.hoisted(() => ({ update: vi.fn(), addComment: vi.fn() }));
const mockAgentsApi = vi.hoisted(() => ({ wakeup: vi.fn() }));

vi.mock("../../api/issues", () => ({ issuesApi: mockIssuesApi }));
vi.mock("../../api/agents", () => ({ agentsApi: mockAgentsApi }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "task-1",
    identifier: "TAM-4",
    title: "Write the sign up words",
    status: "todo",
    description: null,
    blockedBy: null,
    assigneeAgentId: "agent-1",
    ancestors: [],
    ...overrides,
  } as unknown as Issue;
}

const agent = { id: "agent-1", name: "Nova", companyId: "company-1", status: "idle" } as unknown as Agent;
const pausedAgent = { ...agent, status: "paused" } as unknown as Agent;

let container: HTMLDivElement;
let root: Root;
let handleDrop: ((taskId: string, from: never, to: never) => void) | null = null;

const onConfirm = vi.fn((_message: string, onYes: () => void) => onYes());
const onRefuse = vi.fn();
const onDone = vi.fn();
const onFail = vi.fn();
const onRefresh = vi.fn();

function Harness({
  tasks,
  openChild,
  assignee = agent,
  organizationPaused = false,
}: {
  tasks: Issue[];
  openChild: Map<string, number>;
  assignee?: Agent;
  organizationPaused?: boolean;
}) {
  const drop = useBoardDrop({
    tasks,
    agentsById: new Map([[assignee.id, assignee]]),
    openChildCountById: openChild,
    organizationPaused,
    onConfirm,
    onRefuse,
    onDone,
    onFail,
    onRefresh,
  });
  handleDrop = drop.handleDrop as never;
  return null;
}

async function mount(
  tasks: Issue[] = [issue()],
  openChild = new Map<string, number>(),
  options: { assignee?: Agent; organizationPaused?: boolean } = {},
) {
  await act(async () => {
    root.render(
      <Harness
        tasks={tasks}
        openChild={openChild}
        assignee={options.assignee}
        organizationPaused={options.organizationPaused}
      />,
    );
  });
}

async function drop(from: string, to: string, taskId = "task-1") {
  await act(async () => {
    handleDrop?.(taskId, from as never, to as never);
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  handleDrop = null;
  mockIssuesApi.update.mockReset().mockResolvedValue({});
  mockIssuesApi.addComment.mockReset().mockResolvedValue({});
  mockAgentsApi.wakeup.mockReset().mockResolvedValue({});
  onConfirm.mockClear();
  onRefuse.mockClear();
  onDone.mockClear();
  onFail.mockClear();
  onRefresh.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const agentsById = new Map([[agent.id, agent]]);

describe("dropTaskFor", () => {
  it("reads the blocker off the task", () => {
    const built = dropTaskFor({
      issue: issue({ blockedBy: [{ id: "b", identifier: "TAM-3" }] as Issue["blockedBy"] }),
      agentsById,
      openChildCountById: new Map(),
    });
    expect(built).toMatchObject({ identifier: "TAM-4", blockedByIdentifier: "TAM-3" });
  });

  it("carries how many of its own tasks are still open", () => {
    expect(
      dropTaskFor({ issue: issue(), agentsById, openChildCountById: new Map([["task-1", 3]]) }),
    ).toMatchObject({ openChildCount: 3 });
  });

  it("never leaves the person reading an empty name", () => {
    expect(
      dropTaskFor({ issue: issue({ identifier: null }), agentsById, openChildCountById: new Map() }).identifier,
    ).toBe("this task");
  });

  it("carries the assignee's pause, and the organization's", () => {
    expect(
      dropTaskFor({
        issue: issue(),
        agentsById: new Map([[pausedAgent.id, pausedAgent]]),
        openChildCountById: new Map(),
        organizationPaused: true,
      }),
    ).toMatchObject({ assigneeName: "Nova", assigneePaused: true, organizationPaused: true });
  });
});

describe("useBoardDrop", () => {
  it("asks before it does anything", async () => {
    await mount();
    await drop("your-turn", "done");
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onConfirm.mock.calls[0]![0]).toContain("TAM-4");
  });

  it("accepts the work with the same call the task page's Accept makes", async () => {
    await mount();
    await drop("your-turn", "done");
    expect(mockIssuesApi.update).toHaveBeenCalledWith("task-1", { status: "done" });
    expect(onDone).toHaveBeenCalledWith("TAM-4 accepted.");
    expect(onRefresh).toHaveBeenCalled();
  });

  it("clears the blockers and then starts the agent", async () => {
    await mount([issue({ blockedBy: [{ id: "b", identifier: "TAM-3" }] as Issue["blockedBy"] })]);
    await drop("queued", "working");
    expect(mockIssuesApi.update).toHaveBeenCalledWith("task-1", expect.objectContaining({ blockedByIssueIds: [] }));
    expect(mockAgentsApi.wakeup).toHaveBeenCalledWith(
      "agent-1",
      expect.objectContaining({ source: "on_demand", payload: { issueId: "task-1" } }),
      "company-1",
    );
  });

  it("parks the work, marks it waiting on the person, and leaves a note", async () => {
    await mount([issue({ status: "in_progress" as Issue["status"] })]);
    await drop("working", "queued");
    expect(mockIssuesApi.update).toHaveBeenCalledWith("task-1", expect.objectContaining({ status: "blocked" }));
    expect(String(mockIssuesApi.update.mock.calls[0]![1].description)).toContain("todero-blocked-by: waiting-on-you");
    expect(mockIssuesApi.addComment).toHaveBeenCalledWith("task-1", BOARD_PARK_NOTE);
  });

  it("reports a refusal and calls nothing", async () => {
    await mount();
    await drop("queued", "your-turn");
    expect(onRefuse).toHaveBeenCalledWith("Only the agent can hand work in.");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(mockIssuesApi.update).not.toHaveBeenCalled();
  });

  it("does nothing at all when a card lands where it started", async () => {
    await mount();
    await drop("queued", "queued");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onRefuse).not.toHaveBeenCalled();
    expect(mockIssuesApi.update).not.toHaveBeenCalled();
  });

  it("refuses to start a paused agent's work, and names the button that would", async () => {
    await mount([issue()], new Map(), { assignee: pausedAgent });
    await drop("queued", "working");
    expect(onRefuse).toHaveBeenCalledWith("Nova is paused. Press Play on Nova first.");
    expect(mockAgentsApi.wakeup).not.toHaveBeenCalled();
    expect(mockIssuesApi.update).not.toHaveBeenCalled();
  });

  it("refuses to start work while the organization itself is paused", async () => {
    await mount([issue()], new Map(), { organizationPaused: true });
    await drop("queued", "working");
    expect(onRefuse).toHaveBeenCalledWith(
      "The organization is paused. Press Play on it, then this can start.",
    );
    expect(mockAgentsApi.wakeup).not.toHaveBeenCalled();
  });

  it("says so in plain words when the call fails", async () => {
    mockIssuesApi.update.mockRejectedValueOnce(new Error("the server said no"));
    await mount();
    await drop("your-turn", "done");
    expect(onFail).toHaveBeenCalledWith("the server said no");
  });

  it("ignores a card it does not know", async () => {
    await mount();
    await drop("queued", "working", "ghost");
    expect(onConfirm).not.toHaveBeenCalled();
    expect(onRefuse).not.toHaveBeenCalled();
  });
});

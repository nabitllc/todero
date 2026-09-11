// @vitest-environment jsdom

import type { ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ONBOARDING_FIRST_TASK_ORIGIN_KIND, type Agent, type Goal, type Issue } from "@todero/shared";
import { visibleCopyHasForbiddenWord } from "../components/work-item/work-item-model";

const mockIssuesApi = vi.hoisted(() => ({ list: vi.fn(), update: vi.fn(), addComment: vi.fn() }));
const mockGoalsApi = vi.hoisted(() => ({ list: vi.fn() }));
const mockAgentsApi = vi.hoisted(() => ({ list: vi.fn(), wakeup: vi.fn() }));
const mockHeartbeatsApi = vi.hoisted(() => ({ liveRunsForCompany: vi.fn() }));
const mockPushToast = vi.hoisted(() => vi.fn());

vi.mock("../api/issues", () => ({ issuesApi: mockIssuesApi }));
vi.mock("../api/goals", () => ({ goalsApi: mockGoalsApi }));
vi.mock("../api/agents", () => ({ agentsApi: mockAgentsApi }));
vi.mock("../api/heartbeats", () => ({ heartbeatsApi: mockHeartbeatsApi }));
const companyState = vi.hoisted(() => ({ status: "active" as string }));

vi.mock("../context/CompanyContext", () => ({
  useCompany: () => ({
    selectedCompanyId: "company-1",
    selectedCompany: { id: "company-1", status: companyState.status },
  }),
}));
vi.mock("../context/ToastContext", () => ({ useToastActions: () => ({ pushToast: mockPushToast }) }));
vi.mock("@/lib/router", () => ({
  Link: ({ children, to }: { children?: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

const { Board } = await import("./Board");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date("2026-09-11T12:00:00Z");

function issue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "task-1",
    identifier: "TAM-1",
    title: "Write the sign up words",
    status: "todo",
    description: null,
    blockedBy: null,
    goalId: "goal-1",
    parentId: null,
    assigneeAgentId: "agent-1",
    assigneeUserId: null,
    ancestors: [],
    updatedAt: NOW,
    ...overrides,
  } as unknown as Issue;
}

const agent = {
  id: "agent-1",
  name: "Nova",
  companyId: "company-1",
  status: "idle",
  runtimeConfig: { heartbeat: { maxConcurrentRuns: 1 } },
} as unknown as Agent;

const featureGoal = {
  id: "goal-1",
  companyId: "company-1",
  title: "Sign up works",
  description: "A person can sign up and get in.",
  level: "feature",
  status: "active",
  parentId: null,
  ownerAgentId: null,
  createdAt: NOW,
  updatedAt: NOW,
} as unknown as Goal;

let container: HTMLDivElement;
let root: Root;

async function render() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={queryClient}>
        <Board />
      </QueryClientProvider>,
    );
  });
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

function text(): string {
  return container.textContent ?? "";
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  window.localStorage.clear();
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;

  companyState.status = "active";
  mockIssuesApi.list.mockResolvedValue([issue()]);
  mockGoalsApi.list.mockResolvedValue([featureGoal]);
  mockAgentsApi.list.mockResolvedValue([agent]);
  mockAgentsApi.wakeup.mockReset().mockResolvedValue({});
  mockIssuesApi.update.mockReset().mockResolvedValue({});
  mockIssuesApi.addComment.mockReset().mockResolvedValue({});
  mockHeartbeatsApi.liveRunsForCompany.mockResolvedValue([]);
  mockPushToast.mockClear();
});

/** The board on a phone: no dragging, so the cards carry the buttons instead. */
function onAPhone() {
  window.matchMedia = ((query: string) => ({
    matches: true,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("the Board page", () => {
  it("draws the five steps, left to right, in plain words", async () => {
    await render();
    const headers = [...container.querySelectorAll("[data-testid^='board-column-header-']")].map(
      (node) => node.getAttribute("data-testid"),
    );
    expect(headers).toEqual([
      "board-column-header-queued",
      "board-column-header-working",
      "board-column-header-review",
      "board-column-header-your-turn",
      "board-column-header-done",
    ]);
    expect(text()).toContain("Queued");
    expect(text()).toContain("Agent working");
    expect(text()).toContain("Review");
    expect(text()).toContain("Your turn");
    expect(text()).toContain("Done");
  });

  it("gives each feature a row with its progress and its done-when", async () => {
    await render();
    expect(container.querySelector("[data-testid='board-row-goal-1']")).not.toBeNull();
    expect(text()).toContain("Sign up works");
    expect(text()).toContain("0 of 1 done");
    expect(text()).toContain("A person can sign up and get in.");
  });

  it("puts the Brief row on top", async () => {
    mockIssuesApi.list.mockResolvedValue([
      issue(),
      issue({
        id: "brief",
        identifier: "TAM-0",
        title: "The brief",
        goalId: null,
        originKind: ONBOARDING_FIRST_TASK_ORIGIN_KIND as Issue["originKind"],
      }),
    ]);
    await render();
    const rows = [...container.querySelectorAll("[data-testid^='board-row-']")].map((node) =>
      node.getAttribute("data-testid"),
    );
    expect(rows[0]).toBe("board-row-brief");
  });

  it("shows the work-in-progress badge per agent and says 1 of 1 at the limit", async () => {
    await render();
    const badge = container.querySelector("[data-testid='board-wip-agent-1']");
    expect(badge?.textContent).toBe("Nova: 1 of 1");
  });

  it("stands a task waiting on the person in Your turn", async () => {
    mockIssuesApi.list.mockResolvedValue([
      issue({ id: "task-1", identifier: "TAM-3", description: "<!-- todero-review: pending -->" }),
    ]);
    await render();
    const card = container.querySelector("[data-testid='board-card-TAM-3']");
    expect(card?.getAttribute("data-column")).toBe("your-turn");
    expect(container.querySelector("[data-testid='board-cell-goal-1-your-turn']")?.textContent).toContain("TAM-3");
  });

  it("stands a paused agent's work in Queued", async () => {
    mockAgentsApi.list.mockResolvedValue([{ ...agent, status: "paused" }]);
    await render();
    expect(container.querySelector("[data-testid='board-card-TAM-1']")?.getAttribute("data-column")).toBe("queued");
  });

  it("stands a paused organization's work in Queued and says why", async () => {
    companyState.status = "paused";
    await render();
    expect(container.querySelector("[data-testid='board-card-TAM-1']")?.getAttribute("data-column")).toBe("queued");
    expect(text()).toContain("This organization is paused");
  });

  it("leaves a turn already under way in Agent working while the organization is paused", async () => {
    companyState.status = "paused";
    mockHeartbeatsApi.liveRunsForCompany.mockResolvedValue([
      { issueId: "task-1", status: "running" },
    ]);
    await render();
    expect(container.querySelector("[data-testid='board-card-TAM-1']")?.getAttribute("data-column")).toBe("working");
  });

  it("puts Your turn first on a phone", async () => {
    onAPhone();
    await render();
    const headers = [...container.querySelectorAll("[data-testid^='board-column-header-']")].map(
      (node) => node.getAttribute("data-testid"),
    );
    expect(headers[0]).toBe("board-column-header-your-turn");
  });

  it("gives a phone the button the drag would have been", async () => {
    onAPhone();
    mockIssuesApi.list.mockResolvedValue([
      issue({ identifier: "TAM-3", description: "<!-- todero-review: pending -->" }),
    ]);
    await render();
    const button = container.querySelector<HTMLButtonElement>(
      "[data-testid='board-card-action-TAM-3-done']",
    );
    expect(button?.textContent).toBe("Accept");

    await act(async () => {
      button!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
    // It asks first, in the same words the drag asks, and changes nothing yet.
    // The question opens in a dialog of its own, outside this container.
    expect(document.body.textContent ?? "").toContain("Accept TAM-3");
    expect(mockIssuesApi.update).not.toHaveBeenCalled();
  });

  it("gives a phone no button where only the agents act", async () => {
    onAPhone();
    mockIssuesApi.list.mockResolvedValue([issue({ identifier: "TAM-5", status: "in_review" as Issue["status"] })]);
    await render();
    expect(container.querySelector("[data-testid^='board-card-action-TAM-5']")).toBeNull();
  });

  it("says what to do when there is nothing on the board", async () => {
    mockIssuesApi.list.mockResolvedValue([]);
    mockGoalsApi.list.mockResolvedValue([]);
    await render();
    expect(text()).toContain("Nothing on the board yet");
  });

  it("says so plainly when the board cannot be loaded", async () => {
    mockIssuesApi.list.mockRejectedValue(new Error("no"));
    await render();
    expect(text()).toContain("The board could not be loaded");
  });

  it("never says a word the product does not use", async () => {
    await render();
    expect(visibleCopyHasForbiddenWord(text())).toBe(false);
  });

  it("keeps its plain words on a phone, buttons and all", async () => {
    onAPhone();
    await render();
    expect(visibleCopyHasForbiddenWord(text())).toBe(false);
  });
});

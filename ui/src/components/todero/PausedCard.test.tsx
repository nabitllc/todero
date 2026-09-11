// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockIssuesApi = vi.hoisted(() => ({
  list: vi.fn(),
  update: vi.fn(),
}));
const mockHeartbeatsApi = vi.hoisted(() => ({ list: vi.fn() }));
const mockAgentsApi = vi.hoisted(() => ({ list: vi.fn() }));
const mockCompaniesApi = vi.hoisted(() => ({ resume: vi.fn() }));

vi.mock("@/api/issues", () => ({ issuesApi: mockIssuesApi }));
vi.mock("@/api/heartbeats", () => ({ heartbeatsApi: mockHeartbeatsApi }));
vi.mock("@/api/agents", () => ({ agentsApi: mockAgentsApi }));
vi.mock("@/api/companies", () => ({ companiesApi: mockCompaniesApi }));
vi.mock("@/lib/router", () => ({
  Link: ({ to, children }: { to: string; children: unknown }) => <a href={to}>{children as never}</a>,
  useNavigate: () => vi.fn(),
}));

import { PausedCard } from "./PausedCard";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const PAUSED_AT = new Date("2026-09-10T10:42:00Z");

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function mountCard() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <PausedCard
          companyId="company-1"
          pausedAt={PAUSED_AT}
          waitingOnYou={<div data-testid="your-turn-list">one thing</div>}
          waitingOnYouCount={1}
          nextSuggestions={[]}
        />
      </QueryClientProvider>,
    );
  });
  await flushReact();
  return { container, root };
}

describe("PausedCard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIssuesApi.list.mockResolvedValue([
      {
        id: "issue-1",
        identifier: "T-1",
        title: "Write the sign-up words",
        description: "",
        status: "todo",
        assigneeAgentId: "agent-1",
        blockedBy: [],
        updatedAt: new Date("2026-09-10T10:41:50Z"),
        createdAt: new Date("2026-09-10T10:41:50Z"),
      },
    ]);
    mockIssuesApi.update.mockResolvedValue({});
    mockHeartbeatsApi.list.mockResolvedValue([
      {
        id: "run-1",
        agentId: "agent-1",
        status: "running",
        startedAt: new Date("2026-09-10T10:30:00Z"),
        createdAt: new Date("2026-09-10T10:30:00Z"),
        finishedAt: null,
        contextSnapshot: { issueId: "issue-1" },
      },
    ]);
    mockAgentsApi.list.mockResolvedValue([
      { id: "agent-1", name: "Ada", budgetMonthlyCents: 100, spentMonthlyCents: 100 },
    ]);
    mockCompaniesApi.resume.mockResolvedValue({ id: "company-1", status: "active" });
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("shows the four lists, the Play button, and when the pause started", async () => {
    const { container } = await mountCard();

    const card = container.querySelector('[data-testid="paused-card"]');
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("Paused since");

    for (const testId of [
      "paused-in-flight",
      "paused-queued",
      "paused-waiting",
      "paused-recommendations",
    ]) {
      expect(container.querySelector(`[data-testid="${testId}"]`), testId).not.toBeNull();
    }
    expect(container.querySelector('[data-testid="paused-in-flight"]')?.textContent).toContain("Was in flight");
    expect(container.querySelector('[data-testid="paused-queued"]')?.textContent).toContain("Queued");
    expect(container.querySelector('[data-testid="paused-waiting"]')?.textContent).toContain("Waiting on you");
    expect(container.querySelector('[data-testid="paused-recommendations"]')?.textContent).toContain(
      "Recommendations",
    );

    // The Your-turn list is handed through unchanged.
    expect(container.querySelector('[data-testid="your-turn-list"]')?.textContent).toBe("one thing");
    // The agent that spent its month is a computed recommendation.
    expect(container.querySelector('[data-testid="paused-recommendations"]')?.textContent).toContain("Ada");

    const play = container.querySelector('[data-testid="paused-card-play"]');
    expect(play?.textContent).toContain("Play");
  });

  it("presses Play through the API", async () => {
    const { container } = await mountCard();
    const play = container.querySelector('[data-testid="paused-card-play"]') as HTMLButtonElement;
    await act(async () => {
      play.click();
    });
    await flushReact();
    expect(mockCompaniesApi.resume).toHaveBeenCalledWith("company-1");
  });

  it("Skip cancels the task through the API", async () => {
    const { container } = await mountCard();
    const skip = container.querySelector('[data-testid="paused-queued-skip"]') as HTMLButtonElement;
    expect(skip).not.toBeNull();
    await act(async () => {
      skip.click();
    });
    await flushReact();
    expect(mockIssuesApi.update).toHaveBeenCalledWith("issue-1", { status: "cancelled" });
  });
});

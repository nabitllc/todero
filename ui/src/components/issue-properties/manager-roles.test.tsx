// @vitest-environment jsdom

import type { ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Agent, Issue } from "@todero/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AssignedByCaption, TeamSection, readManagerAssignmentMarker } from "./ManagerRoleSections";

const mockAgentsApi = vi.hoisted(() => ({ list: vi.fn() }));

vi.mock("@/lib/router", () => ({
  Link: ({ children, to, ...props }: { children: ReactNode; to: string }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
}));

vi.mock("../../api/agents", () => ({ agentsApi: mockAgentsApi }));

// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

async function act(callback: () => void | Promise<void>) {
  let result: void | Promise<void> = undefined;
  flushSync(() => {
    result = callback();
  });
  await result;
}

async function flushReact() {
  await act(async () => {
    await Promise.resolve();
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

function makeAgent(overrides: Partial<Agent>): Agent {
  return {
    id: "agent-1",
    companyId: "company-1",
    name: "Alpha",
    urlKey: "alpha",
    role: "worker",
    title: null,
    icon: null,
    status: "active",
    reportsTo: null,
    capabilities: null,
    adapterType: "http",
    adapterConfig: {},
    runtimeConfig: {},
    budgetMonthlyCents: 0,
    spentMonthlyCents: 0,
    pauseReason: null,
    pausedAt: null,
    permissions: { canCreateAgents: false },
    lastHeartbeatAt: null,
    metadata: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeChild(overrides: Partial<Issue>): Issue {
  return {
    id: "child-1",
    companyId: "company-1",
    identifier: "ZZW-1",
    title: "Draft the guide",
    description: null,
    status: "todo",
    priority: "medium",
    assigneeAgentId: null,
    parentId: "conversation-1",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  } as Issue;
}

describe("the manager's part of the task sidebar", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot> | null;
  let queryClient: QueryClient;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = null;
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    mockAgentsApi.list.mockReset();
  });

  afterEach(async () => {
    const currentRoot = root;
    if (currentRoot) {
      await act(async () => {
        currentRoot.unmount();
      });
    }
    container.remove();
    queryClient.clear();
  });

  async function render(node: ReactNode) {
    root = createRoot(container);
    await act(async () => {
      root!.render(<QueryClientProvider client={queryClient}>{node}</QueryClientProvider>);
    });
    await flushReact();
    await flushReact();
  }

  describe("readManagerAssignmentMarker", () => {
    it("reads the manager out of the marker", () => {
      expect(readManagerAssignmentMarker("Draft it.\n<!-- todero-assigned-by: mgr-123 -->")).toBe("mgr-123");
    });

    it("tolerates extra whitespace", () => {
      expect(readManagerAssignmentMarker("<!--   todero-assigned-by:   mgr-456   -->Task")).toBe("mgr-456");
    });

    it("takes the first when a task somehow carries two", () => {
      expect(
        readManagerAssignmentMarker("<!-- todero-assigned-by: mgr-1 -->and<!-- todero-assigned-by: mgr-2 -->"),
      ).toBe("mgr-1");
    });

    it("says nothing for a task with no marker", () => {
      expect(readManagerAssignmentMarker("Just a task.")).toBeNull();
      expect(readManagerAssignmentMarker("")).toBeNull();
      expect(readManagerAssignmentMarker(null)).toBeNull();
      expect(readManagerAssignmentMarker("<!-- assigned-by: mgr-123 -->")).toBeNull();
      expect(readManagerAssignmentMarker("todero-assigned-by: mgr-123")).toBeNull();
    });
  });

  describe("AssignedByCaption", () => {
    it("names the manager that handed the task out", async () => {
      mockAgentsApi.list.mockResolvedValue([makeAgent({ id: "mgr-1", name: "Nova", role: "ceo" })]);

      await render(
        <AssignedByCaption
          description={"Draft the guide.\n<!-- todero-assigned-by: mgr-1 -->"}
          selectedCompanyId="company-1"
        />,
      );

      expect(container.textContent).toContain("Assigned by Nova");
    });

    it("says nothing when nobody handed it out", async () => {
      mockAgentsApi.list.mockResolvedValue([makeAgent({ id: "mgr-1", name: "Nova", role: "ceo" })]);

      await render(<AssignedByCaption description="Draft the guide." selectedCompanyId="company-1" />);

      expect(container.textContent).toBe("");
      expect(mockAgentsApi.list).not.toHaveBeenCalled();
    });

    it("says nothing when the named agent is gone", async () => {
      mockAgentsApi.list.mockResolvedValue([makeAgent({ id: "mgr-1", name: "Nova", role: "ceo" })]);

      await render(
        <AssignedByCaption description="<!-- todero-assigned-by: someone-else -->" selectedCompanyId="company-1" />,
      );

      expect(container.textContent).toBe("");
    });
  });

  describe("TeamSection", () => {
    const team = [
      makeAgent({ id: "mgr-1", name: "Nova", role: "ceo" }),
      makeAgent({ id: "wkr-2", name: "Ash 2", role: "worker" }),
      makeAgent({ id: "wkr-1", name: "Ash", role: "worker" }),
      makeAgent({ id: "rev-1", name: "Ash's reviewer", role: "reviewer" }),
    ];

    it("lists the team and counts the open tasks each worker is carrying", async () => {
      mockAgentsApi.list.mockResolvedValue(team);

      await render(
        <TeamSection
          selectedCompanyId="company-1"
          childIssues={[
            makeChild({ id: "c1", assigneeAgentId: "wkr-1", status: "todo" }),
            makeChild({ id: "c2", assigneeAgentId: "wkr-1", status: "in_progress" }),
            makeChild({ id: "c3", assigneeAgentId: "wkr-1", status: "done" }),
            makeChild({ id: "c4", assigneeAgentId: "wkr-2", status: "cancelled" }),
            makeChild({ id: "c5", assigneeAgentId: null, status: "todo" }),
          ]}
        />,
      );

      expect(container.textContent).toContain("Team");
      expect(container.textContent).toContain("Nova");
      expect(container.textContent).toContain("Manager");
      expect(container.textContent).toContain("Reviewer");

      const rows = Array.from(container.querySelectorAll("a")).map((row) => row.textContent);
      // Workers read in name order, whatever order they were hired in.
      expect(rows).toEqual(["Nova", "Ash", "Ash 2", "Ash's reviewer"]);

      const workerRow = (name: string) =>
        Array.from(container.querySelectorAll("div")).find(
          (row) => row.querySelector("a")?.textContent === name && row.textContent?.includes("open"),
        )?.textContent;
      expect(workerRow("Ash")).toContain("2 open");
      expect(workerRow("Ash 2")).toContain("0 open");
    });

    it("stays away until the organization has a worker", async () => {
      mockAgentsApi.list.mockResolvedValue([
        makeAgent({ id: "mgr-1", name: "Nova", role: "ceo" }),
        makeAgent({ id: "rev-1", name: "Nova's reviewer", role: "reviewer" }),
      ]);

      await render(
        <TeamSection
          selectedCompanyId="company-1"
          childIssues={[makeChild({ id: "c1", assigneeAgentId: "mgr-1", status: "todo" })]}
        />,
      );

      expect(container.textContent).toBe("");
    });

    it("stays away while the team is still loading", async () => {
      mockAgentsApi.list.mockReturnValue(new Promise(() => {}));

      await render(<TeamSection selectedCompanyId="company-1" childIssues={[]} />);

      expect(container.textContent).toBe("");
    });
  });
});

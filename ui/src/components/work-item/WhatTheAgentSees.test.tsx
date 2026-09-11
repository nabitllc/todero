// @vitest-environment jsdom

/**
 * Step 9 — "What Nova sees". The panel is read-only and reads the turn's own
 * stored record, so the tests are about what it shows and when it asks for it:
 * nothing until it is opened, the last turn once it is, and a plain sentence
 * when the task has not had a turn at all.
 */
import { StrictMode, act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WhatTheAgentSees } from "./WhatTheAgentSees";
import { WhatTheAgentSeesSection, latestRunId } from "./WhatTheAgentSeesSection";
import { readAgentContext } from "./agent-context";

const runsForIssue = vi.fn();
const heartbeatGet = vi.fn();

vi.mock("../../api/activity", () => ({
  activityApi: { runsForIssue: (issueId: string) => runsForIssue(issueId) },
}));
vi.mock("../../api/heartbeats", () => ({
  heartbeatsApi: { get: (runId: string) => heartbeatGet(runId) },
}));

const snapshot = {
  toderoIdentity: { agentName: "Nova", roleTitle: "Chef", companyName: "Tampa Supper Club" },
  toderoTaskMarkdown: "## The brief\n\nWrite a six course menu.",
  toderoSkillText: "Always hand in one document.",
  toderoTurnInstruction: "Carry on where you left off.",
  toderoThread: [
    { role: "user", body: "Make it seasonal." },
    { role: "assistant", body: "Understood." },
  ],
};

let container: HTMLDivElement;
let root: Root;

async function render(node: ReactNode) {
  await act(async () => {
    root.render(<StrictMode>{node}</StrictMode>);
  });
}

/** Let the fetch, its state change and the re-render all land. */
async function settle() {
  for (let pass = 0; pass < 5; pass += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function click(selector: string) {
  const element = container.querySelector(selector) as HTMLElement | null;
  if (!element) throw new Error(`no ${selector}`);
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  runsForIssue.mockReset();
  heartbeatGet.mockReset();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("the panel", () => {
  it("shows the brief, the standing instructions and the turn's own conversation", async () => {
    await render(<WhatTheAgentSees context={readAgentContext(snapshot)} />);
    const shown = container.textContent ?? "";
    expect(shown).toContain("Nova");
    expect(shown).toContain("Chef at Tampa Supper Club");
    expect(shown).toContain("The brief");
    expect(shown).toContain("Standing instructions");
    expect(shown).toContain("Always hand in one document.");
    expect(shown).toContain("What it was asked this turn");
    expect(shown).toContain("The conversation it was given");
  });

  it("names the two sides of that conversation without calling either one AI", async () => {
    await render(<WhatTheAgentSees context={readAgentContext(snapshot)} />);
    const roles = [...container.querySelectorAll(".agent-sees-turn-role")].map((role) => role.textContent);
    expect(roles).toEqual(["You said", "It said"]);
    expect(container.textContent).not.toContain("AI");
  });

  it("says so plainly when the task has not had a turn", async () => {
    await render(<WhatTheAgentSees context={null} />);
    expect(container.querySelector('[data-testid="what-the-agent-sees-empty"]')?.textContent).toContain(
      "Nothing yet",
    );
  });

  it("says it is reading while the turn is still being fetched", async () => {
    await render(<WhatTheAgentSees context={null} loading />);
    expect(container.querySelector('[data-testid="what-the-agent-sees"]')?.textContent).toContain("Reading");
    expect(container.querySelector('[data-testid="what-the-agent-sees-empty"]')).toBeNull();
  });
});

describe("the sidebar toggle", () => {
  function section() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return (
      <QueryClientProvider client={client}>
        <WhatTheAgentSeesSection issueId="issue-1" agentName="Nova" />
      </QueryClientProvider>
    );
  }

  it("names itself after the agent and asks for nothing until it is opened", async () => {
    await render(section());
    expect(container.querySelector('[data-testid="what-the-agent-sees-toggle"]')?.textContent).toContain(
      "What Nova sees",
    );
    expect(container.querySelector('[data-testid="what-the-agent-sees"]')).toBeNull();
    expect(runsForIssue).not.toHaveBeenCalled();
  });

  it("reads the last turn once it is opened", async () => {
    runsForIssue.mockResolvedValue([
      { runId: "run-old", startedAt: "2026-09-10T09:00:00Z", createdAt: "2026-09-10T09:00:00Z" },
      { runId: "run-new", startedAt: "2026-09-11T10:00:00Z", createdAt: "2026-09-11T10:00:00Z" },
    ]);
    heartbeatGet.mockResolvedValue({ contextSnapshot: snapshot });
    await render(section());
    await click('[data-testid="what-the-agent-sees-toggle"]');
    await settle();
    expect(runsForIssue).toHaveBeenCalledWith("issue-1");
    expect(heartbeatGet).toHaveBeenCalledWith("run-new");
    expect(container.querySelector('[data-testid="what-the-agent-sees"]')?.textContent).toContain(
      "Always hand in one document.",
    );
  });

  it("says there is nothing yet when the task has had no turn", async () => {
    runsForIssue.mockResolvedValue([]);
    await render(section());
    await click('[data-testid="what-the-agent-sees-toggle"]');
    await settle();
    expect(heartbeatGet).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="what-the-agent-sees-empty"]')).not.toBeNull();
  });
});

describe("latestRunId", () => {
  it("has nothing to pick from before the first turn", () => {
    expect(latestRunId(undefined)).toBeNull();
    expect(latestRunId([])).toBeNull();
  });

  it("picks the most recent turn, whichever order they arrive in", () => {
    expect(
      latestRunId([
        { runId: "a", startedAt: "2026-09-11T10:00:00Z", createdAt: "2026-09-11T10:00:00Z" },
        { runId: "b", startedAt: "2026-09-09T10:00:00Z", createdAt: "2026-09-09T10:00:00Z" },
      ]),
    ).toBe("a");
  });

  it("falls back to when the turn was created if it never started", () => {
    expect(
      latestRunId([
        { runId: "a", startedAt: null, createdAt: "2026-09-09T10:00:00Z" },
        { runId: "b", startedAt: null, createdAt: "2026-09-11T10:00:00Z" },
      ]),
    ).toBe("b");
  });
});

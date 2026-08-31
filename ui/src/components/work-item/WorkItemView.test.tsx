// @vitest-environment jsdom

import type { ReactNode } from "react";
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkItemView, type WorkItemViewProps } from "./WorkItemView";
import {
  AGENT_SUMMARY_LIMIT,
  BOLT_VALUE,
  COMPOSER_PLACEHOLDER,
  WAITING_ON_YOU,
  WORK_ITEM_SECTION_TITLES,
  agentSummaryOverflowLine,
  visibleCopyHasForbiddenWord,
} from "./work-item-model";

vi.mock("@/lib/router", () => ({
  Link: ({ children, to }: { children?: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

let container: HTMLDivElement;
let root: Root;

function fixture(overrides: Partial<WorkItemViewProps> = {}): WorkItemViewProps {
  return {
    identifier: "TESA-1",
    type: "Task",
    title: "Short title",
    body: "Ship the in-app work-item view. The work is the item, not a chat.",
    sections: [
      { title: "Acceptance Criteria", body: "Type stamp, facts rail, activity log." },
      { title: "In Scope", body: "This work-item screen." },
      { title: "Out of Scope", body: "Landing and nav." },
      { title: "Testing Strategies", body: "Targeted UI tests on TESA-1." },
    ],
    checklist: [{ id: "c1", text: "Measure a real task screen", done: false }],
    trail: [{ id: "tesa-1", identifier: "TESA-1", href: "/TESA-1", current: true }],
    status: "new",
    priority: "none",
    assigneeId: null,
    assigneeLabel: null,
    blockedBy: null,
    projectName: "Todero",
    projectCount: 1,
    createdAt: new Date("2026-08-30T12:00:00.000Z"),
    closedAt: null,
    tokenUsage: "—",
    tokenCost: "—",
    activity: [],
    assigneeOptions: [{ id: "agent-ron", label: "Ron" }],
    agentOptions: [{ id: "agent-ron", name: "Ron" }],
    blockerOptions: [{ id: "tesa-12", identifier: "TESA-12" }],
    ...overrides,
  };
}

async function render(props: WorkItemViewProps) {
  await act(async () => {
    root.render(
      <StrictMode>
        <WorkItemView {...props} />
      </StrictMode>,
    );
  });
}

function visibleText(): string {
  return (container.textContent ?? "").replace(/\s+/g, " ");
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("WorkItemView TESA-1", () => {
  it("renders the type stamp, short title, New status, and composer placeholder", async () => {
    await render(fixture());
    expect(container.querySelector('[data-testid="work-item-type-stamp"]')?.textContent).toBe("Task");
    expect(container.querySelector('[data-testid="work-item-title"]')?.textContent).toBe("Short title");
    expect(container.querySelector('[data-testid="work-item-status"]')?.textContent).toBe("New");
    const composer = container.querySelector('[data-testid="work-item-composer-input"]') as HTMLTextAreaElement;
    expect(composer.placeholder).toBe(COMPOSER_PLACEHOLDER);
    expect(composer.placeholder).toBe("Comment, or @ an agent");
  });

  it("puts Coming on the Bolt rail as static copy, not a control", async () => {
    await render(fixture());
    const bolt = container.querySelector('[data-testid="work-item-bolt"]') as HTMLElement;
    expect(bolt?.textContent?.trim()).toBe(BOLT_VALUE);
    expect(bolt?.textContent?.trim()).toBe("Coming");
    expect(bolt?.querySelector("a,button")).toBeNull();
    expect(bolt.tagName).not.toBe("A");
    expect(bolt.tagName).not.toBe("BUTTON");
    expect(bolt.classList.contains("work-item-bolt")).toBe(true);
  });

  it("renders the four section titles exactly and hides empty sections", async () => {
    await render(
      fixture({
        sections: [
          { title: "Acceptance Criteria", body: "Must ship." },
          { title: "Testing Strategies", body: "UI tests." },
        ],
      }),
    );
    const titles = [...container.querySelectorAll("[data-section-title]")].map(
      (node) => node.getAttribute("data-section-title"),
    );
    expect(titles).toEqual(["Acceptance Criteria", "Testing Strategies"]);
    expect(titles).not.toContain("In Scope");
    expect(titles).not.toContain("Out of Scope");
    for (const title of WORK_ITEM_SECTION_TITLES) {
      expect(title).toBe(title.replace(/\b\w/g, (char) => char.toUpperCase()) === title ? title : title);
    }
    expect(WORK_ITEM_SECTION_TITLES).toEqual([
      "Acceptance Criteria",
      "In Scope",
      "Out of Scope",
      "Testing Strategies",
    ]);
  });

  it("omits the checklist when there are zero items and never shows 0%", async () => {
    await render(fixture({ checklist: [] }));
    expect(container.querySelector('[data-testid="work-item-checklist"]')).toBeNull();
    expect(visibleText()).not.toContain("0%");
  });

  it("is not a chat-centered 480px messenger layout", async () => {
    await render(fixture());
    expect(container.querySelector('[data-testid="task-chat-thread"]')).toBeNull();
    expect(container.querySelector('[data-testid="work-item-log"]')).not.toBeNull();
    const html = container.innerHTML;
    expect(html).not.toMatch(/max-w-\( --tc-shell-max-w\)/);
    expect(html).not.toMatch(/480px/);
    expect(html).not.toMatch(/max-w-\[480/);
    const log = container.querySelector('[data-testid="work-item-log"]') as HTMLElement;
    expect(log.className).not.toMatch(/mx-auto/);
  });

  it("does not commit In progress without an assignee", async () => {
    const onStatusChange = vi.fn();
    await render(fixture({ assigneeId: null, onStatusChange }));
    await act(async () => {
      (container.querySelector('[data-testid="work-item-status"]') as HTMLButtonElement).click();
    });
    const inProgress = [...container.querySelectorAll('[role="menuitem"]')].find(
      (node) => node.textContent === "In progress",
    ) as HTMLButtonElement;
    await act(async () => {
      inProgress.click();
    });
    expect(onStatusChange).not.toHaveBeenCalled();
    expect(container.querySelector('[data-testid="work-item-status-caption"]')?.textContent).toBe(
      "Pick an assignee first.",
    );
  });

  it("does not allow Blocked with an empty blocked-by", async () => {
    const onStatusChange = vi.fn();
    await render(fixture({ blockedBy: null, onStatusChange }));
    await act(async () => {
      (container.querySelector('[data-testid="work-item-status"]') as HTMLButtonElement).click();
    });
    const blocked = [...container.querySelectorAll('[role="menuitem"]')].find(
      (node) => node.textContent === "Blocked",
    ) as HTMLButtonElement;
    await act(async () => {
      blocked.click();
    });
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("never invents $0.00 for token cost", async () => {
    await render(fixture({ tokenCost: "—" }));
    const cost = container.querySelector('[data-testid="work-item-token-cost"]');
    expect(cost?.textContent).toContain("—");
    expect(cost?.textContent).not.toContain("$0.00");
    expect(visibleText()).not.toContain("$0.00");
  });

  it("uses the exact overflow system line instead of ellipsizing a long agent summary", async () => {
    const summary = "x".repeat(312);
    await render(
      fixture({
        activity: [{ id: "a1", kind: "agent", name: "Ron", body: summary }],
      }),
    );
    const expected = agentSummaryOverflowLine("Ron", 312);
    expect(expected).toBe("Ron\u2019s summary was 312 characters (limit 140).");
    expect(container.querySelector('[data-testid="work-item-system"]')?.textContent).toBe(expected);
    expect(container.querySelector('[data-testid="work-item-agent-row"]')).toBeNull();
    expect(visibleText()).not.toContain("xxx");
    expect(visibleText()).not.toContain("…");
    expect(visibleText()).not.toContain("...");
    expect(summary.length).toBeGreaterThan(AGENT_SUMMARY_LIMIT);
  });

  it("does not use the words issue or disposition in user-visible copy", async () => {
    await render(fixture());
    const text = visibleText();
    expect(visibleCopyHasForbiddenWord(text)).toBe(false);
    expect(text).not.toMatch(/\bissue\b/i);
    expect(text).not.toMatch(/\bdisposition\b/i);
  });

  it("allows Unassigned on New and shows Waiting on you on the blocked chip", async () => {
    await render(
      fixture({
        status: "blocked",
        blockedBy: { kind: "waiting-on-you" },
        assigneeId: null,
      }),
    );
    expect(container.querySelector('[data-testid="work-item-assignee"]')?.textContent).toBe("Unassigned");
    expect(container.querySelector('[data-testid="work-item-status"]')?.textContent).toBe(
      `Blocked · ${WAITING_ON_YOU}`,
    );
  });

  it("omits the project row when only one project exists", async () => {
    await render(fixture({ projectCount: 1, projectName: "Todero" }));
    const labels = [...container.querySelectorAll(".work-item-fact-label")].map((node) => node.textContent);
    expect(labels).not.toContain("Project");
  });
});

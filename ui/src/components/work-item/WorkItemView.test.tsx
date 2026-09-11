// @vitest-environment jsdom

import type { ReactNode } from "react";
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkItemView, type WorkItemViewProps } from "./WorkItemView";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  AGENT_SUMMARY_LIMIT,
  BOLT_VALUE,
  COMPOSER_PLACEHOLDER,
  EMPTY_ACTIVITY,
  WAITING_ON_YOU,
  WORK_ITEM_SECTION_TITLES,
  visibleCopyHasForbiddenWord,
} from "./work-item-model";

const workItemCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "work-item.css"),
  "utf8",
);

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

  it("does not offer Brief as a type a person can pick", async () => {
    const onTypeChange = vi.fn();
    await render(fixture({ onTypeChange }));
    await act(async () => {
      (container.querySelector('[data-testid="work-item-type-stamp"]') as HTMLButtonElement).click();
    });
    const offered = [...container.querySelectorAll(".work-item-stamp-option")].map(
      (node) => node.textContent,
    );
    expect(offered).toEqual(["Feature", "Story", "Task", "Bug"]);
    expect(offered).not.toContain("Brief");
  });

  it("locks the type on the Brief so it cannot be renamed to a Task", async () => {
    const onTypeChange = vi.fn();
    await render(fixture({ type: "Brief", typeEditable: false, onTypeChange }));
    const stamp = container.querySelector('[data-testid="work-item-type-stamp"]') as HTMLButtonElement;
    expect(stamp.textContent).toBe("Brief");
    expect(stamp.disabled).toBe(true);
    await act(async () => {
      stamp.click();
    });
    expect(container.querySelector(".work-item-stamp-menu")).toBeNull();
    expect(onTypeChange).not.toHaveBeenCalled();
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

  it("renders a long agent reply in full instead of hiding it behind a summary line", async () => {
    const reply = "x".repeat(312);
    await render(
      fixture({
        activity: [{ id: "a1", kind: "agent", name: "Ron", time: "2m ago", body: reply }],
      }),
    );
    const row = container.querySelector('[data-testid="work-item-agent-row"]');
    expect(row?.textContent).toContain("Ron");
    expect(row?.textContent).toContain(reply);
    expect(visibleText()).not.toContain("summary was");
    expect(visibleText()).not.toContain("…");
    expect(reply.length).toBeGreaterThan(AGENT_SUMMARY_LIMIT);
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

  it("hides Blocked by unless status is Blocked", async () => {
    for (const status of ["new", "todo", "in_progress", "done", "cancelled"] as const) {
      await render(fixture({ status, blockedBy: { kind: "item", id: "tesa-12", identifier: "TESA-12" } }));
      expect(container.querySelector('[data-testid="work-item-blocked-by"]')).toBeNull();
      expect(visibleText()).not.toContain("Blocked by");
    }
    await render(
      fixture({
        status: "blocked",
        blockedBy: { kind: "item", id: "tesa-12", identifier: "TESA-12" },
      }),
    );
    expect(container.querySelector('[data-testid="work-item-blocked-by"]')?.textContent).toContain("TESA-12");
    expect(visibleText()).toContain("Blocked by");
    await render(
      fixture({
        status: "blocked",
        blockedBy: { kind: "waiting-on-you" },
      }),
    );
    expect(container.querySelector('[data-testid="work-item-blocked-by"]')?.textContent).toContain(WAITING_ON_YOU);
  });

  it("renders empty activity as a left-aligned caption, not a centered well", async () => {
    await render(fixture({ activity: [] }));
    const empty = container.querySelector(".work-item-activity-empty") as HTMLElement;
    expect(empty?.textContent).toBe(EMPTY_ACTIVITY);
    expect(empty?.textContent).toBe("No activity yet.");
    const inline = empty.getAttribute("style") ?? "";
    expect(inline).not.toMatch(/text-align\s*:\s*center/i);
    expect(inline).not.toMatch(/margin\s*:\s*[^;]*auto/i);
    expect(empty.className).not.toMatch(/mx-auto|ml-auto|mr-auto|text-center|m-auto/);
    const emptyRule = workItemCss.match(/\.work-item-activity-empty\s*\{[^}]+\}/)?.[0] ?? "";
    expect(emptyRule).toMatch(/text-align:\s*left/);
    expect(emptyRule).not.toMatch(/text-align:\s*center/);
    expect(emptyRule).not.toMatch(/margin(?:-left|-right)?\s*:\s*auto/);
    expect(emptyRule).not.toMatch(/margin:\s*[^;}]*auto/);
  });

  it("uses muted color for the New status chip, not fg", async () => {
    await render(fixture({ status: "new" }));
    const chip = container.querySelector('[data-testid="work-item-status"]') as HTMLElement;
    expect(chip?.textContent).toBe("New");
    expect(chip.classList.contains("work-item-status-muted")).toBe(true);
    expect(chip.classList.contains("work-item-status-progress")).toBe(false);
    const inline = chip.getAttribute("style") ?? "";
    expect(inline).not.toMatch(/color\s*:\s*var\(--wi-fg\)/);
    const mutedRule = workItemCss.match(/\.work-item-status-muted\s*\{[^}]+\}/)?.[0] ?? "";
    expect(mutedRule).toMatch(/color:\s*var\(--wi-muted\)/);
    expect(mutedRule).not.toMatch(/color:\s*var\(--wi-fg\)/);
    expect(mutedRule).not.toMatch(/background:\s*var\(--wi-(?:fg|mark|alert)\)/);
    const statusRule = workItemCss.match(/\.work-item-status\s*\{[^}]+\}/)?.[0] ?? "";
    expect(statusRule).toMatch(/color:\s*var\(--wi-muted\)/);
    expect(statusRule).not.toMatch(/color:\s*var\(--wi-fg\)/);
  });

});

describe("proposed plan card and tasks", () => {
  const plan = {
    goal: "Seat Tampa neighbors at weekend dinners with strangers.",
    features: [
      { id: "f1", name: "Sign up", why: "Accounts", doneWhen: "a phone code works" },
      { id: "f2", name: "Pick a dinner", why: "The product", doneWhen: "one dinner can be picked" },
    ],
    tasks: [
      { id: "t1", title: "Write the sign-up spec", feature: "Sign up", output: "A spec" },
      { id: "t2", title: "List ten restaurants", feature: "Pick a dinner", output: "A table" },
      { id: "t3", title: "Draft the matching rules", feature: "Pick a dinner", output: "A document" },
    ],
  };

  it("shows the plan as ticked tasks and approves only what stays ticked", async () => {
    const onPlanApprove = vi.fn();
    await render(fixture({ status: "blocked", blockedBy: { kind: "waiting-on-you" }, plan, planApprovable: true, onPlanApprove }));
    const card = container.querySelector('[data-testid="work-item-plan-card"]');
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain("Seat Tampa neighbors");
    expect(card!.textContent).toContain("done when a phone code works");
    const checks = [...container.querySelectorAll<HTMLInputElement>('[data-testid="work-item-plan-task-check"]')];
    expect(checks).toHaveLength(3);
    expect(checks.every((c) => c.checked)).toBe(true);
    expect(container.querySelector('[data-testid="work-item-plan-approve"]')!.textContent).toBe("Approve 3 of 3");

    await act(async () => {
      checks[1]!.click();
    });
    expect(container.querySelector('[data-testid="work-item-plan-approve"]')!.textContent).toBe("Approve 2 of 3");
    await act(async () => {
      (container.querySelector('[data-testid="work-item-plan-approve"]') as HTMLButtonElement).click();
    });
    expect(onPlanApprove).toHaveBeenCalledWith(["t1", "t3"]);
  });

  it("cannot approve an empty plan and hides the card once it is not approvable", async () => {
    await render(fixture({ plan, planApprovable: true }));
    const checks = [...container.querySelectorAll<HTMLInputElement>('[data-testid="work-item-plan-task-check"]')];
    await act(async () => {
      for (const check of checks) check.click();
    });
    expect((container.querySelector('[data-testid="work-item-plan-approve"]') as HTMLButtonElement).disabled).toBe(true);

    await render(fixture({ plan, planApprovable: false }));
    expect(container.querySelector('[data-testid="work-item-plan-card"]')).toBeNull();
    expect(container.querySelector('[data-testid="work-item-plan-fact"]')?.textContent).toContain("2 features · 3 tasks");
  });

  it("lists the tasks created from the plan with their status", async () => {
    await render(
      fixture({
        tasks: [
          { id: "a", identifier: "ZZW-2", title: "Write the sign-up spec", status: "done", href: "/ZZW/issues/ZZW-2" },
          { id: "b", identifier: "ZZW-3", title: "List ten restaurants", status: "in_progress", href: "/ZZW/issues/ZZW-3" },
          { id: "c", identifier: "ZZW-4", title: "Draft the matching rules", status: "new", href: "/ZZW/issues/ZZW-4" },
        ],
      }),
    );
    const rows = [...container.querySelectorAll('[data-testid="work-item-task-row"]')];
    expect(rows).toHaveLength(3);
    expect(rows[0]!.textContent).toContain("ZZW-2");
    expect(rows[0]!.textContent).toContain("Done");
    expect(rows[1]!.textContent).toContain("In progress");
    expect(rows[2]!.querySelector("a")?.getAttribute("href")).toBe("/ZZW/issues/ZZW-4");
  });
});

describe("handed-in output, queued tasks, and blocker counts", () => {
  it("shows Accept and Send back when the agent handed in its output", async () => {
    const onAccept = vi.fn();
    const onSendBack = vi.fn();
    await render(fixture({ status: "blocked", blockedBy: { kind: "waiting-on-you" }, reviewPending: true, onAccept, onSendBack }));
    const card = container.querySelector('[data-testid="work-item-review-card"]');
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain("Handed in");

    await act(async () => {
      (container.querySelector('[data-testid="work-item-accept"]') as HTMLButtonElement).click();
    });
    expect(onAccept).toHaveBeenCalledTimes(1);

    await act(async () => {
      (container.querySelector('[data-testid="work-item-sendback"]') as HTMLButtonElement).click();
    });
    const note = container.querySelector('[data-testid="work-item-sendback-note"]') as HTMLTextAreaElement;
    expect(note).not.toBeNull();
    const confirm = container.querySelector('[data-testid="work-item-sendback-confirm"]') as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")!.set!;
      setter.call(note, "Shorter, please.");
      note.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      (container.querySelector('[data-testid="work-item-sendback-confirm"]') as HTMLButtonElement).click();
    });
    expect(onSendBack).toHaveBeenCalledWith("Shorter, please.");
  });

  it("labels queued tasks Queued and counts blockers on the chip", async () => {
    await render(
      fixture({
        status: "blocked",
        blockedBy: { kind: "item", id: "x", identifier: "ZZW-2" },
        blockerCount: 3,
        tasks: [
          { id: "a", identifier: "ZZW-2", title: "First", status: "todo", queued: false, href: "/ZZW/issues/ZZW-2" },
          { id: "b", identifier: "ZZW-3", title: "Second", status: "todo", queued: true, href: "/ZZW/issues/ZZW-3" },
          { id: "c", identifier: "ZZW-4", title: "Third", status: "done", queued: true, href: "/ZZW/issues/ZZW-4" },
        ],
      }),
    );
    const rows = [...container.querySelectorAll('[data-testid="work-item-task-row"]')];
    expect(rows[0]!.textContent).toContain("To do");
    expect(rows[1]!.textContent).toContain("Queued");
    expect(rows[2]!.textContent).toContain("Done");
    expect(visibleText()).toContain("Blocked · 3 tasks");
  });

  it("labels the goal and prefills the composer when asking for changes", async () => {
    const plan = { goal: "Seat neighbors.", features: [], tasks: [{ id: "t1", title: "One", feature: "", output: "" }] };
    await render(fixture({ plan, planApprovable: true }));
    expect(container.querySelector(".work-item-plan-goal")!.textContent).toContain("Goal");
    await act(async () => {
      (container.querySelector('[data-testid="work-item-plan-changes"]') as HTMLButtonElement).click();
    });
    const composer = container.querySelector('[data-testid="work-item-composer-input"]') as HTMLTextAreaElement;
    expect(composer.value).toBe("Please change the plan: ");
  });

  it("says the agent is writing while a run is live", async () => {
    await render(fixture({ agentWorking: true, assigneeLabel: "Nova" }));
    expect(container.querySelector('[data-testid="work-item-working"]')!.textContent).toContain("Nova is writing a reply");
  });
});

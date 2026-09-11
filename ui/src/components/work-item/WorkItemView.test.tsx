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
    assigneeId: null,
    assigneeLabel: null,
    blockedBy: null,
    activity: [],
    agentOptions: [{ id: "agent-ron", name: "Ron" }],
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

  it("keeps the chip to the status word and leaves the reason to the turn bar", async () => {
    await render(
      fixture({
        status: "blocked",
        blockedBy: { kind: "waiting-on-you" },
        assigneeId: null,
        assigneeLabel: null,
      }),
    );
    expect(container.querySelector('[data-testid="work-item-status"]')?.textContent).toBe("Blocked");
    expect(
      container.querySelector('[data-testid="work-item-turn-sentence"]')?.textContent,
    ).toBe("Your turn: answer the agent");
    // The chip and the bar each say it once; neither repeats the other.
    expect(visibleText()).not.toContain(`Blocked · ${WAITING_ON_YOU}`);
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
      { id: "t1", title: "Write the sign-up spec", feature: "Sign up", output: "A spec", after: "" },
      { id: "t2", title: "List ten restaurants", feature: "Pick a dinner", output: "A table", after: "" },
      {
        id: "t3",
        title: "Draft the matching rules",
        feature: "Pick a dinner",
        output: "A document",
        after: "List ten restaurants",
      },
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
        assigneeId: "agent-nova",
        assigneeLabel: "Nova",
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
    // The chip computes Queued the same way a task row does; the bar carries
    // which task it is queued behind, and how many others.
    expect(container.querySelector('[data-testid="work-item-status"]')?.textContent).toBe("Queued");
    expect(
      container.querySelector('[data-testid="work-item-turn-sentence"]')?.textContent,
    ).toBe("Queued behind ZZW-2 and 2 more, then Nova picks it up");
  });

  it("labels the goal and prefills the composer when asking for changes", async () => {
    const plan = { goal: "Seat neighbors.", features: [], tasks: [{ id: "t1", title: "One", feature: "", output: "", after: "" }] };
    await render(fixture({ plan, planApprovable: true }));
    expect(container.querySelector(".work-item-plan-goal")!.textContent).toContain("Goal");
    await act(async () => {
      (container.querySelector('[data-testid="work-item-plan-changes"]') as HTMLButtonElement).click();
    });
    const composer = container.querySelector('[data-testid="work-item-composer-input"]') as HTMLTextAreaElement;
    expect(composer.value).toBe("Please change the plan: ");
  });

  it("says the agent is writing once, in the turn bar, and does not repeat it", async () => {
    await render(fixture({ agentWorking: true, assigneeId: "agent-nova", assigneeLabel: "Nova" }));
    expect(
      container.querySelector('[data-testid="work-item-turn-sentence"]')?.textContent,
    ).toBe("Nova is writing");
    // The line above the composer keeps only what the bar does not say.
    const notice = container.querySelector('[data-testid="work-item-working"]')!.textContent ?? "";
    expect(notice).toContain("can take a minute while the model loads");
    expect(notice).not.toContain("Nova");
  });
});

describe("the Brief block", () => {
  const briefBody = [
    "Goal: Open a coffee shop on Mission Street",
    "",
    "What the person said when we planned this (use it; do not ask for it again):",
    "- Keep the budget under forty thousand.",
    "",
    "Feature: Storefront",
    "Done when: the lease is signed",
    "Hand in: a one-page summary",
    "",
    "Do this task now, in this reply: write out the output described above in full. Nobody is waiting to give you more information. End with `STATUS: done` when the output is complete.",
  ].join("\n");

  it("reads a plan-made brief as labelled lines", async () => {
    await render(fixture({ body: briefBody }));
    const labels = [...container.querySelectorAll("[data-brief-label]")].map((node) =>
      node.getAttribute("data-brief-label"),
    );
    expect(labels).toEqual(["Goal", "Feature", "Done when", "Hand in", "What you said"]);
    expect(visibleText()).toContain("Open a coffee shop on Mission Street");
    expect(visibleText()).toContain("Keep the budget under forty thousand.");
  });

  it("keeps the standing instruction out of the body", async () => {
    await render(fixture({ body: briefBody }));
    const text = visibleText();
    expect(text).not.toContain("STATUS: done");
    expect(text).not.toContain("Do this task now");
    // The instruction told the reader nobody was waiting for them; the turn bar
    // is the only thing on the card that says whose turn it is.
    expect(text).not.toContain("Nobody is waiting");
  });

  it("still opens the brief as it was written when the person edits it", async () => {
    await render(fixture({ body: briefBody, bodyEditable: true }));
    await act(async () => {
      (container.querySelector('[data-testid="work-item-brief-block"]') as HTMLElement).click();
    });
    const editor = container.querySelector('[data-testid="work-item-body-editor"]') as HTMLTextAreaElement;
    expect(editor.value).toBe(briefBody);
  });

  it("leaves a body a person typed exactly as it is", async () => {
    await render(fixture({ body: "Fix the header on the pricing page." }));
    expect(container.querySelector('[data-testid="work-item-brief-block"]')).toBeNull();
    expect(container.querySelector('[data-testid="work-item-body"]')?.textContent).toContain(
      "Fix the header on the pricing page.",
    );
  });
});

describe("the turn bar", () => {
  it("says whose turn it is and offers the buttons for that turn", async () => {
    const onAccept = vi.fn();
    await render(fixture({ status: "in_progress", reviewPending: true, onAccept }));
    const bar = container.querySelector('[data-testid="work-item-turn-bar"]')!;
    expect(bar.getAttribute("data-tone")).toBe("action");
    expect(
      container.querySelector('[data-testid="work-item-turn-sentence"]')?.textContent,
    ).toBe("Your turn: accept or send back");
    const labels = [...bar.querySelectorAll('[data-testid="work-item-turn-action"]')].map(
      (node) => node.textContent,
    );
    expect(labels).toEqual(["Accept", "Send back"]);
    await act(async () => {
      (bar.querySelector('[data-action="accept"]') as HTMLButtonElement).click();
    });
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("announces the sentence, and announces it again when the turn changes", async () => {
    await render(
      fixture({
        status: "in_progress",
        assigneeId: "agent-nova",
        assigneeLabel: "Nova",
        agentWorking: true,
      }),
    );
    const sentence = () => container.querySelector('[data-testid="work-item-turn-sentence"]')!;
    expect(sentence().getAttribute("role")).toBe("status");
    expect(sentence().getAttribute("aria-live")).toBe("polite");
    expect(sentence().getAttribute("aria-atomic")).toBe("true");
    expect(sentence().textContent).toBe("Nova is writing");

    // The moment it becomes the person's turn. The same live region carries the
    // new sentence, so assistive tech hears it without the page moving.
    await render(
      fixture({
        status: "in_progress",
        assigneeId: "agent-nova",
        assigneeLabel: "Nova",
        reviewPending: true,
      }),
    );
    expect(sentence().getAttribute("aria-live")).toBe("polite");
    expect(sentence().textContent).toBe("Your turn: accept or send back");
  });

  it("hints the keyboard on the buttons that have one, and does not on the rest", async () => {
    await render(fixture({ status: "in_progress", reviewPending: true }));
    const bar = container.querySelector('[data-testid="work-item-turn-bar"]')!;
    expect(bar.querySelector('[data-action="accept"]')?.getAttribute("title")).toBe("Accept (A)");
    await render(fixture({ status: "done" }));
    await render(
      fixture({
        status: "todo",
        assigneeId: "agent-nova",
        assigneeLabel: "Nova",
        timerEnabled: false,
        onStartNow: vi.fn(),
      }),
    );
    const start = container.querySelector('[data-action="start-now"]')!;
    expect(start.getAttribute("title")).toBe("Start now");
  });

  it("offers Start now only when this screen can start the work", async () => {
    const shared = {
      status: "todo",
      assigneeId: "agent-nova",
      assigneeLabel: "Nova",
      timerEnabled: false,
    } as const;
    await render(fixture(shared));
    expect(container.querySelector('[data-action="start-now"]')).toBeNull();
    expect(
      container.querySelector('[data-testid="work-item-turn-sentence"]')?.textContent,
    ).toBe("Nova’s timer is off; nothing will pick this up on its own");

    const onStartNow = vi.fn();
    await render(fixture({ ...shared, onStartNow }));
    await act(async () => {
      (container.querySelector('[data-action="start-now"]') as HTMLButtonElement).click();
    });
    expect(onStartNow).toHaveBeenCalledTimes(1);
  });

  it("offers Play on paused work only when it can resume, and not while resuming", async () => {
    await render(fixture({ paused: true }));
    expect(
      container.querySelector('[data-testid="work-item-turn-sentence"]')?.textContent,
    ).toBe("Paused");
    expect(container.querySelector('[data-action="play"]')).toBeNull();

    const onResume = vi.fn();
    await render(fixture({ paused: true, onResume, resumePending: true }));
    expect(container.querySelector('[data-action="play"]')).toBeNull();

    await render(fixture({ paused: true, onResume }));
    await act(async () => {
      (container.querySelector('[data-action="play"]') as HTMLButtonElement).click();
    });
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it("counts the ticked plan tasks the same way in the bar and on the plan card", async () => {
    const onPlanApprove = vi.fn();
    await render(
      fixture({
        status: "in_progress",
        planPending: true,
        planApprovable: true,
        onPlanApprove,
        plan: {
          goal: "Ship it",
          features: [],
          tasks: [
            { id: "t1", title: "One" },
            { id: "t2", title: "Two" },
            { id: "t3", title: "Three" },
          ],
        } as unknown as WorkItemViewProps["plan"],
      }),
    );
    expect(container.querySelector('[data-action="approve"]')?.textContent).toBe("Approve 3 of 3");
    expect(container.querySelector('[data-testid="work-item-plan-approve"]')?.textContent).toBe(
      "Approve 3 of 3",
    );

    await act(async () => {
      (container.querySelector('[data-task-id="t2"]') as HTMLInputElement).click();
    });
    expect(container.querySelector('[data-action="approve"]')?.textContent).toBe("Approve 2 of 3");
    expect(container.querySelector('[data-testid="work-item-plan-approve"]')?.textContent).toBe(
      "Approve 2 of 3",
    );

    await act(async () => {
      (container.querySelector('[data-action="approve"]') as HTMLButtonElement).click();
    });
    expect(onPlanApprove).toHaveBeenCalledWith(["t1", "t3"]);
  });

  it("asks for plan changes the way the plan card does, not by opening send back", async () => {
    const onPlanChanges = vi.fn();
    await render(
      fixture({
        status: "in_progress",
        planPending: true,
        planApprovable: true,
        onPlanChanges,
        plan: {
          goal: "Ship it",
          features: [],
          tasks: [{ id: "t1", title: "One" }],
        } as unknown as WorkItemViewProps["plan"],
      }),
    );
    expect(container.querySelector('[data-action="send-back"]')?.textContent).toBe(
      "Ask for changes",
    );
    await act(async () => {
      (container.querySelector('[data-action="send-back"]') as HTMLButtonElement).click();
    });
    expect(onPlanChanges).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="work-item-sendback-note"]')).toBeNull();
    expect(
      (container.querySelector('[data-testid="work-item-composer-input"]') as HTMLTextAreaElement).value,
    ).toBe("Please change the plan: ");
  });

  it("takes A and S while a hand-in is waiting, and leaves them alone while typing", async () => {
    const onAccept = vi.fn();
    await render(
      fixture({ status: "blocked", blockedBy: null, reviewPending: true, onAccept }),
    );

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    });
    expect(onAccept).toHaveBeenCalledTimes(1);

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", bubbles: true }));
    });
    expect(container.querySelector('[data-testid="work-item-sendback-note"]')).not.toBeNull();

    // Select-all in the composer must never read as Accept.
    onAccept.mockClear();
    const composer = container.querySelector('[data-testid="work-item-composer-input"]') as HTMLTextAreaElement;
    composer.focus();
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "a", ctrlKey: true, bubbles: true }));
    });
    expect(onAccept).not.toHaveBeenCalled();
  });

  it("says a parent is waiting on the tasks its plan made", async () => {
    await render(
      fixture({
        status: "in_progress",
        assigneeId: "agent-nova",
        assigneeLabel: "Nova",
        tasks: [
          { id: "a", identifier: "ZZW-2", title: "First", status: "done", href: "/ZZW/issues/ZZW-2" },
          { id: "b", identifier: "ZZW-3", title: "Second", status: "todo", href: "/ZZW/issues/ZZW-3" },
          { id: "c", identifier: "ZZW-4", title: "Third", status: "todo", href: "/ZZW/issues/ZZW-4" },
        ],
      }),
    );
    expect(
      container.querySelector('[data-testid="work-item-turn-sentence"]')?.textContent,
    ).toBe("Waiting on ZZW-3 and 1 more");
  });

  it("says when the agent picks an unblocked To do task up by itself", async () => {
    await render(
      fixture({ status: "todo", assigneeId: "agent-nova", assigneeLabel: "Nova", timerIntervalSec: 120 }),
    );
    const bar = container.querySelector('[data-testid="work-item-turn-bar"]')!;
    expect(bar.getAttribute("data-tone")).toBe("waiting");
    expect(
      container.querySelector('[data-testid="work-item-turn-sentence"]')?.textContent,
    ).toBe("Nova picks this up within 2 minutes");
    expect(bar.querySelectorAll('[data-testid="work-item-turn-action"]').length).toBe(0);
  });

  it("says Done on a finished task and offers nothing", async () => {
    await render(fixture({ status: "done" }));
    const bar = container.querySelector('[data-testid="work-item-turn-bar"]')!;
    expect(bar.getAttribute("data-tone")).toBe("done");
    expect(
      container.querySelector('[data-testid="work-item-turn-sentence"]')?.textContent,
    ).toBe("Done");
    expect(bar.querySelectorAll('[data-testid="work-item-turn-action"]').length).toBe(0);
  });
});

describe("the next-project card", () => {
  it("offers Start a project only once the task is done and a Next suggestion exists", async () => {
    await render(fixture({ status: "in_progress", nextProjectSuggestion: "a billing dashboard" }));
    expect(container.querySelector('[data-testid="work-item-next-card"]')).toBeNull();

    const onStartProject = vi.fn();
    await render(fixture({ status: "done", nextProjectSuggestion: "a billing dashboard", onStartProject }));
    const card = container.querySelector('[data-testid="work-item-next-card"]');
    expect(card).not.toBeNull();
    expect(card!.textContent).toContain("a billing dashboard");
    await act(async () => {
      (container.querySelector('[data-testid="work-item-next-start"]') as HTMLButtonElement).click();
    });
    expect(onStartProject).toHaveBeenCalledWith("a billing dashboard");
  });
});

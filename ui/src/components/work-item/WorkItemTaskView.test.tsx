// @vitest-environment jsdom

/**
 * Steps 3-10 of the task view, through the screen rather than through the pure
 * functions: which tab opens, what the conversation shows where a hand-in was,
 * whose voice the verdict card is in, and which chips the composer offers.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReactNode } from "react";
import { StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentRevision, IssueDocument } from "@todero/shared";
import { WorkItemView, type WorkItemViewProps } from "./WorkItemView";
import { visibleCopyHasForbiddenWord } from "./work-item-model";

vi.mock("@/lib/router", () => ({
  Link: ({ children, to }: { children?: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));

const PASS = "I reviewed this and it does what the task asked. It is ready for you to accept.";
const FAIL = "I reviewed this and it is not finished yet. Sending it back with what to change.";

const outputDocument = {
  body: "# The menu\n\nSix courses.",
  title: "Output",
  latestRevisionNumber: 2,
  updatedAt: new Date("2026-09-11T10:42:00Z"),
} as unknown as IssueDocument;

const revisions = [
  { id: "r1", revisionNumber: 1, body: "First pass.", createdAt: new Date("2026-09-10T09:00:00Z") },
  { id: "r2", revisionNumber: 2, body: "# The menu\n\nSix courses.", createdAt: new Date("2026-09-11T10:42:00Z") },
] as unknown as DocumentRevision[];

const plan = {
  goal: "A six course tasting menu.",
  features: [{ id: "f1", name: "The menu", why: "It is the point.", doneWhen: "Six courses are written." }],
  tasks: [
    { id: "p1", title: "Write the tasting menu", feature: "The menu", output: "A menu.", after: "" },
    { id: "p2", title: "Pick the wine", feature: "The menu", output: "A pairing.", after: "" },
  ],
};

let container: HTMLDivElement;
let root: Root;

function fixture(overrides: Partial<WorkItemViewProps> = {}): WorkItemViewProps {
  return {
    identifier: "TAM-3",
    type: "Task",
    title: "Write the tasting menu",
    body: "Goal: a six course menu.",
    sections: [],
    checklist: [],
    trail: [{ id: "tam-3", identifier: "TAM-3", href: "/TAM-3", current: true }],
    status: "blocked",
    assigneeId: "agent-nova",
    assigneeLabel: "Nova",
    blockedBy: null,
    activity: [],
    agentOptions: [{ id: "agent-nova", name: "Nova" }],
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

async function click(selector: string) {
  const element = container.querySelector(selector) as HTMLElement | null;
  if (!element) throw new Error(`no ${selector}`);
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

function text(): string {
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

describe("step 3 — work apart from talk", () => {
  it("shows no tab strip while the conversation is all there is", async () => {
    await render(fixture({ status: "in_progress" }));
    expect(container.querySelector('[data-testid="work-item-tab-deliverable"]')).toBeNull();
    expect(container.querySelector('[data-testid="work-item-tabs"]')?.getAttribute("data-tab-count")).toBe("1");
  });

  it("opens the Deliverable tab once work is handed in", async () => {
    await render(fixture({ reviewPending: true, outputDocument, outputDocumentRevisions: revisions }));
    expect(
      container.querySelector('[data-testid="work-item-tab-deliverable"]')?.getAttribute("aria-selected"),
    ).toBe("true");
    expect(container.querySelector('[data-testid="work-item-deliverable-body"]')?.textContent).toContain("Six courses");
  });

  it("keeps opening on the output once the work has been accepted", async () => {
    await render(
      fixture({
        status: "done",
        reviewPending: false,
        outputDocument,
        outputDocumentRevisions: revisions,
      }),
    );
    expect(
      container.querySelector('[data-testid="work-item-tab-deliverable"]')?.getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("shows the plan's tasks with the status each one is at", async () => {
    await render(
      fixture({
        status: "in_progress",
        plan,
        tasks: [
          {
            id: "child-1",
            identifier: "TAM-4",
            title: "Write the tasting menu",
            status: "done",
            href: "/TAM-4",
          },
          {
            id: "child-2",
            identifier: "TAM-5",
            title: "Pick the wine",
            status: "todo",
            queued: true,
            href: "/TAM-5",
          },
        ],
      }),
    );
    await click('[data-testid="work-item-tab-plan"]');
    const statuses = [...container.querySelectorAll('[data-testid="work-item-plan-task-status"]')].map(
      (row) => row.textContent,
    );
    expect(statuses).toEqual(["Done", "Queued"]);
  });

  it("says nothing about status on a plan that has made no tasks yet", async () => {
    await render(fixture({ status: "todo", plan, planPending: true, planApprovable: true }));
    expect(container.querySelector('[data-testid="work-item-plan-task-status"]')).toBeNull();
  });

  it("moves between tabs with the arrow keys", async () => {
    await render(fixture({ reviewPending: true, outputDocument, outputDocumentRevisions: revisions }));
    const strip = container.querySelector('[role="tablist"]') as HTMLElement;
    await act(async () => {
      strip.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(
      container.querySelector('[data-testid="work-item-tab-conversation"]')?.getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("ties each tab to the panel it opens", async () => {
    await render(fixture({ reviewPending: true, outputDocument, outputDocumentRevisions: revisions }));
    const current = container.querySelector('[data-testid="work-item-tab-deliverable"]') as HTMLElement;
    const panel = container.querySelector('[role="tabpanel"]') as HTMLElement;
    expect(current.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("aria-labelledby")).toBe(current.id);
    expect(current.getAttribute("tabindex")).toBe("0");
    expect(
      container.querySelector('[data-testid="work-item-tab-conversation"]')?.getAttribute("tabindex"),
    ).toBe("-1");
  });

  it("opens the conversation while the work is still being done", async () => {
    await render(fixture({ status: "in_progress", outputDocument, outputDocumentRevisions: revisions }));
    expect(
      container.querySelector('[data-testid="work-item-tab-conversation"]')?.getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("names the version and when it was handed in", async () => {
    await render(fixture({ reviewPending: true, outputDocument, outputDocumentRevisions: revisions }));
    const picker = container.querySelector('[data-testid="work-item-deliverable-versions"]') as HTMLSelectElement;
    expect(picker.options[0].textContent).toContain("Version 2 · handed in ");
  });

  it("leaves the one-line hand-in card where the reply was, and it opens the tab", async () => {
    await render(
      fixture({
        reviewPending: true,
        outputDocument,
        outputDocumentRevisions: revisions,
        activity: [{ id: "c1", kind: "agent", name: "Nova", body: "# The menu\n\nSix courses." }],
      }),
    );
    await click('[data-testid="work-item-tab-conversation"]');
    expect(container.querySelector('[data-testid="work-item-handed-in-card"]')?.textContent).toContain(
      "Handed in version 2",
    );
    await click('[data-testid="work-item-handed-in-open"]');
    expect(
      container.querySelector('[data-testid="work-item-tab-deliverable"]')?.getAttribute("aria-selected"),
    ).toBe("true");
  });
});

describe("step 4 — formatted replies", () => {
  it("renders a reply as formatted text, not as a wall of markdown", async () => {
    await render(
      fixture({
        status: "in_progress",
        activity: [{ id: "c1", kind: "agent", name: "Nova", body: "## Courses\n\n- One\n- Two" }],
      }),
    );
    expect(container.querySelector(".work-item-reply-text h2")?.textContent).toBe("Courses");
    expect(container.querySelectorAll(".work-item-reply-text li")).toHaveLength(2);
  });

  it("folds a long reply and opens it on Show all", async () => {
    const long = Array.from({ length: 40 }, (_, index) => `Line ${index}`).join("\n\n");
    await render(
      fixture({ status: "in_progress", activity: [{ id: "c1", kind: "agent", name: "Nova", body: long }] }),
    );
    expect(container.querySelector('[data-work-item-reply-folded="true"]')).not.toBeNull();
    await click('[data-testid="work-item-reply-expand"]');
    expect(container.querySelector('[data-work-item-reply-folded="true"]')).toBeNull();
  });

  it("still marks an @mention inside what a person wrote", async () => {
    await render(
      fixture({
        status: "in_progress",
        activity: [{ id: "c1", kind: "human", name: "You", body: "ask @Nova about the wine" }],
      }),
    );
    expect(container.querySelector(".work-item-mention")?.textContent).toBe("@Nova");
  });
});

describe("step 5 — mute the machinery", () => {
  it("collapses a run of system lines into one line that opens", async () => {
    await render(
      fixture({
        status: "in_progress",
        activity: [
          { id: "s1", kind: "system", text: "Moved to To do" },
          { id: "s2", kind: "system", text: "Given to Nova" },
          { id: "s3", kind: "system", text: "Moved to In progress" },
        ],
      }),
    );
    expect(container.querySelector('[data-testid="work-item-cluster-toggle"]')?.textContent).toBe("3 changes · show");
    expect(container.querySelector('[data-testid="work-item-cluster-items"]')).toBeNull();
    await click('[data-testid="work-item-cluster-toggle"]');
    expect(container.querySelectorAll('[data-testid="work-item-system"]')).toHaveLength(3);
  });

  it("keeps a recovery notice's warning tone inside the cluster", async () => {
    await render(
      fixture({
        status: "in_progress",
        activity: [
          { id: "s1", kind: "system", text: "Moved to To do" },
          { id: "s2", kind: "system", text: "Recovery: it came back blocked", tone: "warning" },
          { id: "s3", kind: "system", text: "Given to Nova" },
        ],
      }),
    );
    await click('[data-testid="work-item-cluster-toggle"]');
    const lines = [...container.querySelectorAll('[data-testid="work-item-system"]')];
    expect(lines.map((line) => line.getAttribute("data-tone"))).toEqual(["plain", "warning", "plain"]);
    expect(lines[1]?.className).toContain("work-item-system-warning");
  });

  it("leaves a single system line as itself", async () => {
    await render(
      fixture({ status: "in_progress", activity: [{ id: "s1", kind: "system", text: "Moved to To do" }] }),
    );
    expect(container.querySelector('[data-testid="work-item-cluster-toggle"]')).toBeNull();
    expect(container.querySelector('[data-testid="work-item-system"]')?.textContent).toBe("Moved to To do");
  });
});

describe("step 6 — the chain of why", () => {
  it("shows Mission › Feature › Task", async () => {
    await render(
      fixture({
        chain: [
          { id: "mission", label: "Mission", href: "/goals" },
          { id: "g1", label: "Sign up screen", href: "/goals/g1" },
          { id: "task", label: "Write the tasting menu" },
        ],
      }),
    );
    const chain = container.querySelector('[data-testid="work-item-chain"]');
    expect(chain?.textContent).toContain("Mission");
    expect(chain?.textContent).toContain("Sign up screen");
    expect(chain?.querySelectorAll("a")).toHaveLength(2);
  });

  it("is hidden when the task hangs off no feature", async () => {
    await render(fixture({ chain: [] }));
    expect(container.querySelector('[data-testid="work-item-chain"]')).toBeNull();
  });
});

describe("step 7 — the reviewer's voice", () => {
  it("gives the reviewer its own card, not a reply", async () => {
    await render(
      fixture({
        status: "in_progress",
        activity: [{ id: "c1", kind: "agent", name: "Nova's reviewer", body: `${PASS}\n\nEvery course is there.` }],
      }),
    );
    const card = container.querySelector('[data-testid="work-item-verdict-card"]');
    expect(card?.getAttribute("data-verdict")).toBe("pass");
    expect(card?.textContent).toContain("Reviewed by Nova's reviewer · Pass");
    expect(container.querySelector('[data-testid="work-item-agent-row"]')).toBeNull();
  });

  it("shows the round and the note the worker was given on a send back", async () => {
    await render(
      fixture({
        status: "in_progress",
        reviewRound: 2,
        guidance: "Add the wine pairing.",
        activity: [{ id: "c1", kind: "agent", name: "Nova's reviewer", body: `${FAIL}\n\nThe wine is missing.` }],
      }),
    );
    expect(container.querySelector('[data-testid="work-item-verdict-round"]')?.textContent).toBe("2 of 2");
    expect(container.querySelector('[data-testid="work-item-verdict-note"]')?.textContent).toContain("wine is missing");
    expect(container.querySelector('[data-testid="work-item-verdict-guidance"]')?.textContent).toContain(
      "Add the wine pairing.",
    );
    expect(container.querySelector('[data-testid="work-item-verdict-final"]')).not.toBeNull();
  });

  it("makes the review card agree with the verdict above it", async () => {
    await render(
      fixture({
        reviewPending: true,
        outputDocument,
        activity: [{ id: "c1", kind: "agent", name: "Nova's reviewer", body: PASS }],
      }),
    );
    const card = container.querySelector('[data-testid="work-item-review-card"]');
    expect(card?.textContent).toContain("Nova's reviewer read it");
    expect(card?.textContent).toContain("Read it under Deliverable");
  });
});

describe("step 8 — the composer as quick replies", () => {
  it("offers the everyday chips while the work is open", async () => {
    await render(fixture({ status: "in_progress" }));
    const chips = [...container.querySelectorAll(".work-item-chip")].map((chip) => chip.textContent);
    expect(chips).toEqual(["Ask a question", "Give more context", "Skip this task"]);
  });

  it("offers Approve on a hand-in, and Approve does what the turn bar's Accept does", async () => {
    const onAccept = vi.fn();
    await render(fixture({ reviewPending: true, outputDocument, onAccept }));
    await click('[data-testid="work-item-chip-approve"]');
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it("writes an opening sentence rather than sending anything", async () => {
    const onComment = vi.fn();
    await render(fixture({ status: "in_progress", onComment }));
    await click('[data-testid="work-item-chip-ask"]');
    expect((container.querySelector('[data-testid="work-item-composer-input"]') as HTMLTextAreaElement).value).toBe(
      "A question: ",
    );
    expect(onComment).not.toHaveBeenCalled();
  });

  it("offers no chips once the work is done", async () => {
    await render(fixture({ status: "done" }));
    expect(container.querySelectorAll(".work-item-chip")).toHaveLength(0);
  });
});

describe("the words on screen", () => {
  it("never uses a word from the banned list", async () => {
    await render(
      fixture({
        reviewPending: true,
        outputDocument,
        outputDocumentRevisions: revisions,
        reviewRound: 2,
        guidance: "Add the wine pairing.",
        chain: [
          { id: "mission", label: "Mission", href: "/goals" },
          { id: "g1", label: "Sign up screen", href: "/goals/g1" },
          { id: "task", label: "Write the tasting menu" },
        ],
        activity: [
          { id: "c1", kind: "agent", name: "Nova", body: "Here it is." },
          { id: "s1", kind: "system", text: "Moved to To do" },
          { id: "s2", kind: "system", text: "Given to Nova" },
          { id: "c2", kind: "agent", name: "Nova's reviewer", body: `${FAIL}\n\nThe wine is missing.` },
        ],
      }),
    );
    expect(visibleCopyHasForbiddenWord(text())).toBe(false);
  });
});

describe("step 10 — phone", () => {
  // The phone layout is one column, a turn bar that rides the top of the
  // screen, tabs as a segmented control and chips that scroll sideways. All of
  // it is stylesheet work, so the test holds both ends of the contract: the
  // rules exist under the phone width, and the screen really does render the
  // classes those rules select.
  const css = readFileSync(resolve(process.cwd(), "src/components/work-item/work-item.css"), "utf8");

  /** Everything the stylesheet says under the phone width, as one string. */
  function phoneRules(source: string): string {
    const blocks: string[] = [];
    const opener = "@media (max-width: 720px)";
    let at = source.indexOf(opener);
    while (at >= 0) {
      let depth = 0;
      let index = source.indexOf("{", at);
      const start = index;
      while (index < source.length) {
        if (source[index] === "{") depth += 1;
        if (source[index] === "}") {
          depth -= 1;
          if (depth === 0) break;
        }
        index += 1;
      }
      blocks.push(source.slice(start, index));
      at = source.indexOf(opener, index);
    }
    return blocks.join("\n");
  }

  it("keeps the turn bar at the top of the screen", () => {
    const rules = phoneRules(css);
    expect(rules).toContain(".work-item-turn-bar");
    expect(rules.replace(/\s+/g, " ")).toContain("position: sticky");
  });

  it("turns the tabs into a segmented control with no underline", () => {
    const rules = phoneRules(css).replace(/\s+/g, " ");
    expect(rules).toContain(".work-item-tab-strip");
    expect(rules).toContain(".work-item-tab-current::after { content: none;");
  });

  it("lets the chips scroll sideways rather than wrap", () => {
    const chips = css.slice(css.indexOf(".work-item-chips {"));
    expect(chips.slice(0, chips.indexOf("}")).replace(/\s+/g, " ")).toContain("overflow-x: auto");
    expect(css).toContain("white-space: nowrap");
  });

  it("renders the classes the phone rules are written against", async () => {
    await render(
      fixture({
        reviewPending: true,
        outputDocument,
        outputDocumentRevisions: revisions,
        activity: [{ id: "c1", kind: "agent", name: "Nova", body: "Here it is." }],
      }),
    );
    expect(container.querySelector(".work-item-turn-bar")).not.toBeNull();
    expect(container.querySelector(".work-item-tab-strip")).not.toBeNull();
    expect(container.querySelector(".work-item-tab-current")).not.toBeNull();
    expect(container.querySelector(".work-item-chips")).not.toBeNull();
    expect(container.querySelector(".work-item-chip")).not.toBeNull();
  });
});

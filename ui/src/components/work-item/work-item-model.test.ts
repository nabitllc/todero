import { describe, expect, it } from "vitest";
import {
  AGENT_SUMMARY_LIMIT,
  apiStatusFor,
  agentSummaryOverflowLine,
  agentSummaryRow,
  taskRowLabel,
  buildTrail,
  commitWorkItemStatus,
  displayPriority,
  displayStatus,
  formatTokenCost,
  formatTokenUsage,
  parseWorkItemDescription,
  serializeWorkItemDescription,
  visibleCopyHasForbiddenWord,
  WORK_ITEM_SECTION_TITLES,
} from "./work-item-model";

describe("work-item model", () => {
  it("maps unassigned backlog to New and assigned backlog to To do", () => {
    expect(displayStatus({ status: "backlog" })).toBe("new");
    expect(displayStatus({ status: "backlog", assigneeAgentId: "ron" })).toBe("todo");
    expect(displayStatus({ status: "todo" })).toBe("todo");
    expect(apiStatusFor("new")).toBe("backlog");
  });

  it("treats missing priority as None", () => {
    expect(displayPriority(null)).toBe("none");
    expect(displayPriority(undefined)).toBe("none");
    expect(displayPriority("medium")).toBe("medium");
  });

  it("hides empty description sections and keeps Title Case headings", () => {
    const parsed = parseWorkItemDescription(
      [
        "<!-- todero-type: Feature -->",
        "Mission in the body.",
        "",
        "## Acceptance Criteria",
        "Must work.",
        "",
        "## In Scope",
        "",
        "## Out of Scope",
        "Landing.",
        "",
        "## Testing Strategies",
      ].join("\n"),
    );
    expect(parsed.type).toBe("Feature");
    expect(parsed.body).toBe("Mission in the body.");
    expect(parsed.sections.map((section) => section.title)).toEqual([
      "Acceptance Criteria",
      "Out of Scope",
    ]);
    expect(WORK_ITEM_SECTION_TITLES).toEqual([
      "Acceptance Criteria",
      "In Scope",
      "Out of Scope",
      "Testing Strategies",
    ]);
  });

  it("omits checklist items that are not present", () => {
    const parsed = parseWorkItemDescription("Just a body.");
    expect(parsed.checklist).toEqual([]);
  });

  it("keeps the reviewer's round tally out of the body", () => {
    const parsed = parseWorkItemDescription(
      "<!-- todero-type: Task -->\n<!-- todero-judge-rounds: 1 -->\nWrite the sign up words.",
    );
    expect(parsed.type).toBe("Task");
    expect(parsed.body).toBe("Write the sign up words.");
  });

  it("keeps the manager's own notes out of the body", () => {
    const parsed = parseWorkItemDescription(
      [
        "<!-- todero-type: Task -->",
        "<!-- todero-assigned-by: 0f5f2e36-6a34-4e8a-9b9e-f9f2a7a0f111 -->",
        "<!-- todero-waiting-for-manager-sendback: 0f5f2e36-6a34-4e8a-9b9e-f9f2a7a0f222 -->",
        "<!-- todero-has-guidance -->",
        "Write the sign up words.",
      ].join("\n"),
    );
    expect(parsed.type).toBe("Task");
    expect(parsed.body).toBe("Write the sign up words.");
  });

  it("refuses In progress without an assignee and Blocked without blocked-by", () => {
    expect(
      commitWorkItemStatus({ status: "in_progress", assigned: false, blockedBy: null }),
    ).toEqual({ ok: false, reason: "assignee", caption: "Pick an assignee first." });
    expect(
      commitWorkItemStatus({ status: "blocked", assigned: true, blockedBy: null }),
    ).toMatchObject({ ok: false, reason: "blocked-by" });
    expect(
      commitWorkItemStatus({
        status: "blocked",
        assigned: true,
        blockedBy: { kind: "waiting-on-you" },
      }),
    ).toMatchObject({ ok: true });
  });

  it("formats token cost as an em dash instead of $0.00", () => {
    expect(formatTokenCost(null)).toBe("—");
    expect(formatTokenCost(0)).toBe("—");
    expect(formatTokenCost(undefined)).toBe("—");
    expect(formatTokenCost(123)).toBe("$1.23");
    expect(formatTokenUsage(null)).toBe("—");
    expect(formatTokenUsage({ inputTokens: 0, outputTokens: 0 })).toBe("—");
  });

  it("emits the exact overflow system line for summaries over 140 characters", () => {
    const summary = "a".repeat(312);
    const row = agentSummaryRow("Ron", summary);
    expect(row).toEqual({
      kind: "overflow",
      text: "Ron\u2019s summary was 312 characters (limit 140).",
    });
    expect(agentSummaryOverflowLine("Ron", 312)).toBe(
      `Ron\u2019s summary was 312 characters (limit ${AGENT_SUMMARY_LIMIT}).`,
    );
  });

  it("builds a parent trail with spaced › marks", () => {
    const trail = buildTrail({
      ancestors: [
        { id: "f1", identifier: "FEAT-1" },
        { id: "s3", identifier: "STOR-3" },
      ],
      id: "t9",
      identifier: "TESA-9",
      hrefFor: (id) => `/${id}`,
    });
    expect(trail.map((entry) => entry.identifier).join(" › ")).toBe("FEAT-1 › STOR-3 › TESA-9");
    expect(trail.at(-1)?.current).toBe(true);
  });

  it("round-trips type and waiting-on-you markers in the description", () => {
    const serialized = serializeWorkItemDescription({
      type: "Bug",
      waitingOnYou: true,
      body: "Fix the stamp.",
      sections: [{ title: "In Scope", body: "The stamp." }],
      checklist: [],
    });
    const parsed = parseWorkItemDescription(serialized);
    expect(parsed.type).toBe("Bug");
    expect(parsed.waitingOnYou).toBe(true);
    expect(parsed.body).toContain("Fix the stamp.");
    expect(parsed.sections[0]?.title).toBe("In Scope");
  });

  it("flags issue and disposition in copy", () => {
    expect(visibleCopyHasForbiddenWord("This issue is ready")).toBe(true);
    expect(visibleCopyHasForbiddenWord("disposition")).toBe(true);
    expect(visibleCopyHasForbiddenWord("This task is the work item")).toBe(false);
    for (const word of ["handoff", "run", "wake", "heartbeat"]) {
      expect(visibleCopyHasForbiddenWord(`Nothing says ${word} out loud`)).toBe(true);
    }
    expect(visibleCopyHasForbiddenWord("The reviewer is running it now")).toBe(false);
  });
});

describe("review and plan markers", () => {
  it("parses and strips the markers, and serializes them back", () => {
    const description = "<!-- todero-type: Task -->\n<!-- todero-blocked-by: waiting-on-you -->\n<!-- todero-review: pending -->\nGoal: x\n";
    const parsed = parseWorkItemDescription(description);
    expect(parsed.waitingOnYou).toBe(true);
    expect(parsed.reviewPending).toBe(true);
    expect(parsed.planPending).toBe(false);
    expect(parsed.body).toBe("Goal: x");
    const again = serializeWorkItemDescription({ ...parsed, waitingOnYou: true });
    expect(again).toContain("<!-- todero-review: pending -->");
    expect(again).not.toContain("todero-plan");
  });

  it("labels queued rows", () => {
    expect(taskRowLabel({ status: "todo", queued: true })).toBe("Queued");
    expect(taskRowLabel({ status: "done", queued: true })).toBe("Done");
    expect(taskRowLabel({ status: "todo", queued: false })).toBe("To do");
  });
});


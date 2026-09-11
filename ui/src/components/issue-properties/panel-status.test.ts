import { describe, expect, it } from "vitest";
import {
  PANEL_STATUS_OPTIONS,
  panelQueued,
  panelStatus,
  panelStatusGlyph,
  panelStatusLabel,
  panelStatusOptionLabel,
  panelStatusPatch,
  panelStatusTitle,
} from "./panel-status";

describe("the status the panel reads", () => {
  it("calls an unassigned backlog task New and an assigned one To do", () => {
    expect(panelStatus({ status: "backlog" })).toBe("new");
    expect(panelStatus({ status: "backlog", assigneeAgentId: "agent-1" })).toBe("todo");
    expect(panelStatus({ status: "backlog", assigneeUserId: "user-1" })).toBe("todo");
  });

  it("folds in_review into In progress, the way the chip does", () => {
    expect(panelStatus({ status: "in_review" })).toBe("in_progress");
  });

  it("passes the other five through unchanged", () => {
    expect(panelStatus({ status: "todo" })).toBe("todo");
    expect(panelStatus({ status: "in_progress" })).toBe("in_progress");
    expect(panelStatus({ status: "blocked" })).toBe("blocked");
    expect(panelStatus({ status: "done" })).toBe("done");
    expect(panelStatus({ status: "cancelled" })).toBe("cancelled");
  });
});

describe("queued", () => {
  it("is true only while another task holds this one", () => {
    expect(panelQueued({ status: "blocked" })).toBe(false);
    expect(panelQueued({ status: "blocked", blockedBy: [] })).toBe(false);
    expect(panelQueued({ status: "blocked", blockedBy: [{ id: "a", identifier: "PAP-2" }] })).toBe(true);
  });
});

describe("the words the panel shows", () => {
  it("never says backlog", () => {
    expect(panelStatusLabel({ status: "backlog" })).toBe("New");
    expect(panelStatusLabel({ status: "backlog", assigneeAgentId: "a" })).toBe("To do");
  });

  it("says Queued when the task waits behind another", () => {
    expect(
      panelStatusLabel({ status: "blocked", blockedBy: [{ id: "a", identifier: "PAP-2" }] }),
    ).toBe("Queued");
    expect(panelStatusLabel({ status: "blocked" })).toBe("Blocked");
  });

  it("still says Done for a finished task that once waited on another", () => {
    expect(
      panelStatusLabel({ status: "done", blockedBy: [{ id: "a", identifier: "PAP-2" }] }),
    ).toBe("Done");
  });

  it("offers exactly the six words a person can pick", () => {
    expect(PANEL_STATUS_OPTIONS.map(panelStatusOptionLabel)).toEqual([
      "New",
      "To do",
      "In progress",
      "Blocked",
      "Done",
      "Cancelled",
    ]);
  });
});

describe("the glyph the row draws", () => {
  it("gives a queued task the queued shape", () => {
    expect(
      panelStatusGlyph({ status: "blocked", blockedBy: [{ id: "a", identifier: "PAP-2" }] }),
    ).toBe("in_queue");
  });

  it("draws everything else on its own status", () => {
    expect(panelStatusGlyph({ status: "blocked" })).toBe("blocked");
    expect(panelStatusGlyph({ status: "backlog" })).toBe("backlog");
    expect(panelStatusGlyph({ status: "backlog", assigneeAgentId: "a" })).toBe("todo");
    expect(panelStatusGlyph({ status: "in_review" })).toBe("in_progress");
    expect(panelStatusGlyph({ status: "done" })).toBe("done");
    expect(panelStatusGlyph({ status: "cancelled" })).toBe("cancelled");
  });
});

describe("the hover line", () => {
  it("is just the label when nothing knows why the task is held", () => {
    expect(panelStatusTitle("Queued", null)).toBe("Queued");
    expect(panelStatusTitle("Queued", undefined)).toBe("Queued");
    expect(panelStatusTitle("Blocked", "Blocked")).toBe("Blocked");
  });

  it("keeps the label and appends the reason", () => {
    expect(panelStatusTitle("Queued", "Blocked · waiting on active sub-task PAP-2")).toBe(
      "Queued · waiting on active sub-task PAP-2",
    );
    expect(panelStatusTitle("Blocked", "2 blockers need attention")).toBe(
      "Blocked · 2 blockers need attention",
    );
  });
});

describe("what the panel writes back", () => {
  it("writes backlog for New, so the API and the word agree", () => {
    const result = panelStatusPatch({ status: "todo" }, "new");
    expect(result).toEqual({ ok: true, patch: { status: "backlog" } });
  });

  it("writes the other five straight through", () => {
    expect(panelStatusPatch({ status: "backlog" }, "todo")).toEqual({
      ok: true,
      patch: { status: "todo" },
    });
    expect(panelStatusPatch({ status: "todo", assigneeAgentId: "a" }, "in_progress")).toEqual({
      ok: true,
      patch: { status: "in_progress" },
    });
    expect(panelStatusPatch({ status: "todo" }, "done")).toEqual({
      ok: true,
      patch: { status: "done" },
    });
    expect(panelStatusPatch({ status: "todo" }, "cancelled")).toEqual({
      ok: true,
      patch: { status: "cancelled" },
    });
  });

  it("refuses In progress with nobody on it", () => {
    const result = panelStatusPatch({ status: "todo" }, "in_progress");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.caption).toBe("Pick an assignee first.");
  });

  it("refuses Blocked with nothing blocking it", () => {
    const result = panelStatusPatch({ status: "todo" }, "blocked");
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.caption).toBe("Blocked by is required.");
  });

  it("allows Blocked once a blocker exists, by task or by a question to the person", () => {
    expect(
      panelStatusPatch({ status: "todo", blockedBy: [{ id: "a", identifier: "PAP-2" }] }, "blocked"),
    ).toEqual({ ok: true, patch: { status: "blocked" } });
    expect(
      panelStatusPatch(
        { status: "todo", description: "<!-- todero-blocked-by: waiting-on-you -->\nAsk them." },
        "blocked",
      ),
    ).toEqual({ ok: true, patch: { status: "blocked" } });
  });
});

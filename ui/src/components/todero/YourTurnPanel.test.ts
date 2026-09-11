import { describe, expect, it } from "vitest";
import type { Issue } from "@todero/shared";
import { nextTurnRows, yourTurnRows } from "./YourTurnPanel";

function issue(partial: Partial<Issue> & { identifier: string; description: string; status: string }): Issue {
  return { id: partial.identifier, title: "t", ...partial } as unknown as Issue;
}

describe("yourTurnRows", () => {
  it("keeps only blocked tasks waiting on the person, typed by marker, in task order", () => {
    const rows = yourTurnRows([
      issue({ identifier: "T-3", status: "blocked", description: "<!-- todero-blocked-by: waiting-on-you -->\n<!-- todero-review: pending -->\nx" }),
      issue({ identifier: "T-1", status: "blocked", description: "<!-- todero-blocked-by: waiting-on-you -->\n<!-- todero-plan: pending -->\nx" }),
      issue({ identifier: "T-2", status: "blocked", description: "<!-- todero-blocked-by: waiting-on-you -->\nx" }),
      issue({ identifier: "T-4", status: "blocked", description: "blocked by another task, not by you" }),
      issue({ identifier: "T-5", status: "todo", description: "<!-- todero-blocked-by: waiting-on-you -->\nstale marker" }),
      issue({ identifier: "T-10", status: "blocked", description: "<!-- todero-blocked-by: waiting-on-you -->\nx" }),
    ]);
    expect(rows.map((row) => [row.identifier, row.kind])).toEqual([
      ["T-1", "plan"],
      ["T-2", "question"],
      ["T-3", "review"],
      ["T-10", "question"],
    ]);
    expect(rows[0]!.href).toContain("T-1");
  });
});

describe("nextTurnRows", () => {
  it("offers a row only for a done, parentless task with a non-empty suggestion", () => {
    const rows = nextTurnRows([
      { issue: issue({ identifier: "T-1", status: "done", description: "", parentId: null }), nextProjectName: "a billing dashboard" },
      { issue: issue({ identifier: "T-2", status: "done", description: "", parentId: "T-1" }), nextProjectName: "should be skipped, has a parent" },
      { issue: issue({ identifier: "T-3", status: "in_progress", description: "", parentId: null }), nextProjectName: "should be skipped, not done" },
      { issue: issue({ identifier: "T-4", status: "done", description: "", parentId: null }), nextProjectName: "   " },
    ]);
    expect(rows.map((row) => [row.identifier, row.kind, row.nextProjectName])).toEqual([
      ["T-1", "next", "a billing dashboard"],
    ]);
  });
});

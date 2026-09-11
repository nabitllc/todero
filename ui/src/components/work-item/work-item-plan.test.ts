import { describe, expect, it } from "vitest";
import { planTaskRow, planTaskStatusLabel } from "./work-item-plan";
import type { WorkItemTaskRow } from "./work-item-model";

const row = (overrides: Partial<WorkItemTaskRow>): WorkItemTaskRow => ({
  id: "task-1",
  identifier: "TAM-4",
  title: "Write the tasting menu",
  status: "todo",
  href: "/TAM-4",
  ...overrides,
});

describe("planTaskRow", () => {
  it("has nothing to join to before the plan is approved", () => {
    expect(planTaskRow({ id: "p1", title: "Write the tasting menu" }, undefined)).toBeNull();
    expect(planTaskRow({ id: "p1", title: "Write the tasting menu" }, [])).toBeNull();
  });

  it("matches on the id when the task kept it", () => {
    const kept = row({ id: "p1", title: "Something else entirely" });
    expect(planTaskRow({ id: "p1", title: "Write the tasting menu" }, [kept])).toBe(kept);
  });

  it("falls back to the title, ignoring case and spacing", () => {
    const made = row({ id: "task-9", title: "  write   the TASTING menu " });
    expect(planTaskRow({ id: "p1", title: "Write the tasting menu" }, [made])).toBe(made);
  });

  it("returns nothing when the line was dropped before approval", () => {
    expect(planTaskRow({ id: "p1", title: "Book the room" }, [row({})])).toBeNull();
  });
});

describe("planTaskStatusLabel", () => {
  it("says nothing while the plan has made no tasks", () => {
    expect(planTaskStatusLabel({ id: "p1", title: "Write the tasting menu" }, [])).toBeNull();
  });

  it("reads the task's own status word", () => {
    expect(planTaskStatusLabel({ id: "p1", title: "Write the tasting menu" }, [row({ status: "done" })])).toBe(
      "Done",
    );
    expect(
      planTaskStatusLabel({ id: "p1", title: "Write the tasting menu" }, [row({ status: "in_progress" })]),
    ).toBe("In progress");
  });

  it("says Queued for a task waiting behind another", () => {
    expect(
      planTaskStatusLabel({ id: "p1", title: "Write the tasting menu" }, [row({ queued: true })]),
    ).toBe("Queued");
  });
});

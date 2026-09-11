// Gauntlet item 3: reordering within a Board column changes the task's priority.
// Fails until board-drop.ts exports reorderFor and dropFor returns a priority
// for a same-column drop with a position.
import { describe, expect, it } from "vitest";
import { dropFor, reorderFor, type DropTask } from "./board-drop";

const column = [
  { id: "a", priority: "critical" as const },
  { id: "b", priority: "high" as const },
  { id: "c", priority: "medium" as const },
  { id: "d", priority: "low" as const },
];

function task(overrides: Partial<DropTask> = {}): DropTask {
  return {
    id: "c",
    identifier: "ZZW-4",
    status: "todo",
    assigneeId: "agent-1",
    blockedBy: null,
    paused: false,
    ...overrides,
  } as DropTask;
}

describe("reorderFor", () => {
  it("takes the priority of the card it lands above", () => {
    expect(reorderFor({ column, movedId: "c", toIndex: 0 })).toEqual({ id: "c", priority: "critical" });
    expect(reorderFor({ column, movedId: "d", toIndex: 1 })).toEqual({ id: "d", priority: "high" });
  });

  it("takes the lowest neighbour's priority when it lands at the bottom", () => {
    expect(reorderFor({ column, movedId: "a", toIndex: 3 })).toEqual({ id: "a", priority: "low" });
  });

  it("changes nothing when the card lands where it already is", () => {
    expect(reorderFor({ column, movedId: "b", toIndex: 1 })).toBeNull();
  });
});

describe("a drop inside one column", () => {
  it("is a reorder that carries the new priority", () => {
    const result = dropFor({ task: task(), from: "working", to: "working", column, toIndex: 0 });
    expect(result).toEqual({ action: "reorder", taskId: "c", priority: "critical" });
  });
});

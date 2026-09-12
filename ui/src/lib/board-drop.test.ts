import { describe, expect, it } from "vitest";
import { visibleCopyHasForbiddenWord } from "../components/work-item/work-item-model";
import { BOARD_COLUMNS, type BoardColumn } from "./board-model";
import { cardActionsFor, dropFor, isRefusal, reorderFor, type DropTask, type ReorderCard } from "./board-drop";

function task(overrides: Partial<DropTask> = {}): DropTask {
  return {
    id: "task-1",
    identifier: "TAM-4",
    assigneeAgentId: "agent-1",
    blockedByIdentifier: null,
    openChildCount: 0,
    ...overrides,
  };
}

function drop(from: BoardColumn, to: BoardColumn, overrides: Partial<DropTask> = {}) {
  return dropFor({ task: task(overrides), from, to });
}

describe("what a drop does", () => {
  it("accepts the work when it moves from Your turn to Done", () => {
    const result = drop("your-turn", "done");
    expect(result).toMatchObject({ action: "accept", taskId: "task-1" });
    expect(isRefusal(result)).toBe(false);
    expect((result as { confirm: string }).confirm).toContain("TAM-4");
  });

  it("starts the work when it moves from Queued to Agent working", () => {
    const result = drop("queued", "working");
    expect(result).toMatchObject({ action: "start-now", taskId: "task-1" });
  });

  it("names what it is jumping ahead of", () => {
    const result = drop("queued", "working", { blockedByIdentifier: "TAM-3" });
    expect((result as { confirm: string }).confirm).toBe("Start now, ahead of TAM-3?");
  });

  it("asks plainly when there is nothing to jump ahead of", () => {
    const result = drop("queued", "working");
    expect((result as { confirm: string }).confirm).toBe("Start TAM-4 now?");
  });

  it("parks the work when it moves from Agent working back to Queued", () => {
    const result = drop("working", "queued");
    expect(result).toMatchObject({ action: "park", taskId: "task-1" });
    expect((result as { confirm: string }).confirm).toBe("Park TAM-4 and wait for you?");
  });

  // The order inside a column is the task's priority. Without a position (a
  // phone's buttons, an older caller) a card dropped back on its own column
  // asks nothing and saves nothing.
  it("does nothing, and saves no new order, when a card lands in its own column with no position", () => {
    for (const column of BOARD_COLUMNS) {
      const result = dropFor({ task: task(), from: column, to: column });
      expect(result).toEqual({ action: "reorder", taskId: "task-1" });
    }
  });

  it("carries the new priority when a card lands at a new place in its own column", () => {
    const lane: ReorderCard[] = [
      { id: "top", priority: "critical" },
      { id: "task-1", priority: "medium" },
      { id: "last", priority: "low" },
    ];
    expect(dropFor({ task: task(), from: "working", to: "working", column: lane, toIndex: 0 })).toEqual({
      action: "reorder",
      taskId: "task-1",
      priority: "critical",
    });
    expect(dropFor({ task: task(), from: "working", to: "working", column: lane, toIndex: 1 })).toEqual({
      action: "reorder",
      taskId: "task-1",
    });
  });

  it("refuses to start a paused agent's work and names the button that would", () => {
    const result = drop("queued", "working", { assigneePaused: true, assigneeName: "Nova" });
    expect(result).toEqual({ refused: "Nova is paused. Press Play on Nova first." });
  });

  it("refuses the same way when the card has no name for the agent", () => {
    const result = drop("queued", "working", { assigneePaused: true });
    expect(result).toEqual({ refused: "The agent is paused. Press Play on the agent first." });
  });

  it("refuses to start anything while the organization itself is paused", () => {
    const result = drop("queued", "working", { organizationPaused: true });
    expect(result).toEqual({
      refused: "The organization is paused. Press Play on it, then this can start.",
    });
  });

  it("keeps refusing an unassigned task before it mentions a pause", () => {
    const result = drop("queued", "working", { assigneeAgentId: null, organizationPaused: true });
    expect(result).toEqual({ refused: "Nobody is assigned to TAM-4 yet." });
  });

  it("confirms before anything that changes state", () => {
    for (const [from, to] of [
      ["your-turn", "done"],
      ["queued", "working"],
      ["working", "queued"],
    ] as Array<[BoardColumn, BoardColumn]>) {
      expect((drop(from, to) as { confirm?: string }).confirm).toBeTruthy();
    }
  });
});

describe("what a drop refuses", () => {
  it("refuses every drop onto Your turn, because only the agent hands work in", () => {
    for (const from of BOARD_COLUMNS.filter((column) => column !== "your-turn")) {
      const result = drop(from, "your-turn");
      expect(isRefusal(result)).toBe(true);
      expect((result as { refused: string }).refused).toBe("Only the agent can hand work in.");
    }
  });

  it("refuses every drop onto Review, because the reviewer picks work up itself", () => {
    for (const from of BOARD_COLUMNS.filter((column) => column !== "review")) {
      expect(isRefusal(drop(from, "review"))).toBe(true);
    }
  });

  it("refuses Done from anywhere but Your turn", () => {
    for (const from of ["queued", "working", "review"] as BoardColumn[]) {
      const result = drop(from, "done");
      expect(isRefusal(result)).toBe(true);
      expect((result as { refused: string }).refused).toContain("Accept the work first");
    }
  });

  it("refuses to start a task that is waiting on its own plan", () => {
    const result = drop("queued", "working", { openChildCount: 2 });
    expect(isRefusal(result)).toBe(true);
    expect((result as { refused: string }).refused).toBe("TAM-4 is waiting on its own plan; finish that first.");
  });

  it("refuses to start a task nobody is assigned to", () => {
    const result = drop("queued", "working", { assigneeAgentId: null });
    expect(isRefusal(result)).toBe(true);
    expect((result as { refused: string }).refused).toBe("Nobody is assigned to TAM-4 yet.");
  });

  it("refuses to start work that is already moving", () => {
    for (const from of ["review", "your-turn", "done"] as BoardColumn[]) {
      expect(isRefusal(drop(from, "working"))).toBe(true);
    }
  });

  it("refuses to put anything but Agent working back in the queue", () => {
    for (const from of ["review", "your-turn", "done"] as BoardColumn[]) {
      expect(isRefusal(drop(from, "queued"))).toBe(true);
    }
  });

  it("always gives a reason, in one line, in plain words", () => {
    for (const from of BOARD_COLUMNS) {
      for (const to of BOARD_COLUMNS) {
        const result = drop(from, to, { assigneeAgentId: null, openChildCount: 1 });
        if (!isRefusal(result)) continue;
        expect(result.refused.length).toBeGreaterThan(0);
        expect(result.refused).not.toContain("\n");
        expect(visibleCopyHasForbiddenWord(result.refused)).toBe(false);
      }
    }
  });

  it("gives a refusal in plain words for a pause too", () => {
    for (const overrides of [
      { assigneePaused: true, assigneeName: "Nova" },
      { organizationPaused: true },
    ]) {
      const result = drop("queued", "working", overrides);
      if (!isRefusal(result)) throw new Error("a paused agent must refuse the start");
      expect(visibleCopyHasForbiddenWord(result.refused)).toBe(false);
      expect(result.refused).not.toContain("\n");
    }
  });
});

describe("the buttons that replace the drag", () => {
  it("offers Accept where the work is waiting on the person", () => {
    expect(cardActionsFor("your-turn")).toEqual([{ label: "Accept", to: "done" }]);
  });

  it("offers Start now on a queued card", () => {
    expect(cardActionsFor("queued")).toEqual([{ label: "Start now", to: "working" }]);
  });

  it("offers Park on work the agent is carrying", () => {
    expect(cardActionsFor("working")).toEqual([{ label: "Park", to: "queued" }]);
  });

  it("offers nothing where only the agents act", () => {
    expect(cardActionsFor("review")).toEqual([]);
    expect(cardActionsFor("done")).toEqual([]);
  });

  it("only ever offers a move the drop rules would allow", () => {
    for (const column of BOARD_COLUMNS) {
      for (const action of cardActionsFor(column)) {
        expect(isRefusal(dropFor({ task: task(), from: column, to: action.to }))).toBe(false);
      }
    }
  });
});

describe("reorderFor", () => {
  const lane: ReorderCard[] = [
    { id: "a", priority: "critical" },
    { id: "b", priority: "high" },
    { id: "c", priority: "medium" },
    { id: "d", priority: "low" },
  ];

  it("takes the priority of the card it lands on", () => {
    expect(reorderFor({ column: lane, movedId: "c", toIndex: 0 })).toEqual({ id: "c", priority: "critical" });
    expect(reorderFor({ column: lane, movedId: "a", toIndex: 3 })).toEqual({ id: "a", priority: "low" });
  });

  it("changes nothing when it lands where it was, or on a card of the same priority", () => {
    expect(reorderFor({ column: lane, movedId: "b", toIndex: 1 })).toBeNull();
    expect(reorderFor({ column: [...lane, { id: "e", priority: "low" }], movedId: "e", toIndex: 3 })).toBeNull();
  });

  it("keeps a slot past either end inside the lane", () => {
    expect(reorderFor({ column: lane, movedId: "a", toIndex: 99 })).toEqual({ id: "a", priority: "low" });
    expect(reorderFor({ column: lane, movedId: "d", toIndex: -5 })).toEqual({ id: "d", priority: "critical" });
  });

  it("knows nothing about a card that is not in the lane", () => {
    expect(reorderFor({ column: lane, movedId: "zzz", toIndex: 0 })).toBeNull();
    expect(reorderFor({ column: [], movedId: "a", toIndex: 0 })).toBeNull();
  });
});
